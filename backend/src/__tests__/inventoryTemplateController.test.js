/**
 * Tests for the Inventory Template Generation controller.
 */

const { previewTemplate, downloadTemplate } = require('../controllers/inventoryTemplateController');

function makeReq(csvString) {
  return { file: { buffer: Buffer.from(csvString) } };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(code) {
      this._status = code;
      return { json: (data) => { this._status = code; this._body = data; } };
    },
    json(data) {
      this._body = data;
      return this;
    },
    setHeader(key, value) {
      this._headers[key] = value;
    },
    send(data) {
      this._body = data;
      return this;
    },
  };
  return res;
}

// ─── previewTemplate ─────────────────────────────────────────────────────────

describe('previewTemplate', () => {
  test('returns 400 when no file provided', async () => {
    const req = { file: null };
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/CSV file is required/);
  });

  test('returns 400 for empty CSV', async () => {
    const req = makeReq('');
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  test('returns 400 when required columns are missing', async () => {
    const req = makeReq('SomeColumn\nvalue');
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/missing required columns/i);
  });

  test('parses valid CSV with Order Lines/Order Ref column', async () => {
    const csv = [
      'Order Lines/Order Ref,Order Lines/Product/Barcode,Total',
      'ALARIDAH/8371,12345,10',
    ].join('\n');
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(200);
    const row = res._body.previewRows[0];
    expect(row.SubinventoryCode).toBe('ALARIDAH');
    expect(row.TransactionReference).toBe('ALARIDAH/8371');
    expect(row.ItemNumber).toBe('12345');
    expect(row.TransactionQuantity).toBe(-10);
    expect(row.TransactionTypeName).toBe('Vend Sales Issue');
  });

  test('parses valid CSV with Branch/Name column (Amro export format)', async () => {
    const csv = [
      'Branch/Name,Product/Barcode,Total',
      'ALARIDAH/8371,12345,10',
    ].join('\n');
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(200);
    const row = res._body.previewRows[0];
    expect(row.SubinventoryCode).toBe('ALARIDAH');
    expect(row.TransactionReference).toBe('ALARIDAH/8371');
    expect(row.ItemNumber).toBe('12345');
    expect(row.TransactionQuantity).toBe(-10);
  });

  test('Branch/Name takes lower priority than Order Lines/Order Ref', async () => {
    const csv = [
      'Branch/Name,Order Lines/Order Ref,Order Lines/Product/Barcode,Total',
      'BRANCH/X,ALARIDAH/8371,12345,10',
    ].join('\n');
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(200);
    // Order Lines/Order Ref should be preferred over Branch/Name
    const row = res._body.previewRows[0];
    expect(row.SubinventoryCode).toBe('ALARIDAH');
    expect(row.TransactionReference).toBe('ALARIDAH/8371');
  });

  test('positive quantity becomes negative (Vend Sales Issue)', async () => {
    const csv = 'Order Ref,Product/Barcode,Total\nALARIDAH/1,111,5';
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.previewRows[0].TransactionQuantity).toBe(-5);
    expect(res._body.previewRows[0].TransactionTypeName).toBe('Vend Sales Issue');
  });

  test('REFUND transactions keep positive quantity (Vend RMA)', async () => {
    const csv = 'Order Ref,Product/Barcode,Total,Picking Type/Name\nALARIDAH/1,111,5,REFUND';
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.previewRows[0].TransactionQuantity).toBe(5);
    expect(res._body.previewRows[0].TransactionTypeName).toBe('Vend RMA');
  });

  test('rows with same key are aggregated', async () => {
    const csv = [
      'Order Ref,Product/Barcode,Total',
      'ALARIDAH/1,111,3',
      'ALARIDAH/1,111,7',
    ].join('\n');
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.totalRows).toBe(1);
    expect(res._body.previewRows[0].TransactionQuantity).toBe(-10);
  });

  test('skips rows with missing required fields and returns warnings', async () => {
    const csv = [
      'Order Ref,Product/Barcode,Total',
      ',111,5',  // missing Order Ref
      'ALARIDAH/1,222,3',
    ].join('\n');
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.skippedRows).toBe(1);
    expect(res._body.totalRows).toBe(1);
    expect(res._body.warnings.length).toBeGreaterThan(0);
  });

  test('returns 400 when all rows are skipped', async () => {
    const csv = 'Order Ref,Product/Barcode,Total\n,,\n,,';
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  test('TransactionUnitOfMeasure defaults to Each when not provided', async () => {
    const csv = 'Order Ref,Product/Barcode,Total\nALARIDAH/1,111,5';
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.previewRows[0].TransactionUnitOfMeasure).toBe('Each');
  });

  test('uses provided unit of measure over default', async () => {
    const csv = 'Order Ref,Product/Barcode,Total,Base UoM\nALARIDAH/1,111,5,KG';
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.previewRows[0].TransactionUnitOfMeasure).toBe('KG');
  });

  test('returns 400 for future dates', async () => {
    const csv = 'Order Ref,Product/Barcode,Total,Order Lines/Order Ref/Date\nALARIDAH/1,111,5,2099-01-01';
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    // All rows skipped due to future date → 400
    expect(res._status).toBe(400);
  });

  test('preview is capped at 50 rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      `BRANCH/${i},ITEM${i},1`
    );
    const csv = ['Order Ref,Product/Barcode,Total', ...rows].join('\n');
    const req = makeReq(csv);
    const res = makeRes();
    await previewTemplate(req, res, jest.fn());
    expect(res._body.totalRows).toBe(60);
    expect(res._body.previewRows.length).toBe(50);
  });
});

// ─── downloadTemplate ────────────────────────────────────────────────────────

describe('downloadTemplate', () => {
  test('returns 400 when no file provided', async () => {
    const req = { file: null };
    const res = makeRes();
    await downloadTemplate(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/CSV file is required/);
  });

  test('returns CSV content for valid input', async () => {
    const csv = 'Order Ref,Product/Barcode,Total\nALARIDAH/8371,12345,10';
    const req = makeReq(csv);
    const res = makeRes();
    await downloadTemplate(req, res, jest.fn());
    expect(typeof res._body).toBe('string');
    expect(res._body).toContain('TransactionTypeName');
    expect(res._body).toContain('Vend Sales Issue');
    expect(res._body).toContain('ALARIDAH');
  });

  test('returns CSV with UTF-8 BOM', async () => {
    const csv = 'Order Ref,Product/Barcode,Total\nALARIDAH/8371,12345,10';
    const req = makeReq(csv);
    const res = makeRes();
    await downloadTemplate(req, res, jest.fn());
    expect(res._body.startsWith('\uFEFF')).toBe(true);
  });

  test('Branch/Name alias works for download', async () => {
    const csv = 'Branch/Name,Product/Barcode,Total\nALARIDAH/8371,12345,10';
    const req = makeReq(csv);
    const res = makeRes();
    await downloadTemplate(req, res, jest.fn());
    expect(typeof res._body).toBe('string');
    expect(res._body).toContain('ALARIDAH');
    expect(res._body).toContain('ALARIDAH/8371');
  });
});
