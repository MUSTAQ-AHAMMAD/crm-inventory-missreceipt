const {
  parseTaxRateFraction,
  taxRegimeForRegion,
  buildCreditMemoLine,
  buildCreditMemoPayload,
} = require('../services/creditMemoService');

describe('creditMemoService', () => {
  test('parseTaxRateFraction reads the percent from the classification code', () => {
    expect(parseTaxRateFraction('OUTPUT-GOODS-DOM-15%')).toBeCloseTo(0.15, 5);
    expect(parseTaxRateFraction('OUTPUT-GOODS-DOM-5%')).toBeCloseTo(0.05, 5);
    expect(parseTaxRateFraction('')).toBeCloseTo(0.15, 5); // default KSA VAT
  });

  test('taxRegimeForRegion maps SA/KSA/OM and falls back', () => {
    expect(taxRegimeForRegion('SA')).toBe('KSA REGIME');
    expect(taxRegimeForRegion('ksa')).toBe('KSA REGIME');
    expect(taxRegimeForRegion('SN')).toBe('KSA REGIME');
    expect(taxRegimeForRegion('OM')).toBe('OMAN REGIME');
    expect(taxRegimeForRegion('oman')).toBe('OMAN REGIME');
    expect(taxRegimeForRegion('unknown')).toBe('KSA REGIME');
  });

  test('Oman line carries OM tax name, OMAN REGIME and 5% tax', () => {
    const line = buildCreditMemoLine(
      { MemoLineName: 'Discount Item', Quantity: 1, UnitSellingPrice: -100, TaxClassificationCode: 'OM-OUTPUT-GOODS-DOM-5%' },
      1,
      { region: 'OM' }
    );
    expect(line.TaxClassificationCode).toBe('OM-OUTPUT-GOODS-DOM-5%');
    expect(line.receivablesCreditMemoLineTaxLines[0].TaxRegimeCode).toBe('OMAN REGIME');
    expect(line.receivablesCreditMemoLineTaxLines[0].TaxRateCode).toBe('OM-OUTPUT-GOODS-DOM-5%');
    // 5% of -100 = -5.00
    expect(line.receivablesCreditMemoLineTaxLines[0].TaxAmount).toBe('-5');
  });

  test('buildCreditMemoLine reproduces the returned-item sample (neg qty, pos price, neg tax)', () => {
    // Our source refund line stores a positive quantity with a NEGATIVE price.
    const line = buildCreditMemoLine(
      {
        ItemNumber: '6287020284588',
        Quantity: 1,
        UnitSellingPrice: -14.78,
        SalesOrder: 'HAARARSOQ/13573استرداد الأموال',
        TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
      },
      1,
      { region: 'SA' }
    );

    expect(line).toEqual({
      LineNumber: '1',
      LineQuantityCredit: '-1',
      UnitSellingPrice: '14.78',
      ItemNumber: '6287020284588',
      SalesOrderNumber: 'HAARARSOQ/13573استرداد الأموال', // raw, non-ASCII kept
      TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
      receivablesCreditMemoLineTaxLines: [
        { TaxAmount: '-2.22', TaxRegimeCode: 'KSA REGIME', TaxRateCode: 'OUTPUT-GOODS-DOM-15%' },
      ],
    });
  });

  test('buildCreditMemoLine keeps a price-positive line positive (debit line inside a CM)', () => {
    const line = buildCreditMemoLine(
      { ItemNumber: 'X', Quantity: 1, UnitSellingPrice: 65.22, TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%' },
      2,
      { region: 'SA' }
    );
    expect(line.LineQuantityCredit).toBe('1');
    expect(line.UnitSellingPrice).toBe('65.22');
    expect(line.receivablesCreditMemoLineTaxLines[0].TaxAmount).toBe('9.78'); // +65.22 * 0.15
  });

  test('buildCreditMemoLine uses MemoLine + LineDescription (not MemoLineName/Description)', () => {
    const line = buildCreditMemoLine(
      { MemoLineName: 'Discount Item', Description: 'Discount Item', Quantity: 1, UnitSellingPrice: -260.85, TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%' },
      1,
      { region: 'SA' }
    );
    expect(line).not.toHaveProperty('ItemNumber');
    expect(line).not.toHaveProperty('MemoLineName'); // rejected by Oracle
    expect(line).not.toHaveProperty('Description');   // invalid on a line — must be LineDescription
    expect(line.MemoLine).toBe('Discount Item');
    expect(line.LineDescription).toBe('Discount Item');
    expect(line.LineQuantityCredit).toBe('-1');
    expect(line.UnitSellingPrice).toBe('260.85');
  });

  test('buildCreditMemoPayload assembles the header + lines like the sample', () => {
    const payload = buildCreditMemoPayload({
      BillToCustomerNumber: '146013',
      BillToSite: '130054',
      BusinessUnit: 'Hikayat Anber-KSA',
      TransactionSource: 'Vend Hikayat Anber',
      TransactionType: 'HA Vend Invoice - CN',
      TransactionDate: '2026-07-11',
      AccountingDate: '2026-07-11',
      CrossReference: '14601320260711',
      region: 'SA',
      lines: [
        {
          ItemNumber: '6287020284588',
          Quantity: 1,
          UnitSellingPrice: -14.78,
          SalesOrder: 'HAARARSOQ/13573',
          TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
        },
      ],
    });

    expect(payload).toMatchObject({
      BillToCustomerNumber: '146013',
      BillToSite: '130054',
      BusinessUnit: 'Hikayat Anber-KSA',
      TransactionSource: 'Vend Hikayat Anber',
      TransactionType: 'HA Vend Invoice - CN',
      TransactionDate: '2026-07-11',
      AccountingDate: '2026-07-11',
      CrossReference: '14601320260711',
    });
    expect(payload.receivablesCreditMemoLines).toHaveLength(1);
    expect(payload.receivablesCreditMemoLines[0].LineQuantityCredit).toBe('-1');
  });
});
