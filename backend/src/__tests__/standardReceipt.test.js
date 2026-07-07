/**
 * Standard Receipt Controller Tests (REST).
 * The controller POSTs name/number JSON payloads to Oracle's standardReceipts REST
 * resource. These tests cover CSV validation, normalization, skip rules, dedup,
 * persistence, and the REST POST itself (axios mocked).
 */

jest.mock('../services/prisma', () => ({
  standardReceiptUpload:  { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  fusionStandardReceipt:  { create: jest.fn(), findFirst: jest.fn() },
  standardReceiptFailure: { createMany: jest.fn() },
}));

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('p-limit', () => () => (fn) => fn());

const request = require('supertest');
const express = require('express');
const { parse } = require('csv-parse/sync');
const axios = require('axios');
const prisma = require('../services/prisma');

const {
  previewXml,
  upload,
  downloadTemplate,
  normalizeRow,
  normalizeDate,
  normalizeAmount,
} = require('../controllers/standardReceiptController');

const HEADER = 'ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate';

function csv(rows) {
  return [HEADER, ...rows].join('\n');
}

function buildApp(handler, body) {
  const app = express();
  app.use(express.json());
  app.post('/x', (req, _res, next) => {
    req.user = { id: 1, role: 'ADMIN' };
    if (body !== undefined) req.file = { originalname: 'test.csv', buffer: Buffer.from(body) };
    next();
  }, handler);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('Template Generation', () => {
  test('ships the REST name/number columns and no internal-ID columns', async () => {
    const app = express();
    app.get('/t', downloadTemplate);
    const res = await request(app).get('/t').expect(200).expect('Content-Type', /csv/);
    expect(res.text).toMatch(/^﻿/);
    for (const col of ['ReceiptMethod', 'BusinessUnit', 'CustomerAccountNumber', 'Currency', 'RemittanceBankAccountNumber', 'AccountingDate']) {
      expect(res.text).toContain(col);
    }
    // SOAP-era ID columns must be gone
    expect(res.text).not.toContain('ReceiptMethodId');
    expect(res.text).not.toContain('RegisterName');
    expect(res.text).not.toContain('CustomerId,');
  });
});

describe('Date normalization', () => {
  test('keeps ISO', () => expect(normalizeDate('2026-05-22', 'd')).toBe('2026-05-22'));
  test('DD-MM-YYYY → ISO', () => expect(normalizeDate('22-05-2026', 'd')).toBe('2026-05-22'));
  test('US MM/DD/YYYY (5/22/2026) → ISO', () => expect(normalizeDate('5/22/2026', 'd')).toBe('2026-05-22'));
  test('DD/MM/YYYY where day>12 → ISO', () => expect(normalizeDate('22/05/2026', 'd')).toBe('2026-05-22'));
});

describe('Amount normalization', () => {
  test('strips thousands separators', () => expect(normalizeAmount('22,614.89')).toBe('22614.89'));
  test('throws on non-numeric', () => expect(() => normalizeAmount('abc')).toThrow());
});

describe('normalizeRow (REST payload)', () => {
  test('produces the Oracle REST field set', () => {
    const out = normalizeRow({
      ReceiptNumber: 'Cash-001', ReceiptMethod: 'Cash', ReceiptDate: '5/22/2026',
      BusinessUnit: 'BU', CustomerAccountNumber: '12345', CustomerSite: 'S1',
      Amount: '1,021', Currency: 'sar', RemittanceBankAccountNumber: '67890', AccountingDate: '',
    });
    expect(out).toEqual({
      ReceiptNumber: 'Cash-001', ReceiptMethod: 'Cash', ReceiptDate: '2026-05-22',
      BusinessUnit: 'BU', CustomerAccountNumber: '12345', CustomerSite: 'S1',
      Amount: '1021', Currency: 'SAR', RemittanceBankAccountNumber: '67890',
      AccountingDate: '2026-05-22', // falls back to ReceiptDate when blank
    });
  });
});

describe('CSV validation', () => {
  test('rejects a CSV missing required columns', async () => {
    const app = buildApp(previewXml, 'ReceiptNumber,ReceiptDate\nCash-001,2026-05-22');
    const res = await request(app).post('/x');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required columns/i);
  });

  test('rejects a row missing a required value', async () => {
    const app = buildApp(previewXml, csv(['Cash-001,,2026-05-22,BU,12345,S1,1021,SAR,67890,2026-05-22']));
    const res = await request(app).post('/x');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing values/i);
  });
});

