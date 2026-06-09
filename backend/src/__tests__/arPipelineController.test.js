/**
 * AR Pipeline Controller Tests
 *
 * Covers:
 *  - createInvoiceBatch: async (non-blocking) response, env validation, background processing
 *  - getInvoiceBatchProgress: valid, not-found, invalid id, access control
 *  - getSummary: result limits applied to prevent memory exhaustion on large datasets
 *  - getPendingApply: result limits, pair matching, already-applied exclusion
 *  - submitApply: date fallback from receipt when invoice txnDate/glDate are null
 *  - listInvoices: pagination
 */

jest.mock('../services/prisma', () => ({
  arInvoiceBatch: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  arInvoiceUpload: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  applyReceiptUpload: {
    create: jest.fn(),
    update: jest.fn(),
  },
  applyReceiptFailure: {
    create: jest.fn(),
  },
  fusionInvoiceHeader: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  fusionInvoiceLine: {
    createMany: jest.fn(),
  },
  fusionStandardReceipt: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  fusionMiscReceipt: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  fusionApplyReceipt: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../services/OracleSoapClient', () => ({
  createOracleSoapClient: jest.fn(() => ({
    callWithCustomEnvelope: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
  })),
}));

jest.mock('axios');

const request = require('supertest');
const express = require('express');
const prisma = require('../services/prisma');
const axios = require('axios');

