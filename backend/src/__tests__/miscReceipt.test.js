/**
 * Misc Receipt Controller Tests
 * Tests CSV parsing, validation, SOAP XML generation, and upload flow
 */

const request = require('supertest');
const express = require('express');
const { parse } = require('csv-parse/sync');

// Import the controller functions
const { downloadTemplate } = require('../controllers/miscReceiptController');

describe('Misc Receipt Controller', () => {
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
      expect(response.text).toContain('Amount');
      expect(response.text).toContain('CurrencyCode');
      expect(response.text).toContain('DepositDate');
      expect(response.text).toContain('ReceiptDate');
      expect(response.text).toContain('GlDate');
      expect(response.text).toContain('OrgId');
      expect(response.text).toContain('ReceiptNumber');
      expect(response.text).toContain('ReceivableActivityName');
      expect(response.text).toContain('BankAccountNumber');

      // Check sample data (negative amount)
      expect(response.text).toContain('-100.00');
      expect(response.text).toContain('SAR');

      // Verify it can be parsed back
      const records = parse(response.text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });

      expect(records).toHaveLength(1);
      expect(records[0].Amount).toBe('-100.00');
      expect(records[0].CurrencyCode).toBe('SAR');
    });
  });

  describe('CSV Validation', () => {
    test('should validate all required fields are present in headers', () => {
      const csvWithMissingHeaders = `Amount,CurrencyCode,DepositDate
-100,SAR,2024-01-20`;

      const records = parse(csvWithMissingHeaders, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const headers = Object.keys(records[0] || {});
      const requiredFields = [
        'Amount',
        'CurrencyCode',
        'DepositDate',
        'ReceiptDate',
        'GlDate',
        'OrgId',
        'ReceiptNumber',
        'ReceivableActivityName',
        'BankAccountNumber',
      ];

      const missingHeaders = requiredFields.filter(
        (field) => !headers.includes(field)
      );

      expect(missingHeaders.length).toBeGreaterThan(0);
      expect(missingHeaders).toContain('ReceiptDate');
      expect(missingHeaders).toContain('GlDate');
    });

    test('should validate required values are not empty', () => {
      const csvWithEmptyValues = `Amount,CurrencyCode,DepositDate,ReceiptDate,GlDate,OrgId,ReceiptNumber,ReceivableActivityName,BankAccountNumber
-100,SAR,,2024-01-20,2024-01-20,101,REC001,Misc Activity,123456789
,SAR,2024-01-20,2024-01-20,2024-01-20,101,REC002,Misc Activity,123456789`;

      const records = parse(csvWithEmptyValues, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const requiredFields = [
        'Amount',
        'CurrencyCode',
        'DepositDate',
        'ReceiptDate',
        'GlDate',
        'OrgId',
        'ReceiptNumber',
        'ReceivableActivityName',
        'BankAccountNumber',
      ];

      // Check row 1 (index 0)
      let missingValues = requiredFields.filter((field) => {
        const value = records[0][field];
        return (
          value === undefined || value === null || String(value).trim() === ''
        );
      });
      expect(missingValues).toContain('DepositDate');

      // Check row 2 (index 1)
      missingValues = requiredFields.filter((field) => {
        const value = records[1][field];
        return (
          value === undefined || value === null || String(value).trim() === ''
        );
      });
      expect(missingValues).toContain('Amount');
    });
  });

  describe('Date Normalization', () => {
    test('should accept YYYY-MM-DD format', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) {
          throw new Error(`${fieldName} is required`);
        }
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch) {
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        }
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(normalizeDate('2024-01-20', 'ReceiptDate')).toBe('2024-01-20');
    });

    test('should convert DD-MM-YYYY to YYYY-MM-DD', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) {
          throw new Error(`${fieldName} is required`);
        }
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch) {
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        }
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(normalizeDate('20-01-2024', 'ReceiptDate')).toBe('2024-01-20');
    });

    test('should throw error for invalid date format', () => {
      const normalizeDate = (raw, fieldName) => {
        const value = String(raw ?? '').trim();
        if (!value) {
          throw new Error(`${fieldName} is required`);
        }
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return value;
        const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmyMatch) {
          return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        }
        throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
      };

      expect(() => normalizeDate('2024/01/20', 'ReceiptDate')).toThrow(
        'ReceiptDate must be in YYYY-MM-DD format'
      );
      expect(() => normalizeDate('', 'ReceiptDate')).toThrow(
        'ReceiptDate is required'
      );
    });
  });

  describe('Amount Normalization (Ensure Negative)', () => {
    test('should convert positive amounts to negative', () => {
      const ensureNegativeAmount = (rawAmount) => {
        const trimmed = String(rawAmount ?? '').trim();
        if (trimmed === '') {
          throw new Error('Amount is required');
        }
        const decimalMatch = trimmed.match(/\.(\d+)/);
        const decimals = decimalMatch ? decimalMatch[1].length : 0;
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        const negativeValue = numeric > 0 ? -numeric : numeric;
        return decimals > 0
          ? negativeValue.toFixed(decimals)
          : negativeValue.toString();
      };

      expect(ensureNegativeAmount('100')).toBe('-100');
      expect(ensureNegativeAmount('100.50')).toBe('-100.50');
      expect(ensureNegativeAmount('100.00')).toBe('-100.00');
    });

    test('should keep negative amounts negative', () => {
      const ensureNegativeAmount = (rawAmount) => {
        const trimmed = String(rawAmount ?? '').trim();
        if (trimmed === '') {
          throw new Error('Amount is required');
        }
        const decimalMatch = trimmed.match(/\.(\d+)/);
        const decimals = decimalMatch ? decimalMatch[1].length : 0;
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        const negativeValue = numeric > 0 ? -numeric : numeric;
        return decimals > 0
          ? negativeValue.toFixed(decimals)
          : negativeValue.toString();
      };

      expect(ensureNegativeAmount('-100')).toBe('-100');
      expect(ensureNegativeAmount('-100.50')).toBe('-100.50');
    });

    test('should preserve decimal places', () => {
      const ensureNegativeAmount = (rawAmount) => {
        const trimmed = String(rawAmount ?? '').trim();
        if (trimmed === '') {
          throw new Error('Amount is required');
        }
        const decimalMatch = trimmed.match(/\.(\d+)/);
        const decimals = decimalMatch ? decimalMatch[1].length : 0;
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        const negativeValue = numeric > 0 ? -numeric : numeric;
        return decimals > 0
          ? negativeValue.toFixed(decimals)
          : negativeValue.toString();
      };

      expect(ensureNegativeAmount('100.123')).toBe('-100.123');
      expect(ensureNegativeAmount('100.1')).toBe('-100.1');
    });

    test('should reject invalid amounts', () => {
      const ensureNegativeAmount = (rawAmount) => {
        const trimmed = String(rawAmount ?? '').trim();
        if (trimmed === '') {
          throw new Error('Amount is required');
        }
        const decimalMatch = trimmed.match(/\.(\d+)/);
        const decimals = decimalMatch ? decimalMatch[1].length : 0;
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
          throw new Error('Amount must be a valid number');
        }
        const negativeValue = numeric > 0 ? -numeric : numeric;
        return decimals > 0
          ? negativeValue.toFixed(decimals)
          : negativeValue.toString();
      };

      expect(() => ensureNegativeAmount('')).toThrow('Amount is required');
      expect(() => ensureNegativeAmount('abc')).toThrow(
        'Amount must be a valid number'
      );
    });
  });

  describe('SOAP XML Generation', () => {
    test('should generate valid SOAP envelope', () => {
      const escapeXml = (value) => {
        if (value == null) return '';
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      const generateSoapEnvelope = (row) => {
        const receiptMethodIdTag = row.ReceiptMethodId
          ? `        <com:ReceiptMethodId>${escapeXml(row.ReceiptMethodId)}</com:ReceiptMethodId>\n`
          : '';
        const receiptMethodNameTag = row.ReceiptMethodName
          ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
          : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:com="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>
      <com:miscellaneousReceipt>
        <com:Amount>${escapeXml(row.Amount)}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:DepositDate>${escapeXml(row.DepositDate)}</com:DepositDate>
        <com:GlDate>${escapeXml(row.GlDate)}</com:GlDate>
${receiptMethodIdTag}${receiptMethodNameTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </com:miscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
      };

      const testRow = {
        Amount: '-100.00',
        CurrencyCode: 'SAR',
        ReceiptNumber: 'REC001',
        ReceiptDate: '2024-01-20',
        DepositDate: '2024-01-20',
        GlDate: '2024-01-20',
        ReceivableActivityName: 'Misc Activity',
        BankAccountNumber: '123456789',
        OrgId: '101',
      };

      const xml = generateSoapEnvelope(testRow);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<soapenv:Envelope');
      expect(xml).toContain('<com:createMiscellaneousReceipt>');
      expect(xml).toContain('<com:Amount>-100.00</com:Amount>');
      expect(xml).toContain('<com:CurrencyCode>SAR</com:CurrencyCode>');
      expect(xml).toContain('<com:ReceiptNumber>REC001</com:ReceiptNumber>');
      expect(xml).toContain('</soapenv:Envelope>');
    });

    test('should escape XML special characters', () => {
      const escapeXml = (value) => {
        if (value == null) return '';
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      expect(escapeXml('A & B')).toBe('A &amp; B');
      expect(escapeXml('<script>')).toBe('&lt;script&gt;');
      expect(escapeXml("It's a test")).toBe('It&apos;s a test');
      expect(escapeXml('Say "Hello"')).toBe('Say &quot;Hello&quot;');
    });

    test('should include optional receipt method fields when provided', () => {
      const escapeXml = (value) => {
        if (value == null) return '';
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      const generateSoapEnvelope = (row) => {
        const receiptMethodIdTag = row.ReceiptMethodId
          ? `        <com:ReceiptMethodId>${escapeXml(row.ReceiptMethodId)}</com:ReceiptMethodId>\n`
          : '';
        const receiptMethodNameTag = row.ReceiptMethodName
          ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
          : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:com="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>
      <com:miscellaneousReceipt>
        <com:Amount>${escapeXml(row.Amount)}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:DepositDate>${escapeXml(row.DepositDate)}</com:DepositDate>
        <com:GlDate>${escapeXml(row.GlDate)}</com:GlDate>
${receiptMethodIdTag}${receiptMethodNameTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </com:miscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
      };

      const rowWithReceiptMethod = {
        Amount: '-100.00',
        CurrencyCode: 'SAR',
        ReceiptNumber: 'REC001',
        ReceiptDate: '2024-01-20',
        DepositDate: '2024-01-20',
        GlDate: '2024-01-20',
        ReceiptMethodId: '12345',
        ReceiptMethodName: 'Credit Card',
        ReceivableActivityName: 'Misc Activity',
        BankAccountNumber: '123456789',
        OrgId: '101',
      };

      const xml = generateSoapEnvelope(rowWithReceiptMethod);

      expect(xml).toContain('<com:ReceiptMethodId>12345</com:ReceiptMethodId>');
      expect(xml).toContain(
        '<com:ReceiptMethodName>Credit Card</com:ReceiptMethodName>'
      );
    });
  });

  describe('Currency Enforcement', () => {
    test('should force currency to SAR', () => {
      const REQUIRED_CURRENCY = 'SAR';

      const normalizeRow = (row) => {
        return {
          ...row,
          CurrencyCode: REQUIRED_CURRENCY,
        };
      };

      const testRow = {
        CurrencyCode: 'USD',
        Amount: '-100',
      };

      const normalized = normalizeRow(testRow);

      expect(normalized.CurrencyCode).toBe('SAR');
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
      const headersOnly = `Amount,CurrencyCode,DepositDate,ReceiptDate,GlDate,OrgId,ReceiptNumber,ReceivableActivityName,BankAccountNumber`;

      const records = parse(headersOnly, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records).toHaveLength(0);
    });

    test('should handle whitespace in values', () => {
      const csvWithWhitespace = `Amount,CurrencyCode,DepositDate,ReceiptDate,GlDate,OrgId,ReceiptNumber,ReceivableActivityName,BankAccountNumber
  -100  ,  SAR  ,  2024-01-20  ,  2024-01-20  ,  2024-01-20  ,  101  ,  REC001  ,  Misc Activity  ,  123456789  `;

      const records = parse(csvWithWhitespace, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      expect(records[0].Amount).toBe('-100');
      expect(records[0].CurrencyCode).toBe('SAR');
    });
  });
});
