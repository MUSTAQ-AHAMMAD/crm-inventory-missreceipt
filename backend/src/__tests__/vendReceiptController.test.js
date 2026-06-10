/**
 * Vend Receipt Controller Tests
 *
 * Covers the lookupCustomerPartyId logic inside submitStandardReceipts:
 *  - Strategy 1:  invoice-header → receipt chain
 *  - Strategy 1b: txnNumber → FusionInvoiceHeader → FusionSalesMetadata → Oracle SOAP → CUST_ACCOUNT_ID
 *  - Strategy 2:  bank-account-ID fallback (seeded historical data)
 *  - Strategy 3b: subinventory → FusionSalesMetadata → Oracle SOAP → CUST_ACCOUNT_ID
 *  - Strategy 4:  Oracle SOAP customer lookup (ReceivablesCustomerProfileService)
 *  - Correct SOAP CustomerId population
 *
 * Also covers generateReceipts:
 *  - Receipt date must equal the payment file date (not the invoice's stored txnDate)
 */

jest.mock('../services/prisma', () => ({
  fusionInvoiceHeader: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  fusionSalesMetadata: {
    findFirst: jest.fn(),
  },
  vendhqRegister: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  fusionStandardReceipt: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  fusionReceiptMethod: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  vendReceiptBatch: {
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
const fileUpload = require('express-fileupload');
const axios = require('axios');
const XLSX = require('xlsx');
const prisma = require('../services/prisma');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

const { submitStandardReceipts, generateReceipts } = require('../controllers/vendReceiptController');

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

function buildGenerateApp() {
  const app = express();
  app.use(fileUpload());
  app.post('/generate', (req, _res, next) => {
    req.user = { id: 'test-user' };
    next();
  }, generateReceipts);
  return app;
}

/** Build a minimal XLSX buffer with payment line rows */
function buildPaymentXlsx(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
    prisma.vendhqRegister.update.mockResolvedValue({});
    // Strategy 4: by default Oracle REST returns no customer (simulates unconfigured or not found)
    axios.get.mockResolvedValue({ data: { items: [] } });
    // Default: all DB lookups return null/empty so strategies fall through cleanly
    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue(null);
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue(null);
    prisma.vendhqRegister.findFirst.mockResolvedValue(null);
  });

  test('strategy 1: resolves party ID via invoice header → receipt chain', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([
      { txnNumber: '12345' },
    ]);
    prisma.fusionStandardReceipt.findFirst
      // First call: dedup check – receipt doesn't already exist
      .mockResolvedValueOnce(null)
      // Second call: receipt-number endsWith match → returns party ID
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
    prisma.fusionStandardReceipt.findFirst
      // First call: dedup check – receipt doesn't already exist
      .mockResolvedValueOnce(null)
      // Second call: bank-account-ID query → finds seeded receipt with correct party ID
      .mockResolvedValueOnce({ customerId: '300000001576078' });

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

  test('strategy 4: resolves party ID via Oracle SOAP customer lookup when DB has no records', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL = 'http://test.oracle/customer-profile';
    // Strategy 4: customer profile SOAP returns CustomerAccountId
    createOracleSoapClient.mockImplementationOnce(() => ({
      callWithCustomEnvelope: jest.fn().mockResolvedValue({
        status: 200,
        data: '<CustomerAccountId>300000001576078</CustomerAccountId>',
      }),
    }));

    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });

    delete process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL;

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // Standard receipt SOAP is results[1]; results[0] is the customer profile client
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[1].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    // SOAP envelope must contain the Oracle CustomerAccountId (not the account number "57013")
    expect(soapXml).toContain('300000001576078');
    expect(soapXml).not.toContain('>57013<');

    // Verify customer profile SOAP was called with the correct account number
    const custProfileClient = createOracleSoapClient.mock.results[0].value;
    const custProfileXml = custProfileClient.callWithCustomEnvelope.mock.calls[0][0];
    expect(custProfileXml).toContain('57013');
    expect(custProfileXml).toContain('getActiveCustomerProfile');
  });

  test('SOAP success + DB failure: receipt counted as success, error does not propagate', async () => {
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    // First call: dedup check – no existing receipt; subsequent calls: return party ID
    prisma.fusionStandardReceipt.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ customerId: '300000001576078' });
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

  test('strategy 1b: resolves CustomerId via txnNumber → FusionInvoiceHeader → FusionSalesMetadata → Oracle SOAP', async () => {
    // No prior receipt records → strategies 1, 2, 3 all return nothing
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    // Strategy 1b: invoice found by txnNumber; metadata found by billToLocation (siteNumber)
    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue({
      billToLocation: '39004',
      billToAccNumber: 55012,
    });
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue({ billToAccount: 55012 });
    // Oracle SOAP converts account number 55012 to real CUST_ACCOUNT_ID
    process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL = 'http://test.oracle/customer-profile';
    createOracleSoapClient.mockImplementationOnce(() => ({
      callWithCustomEnvelope: jest.fn().mockResolvedValue({
        status: 200,
        data: '<CustomerAccountId>300000158776674</CustomerAccountId>',
      }),
    }));

    const payloadWithMeta = {
      ...BASE_PAYLOAD,
      _meta: { subinventory: 'EXBSA', date: '2025-05-01', paymentType: 'NORMAL', txnNumber: '2672577', method: 'Visa' },
    };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let res;
    try {
      res = await request(app)
        .post('/submit-standard')
        .send({ payloads: [payloadWithMeta] });
    } finally {
      consoleSpy.mockRestore();
      delete process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL;
    }

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // Standard receipt SOAP is results[1]; results[0] is the customer profile client
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[1].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    // SOAP envelope must contain the real Oracle CUST_ACCOUNT_ID (not the account number 55012)
    expect(soapXml).toContain('300000158776674');
    expect(soapXml).not.toContain('>55012<');

    // Strategy 1b lookup: FusionInvoiceHeader.findFirst called with the correct txnNumber
    const findFirstCalls = prisma.fusionInvoiceHeader.findFirst.mock.calls;
    const txnLookup = findFirstCalls.find(([args]) => args?.where?.txnNumber === 2672577);
    expect(txnLookup).toBeDefined();
  });

  test('strategy 3a: resolves CustomerId from VendhqRegister.customerAccountId (pre-configured)', async () => {
    // No prior receipt records, no Oracle REST
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue(null);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue(null);
    // VendhqRegister has customerAccountId pre-configured by admin
    prisma.vendhqRegister.findFirst.mockResolvedValue({
      id: 42,
      bankAccountId: '300000016780340',
      cashAccountId: null,
      customerAccountId: '300000001576078',
    });

    const payloadWithMeta = {
      ...BASE_PAYLOAD,
      _meta: { subinventory: 'EXBSA', date: '2025-05-01', paymentType: 'NORMAL', txnNumber: '2671613', method: 'Visa' },
    };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let res;
    try {
      res = await request(app)
        .post('/submit-standard')
        .send({ payloads: [payloadWithMeta] });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // SOAP envelope must contain the pre-configured customerAccountId
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[0].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    expect(soapXml).toContain('300000001576078');

    // Oracle SOAP customer profile must NOT be called since Strategy 3a already resolved the ID
    // Also verify only one SOAP client was created (standard receipt only, no customer profile)
    expect(createOracleSoapClient).toHaveBeenCalledTimes(1);
  });

  test('strategy 3b: auto-caches CUST_ACCOUNT_ID to VendhqRegister.customerAccountId after Oracle SOAP success', async () => {
    // No prior receipt records
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue(null);
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    // VendhqRegister found but customerAccountId not yet set
    prisma.vendhqRegister.findFirst.mockResolvedValue({
      id: 42,
      bankAccountId: '300000016780340',
      cashAccountId: null,
      customerAccountId: null,
    });
    // Strategy 3b: metadata found, Oracle SOAP returns ID
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue({ billToAccount: 55012 });
    process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL = 'http://test.oracle/customer-profile';
    createOracleSoapClient.mockImplementationOnce(() => ({
      callWithCustomEnvelope: jest.fn().mockResolvedValue({
        status: 200,
        data: '<CustomerAccountId>300000158776674</CustomerAccountId>',
      }),
    }));

    const payloadWithMeta = {
      ...BASE_PAYLOAD,
      _meta: { subinventory: 'EXBSA', date: '2025-05-01', paymentType: 'NORMAL', txnNumber: '9999999', method: 'Visa' },
    };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let res;
    try {
      res = await request(app)
        .post('/submit-standard')
        .send({ payloads: [payloadWithMeta] });
    } finally {
      consoleSpy.mockRestore();
      delete process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL;
    }

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // VendhqRegister.update must have been called to cache the resolved ID
    expect(prisma.vendhqRegister.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data:  { customerAccountId: '300000158776674' },
      })
    );
  });

  test('strategy 3b: resolves CustomerId via subinventory → FusionSalesMetadata → Oracle SOAP', async () => {
    // No invoice headers or prior receipts at all (brand-new store)
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue(null); // no invoice for txnNumber
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    // VendhqRegister: no match so strategy 3 finds no candidates
    prisma.vendhqRegister.findFirst.mockResolvedValue(null);
    // Strategy 3b: metadata found directly by subinventory
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue({ billToAccount: 55012 });
    // Oracle SOAP converts account number 55012 to real CUST_ACCOUNT_ID
    process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL = 'http://test.oracle/customer-profile';
    createOracleSoapClient.mockImplementationOnce(() => ({
      callWithCustomEnvelope: jest.fn().mockResolvedValue({
        status: 200,
        data: '<CustomerAccountId>300000158776674</CustomerAccountId>',
      }),
    }));

    const payloadWithMeta = {
      ...BASE_PAYLOAD,
      _meta: { subinventory: 'EXBSA', date: '2025-05-01', paymentType: 'NORMAL', txnNumber: '9999999', method: 'Visa' },
    };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let res;
    try {
      res = await request(app)
        .post('/submit-standard')
        .send({ payloads: [payloadWithMeta] });
    } finally {
      consoleSpy.mockRestore();
      delete process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL;
    }

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);

    // Standard receipt SOAP is results[1]; results[0] is the customer profile client
    const { callWithCustomEnvelope } = createOracleSoapClient.mock.results[1].value;
    const soapXml = callWithCustomEnvelope.mock.calls[0][0];
    // SOAP envelope must contain the real Oracle CUST_ACCOUNT_ID (not the account number 55012)
    expect(soapXml).toContain('300000158776674');
    expect(soapXml).not.toContain('>55012<');

    // Strategy 3b lookup: FusionSalesMetadata.findFirst called with normalized subinventory
    const metaCalls = prisma.fusionSalesMetadata.findFirst.mock.calls;
    const subinvLookup = metaCalls.find(([args]) => args?.where?.subinventory === 'EXBSA');
    expect(subinvLookup).toBeDefined();
  });
});

