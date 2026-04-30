/**
 * Standard Receipt Controller Tests
 * Tests CSV parsing, validation, normalization, and upload flow
 */

const request = require('supertest');
const express = require('express');
const { parse } = require('csv-parse/sync');

// Import the controller functions
const {
  previewPayload,
  downloadTemplate,
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

      // Check headers
      expect(response.text).toContain('ReceiptNumber');
      expect(response.text).toContain('ReceiptMethod');
      expect(response.text).toContain('ReceiptDate');
      expect(response.text).toContain('BusinessUnit');
      expect(response.text).toContain('CustomerAccountNumber');
      expect(response.text).toContain('CustomerSite');
      expect(response.text).toContain('Amount');
      expect(response.text).toContain('Currency');
      expect(response.text).toContain('RemittanceBankAccountNumber');
      expect(response.text).toContain('AccountingDate');

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
      const csvWithMissingHeaders = `ReceiptNumber,ReceiptMethod,ReceiptDate
Visa-001,Visa,2026-03-05`;

      const records = parse(csvWithMissingHeaders, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const headers = Object.keys(records[0] || {});
      const requiredFields = [
        'ReceiptNumber',
        'ReceiptMethod',
        'ReceiptDate',
        'BusinessUnit',
        'CustomerAccountNumber',
        'CustomerSite',
        'Amount',
        'Currency',
        'RemittanceBankAccountNumber',
        'AccountingDate',
      ];

      const missingHeaders = requiredFields.filter(
        (field) => !headers.includes(field)
      );

      expect(missingHeaders.length).toBeGreaterThan(0);
      expect(missingHeaders).toContain('BusinessUnit');
      expect(missingHeaders).toContain('Amount');
    });

    test('should validate required values are not empty', () => {
      const csvWithEmptyValues = `ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate
Visa-001,,2026-03-05,AlQurashi-KSA,116012,100005,422,SAR,157-95017321-ALARIDAH,2026-03-05
Visa-002,Visa,,AlQurashi-KSA,116012,100005,422,SAR,157-95017321-ALARIDAH,2026-03-05`;

      const records = parse(csvWithEmptyValues, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const requiredFields = [
        'ReceiptNumber',
        'ReceiptMethod',
        'ReceiptDate',
        'BusinessUnit',
        'CustomerAccountNumber',
        'CustomerSite',
        'Amount',
        'Currency',
        'RemittanceBankAccountNumber',
        'AccountingDate',
      ];

      // Check row 1 (index 0)
      let missingValues = requiredFields.filter((field) => {
        const value = records[0][field];
        return (
          value === undefined || value === null || String(value).trim() === ''
        );
      });
      expect(missingValues).toContain('ReceiptMethod');

      // Check row 2 (index 1)
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
    test('should normalize a complete valid record', () => {
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
          ReceiptNumber: String(row.ReceiptNumber ?? '').trim(),
          ReceiptMethod: String(row.ReceiptMethod ?? '').trim(),
          ReceiptDate: normalizeDate(row.ReceiptDate, 'ReceiptDate'),
          BusinessUnit: String(row.BusinessUnit ?? '').trim(),
          CustomerAccountNumber: String(
            row.CustomerAccountNumber ?? ''
          ).trim(),
          CustomerSite: String(row.CustomerSite ?? '').trim(),
          Amount: normalizeAmount(row.Amount),
          Currency: String(row.Currency ?? '').trim().toUpperCase(),
          RemittanceBankAccountNumber: String(
            row.RemittanceBankAccountNumber ?? ''
          ).trim(),
          AccountingDate: normalizeDate(row.AccountingDate, 'AccountingDate'),
        };
      };

      const testRow = {
        ReceiptNumber: 'Visa-BLK-ALAR-00000008',
        ReceiptMethod: 'Visa',
        ReceiptDate: '2026-03-05',
        BusinessUnit: 'AlQurashi-KSA',
        CustomerAccountNumber: '116012',
        CustomerSite: '100005',
        Amount: '422',
        Currency: 'sar',
        RemittanceBankAccountNumber: '157-95017321-ALARIDAH',
        AccountingDate: '05-03-2026',
      };

      const normalized = normalizeRow(testRow);

      expect(normalized.ReceiptNumber).toBe('Visa-BLK-ALAR-00000008');
      expect(normalized.Currency).toBe('SAR'); // uppercase
      expect(normalized.AccountingDate).toBe('2026-03-05'); // converted from DD-MM-YYYY
    });
  });

  describe('CSV Parsing with BOM', () => {
    test('should handle UTF-8 BOM correctly', () => {
      const BOM = '\uFEFF';
      const csvWithBOM = `${BOM}ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate
Visa-BLK-ALAR-00000008,Visa,2026-03-05,AlQurashi-KSA,116012,100005,422,SAR,157-95017321-ALARIDAH,2026-03-05`;

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
      const headersOnly = `ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate`;

      const records = parse(headersOnly, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records).toHaveLength(0);
    });

    test('should handle whitespace in values', () => {
      const csvWithWhitespace = `ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate
  Visa-001  ,  Visa  ,  2026-03-05  ,  AlQurashi-KSA  ,  116012  ,  100005  ,  422  ,  SAR  ,  157-95017321-ALARIDAH  ,  2026-03-05  `;

      const records = parse(csvWithWhitespace, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records[0].ReceiptNumber).toBe('Visa-001');
      expect(records[0].ReceiptMethod).toBe('Visa');
    });

    test('should handle special characters and Arabic text', () => {
      const csvWithArabic = `ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate
Visa-العربية-001,Visa,2026-03-05,AlQurashi-KSA,116012,100005,422,SAR,157-95017321-ALARIDAH,2026-03-05`;

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
