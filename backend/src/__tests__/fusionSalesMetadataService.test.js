const prisma = require('../services/prisma');
const service = require('../services/fusionSalesMetadataService');

jest.mock('../services/prisma', () => ({
  fusionSalesMetadata: {
    findFirst: jest.fn(),
  },
}));

describe('fusionSalesMetadataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('findByCustomerType normalizes customer type and subinventory', async () => {
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue({ rowId: 1 });

    await service.findByCustomerType(' tabby ', ' yasmeen ');

    expect(prisma.fusionSalesMetadata.findFirst).toHaveBeenCalledWith({
      where: {
        customerType: 'TABBY',
        subinventory: 'YASMEEN',
      },
    });
  });

  test('findBySalesHeader normalizes subinventory', async () => {
    prisma.fusionSalesMetadata.findFirst.mockResolvedValue({ rowId: 2 });

    await service.findBySalesHeader('  Yasmeen Mall  ', ' yasmeen ');

    expect(prisma.fusionSalesMetadata.findFirst).toHaveBeenCalledWith({
      where: {
        billToName: 'Yasmeen Mall',
        subinventory: 'YASMEEN',
      },
    });
  });

  test('mapToArInvoiceHeader maps bill-to account and site fields', () => {
    const mapped = service.mapToArInvoiceHeader({
      businessUnit: 'AlQurashi-KSA',
      txnSource: 'Vend',
      txnType: 'Vend Invoice',
      billToName: 'Yasmeen Mall',
      billToAccount: 14,
      siteNumber: '14',
    });

    expect(mapped).toEqual({
      BusinessUnit: 'AlQurashi-KSA',
      TransactionSource: 'Vend',
      TransactionType: 'Vend Invoice',
      // No explicit override → derived from the invoice type (append " - CN").
      CreditMemoTransactionType: 'Vend Invoice - CN',
      BillToCustomerName: 'Yasmeen Mall',
      BillToCustomerNumber: '14',
      BillToSite: '14',
      // Defaults to 'User' when rateIsCorporate is not '1'
      ConversionRateType: 'User',
    });
  });

  test('mapToArInvoiceHeader prefers the explicit txnTypeCreditMemo override over derivation', () => {
    const mapped = service.mapToArInvoiceHeader({
      businessUnit: 'Hikayat Anber-KSA',
      txnSource: 'Vend Hikayat Anber',
      txnType: 'HA Vend Invoice',
      txnTypeCreditMemo: 'HA Vend Credit Memo Special',
      billToName: 'Hikayat Anber',
      billToAccount: 127018,
      siteNumber: '112033',
    });

    expect(mapped.CreditMemoTransactionType).toBe('HA Vend Credit Memo Special');
  });

  test('deriveCreditMemoType appends " - CN" to the invoice type (idempotent)', () => {
    expect(service.deriveCreditMemoType('Vend Invoice')).toBe('Vend Invoice - CN');
    expect(service.deriveCreditMemoType('Vend Invoice Oman')).toBe('Vend Invoice Oman - CN');
    expect(service.deriveCreditMemoType('HA Vend Invoice')).toBe('HA Vend Invoice - CN');
    // Already a credit-memo type → returned unchanged.
    expect(service.deriveCreditMemoType('Vend Invoice - CN')).toBe('Vend Invoice - CN');
    expect(service.deriveCreditMemoType(null)).toBeNull();
    expect(service.deriveCreditMemoType('')).toBeNull();
  });

  test('mapToArInvoiceHeader sets ConversionRateType to Corporate when rateIsCorporate is "1"', () => {
    const mapped = service.mapToArInvoiceHeader({
      businessUnit: 'AlQurashi-KSA',
      txnSource: 'Vend',
      txnType: 'Vend Invoice',
      billToName: 'Yasmeen Mall',
      billToAccount: 14,
      siteNumber: '14',
      rateIsCorporate: '1',
    });

    expect(mapped.ConversionRateType).toBe('Corporate');
  });
});