// ─── Skip-rule tests ──────────────────────────────────────────────────────────

describe('submitStandardReceipts – skip rules', () => {
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
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue(null);
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue(null);
    prisma.vendhqRegister.findFirst.mockResolvedValue(null);
    axios.get.mockResolvedValue({ data: { items: [] } });
  });

  test('skips receipt when Amount is 0', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [{ ...BASE_PAYLOAD, Amount: '0' }] });
    consoleSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(1);
    expect(res.body.successCount).toBe(0);
    expect(res.body.failureCount).toBe(0);
    expect(createOracleSoapClient).not.toHaveBeenCalled();
    expect(res.body.logs[0]).toMatch(/SKIP.*Amount is 0/);
  });

  test('skips receipt when receipt number contains "credit" (case-insensitive)', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [{ ...BASE_PAYLOAD, ReceiptNumber: 'Credit On Cust-99999' }] });
    consoleSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(1);
    expect(res.body.successCount).toBe(0);
    expect(res.body.failureCount).toBe(0);
    expect(createOracleSoapClient).not.toHaveBeenCalled();
    expect(res.body.logs[0]).toMatch(/SKIP.*credit/i);
  });

  test('skips receipt when Amount is negative (handled as misc receipt)', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [{ ...BASE_PAYLOAD, Amount: '-50' }] });
    consoleSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(1);
    expect(res.body.successCount).toBe(0);
    expect(res.body.failureCount).toBe(0);
    expect(createOracleSoapClient).not.toHaveBeenCalled();
    expect(res.body.logs[0]).toMatch(/SKIP.*[Nn]egative/);
  });

  test('skips receipt when it already exists in Fusion (deduplication)', async () => {
    // Dedup check: receipt already exists with status Success
    prisma.fusionStandardReceipt.findFirst.mockResolvedValueOnce({ id: 42 });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });
    consoleSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(1);
    expect(res.body.successCount).toBe(0);
    expect(res.body.failureCount).toBe(0);
    expect(createOracleSoapClient).not.toHaveBeenCalled();
    expect(res.body.logs[0]).toMatch(/SKIP.*already exists/i);

    // Dedup check must have queried by the correct receipt number and status
    const dupCheck = prisma.fusionStandardReceipt.findFirst.mock.calls[0][0];
    expect(dupCheck.where.receiptNumber).toBe('Visa-12345');
    expect(dupCheck.where.status).toBe('Success');
  });

  test('processes normal receipts (positive, no credit, non-zero) without skipping', async () => {
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL = 'http://test.oracle/customer-profile';
    createOracleSoapClient.mockImplementationOnce(() => ({
      callWithCustomEnvelope: jest.fn().mockResolvedValue({
        status: 200,
        data: '<CustomerAccountId>300000001576078</CustomerAccountId>',
      }),
    }));

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app)
      .post('/submit-standard')
      .send({ payloads: [BASE_PAYLOAD] });
    consoleSpy.mockRestore();

    delete process.env.ORACLE_CUSTOMER_PROFILE_SOAP_URL;

    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(0);
    expect(res.body.successCount).toBe(1);
    expect(createOracleSoapClient).toHaveBeenCalled();
  });
});