const {
  createInvoiceBatch,
  getInvoiceBatchProgress,
  getSummary,
  getPendingApply,
  submitApply,
  listInvoices,
  listStandardReceipts,
  listMiscReceipts,
} = require('../controllers/arPipelineController');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApp(handler, role = 'ADMIN') {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((req, _res, next) => { req.user = { id: 1, role }; next(); });
  app.use('/', handler);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const samplePayload = {
  BusinessUnit:        'KSA BU',
  TransactionSource:   'VEND',
  TransactionType:     'INVOICE',
  TransactionDate:     '2026-06-01',
  AccountingDate:      '2026-06-01',
  BillToCustomerName:  'RIYADH STORE',
  BillToCustomerNumber: '12345',
  BillToSite:          'SITE-001',
  PaymentTerms:        'NET30',
  InvoiceCurrencyCode: 'SAR',
  receivablesInvoiceLines: [
    {
      LineNumber: '1',
      ItemNumber: 'ITEM-001',
      Description: 'Widget',
      Quantity: '10',
      UnitSellingPrice: '50',
      TaxClassificationCode: 'SAR-EXEMPT',
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AR Pipeline Controller', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ORACLE_AR_INVOICE_URL = 'http://oracle.example.com/ar-invoice';
    process.env.ORACLE_USERNAME       = 'testuser';
    process.env.ORACLE_PASSWORD       = 'testpass';

    // Default empty responses for summary/pending endpoints
    prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
    prisma.fusionInvoiceHeader.count.mockResolvedValue(0);
    prisma.fusionStandardReceipt.findMany.mockResolvedValue([]);
    prisma.fusionStandardReceipt.count.mockResolvedValue(0);
    prisma.fusionMiscReceipt.findMany.mockResolvedValue([]);
    prisma.fusionMiscReceipt.count.mockResolvedValue(0);
    prisma.fusionApplyReceipt.findMany.mockResolvedValue([]);
    prisma.arInvoiceUpload.create.mockResolvedValue({ id: 99 });
    prisma.arInvoiceUpload.update.mockResolvedValue({});
    prisma.fusionInvoiceHeader.create.mockResolvedValue({ id: 1 });
    prisma.fusionInvoiceLine.createMany.mockResolvedValue({ count: 1 });
  });

  afterAll(() => {
    Object.assign(process.env, origEnv);
  });

  // ── createInvoiceBatch ─────────────────────────────────────────────────────

  describe('POST /create-invoice-batch', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json({ limit: '50mb' }));
      app.use((req, _res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); });
      app.post('/', createInvoiceBatch);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });

    test('returns 400 when payloads is an empty array', async () => {
      const res = await request(app).post('/').send({ payloads: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty/);
    });

    test('returns 400 when payloads is absent', async () => {
      const res = await request(app).post('/').send({});
      expect(res.status).toBe(400);
    });

    test('returns 500 when ORACLE_AR_INVOICE_URL is not configured', async () => {
      delete process.env.ORACLE_AR_INVOICE_URL;
      const res = await request(app).post('/').send({ payloads: [samplePayload] });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/ORACLE_AR_INVOICE_URL/);
    });

    test('returns 500 when Oracle credentials are missing', async () => {
      delete process.env.ORACLE_USERNAME;
      const res = await request(app).post('/').send({ payloads: [samplePayload] });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/credentials/i);
    });

    test('responds immediately with batchId without blocking on Oracle calls', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42, totalRecords: 1 });
      // Oracle never resolves → confirms we don't wait for it
      axios.post.mockImplementation(() => new Promise(() => {}));

      const start = Date.now();
      const res = await request(app).post('/').send({ payloads: [samplePayload] });
      const elapsed = Date.now() - start;

      expect(res.status).toBe(200);
      expect(res.body.batchId).toBe(42);
      expect(res.body.total).toBe(1);
      expect(res.body.message).toMatch(/Processing 1 invoice/);
      // Must respond well under the 30s Oracle timeout
      expect(elapsed).toBeLessThan(3000);
    });

    test('creates ArInvoiceBatch record with correct totalRecords', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42, totalRecords: 2 });
      axios.post.mockImplementation(() => new Promise(() => {}));

      const payloads = [samplePayload, { ...samplePayload, BillToCustomerName: 'JEDDAH STORE' }];
      await request(app).post('/').send({ payloads });

      expect(prisma.arInvoiceBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalRecords: 2,
            status: 'PROCESSING',
            userId: 1,
          }),
        })
      );
    });

    test('background processing uses createMany for invoice lines instead of per-row creates', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42 });
      prisma.arInvoiceBatch.update.mockResolvedValue({});

      const oracleData = {
        ...samplePayload,
        TransactionNumber: '100001',
        CustomerTrxId: '9999',
        receivablesInvoiceLines: samplePayload.receivablesInvoiceLines,
      };
      axios.post.mockResolvedValue({ status: 201, data: oracleData });

      await request(app).post('/').send({ payloads: [samplePayload] });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 150));

      expect(prisma.fusionInvoiceLine.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ invoiceNumber: '100001', lineNumber: 1 }),
          ]),
        })
      );
    });

    test('stores Oracle offset timestamps as UTC-midnight dates', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42 });
      prisma.arInvoiceBatch.update.mockResolvedValue({});

      axios.post.mockResolvedValue({
        status: 201,
        data: {
          ...samplePayload,
          TransactionNumber: '100001',
          CustomerTrxId: '9999',
          TransactionDate: '2025-06-01T00:00:00+03:00',
          AccountingDate: '2025-06-01T12:34:56+03:00',
          receivablesInvoiceLines: [],
        },
      });

      await request(app).post('/').send({ payloads: [samplePayload] });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 150));

      const createCall = prisma.fusionInvoiceHeader.create.mock.calls[0][0];
      expect(createCall.data.txnDate.toISOString()).toBe('2025-06-01T00:00:00.000Z');
      expect(createCall.data.glDate.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    });

    test('background: marks batch SUCCESS when all invoices succeed', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42 });
      prisma.arInvoiceBatch.update.mockResolvedValue({});

      axios.post.mockResolvedValue({
        status: 201,
        data: { ...samplePayload, TransactionNumber: '100001', CustomerTrxId: '9999', receivablesInvoiceLines: [] },
      });

      await request(app).post('/').send({ payloads: [samplePayload] });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 150));

      expect(prisma.arInvoiceBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SUCCESS', successCount: 1, failureCount: 0 }),
        })
      );
    });

    test('background: marks batch FAILED when Oracle returns 4xx', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42 });
      prisma.arInvoiceBatch.update.mockResolvedValue({});

      axios.post.mockResolvedValue({ status: 400, data: { error: 'bad request' } });

      await request(app).post('/').send({ payloads: [samplePayload] });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 150));

      expect(prisma.arInvoiceBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', successCount: 0, failureCount: 1 }),
        })
      );
    });

    test('background: marks batch PARTIAL when some fail', async () => {
      prisma.arInvoiceBatch.create.mockResolvedValue({ id: 42, totalRecords: 2 });
      prisma.arInvoiceBatch.update.mockResolvedValue({});

      axios.post
        .mockResolvedValueOnce({
          status: 201,
          data: { ...samplePayload, TransactionNumber: '100001', CustomerTrxId: '9999', receivablesInvoiceLines: [] },
        })
        .mockResolvedValueOnce({ status: 400, data: { error: 'bad' } });

      const payloads = [samplePayload, { ...samplePayload, BillToCustomerName: 'OTHER' }];
      await request(app).post('/').send({ payloads });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 200));

      expect(prisma.arInvoiceBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PARTIAL', successCount: 1, failureCount: 1 }),
        })
      );
    });
  });

  // ── getInvoiceBatchProgress ────────────────────────────────────────────────

  describe('GET /invoice-batch/:batchId/progress', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); });
      app.get('/:batchId/progress', getInvoiceBatchProgress);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });

    test('returns 400 for non-numeric batchId', async () => {
      const res = await request(app).get('/abc/progress');
      expect(res.status).toBe(400);
    });

    test('returns 404 when batch not found', async () => {
      prisma.arInvoiceBatch.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/999/progress');
      expect(res.status).toBe(404);
    });

    test('returns PROCESSING status with correct progress fields', async () => {
      prisma.arInvoiceBatch.findUnique.mockResolvedValue({
        id: 42, userId: 1, totalRecords: 5, successCount: 2, failureCount: 0, status: 'PROCESSING', message: null,
      });
      const res = await request(app).get('/42/progress');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        batchId: 42, totalRecords: 5, successCount: 2, failureCount: 0, processed: 2, status: 'PROCESSING',
      });
    });

    test('returns SUCCESS status with final counts', async () => {
      prisma.arInvoiceBatch.findUnique.mockResolvedValue({
        id: 42, userId: 1, totalRecords: 3, successCount: 3, failureCount: 0,
        status: 'SUCCESS', message: '3 succeeded, 0 failed out of 3.',
      });
      const res = await request(app).get('/42/progress');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        batchId: 42, totalRecords: 3, successCount: 3, failureCount: 0, processed: 3,
        status: 'SUCCESS', message: '3 succeeded, 0 failed out of 3.',
      });
    });

    test('returns 403 when non-owner USER requests another user\'s batch', async () => {
      const userApp = express();
      userApp.use(express.json());
      userApp.use((req, _res, next) => { req.user = { id: 99, role: 'USER' }; next(); });
      userApp.get('/:batchId/progress', getInvoiceBatchProgress);
      userApp.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

      prisma.arInvoiceBatch.findUnique.mockResolvedValue({ id: 42, userId: 1, totalRecords: 1, successCount: 0, failureCount: 0, status: 'PROCESSING' });
      const res = await request(userApp).get('/42/progress');
      expect(res.status).toBe(403);
    });
  });

  // ── getSummary ─────────────────────────────────────────────────────────────

  describe('GET /summary (getSummary)', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); });
      app.get('/', getSummary);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });

    test('returns summary with zero counts when no data', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        invoiceCount: 0, standardReceiptCount: 0, miscReceiptCount: 0, appliedCount: 0,
      });
    });

    test('enforces take:2000 on invoice query to cap memory usage', async () => {
      await request(app).get('/');
      const call = prisma.fusionInvoiceHeader.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    test('enforces take:2000 on standardReceipt query', async () => {
      await request(app).get('/');
      const call = prisma.fusionStandardReceipt.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    test('enforces take:2000 on miscReceipt query', async () => {
      await request(app).get('/');
      const call = prisma.fusionMiscReceipt.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    test('returns grouped pairs for matching invoice + receipt', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValueOnce([
        { id: 1, txnNumber: 12345, customerTxnId: 999, billToCustName: 'RIYADH STORE', billToAccNumber: 111,
          businessUnit: 'KSA', txnDate: new Date('2026-06-01'), status: 'SUCCESS', txnSource: 'VEND' },
      ]);
      prisma.fusionStandardReceipt.findMany.mockResolvedValueOnce([
        { id: 10, receiptNumber: 'Mada-12345', receiptDate: new Date('2026-06-01'), amount: 500,
          customerId: '111', orgId: '1', receiptMethodId: '5', status: 'SUCCESS' },
      ]);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.invoiceCount).toBe(1);
      expect(res.body.standardReceiptCount).toBe(1);
      expect(res.body.pairs[0].totalReceiptsMatched).toBe(1);
    });
  });

  // ── getPendingApply ────────────────────────────────────────────────────────

  describe('GET /pending-apply (getPendingApply)', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); });
      app.get('/', getPendingApply);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });

    test('returns empty pendingPairs when no data', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ pendingPairs: [], total: 0 });
    });

    test('enforces take:2000 on invoice findMany', async () => {
      await request(app).get('/');
      const call = prisma.fusionInvoiceHeader.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    test('enforces take:2000 on standardReceipt findMany', async () => {
      await request(app).get('/');
      const call = prisma.fusionStandardReceipt.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    test('correctly identifies unapplied invoice–receipt pairs by receipt number suffix', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValueOnce([
        { id: 1, txnNumber: 12345, customerTxnId: 999, billToCustName: 'STORE', businessUnit: 'KSA', txnDate: new Date('2026-06-01') },
      ]);
      prisma.fusionStandardReceipt.findMany.mockResolvedValueOnce([
        { id: 10, receiptNumber: 'Mada-12345', receiptDate: new Date('2026-06-01'), amount: 500 },
      ]);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.pendingPairs).toHaveLength(1);
      expect(res.body.pendingPairs[0]).toMatchObject({ txnNumber: 12345, receiptNumber: 'Mada-12345', amount: 500 });
    });

    test('excludes already-applied pairs from results', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValueOnce([
        { id: 1, txnNumber: 12345, customerTxnId: 999, billToCustName: 'STORE', businessUnit: 'KSA', txnDate: new Date('2026-06-01') },
      ]);
      prisma.fusionStandardReceipt.findMany.mockResolvedValueOnce([
        { id: 10, receiptNumber: 'Mada-12345', receiptDate: new Date('2026-06-01'), amount: 500 },
      ]);
      prisma.fusionApplyReceipt.findMany.mockResolvedValueOnce([
        { txnNumber: 12345, receiptNumber: 'Mada-12345' },
      ]);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.pendingPairs).toHaveLength(0);
    });

    test('includes pair when only some receipts are already applied', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValueOnce([
        { id: 1, txnNumber: 12345, customerTxnId: 999, billToCustName: 'STORE', businessUnit: 'KSA', txnDate: new Date('2026-06-01') },
      ]);
      prisma.fusionStandardReceipt.findMany.mockResolvedValueOnce([
        { id: 10, receiptNumber: 'Mada-12345', receiptDate: new Date('2026-06-01'), amount: 500 },
        { id: 11, receiptNumber: 'Visa-12345', receiptDate: new Date('2026-06-01'), amount: 200 },
      ]);
      prisma.fusionApplyReceipt.findMany.mockResolvedValueOnce([
        { txnNumber: 12345, receiptNumber: 'Mada-12345' },
      ]);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.pendingPairs).toHaveLength(1);
      expect(res.body.pendingPairs[0].receiptNumber).toBe('Visa-12345');
    });
  });

  // ── submitApply ────────────────────────────────────────────────────────────

  describe('POST /submit-apply (submitApply)', () => {
    let app;
    const { createOracleSoapClient } = require('../services/OracleSoapClient');

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); });
      app.post('/', submitApply);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });

    beforeEach(() => {
      process.env.ORACLE_APPLY_RECEIPT_SOAP_URL = 'http://oracle-test/soap';
      prisma.applyReceiptUpload.create.mockResolvedValue({ id: 77 });
      prisma.applyReceiptUpload.update.mockResolvedValue({});
      prisma.fusionApplyReceipt.create.mockResolvedValue({});
      prisma.applyReceiptFailure.create.mockResolvedValue({});
      createOracleSoapClient.mockReturnValue({
        callWithCustomEnvelope: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
      });
    });

    afterEach(() => {
      delete process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;
    });

    test('succeeds using receipt receiptDate when invoice txnDate and glDate are null', async () => {
      // Invoice exists but has no txnDate or glDate
      prisma.fusionInvoiceHeader.findMany.mockResolvedValueOnce([
        {
          txnNumber: 2671614,
          txnSource: 'VEND',
          txnDate: null,
          glDate: null,
        },
      ]);
      // Receipt has a receiptDate that should be used as AccountingDate
      prisma.fusionStandardReceipt.findMany.mockResolvedValueOnce([
        {
          receiptNumber: 'Mada-2671614',
          amount: 422,
          currencyCode: 'SAR',
          receiptDate: new Date('2026-06-01'),
          glDate: null,
        },
      ]);

      const res = await request(app)
        .post('/')
        .send({ pairs: [{ txnNumber: 2671614, receiptNumber: 'Mada-2671614' }] });

      expect(res.status).toBe(200);
      expect(res.body.uploadId).toBe(77);

      // Let the setImmediate background processing run and all async chains settle
      await new Promise((r) => setTimeout(r, 50));

      // Should NOT have logged a failure for missing txnDate
      const failCalls = prisma.applyReceiptFailure.create.mock.calls;
      expect(failCalls).toHaveLength(0);

      // Upload should be updated with 1 success
      const updateCall = prisma.applyReceiptUpload.update.mock.calls[0][0];
      expect(updateCall.data.successCount).toBe(1);
      expect(updateCall.data.failureCount).toBe(0);

      // The SOAP call should have been made with AccountingDate and TxnDate from the receipt
      const soapInstance = createOracleSoapClient.mock.results[0].value;
      const soapArg = soapInstance.callWithCustomEnvelope.mock.calls[0][0];
      expect(soapArg).toContain('<com:AccountingDate>2026-06-01</com:AccountingDate>');
      expect(soapArg).toContain('<com:TxnDate>2026-06-01</com:TxnDate>');
    });

    test('fails with missing txnDate error when both invoice and receipt have no date', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValueOnce([
        { txnNumber: 2671614, txnSource: 'VEND', txnDate: null, glDate: null },
      ]);
      prisma.fusionStandardReceipt.findMany.mockResolvedValueOnce([
        {
          receiptNumber: 'Mada-2671614',
          amount: 422,
          currencyCode: 'SAR',
          receiptDate: null,
          glDate: null,
        },
      ]);

      const res = await request(app)
        .post('/')
        .send({ pairs: [{ txnNumber: 2671614, receiptNumber: 'Mada-2671614' }] });

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      const failCalls = prisma.applyReceiptFailure.create.mock.calls;
      expect(failCalls).toHaveLength(1);
      expect(failCalls[0][0].data.errorMessage).toMatch(/txnDate/);
    });
  });

  // ── listInvoices ───────────────────────────────────────────────────────────

  describe('GET /invoices (listInvoices)', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); });
      app.get('/', listInvoices);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });

    test('returns paginated invoice list with defaults', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
      prisma.fusionInvoiceHeader.count.mockResolvedValue(0);

      const res = await request(app).get('/?page=1&limit=20');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ invoices: [], total: 0, page: 1, limit: 20 });
    });

    test('defaults to page 1 and limit 50', async () => {
      prisma.fusionInvoiceHeader.findMany.mockResolvedValue([]);
      prisma.fusionInvoiceHeader.count.mockResolvedValue(0);

      await request(app).get('/');
      const call = prisma.fusionInvoiceHeader.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(50);
    });
  });
});
