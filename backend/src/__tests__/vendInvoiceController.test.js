const XLSX = require('xlsx');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

const { uploadVendInvoice } = require('../controllers/vendInvoiceController');

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
  },
}));

jest.mock('../services/prisma', () => ({
  fusionInvoiceHeader: {
    findFirst: jest.fn(),
  },
  arInvoiceUpload: {
    findMany: jest.fn(),
  },
}));

jest.mock('../services/fusionSalesMetadataService', () => ({
  findByCustomerType: jest.fn(),
  mapToArInvoiceHeader: jest.fn(),
}));

describe('vendInvoiceController', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prisma.fusionInvoiceHeader.findFirst.mockResolvedValue({ requestId: 100 });
    prisma.arInvoiceUpload.findMany.mockResolvedValue([]);

    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
  });

  test('forces Disscount Item for empty SKU lines and returns payment type stats', async () => {
    XLSX.utils.sheet_to_json
      .mockImplementationOnce(() => ([
        { Store: 'YASMEEN', 'Subinventory code': 'yasmeen', Branch: 'Yasmeen Mall', 'Payment Method': 'Cash' },
        { Store: 'YASMEEN', 'Subinventory code': 'yasmeen', Branch: 'Yasmeen Mall', 'Payment Method': 'Tabby' },
        { Store: 'YASMEEN', 'Subinventory code': 'yasmeen', Branch: 'Yasmeen Mall', 'Payment Method': 'Tamara' },
      ]))
      .mockImplementationOnce(() => ([
        {
          'Order Lines/Order Ref': 'YASMEEN/80963',
          'Order Lines/Order Ref/Date': '2026-05-18',
          'Order Lines/Product Barcode': '',
          'Order Lines/Product': '100% on your order',
          'Order Lines/Base Quantity': 1,
          'Order Lines/Tax Incl': 0,
        },
      ]));

    fusionMetadataService.findByCustomerType.mockImplementation(async (customerType) => ({
      billToName: `${customerType} Customer`,
      billToAccount: customerType === 'TABBY' ? 50011 : customerType === 'TAMARA' ? 69011 : 14,
      siteNumber: customerType === 'TABBY' ? '51100' : customerType === 'TAMARA' ? '51050' : '14',
    }));
    fusionMetadataService.mapToArInvoiceHeader.mockImplementation((metadata) => ({
      BillToCustomerName: metadata.billToName,
      BillToCustomerNumber: String(metadata.billToAccount),
      BillToSite: metadata.siteNumber,
    }));

    const req = {
      files: {
        paymentLines: { name: 'payment.xlsx', data: Buffer.from('payment') },
        salesLines: { name: 'sales.xlsx', data: Buffer.from('sales') },
      },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await uploadVendInvoice(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);

    const response = res.json.mock.calls[0][0];
    expect(response.invoiceTypeStats).toEqual({
      NORMAL: 1,
      TABBY: 1,
      TAMARA: 1,
    });
    expect(response.message).toContain('NORMAL: 1');
    expect(response.message).toContain('TABBY: 1');
    expect(response.message).toContain('TAMARA: 1');

    for (const payload of response.payloads) {
      expect(payload.receivablesInvoiceLines[0]).toMatchObject({
        ItemNumber: '',
        Description: 'Disscount Item',
        MemoLine: 'Disscount Item',
      });
    }
  });
});
