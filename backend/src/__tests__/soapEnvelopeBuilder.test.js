const {
  buildArInvoiceSoapEnvelope,
  sanitizeAccountNumber,
  sanitizeSalesOrder,
  mapUomCode,
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

describe('mapUomCode', () => {
  test('maps Each variants to Oracle "Ea"', () => {
    expect(mapUomCode('Each')).toBe('Ea');
    expect(mapUomCode('EA')).toBe('Ea');
    expect(mapUomCode('ea')).toBe('Ea');
  });

  test('maps Gram variants to Oracle "G"', () => {
    expect(mapUomCode('Gram')).toBe('G');
    expect(mapUomCode('grams')).toBe('G');
    expect(mapUomCode('G')).toBe('G');
    expect(mapUomCode('GR')).toBe('G');
  });

  test('falls back to "Ea" for blank/unknown units', () => {
    expect(mapUomCode('')).toBe('Ea');
    expect(mapUomCode(null)).toBe('Ea');
    expect(mapUomCode(undefined)).toBe('Ea');
    expect(mapUomCode('Litre')).toBe('Ea');
  });
});

describe('buildArInvoiceSoapEnvelope – per-line UOM', () => {
  test('emits the mapped Oracle UOM code (Gram → G) on the Quantity element', () => {
    const xml = buildArInvoiceSoapEnvelope({
      BillToCustomerName: 'RED SEA MALL',
      BillToCustomerNumber: '87036',
      receivablesInvoiceLines: [
        { LineNumber: 1, ItemNumber: '1024391783', Description: 'MUSK-ALQURASHI/ Gram', Quantity: 5, UnitSellingPrice: 10, UomCode: 'Gram', SalesOrder: 'REDSEA/60713', TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%' },
        { LineNumber: 2, ItemNumber: '6281074733764', Description: 'MUSK/ Each', Quantity: 1, UnitSellingPrice: 100, UomCode: 'Each', SalesOrder: 'REDSEA/60713', TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%' },
      ],
    });
    expect(xml).toContain('<inv:Quantity unitCode="G">5</inv:Quantity>');
    expect(xml).toContain('<inv:Quantity unitCode="Ea">1</inv:Quantity>');
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