describe('previewXml', () => {
  test('returns the REST JSON payload per row', async () => {
    const app = buildApp(previewXml, csv(['Cash-001,Cash,5/22/2026,BU,12345,S1,1021,SAR,67890,']));
    const res = await request(app).post('/x');
    expect(res.status).toBe(200);
    expect(res.body.previews[0].payload).toMatchObject({
      ReceiptNumber: 'Cash-001', ReceiptMethod: 'Cash', ReceiptDate: '2026-05-22',
      RemittanceBankAccountNumber: '67890', Currency: 'SAR',
    });
  });
});

describe('upload (REST POST)', () => {
  beforeAll(() => {
    process.env.ORACLE_STANDARD_RECEIPT_API_URL = 'https://oracle.test/fscmRestApi/resources/11.13.18.05/standardReceipts';
    process.env.ORACLE_USERNAME = 'OICINT';
    process.env.ORACLE_PASSWORD = 'secret';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.standardReceiptUpload.create.mockResolvedValue({ id: 7 });
    prisma.standardReceiptUpload.update.mockResolvedValue({ id: 7 });
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue(null);
    prisma.fusionStandardReceipt.create.mockResolvedValue({});
    prisma.standardReceiptFailure.createMany.mockResolvedValue({});
    axios.post.mockResolvedValue({ status: 201, data: { ReceiptNumber: 'Cash-001' } });
  });

  test('POSTs the REST JSON payload with Basic auth to the standardReceipts URL', async () => {
    const app = buildApp(upload, csv(['Cash-001,Cash,5/22/2026,BU,12345,S1,1021,SAR,67890,2026-05-22']));
    const res = await request(app).post('/x');
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = axios.post.mock.calls[0];
    expect(url).toContain('/standardReceipts');
    expect(payload).toMatchObject({ ReceiptNumber: 'Cash-001', ReceiptMethod: 'Cash', RemittanceBankAccountNumber: '67890' });
    expect(config.headers.Authorization).toMatch(/^Basic /);
    // Persisted as success
    expect(prisma.fusionStandardReceipt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'Success', receiptNumber: 'Cash-001' }) }));
  });

  test('skips Amount=0, credit, and negative rows without calling Oracle', async () => {
    const app = buildApp(upload, csv([
      'Cash-000,Cash,2026-05-22,BU,12345,S1,0,SAR,67890,2026-05-22',
      'Credit-001,Cash,2026-05-22,BU,12345,S1,50,SAR,67890,2026-05-22',
      'Cash-neg,Cash,2026-05-22,BU,12345,S1,-10,SAR,67890,2026-05-22',
    ]));
    const res = await request(app).post('/x');
    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(3);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('dedup: skips a receipt that already succeeded in Fusion', async () => {
    prisma.fusionStandardReceipt.findFirst.mockResolvedValue({ id: 99 });
    const app = buildApp(upload, csv(['Cash-001,Cash,2026-05-22,BU,12345,S1,1021,SAR,67890,2026-05-22']));
    const res = await request(app).post('/x');
    expect(res.body.skipCount).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('records a failure and persists it when Oracle returns 400', async () => {
    axios.post.mockResolvedValue({ status: 400, data: 'AR-855753 invalid remittance bank account' });
    const app = buildApp(upload, csv(['Cash-001,Cash,2026-05-22,BU,12345,S1,1021,SAR,67890,2026-05-22']));
    const res = await request(app).post('/x');
    expect(res.body.failureCount).toBe(1);
    expect(prisma.standardReceiptFailure.createMany).toHaveBeenCalled();
    expect(prisma.fusionStandardReceipt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'Failed' }) }));
  });
});
