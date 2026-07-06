const {
  buildArInvoiceSoapEnvelope,
  sanitizeAccountNumber,
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
