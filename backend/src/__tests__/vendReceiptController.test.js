/**
 * Vend Receipt Controller Tests
 *
 * Covers the lookupCustomerPartyId logic inside submitStandardReceipts:
 *  - Strategy 1: invoice-header → receipt chain
 *  - Strategy 2: bank-account-ID fallback (seeded historical data)
 *  - Correct SOAP CustomerId population
 */

jest.mock('../services/prisma', () => ({
  fusionInvoiceHeader: {
    findMany: jest.fn(),
  },
  fusionStandardReceipt: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../services/OracleSoapClient', () => ({
  createOracleSoapClient: jest.fn(() => ({
    callWithCustomEnvelope: jest.fn().mockResolvedValue({ status: 200 }),
  })),
}));

// Mock axios so Strategy 4 (Oracle REST customer lookup) is controlled in tests
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

// p-limit must resolve immediately in tests
jest.mock('p-limit', () => () => (fn) => fn());

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const prisma = require('../services/prisma');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

const { submitStandardReceipts } = require('../controllers/vendReceiptController');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/submit-standard', (req, _res, next) => {
    req.user = { id: 'test-user' };
    next();
  }, submitStandardReceipts);
  return app;
}

const BASE_PAYLOAD = {
  ReceiptNumber:              'Visa-12345',
  ReceiptDate:                '2025-05-01',
  Amount:                     '1000',
  Currency:                   'SAR',
  ReceiptMethodId:            '300000001518641',
  RemittanceBankAccountNumber: '300000016780340',
  CustomerAccountNumber:      '57013',
  OrgId:                      '300000001421038',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('submitStandardReceipts – lookupCustomerPartyId', () => {
  let app;

  beforeAll(() => {
    process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL = 'http://test.oracle/soap';
    app = buildApp();
  });

  afterAll(() => {
    delete process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.fusionStandardReceipt.create.mockResolvedValue({});
    // Strategy 4: by default Oracle REST returns no customer (simulates unconfigured or not found)
    axios.get.mockResolvedValue({ data: { items: [] } });
  });

  test('strategy 1: resolves party ID via invoice header → receipt chain', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([
      { txnNumber: '12345' },
    ]);
    prisma.fusionStandardReceipt.findFirst
      // First call: receipt-number endsWith match → returns party ID
      .mockResolvedValueOnce({ customerId: '300000001576078' });

    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // SOAP envelope should contain the Oracle party ID (not account number "57013")
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[0].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    expect(soapXml).toContain('300000001576078');
    expect(soapXml).not.toContain('>57013<');
  });

  test('strategy 2: falls back to bank-account-ID lookup when no invoice chain matches', async () => {
    // No invoice headers found → strategy 1 returns null
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    // Bank-account-ID query → finds seeded receipt with correct party ID
    prisma.fusionStandardReceipt.findFirst.mockResolvedValueOnce({
      customerId: '300000001576078',
    });

    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // Verify the fallback DB query was made with the correct bank account ID
    const findFirstCalls = prisma.fusionStandardReceipt.findFirst.mock.calls;
    const bankAccLookup = findFirstCalls.find(
      ([args]) => args?.where?.remittanceBankAccId === '300000016780340'
    );
    expect(bankAccLookup).toBeDefined();

    // SOAP envelope should contain the party ID resolved via the fallback
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[0].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    expect(soapXml).toContain('300000001576078');
    expect(soapXml).not.toContain('>57013<');
  });

  test('fails with missing CustomerId when all DB strategies and Oracle REST return nothing', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    // Strategy 4: Oracle REST returns no customer
    process.env.ORACLE_CUSTOMERS_API_URL = 'http://test.oracle/customers';
    axios.get.mockResolvedValue({ data: { items: [] } });

    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });

    delete process.env.ORACLE_CUSTOMERS_API_URL;

    expect(res.status).toBe(200);
    // Receipt must be counted as failed — sending account number as CustomerId
    // would produce AR_RAPI_CUST_ID_INVALID; failing here is the correct behaviour.
    expect(res.body.failureCount).toBe(1);
    expect(res.body.successCount).toBe(0);
    // SOAP must NOT have been called with the account number as CustomerId
    expect(createOracleSoapClient).not.toHaveBeenCalled();
  });

  test('strategy 4: resolves party ID via Oracle REST customer lookup when DB has no records', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    process.env.ORACLE_CUSTOMERS_API_URL = 'http://test.oracle/customers';
    // Strategy 4: Oracle REST returns CustomerAccountId
    axios.get.mockResolvedValue({ data: { items: [{ CustomerAccountId: '300000001576078' }] } });

    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });

    delete process.env.ORACLE_CUSTOMERS_API_URL;

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // SOAP envelope must contain the Oracle CustomerAccountId (not the account number "57013")
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[0].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    expect(soapXml).toContain('300000001576078');
    expect(soapXml).not.toContain('>57013<');
  });

  test('SOAP success + DB failure: receipt counted as success, error does not propagate', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue({ customerId: '300000001576078' });
    // DB write fails after SOAP succeeds
    prisma.fusionStandardReceipt.create.mockRejectedValue(new Error('DB unavailable'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });

    consoleSpy.mockRestore();

    // SOAP succeeded → must be counted as success despite DB error
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(res.body.failureCount).toBe(0);
  });
});