// ─── generateReceipts – receipt date tests ────────────────────────────────────

describe('generateReceipts – receipt date matches payment file date', () => {
  let app;

  beforeAll(() => {
    app = buildGenerateApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // vendReceiptBatch.create returns a minimal batch record
    prisma.vendReceiptBatch.create.mockResolvedValue({ id: 1 });
    // fusionReceiptMethod: return a method so canonicalName resolves
    prisma.fusionReceiptMethod.findFirst.mockResolvedValue({
      receiptMethodName: 'Mada',
      receiptMethodId: '300000001518641',
      receiptBankCharge: 0.015,
      receiptMethodTax: 0.15,
    });
    prisma.fusionReceiptMethod.findMany.mockResolvedValue([]);
    // VendhqRegister: return a register with bankAccountId
    prisma.vendhqRegister.findFirst.mockResolvedValue({
      registerName: 'EXBSA',
      bankAccountId: '300000016780340',
      bankAccount: 'Test Bank',
      cashAccountId: '',
      region: 'SA',
    });
    // resolveOrgIdByRegion uses fusionStandardReceipt.findFirst
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    // Default: metadata not found (falls through to billToCustName strategy)
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue(null);
  });

  test('receipt date equals payment file date even when matched invoice has a different txnDate', async () => {
    // Invoice in DB is from 2025-03-24 (previous day) — txnDate must NOT bleed into ReceiptDate
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([
      {
        id: 1,
        txnNumber: 2671635,
        txnDate: new Date('2025-03-24T00:00:00.000Z'),
        billToLocation: null,
        billToAccNumber: null,
        billToCustName: 'EXBSA Store',
        businessUnit: 'AlQurashi-KSA',
        status: 'SUCCESS',
        createdAt: new Date('2025-03-24T10:00:00.000Z'),
      },
    ]);

    // Payment file date is 2025-03-25 — this is what the receipt date must be
    const paymentDate = '2025-03-25';
    const xlsxBuffer = buildPaymentXlsx([
      { Date: paymentDate, Store: 'EXBSA', 'Payment Method': 'Mada', Amount: 1000 },
    ]);

    const res = await request(app)
      .post('/generate')
      .field('region', 'SA')
      .attach('paymentLines', xlsxBuffer, 'payments.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.standardPayloads).toBeDefined();
    expect(res.body.standardPayloads.length).toBeGreaterThan(0);

    const stdPayload = res.body.standardPayloads[0];
    // ReceiptDate must equal the payment file date (2025-03-25), not the invoice txnDate (2025-03-24)
    expect(stdPayload.ReceiptDate).toBe(paymentDate);
    expect(stdPayload.AccountingDate).toBe(paymentDate);

    if (res.body.miscPayloads?.length > 0) {
      const miscPayload = res.body.miscPayloads[0];
      expect(miscPayload.ReceiptDate).toBe(paymentDate);
      expect(miscPayload.GlDate).toBe(paymentDate);
      expect(miscPayload.DepositDate).toBe(paymentDate);
    }
  });

  test('receipt date equals payment file date when invoice txnDate matches', async () => {
    // Invoice in DB also from 2025-03-25 — ReceiptDate should still equal payment date
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([
      {
        id: 2,
        txnNumber: 2672610,
        txnDate: new Date('2025-03-25T00:00:00.000Z'),
        billToLocation: null,
        billToAccNumber: null,
        billToCustName: 'EXBSA Store',
        businessUnit: 'AlQurashi-KSA',
        status: 'SUCCESS',
        createdAt: new Date('2025-03-25T08:00:00.000Z'),
      },
    ]);

    const paymentDate = '2025-03-25';
    const xlsxBuffer = buildPaymentXlsx([
      { Date: paymentDate, Store: 'EXBSA', 'Payment Method': 'Mada', Amount: 500 },
    ]);

    const res = await request(app)
      .post('/generate')
      .field('region', 'SA')
      .attach('paymentLines', xlsxBuffer, 'payments.xlsx');

    expect(res.status).toBe(200);
    const stdPayload = res.body.standardPayloads[0];
    expect(stdPayload.ReceiptDate).toBe(paymentDate);
    expect(stdPayload.AccountingDate).toBe(paymentDate);
  });
});
