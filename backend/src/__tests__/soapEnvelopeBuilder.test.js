const {
  buildArInvoiceSoapEnvelope,
  sanitizeAccountNumber,
  sanitizeSalesOrder,
} = require('../services/soapEnvelopeBuilder');

describe('sanitizeAccountNumber', () => {
  test('strips a trailing BigInt-literal "n"', () => {
    expect(sanitizeAccountNumber('300000158776674n')).toBe('300000158776674');
  });

  test('passes through a clean numeric string', () => {
    expect(sanitizeAccountNumber('57013')).toBe('57013');
  });

  test('accepts a number', () => {
    expect(sanitizeAccountNumber(14)).toBe('14');
  });

  test('accepts a BigInt', () => {
    expect(sanitizeAccountNumber(300000158776674n)).toBe('300000158776674');
  });

  test('returns empty string for null/undefined', () => {
    expect(sanitizeAccountNumber(null)).toBe('');
    expect(sanitizeAccountNumber(undefined)).toBe('');
  });

  test('sanitized value is safe to convert with BigInt()', () => {
    expect(() => BigInt(sanitizeAccountNumber('300000158776674n'))).not.toThrow();
    expect(BigInt(sanitizeAccountNumber('300000158776674n'))).toBe(300000158776674n);
  });
});

describe('buildArInvoiceSoapEnvelope – BillToAccountNumber', () => {
  test('emits digits only even when the account number carries a stray "n"', () => {
    const xml = buildArInvoiceSoapEnvelope({
      BillToCustomerName: 'RIYADH STORE',
      BillToCustomerNumber: '300000158776674n',
      receivablesInvoiceLines: [],
    });
    expect(xml).toContain('<inv:BillToAccountNumber>300000158776674</inv:BillToAccountNumber>');
    expect(xml).not.toContain('300000158776674n');
  });
});

describe('sanitizeSalesOrder', () => {
  test('strips non-ASCII noise (e.g. Arabic "refund" text) from the order ref', () => {
    expect(sanitizeSalesOrder('REDSEA/60713استرداد الأموال')).toBe('REDSEA/60713');
  });

  test('passes a clean ref through unchanged', () => {
    expect(sanitizeSalesOrder('REDSEA/60775')).toBe('REDSEA/60775');
  });

  test('returns empty string for null', () => {
    expect(sanitizeSalesOrder(null)).toBe('');
  });
});

describe('buildArInvoiceSoapEnvelope – SalesOrder sanitising', () => {
  test('strips non-ASCII noise from a line SalesOrder in the envelope', () => {
    const xml = buildArInvoiceSoapEnvelope({
      BillToCustomerName: 'RED SEA MALL',
      BillToCustomerNumber: '87036',
      receivablesInvoiceLines: [
        { LineNumber: 1, ItemNumber: '6281074733764', Description: 'MUSK', Quantity: 1, UnitSellingPrice: 100.0, SalesOrder: 'REDSEA/60713استرداد الأموال', TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%' },
      ],
    });
    expect(xml).toContain('<inv:SalesOrder>REDSEA/60713</inv:SalesOrder>');
    expect(xml).not.toMatch(/[^\x00-\x7F]/);
  });
});
