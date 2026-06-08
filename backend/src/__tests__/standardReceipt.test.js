/**
 * Standard Receipt Controller Tests
 * Tests CSV parsing, validation, normalization, and upload flow
 * (SOAP-based: RegisterName in CSV → RemittanceBankAccountId resolved from VendhqRegister)
 */

jest.mock('../services/prisma', () => ({
  vendhqRegister:          { findFirst: jest.fn() },
  fusionReceiptMethod:     { findFirst: jest.fn() },
  standardReceiptUpload:   { create: jest.fn(), update: jest.fn() },
  fusionStandardReceipt:   { create: jest.fn() },
  standardReceiptFailure:  { createMany: jest.fn() },
}));

jest.mock('../services/OracleSoapClient', () => ({
  createOracleSoapClient: jest.fn(() => ({
    callWithCustomEnvelope: jest.fn(),
  })),
}));

jest.mock('p-limit', () => () => (fn) => fn());

const request = require('supertest');
const express = require('express');
const { parse } = require('csv-parse/sync');
const prisma = require('../services/prisma');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

// Import the controller functions
const {
  previewXml,
  downloadTemplate,
  upload,
} = require('../controllers/standardReceiptController');

describe('Standard Receipt Controller', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
  });

  describe('Template Generation', () => {
    test('should generate valid CSV template with BOM', async () => {
      app.get('/test/template', downloadTemplate);

      const response = await request(app)
        .get('/test/template')
        .expect(200)
        .expect('Content-Type', /csv/);

      // Check for UTF-8 BOM
      expect(response.text).toMatch(/^\uFEFF/);

      // Check SOAP-based headers (RegisterName instead of RemittanceBankAccountId)
      expect(response.text).toContain('ReceiptNumber');
      expect(response.text).toContain('ReceiptDate');
      expect(response.text).toContain('Amount');
      expect(response.text).toContain('CurrencyCode');
      expect(response.text).toContain('ReceiptMethodId');
      expect(response.text).toContain('RegisterName');
      expect(response.text).toContain('CustomerId');
      expect(response.text).toContain('OrgId');

      // Old fields must NOT appear
      expect(response.text).not.toContain('RemittanceBankAccountId');
      expect(response.text).not.toContain('ReceiptMethod,');
      expect(response.text).not.toContain('BusinessUnit');
      expect(response.text).not.toContain('CustomerAccountNumber');
      expect(response.text).not.toContain('CustomerSite');
      expect(response.text).not.toContain('RemittanceBankAccountNumber');
      expect(response.text).not.toContain('AccountingDate');

      // Check sample data
      expect(response.text).toContain('Visa-BLK-ALAR-00000008');
      expect(response.text).toContain('2026-03-05');

      // Verify it can be parsed back
      const records = parse(response.text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });

      expect(records).toHaveLength(1);
      expect(records[0].ReceiptNumber).toBe('Visa-BLK-ALAR-00000008');
    });
  });

  describe('CSV Validation', () => {
    test('should validate all required fields are present in headers', () => {
      const csvWithMissingHeaders = `ReceiptNumber,ReceiptDate
Visa-001,2026-03-05`;

      const records = parse(csvWithMissingHeaders, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const headers = Object.keys(records[0] || {});
      const requiredFields = [
        'ReceiptNumber',
        'ReceiptDate',
        'Amount',
        'CurrencyCode',
        'ReceiptMethodId',
        'RegisterName',
        'CustomerId',
        'OrgId',
      ];

      const missingHeaders = requiredFields.filter(
        (field) => !headers.includes(field)
      );

      expect(missingHeaders.length).toBeGreaterThan(0);
      expect(missingHeaders).toContain('OrgId');
      expect(missingHeaders).toContain('Amount');
    });

    test('should validate required values are not empty', () => {
      const csvWithEmptyValues = `ReceiptNumber,ReceiptDate,Amount,CurrencyCode,ReceiptMethodId,RegisterName,CustomerId,OrgId
Visa-001,2026-03-05,422,SAR,,AZIZMALL,300000001234567,300000001421038
Visa-002,,422,SAR,300000001518646,AZIZMALL,300000001234567,300000001421038`;

      const records = parse(csvWithEmptyValues, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const requiredFields = [
        'ReceiptNumber',
        'ReceiptDate',
        'Amount',
        'CurrencyCode',
        'ReceiptMethodId',
        'RegisterName',
        'CustomerId',
        'OrgId',
      ];

      // Check row 1 (index 0) – empty ReceiptMethodId
      let missingValues = requiredFields.filter((field) => {
        const value = records[0][field];
        return (
          value === undefined || value === null || String(value).trim() === ''
        );
      });
      expect(missingValues).toContain('ReceiptMethodId');

      // Check row 2 (index 1) – empty ReceiptDate
      missingValues = requiredFields.filter((field) => {
        const value = records[1][field];
        return (
          value === undefined || value === null || String(value).trim() === ''
        );
      });
      expect(missingValues).toContain('ReceiptDate');
    });
  });

  describe('Date Normalization', () => {
    test('should accept YYYY-MM-DD format and keep it as-is', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error(`${fieldName} is required`);
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch)
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;
        const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(normalizeDate('2026-03-05', 'ReceiptDate')).toBe('2026-03-05');
    });

    test('should convert DD-MM-YYYY to YYYY-MM-DD', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error(`${fieldName} is required`);
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch)
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;
        const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(normalizeDate('05-03-2026', 'ReceiptDate')).toBe('2026-03-05');
    });

    test('should convert YYYY/MM/DD to YYYY-MM-DD', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error(`${fieldName} is required`);
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch)
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;
        const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(normalizeDate('2026/02/08', 'ReceiptDate')).toBe('2026-02-08');
    });

    test('should convert DD/MM/YYYY to YYYY-MM-DD', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error(`${fieldName} is required`);
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch)
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;
        const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(normalizeDate('08/02/2026', 'ReceiptDate')).toBe('2026-02-08');
    });

    test('should throw error for invalid date format', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error(`${fieldName} is required`);
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch)
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;
        const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(() => normalizeDate('2026.03.05', 'ReceiptDate')).toThrow(
        'ReceiptDate must be in YYYY-MM-DD format'
      );
      expect(() => normalizeDate('', 'ReceiptDate')).toThrow(
        'ReceiptDate is required'
      );
    });
  });

  describe('Amount Normalization', () => {
    test('should accept valid numeric amounts', () => {
      const normalizeAmount = (raw) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error('Amount is required');
        const normalizedValue = value.replace(/,/g, '');
        const numeric = Number(normalizedValue);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        return normalizedValue;
      };

      expect(normalizeAmount('422')).toBe('422');
      expect(normalizeAmount('422.50')).toBe('422.50');
      expect(normalizeAmount('0.01')).toBe('0.01');
    });

    test('should handle comma-separated thousands', () => {
      const normalizeAmount = (raw) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error('Amount is required');
        const normalizedValue = value.replace(/,/g, '');
        const numeric = Number(normalizedValue);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        return normalizedValue;
      };

      expect(normalizeAmount('22,614.89')).toBe('22614.89');
      expect(normalizeAmount('1,000')).toBe('1000');
      expect(normalizeAmount('1,234,567.89')).toBe('1234567.89');
    });

    test('should reject invalid amounts', () => {
      const normalizeAmount = (raw) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error('Amount is required');
        const normalizedValue = value.replace(/,/g, '');
        const numeric = Number(normalizedValue);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        return normalizedValue;
      };

      expect(() => normalizeAmount('')).toThrow('Amount is required');
      expect(() => normalizeAmount('abc')).toThrow(
        'Amount must be a valid number'
      );
      expect(() => normalizeAmount('12.34.56')).toThrow(
        'Amount must be a valid number'
      );
    });
  });

  describe('Full Record Normalization', () => {
    test('should normalize a complete valid record with RegisterName instead of RemittanceBankAccountId', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error(`${fieldName} is required`);
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch)
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;
        const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      const normalizeAmount = (raw) => {
        const value = String(raw ?? '').trim();
        if (!value) throw new Error('Amount is required');
        const normalizedValue = value.replace(/,/g, '');
        const numeric = Number(normalizedValue);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        return normalizedValue;
      };

      const normalizeRow = (row) => {
        return {
          ReceiptNumber:   String(row.ReceiptNumber   ?? '').trim(),
          ReceiptDate:     normalizeDate(row.ReceiptDate, 'ReceiptDate'),
          Amount:          normalizeAmount(row.Amount),
          CurrencyCode:    String(row.CurrencyCode    ?? '').trim().toUpperCase(),
          ReceiptMethodId: String(row.ReceiptMethodId ?? '').trim(),
          RegisterName:    String(row.RegisterName    ?? '').trim(),
          CustomerId:      String(row.CustomerId      ?? '').trim(),
          OrgId:           String(row.OrgId           ?? '').trim(),
        };
      };

      const testRow = {
        ReceiptNumber:   'Visa-BLK-ALAR-00000008',
        ReceiptDate:     '2026-03-05',
        Amount:          '422',
        CurrencyCode:    'sar',
        ReceiptMethodId: '300000001518646',
        RegisterName:    'AZIZMALL',
        CustomerId:      '300000001234567',
        OrgId:           '300000001421038',
      };

      const testRowForDateConversion = { ...testRow, ReceiptDate: '05-03-2026' };

      const normalized = normalizeRow(testRow);

      expect(normalized.ReceiptNumber).toBe('Visa-BLK-ALAR-00000008');
      expect(normalized.CurrencyCode).toBe('SAR'); // uppercased
      expect(normalized.ReceiptMethodId).toBe('300000001518646');
      expect(normalized.RegisterName).toBe('AZIZMALL');
      expect(normalized.CustomerId).toBe('300000001234567');
      expect(normalized.OrgId).toBe('300000001421038');

      const normalizedDateConversion = normalizeRow(testRowForDateConversion);
      expect(normalizedDateConversion.ReceiptDate).toBe('2026-03-05'); // converted from DD-MM-YYYY
    });
  });

  describe('CSV Parsing with BOM', () => {
    test('should handle UTF-8 BOM correctly', () => {
      const BOM = '\uFEFF';
      const csvWithBOM = `${BOM}ReceiptNumber,ReceiptDate,Amount,CurrencyCode,ReceiptMethodId,RegisterName,CustomerId,OrgId
Visa-BLK-ALAR-00000008,2026-03-05,422.00,SAR,300000001518646,AZIZMALL,300000001234567,300000001421038`;

      const records = parse(csvWithBOM, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });

      expect(records).toHaveLength(1);
      expect(records[0].ReceiptNumber).toBe('Visa-BLK-ALAR-00000008');
      // Headers should not have BOM prefix when bom: true is used
      expect(Object.keys(records[0])[0]).toBe('ReceiptNumber');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty CSV file', () => {
      const emptyCSV = '';
      const records = parse(emptyCSV, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records).toHaveLength(0);
    });

    test('should handle CSV with only headers', () => {
      const headersOnly = `ReceiptNumber,ReceiptDate,Amount,CurrencyCode,ReceiptMethodId,RegisterName,CustomerId,OrgId`;

      const records = parse(headersOnly, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records).toHaveLength(0);
    });

    test('should handle whitespace in values', () => {
      const csvWithWhitespace = `ReceiptNumber,ReceiptDate,Amount,CurrencyCode,ReceiptMethodId,RegisterName,CustomerId,OrgId
  Visa-001  ,  2026-03-05  ,  422  ,  SAR  ,  300000001518646  ,  AZIZMALL  ,  300000001234567  ,  300000001421038  `;

      const records = parse(csvWithWhitespace, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records[0].ReceiptNumber).toBe('Visa-001');
      expect(records[0].ReceiptMethodId).toBe('300000001518646');
      expect(records[0].RegisterName).toBe('AZIZMALL');
    });

    test('should handle special characters and Arabic text in ReceiptNumber', () => {
      const csvWithArabic = `ReceiptNumber,ReceiptDate,Amount,CurrencyCode,ReceiptMethodId,RegisterName,CustomerId,OrgId
Visa-العربية-001,2026-03-05,422,SAR,300000001518646,AZIZMALL,300000001234567,300000001421038`;

      const records = parse(csvWithArabic, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });

      expect(records[0].ReceiptNumber).toBe('Visa-العربية-001');
    });
  });
});

