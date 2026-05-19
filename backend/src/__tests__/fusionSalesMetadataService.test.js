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
      BillToCustomerName: 'Yasmeen Mall',
      BillToCustomerNumber: '14',
      BillToSite: '14',
    });
  });
});
