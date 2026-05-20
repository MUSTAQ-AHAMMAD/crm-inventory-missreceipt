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

    for (const payload of response.payloads) {
      const line = payload.receivablesInvoiceLines[0];
      // Discount lines must not include ItemNumber (causes Oracle AR-855636)
      expect(line).not.toHaveProperty('ItemNumber');
      expect(line).toMatchObject({
        Description: 'Disscount Item',
        MemoLine: 'Disscount Item',
      });
    }
  });

  test('supports payment-lines exports with Payments/Payment Method and maps order-level payment types', async () => {
    XLSX.utils.sheet_to_json
      .mockImplementationOnce(() => ([
        { 'Order Ref': 'YASMEEN/90001', Branch: 'YASMEEN', 'Payments/Payment Method': 'TABBY' },
        { 'Order Ref': 'YASMEEN/90002', Branch: 'YASMEEN', 'Payments/Payment Method': 'TAMARA' },
        { 'Order Ref': 'YASMEEN/90003', Branch: 'YASMEEN', 'Payments/Payment Method': 'Cash' },
      ]))
      .mockImplementationOnce(() => ([
        {
          'Order Lines/Order Ref': 'YASMEEN/90001',
          'Order Lines/Order Ref/Date': '2026-05-18',
          'Order Lines/Product Barcode': '111',
          'Order Lines/Product': 'Product 1',
          'Order Lines/Base Quantity': 1,
          'Order Lines/Tax Incl': 100,
        },
        {
          'Order Lines/Order Ref': 'YASMEEN/90002',
          'Order Lines/Order Ref/Date': '2026-05-18',
          'Order Lines/Product Barcode': '222',
          'Order Lines/Product': 'Product 2',
          'Order Lines/Base Quantity': 1,
          'Order Lines/Tax Incl': 200,
        },
        {
          'Order Lines/Order Ref': 'YASMEEN/90003',
          'Order Lines/Order Ref/Date': '2026-05-18',
          'Order Lines/Product Barcode': '333',
          'Order Lines/Product': 'Product 3',
          'Order Lines/Base Quantity': 1,
          'Order Lines/Tax Incl': 300,
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

    expect(response.payloads).toHaveLength(3);
    const comments = response.payloads.map((p) => p.Comments);
    expect(comments.some((c) => c.includes('Tabby payment'))).toBe(true);
    expect(comments.some((c) => c.includes('Tamara payment'))).toBe(true);
    expect(comments.some((c) => c.includes('Cash/Bank payment'))).toBe(true);

    for (const payload of response.payloads) {
      expect(payload.BillToCustomerNumber).not.toBe('');
      expect(payload.BillToSite).not.toBe('');
      expect(payload.receivablesInvoiceLines).toHaveLength(1);
    }
  });

  test('maps bill-to metadata and unit prices when files use alternate header names', async () => {
    XLSX.utils.sheet_to_json
      .mockImplementationOnce(() => ([
        { 'order ref ': 'RASHIDMAD2/4014', 'store ': 'RASHIDMAD2', ' subinventory code ': 'RASHIDMAD2', 'payment method details': 'Tamara' },
      ]))
      .mockImplementationOnce(() => ([
        {
          'order ref': 'RASHIDMAD2/4014',
          'order ref / date': '2026-04-29 10:00:00',
          'product barcode': '6287020283482',
          product: 'Sample Product',
          quantity: 2,
          'unit price': 145.5,
          'payment type': 'Tamara',
        },
      ]));

    fusionMetadataService.findByCustomerType.mockResolvedValue({
      billToName: 'Tamara Customer',
      billToAccount: 69011,
      siteNumber: '51050',
    });
    fusionMetadataService.mapToArInvoiceHeader.mockReturnValue({
      BillToCustomerName: 'Tamara Customer',
      BillToCustomerNumber: '69011',
      BillToSite: '51050',
    });

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
    expect(response.payloads).toHaveLength(1);
    expect(response.payloads[0]).toMatchObject({
      BillToCustomerName: 'Tamara Customer',
      BillToCustomerNumber: '69011',
      BillToSite: '51050',
    });
    expect(response.payloads[0].receivablesInvoiceLines[0]).toMatchObject({
      Quantity: 2,
      UnitSellingPrice: 145.5,
      SalesOrder: 'RASHIDMAD2/4014',
    });
  });
});