// ─── Upload Function Tests ──────────────────────────────────────────────────

const UPLOAD_CSV = [
  'ReceiptNumber,ReceiptDate,Amount,CurrencyCode,ReceiptMethodId,RegisterName,CustomerId,OrgId',
  'Visa-001,2026-03-05,422.00,SAR,300000001518646,AZIZMALL,300000158776674,300000001421038',
].join('\n');

function buildUploadApp() {
  const app = express();
  app.use(express.json());
  app.post('/upload', (req, _res, next) => {
    req.user = { id: 1, role: 'ADMIN' };
    req.file = { originalname: 'test.csv', buffer: Buffer.from(UPLOAD_CSV) };
    next();
  }, upload);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('Upload Function (FusionStandardReceipt persistence)', () => {
  let app;
  let mockSoapClient;

  beforeAll(() => {
    process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL = 'http://test.oracle/soap';
    app = buildUploadApp();
  });

  afterAll(() => {
    delete process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default prisma mocks
    prisma.vendhqRegister.findFirst.mockResolvedValue({
      registerName: 'AZIZMALL',
      bankAccountId: '300000052407289',
      cashAccountId: '300000012345678',
    });
    prisma.fusionReceiptMethod.findFirst.mockResolvedValue({
      receiptMethodId: '300000001518646',
      receiptIsCash: false,
    });
    prisma.standardReceiptUpload.create.mockResolvedValue({
      id: 1,
      userId: 1,
      filename: 'test.csv',
      status: 'PROCESSING',
    });
    prisma.standardReceiptUpload.update.mockResolvedValue({
      id: 1,
      successCount: 1,
      failureCount: 0,
      status: 'SUCCESS',
    });
    prisma.fusionStandardReceipt.create.mockResolvedValue({});
    prisma.standardReceiptFailure.createMany.mockResolvedValue({});

    // Default SOAP mock (success)
    mockSoapClient = { callWithCustomEnvelope: jest.fn().mockResolvedValue({ status: 200, data: 'OK' }) };
    createOracleSoapClient.mockReturnValue(mockSoapClient);
  });

  test('SOAP success: FusionStandardReceipt saved with status Success', async () => {
    const res = await request(app).post('/upload');
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(res.body.failureCount).toBe(0);

    expect(prisma.fusionStandardReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status:              'Success',
          receiptNumber:       'Visa-001',
          remittanceBankAccId: '300000052407289',
          customerId:          '300000158776674',
          orgId:               '300000001421038',
          integMode:           'MANUAL',
        }),
      })
    );
  });

  test('SOAP failure: FusionStandardReceipt saved with status Failed', async () => {
    mockSoapClient.callWithCustomEnvelope.mockRejectedValue(new Error('Oracle SOAP error'));

    const res = await request(app).post('/upload');
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(0);
    expect(res.body.failureCount).toBe(1);

    expect(prisma.fusionStandardReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status:       'Failed',
          receiptNumber: 'Visa-001',
          message:      'Oracle SOAP error',
          integMode:    'MANUAL',
        }),
      })
    );
  });

  test('SOAP success + DB failure: still counted as success, error logged not thrown', async () => {
    prisma.fusionStandardReceipt.create.mockRejectedValue(new Error('DB write error'));

    const res = await request(app).post('/upload');
    expect(res.status).toBe(200);
    // SOAP succeeded so it must be counted as success despite the DB error
    expect(res.body.successCount).toBe(1);
    expect(res.body.failureCount).toBe(0);
  });
});
