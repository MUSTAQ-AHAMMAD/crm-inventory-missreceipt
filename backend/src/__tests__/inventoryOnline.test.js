/**
 * Unit tests for the "Online" (Oracle FBDI) inventory upload mapping:
 * FBDI column headers → canonical fields → Oracle REST payload, plus the
 * Excel-serial date handling and per-row organization validation.
 */

const { _test } = require('../controllers/inventoryController');
const { normalizeOnlineRow, normalizeRow, mapRowToPayload, validateRow, maybeExcelSerialToDate, normalizeUom } = _test;

// A row mirroring the sample filled into the Oracle template (row 5), with the
// asterisks/spacing the template uses on required headers.
function sampleOnlineRow() {
  return {
    '* ORGANIZATION_NAME': 'Online Store',
    'ITEM_NUMBER': '6287020282591',
    'SUBINVENTORY_CODE': 'Shipped',
    '*TRANSACTION_QUANTITY': '-1',
    'TRANSACTION_UOM': 'Ea',
    'TRANSACTION_UNIT_OF_MEASURE': '',
    'TRANSACTION_DATE': '2026-08-27',
    'TRANSACTION_TYPE_NAME': 'Online sales',
    'TRANSACTION_REFERENCE': 'Completed no.276752514',
    '*SOURCE_CODE': 'SR',
    '*SOURCE_HEADER_ID': '123456',
    '*SOURCE_LINE_ID': '121364',
    '*TRANSACTION_MODE': '2',
    '*USE_CURRENT_COST': '',
    'DST_SEGMENT1': '01',
    'DST_SEGMENT2': '000',
    'DST_SEGMENT3': '1410',
    'DST_SEGMENT4': '0000',
    'DST_SEGMENT5': '000',
    'DST_SEGMENT6': '0000',
    'DST_SEGMENT7': '0000',
  };
}

describe('normalizeOnlineRow', () => {
  it('maps FBDI headers (with asterisks) to canonical fields', () => {
    const n = normalizeOnlineRow(sampleOnlineRow());
    expect(n.OrganizationName).toBe('Online Store');
    expect(n.ItemNumber).toBe('6287020282591');
    expect(n.SubinventoryCode).toBe('Shipped');
    expect(n.TransactionQuantity).toBe('-1');
    expect(n.TransactionUnitOfMeasure).toBe('Each'); // "Ea" code resolved to the name Oracle accepts
    expect(n.TransactionTypeName).toBe('Online sales');
    expect(n.TransactionReference).toBe('Completed no.276752514');
    expect(n.SourceCode).toBe('SR');
    expect(n.SourceHeaderId).toBe('123456');
    expect(n.SourceLineId).toBe('121364');
    // TransactionMode is forced to online ("1") regardless of the file value,
    // so the staged transaction actually posts (see normalizeOnlineRow).
    expect(n.TransactionMode).toBe('1');
    // DST_SEGMENT1..7 joined with "-" in order.
    expect(n.DistributionAccountId).toBe('01-000-1410-0000-000-0000-0000');
  });

  it('builds DistributionAccountId from DST_SEGMENT columns (asterisks/spacing ignored)', () => {
    const n = normalizeOnlineRow({
      'ITEM_NUMBER': 'X',
      '* DST_SEGMENT1': '01',
      'DST_SEGMENT2': '000',
      'DST_SEGMENT3': '1410',
      'DST_SEGMENT4': '0000',
      'DST_SEGMENT5': '000',
      'DST_SEGMENT6': '0000',
      'DST_SEGMENT7': '0000',
    });
    expect(n.DistributionAccountId).toBe('01-000-1410-0000-000-0000-0000');
  });

  it('omits DistributionAccountId when every segment is blank or absent', () => {
    expect(normalizeOnlineRow({ 'ITEM_NUMBER': 'X' }).DistributionAccountId).toBeUndefined();
    expect(normalizeOnlineRow({
      'ITEM_NUMBER': 'X',
      'DST_SEGMENT1': '',
      'DST_SEGMENT2': '  ',
    }).DistributionAccountId).toBeUndefined();
  });

  it('preserves empty slots between populated segments', () => {
    const n = normalizeOnlineRow({
      'ITEM_NUMBER': 'X',
      'DST_SEGMENT1': '01',
      'DST_SEGMENT3': '1410',
    });
    expect(n.DistributionAccountId).toBe('01--1410----');
  });

  it('prefers TRANSACTION_UNIT_OF_MEASURE (name) over TRANSACTION_UOM (code)', () => {
    expect(normalizeOnlineRow({ 'TRANSACTION_UOM': '', 'TRANSACTION_UNIT_OF_MEASURE': 'Each' }).TransactionUnitOfMeasure).toBe('Each');
    expect(normalizeOnlineRow({ 'TRANSACTION_UOM': 'Ea', 'TRANSACTION_UNIT_OF_MEASURE': '' }).TransactionUnitOfMeasure).toBe('Each');
    expect(normalizeOnlineRow({ 'TRANSACTION_UOM': 'Box', 'TRANSACTION_UNIT_OF_MEASURE': '' }).TransactionUnitOfMeasure).toBe('Box');
  });

  it('normalizeUom maps "Ea" to "Each" and passes unknown values through', () => {
    expect(normalizeUom('Ea')).toBe('Each');
    expect(normalizeUom('ea')).toBe('Each');
    expect(normalizeUom('Each')).toBe('Each');
    expect(normalizeUom('Box')).toBe('Box');
    expect(normalizeUom('')).toBe('');
  });

  it('converts an Excel serial TRANSACTION_DATE to YYYY-MM-DD', () => {
    const n = normalizeOnlineRow({ 'ITEM_NUMBER': 'X', 'TRANSACTION_DATE': '46266' });
    expect(n.TransactionDate).toBe('2026-09-01');
  });
});

describe('maybeExcelSerialToDate', () => {
  it('converts serials in range and leaves date strings alone', () => {
    expect(maybeExcelSerialToDate('46266')).toBe('2026-09-01');
    expect(maybeExcelSerialToDate('2026-08-27')).toBe('2026-08-27');
    expect(maybeExcelSerialToDate('7/1/2026')).toBe('7/1/2026');
    expect(maybeExcelSerialToDate('5')).toBe('5'); // out of serial range → untouched
  });
});

describe('mapRowToPayload (online)', () => {
  it('reads org and fixed fields from the row when no form org is passed', () => {
    const row = normalizeOnlineRow(sampleOnlineRow());
    expect(validateRow(row, { requireOrg: true })).toBeNull();
    const payload = mapRowToPayload(row, '');
    expect(payload).toMatchObject({
      OrganizationName: 'Online Store',
      TransactionTypeName: 'Online sales',
      ItemNumber: '6287020282591',
      SubinventoryCode: 'Shipped',
      TransactionDate: '2026-08-27T00:00:00.000+00:00',
      TransactionQuantity: '-1',
      TransactionReference: 'Completed no.276752514',
      ExternalSystemTransactionReference: 'Completed no.276752514',
      TransactionUnitOfMeasure: 'Each', // "Ea" resolved to the valid Oracle UOM name
      SourceHeaderId: '123456',
      SourceLineId: '121364',
      TransactionMode: '1', // forced online so the transaction posts
      SourceCode: 'SR',
      UseCurrentCostFlag: 'true', // blank in file → default
      AccountCombination: '01-000-1410-0000-000-0000-0000',
    });
  });

  it('flags a missing organization name for online rows', () => {
    const row = normalizeOnlineRow({ 'ITEM_NUMBER': 'X', '*TRANSACTION_QUANTITY': '1' });
    expect(validateRow(row, { requireOrg: true })).toBe('Empty organization name');
  });
});

describe('mapRowToPayload (normal, backward compatible)', () => {
  it('uses the form org and the fixed defaults when the row has no such columns', () => {
    const row = normalizeRow({
      TransactionTypeName: 'Vend RMA',
      ItemNumber: 'AS54888',
      SubinventoryCode: 'AZIZMALL',
      TransactionDate: '2024-01-15',
      TransactionQuantity: '10',
      TransactionReference: 'REF001',
      TransactionUnitOfMeasure: 'Ea',
    });
    const payload = mapRowToPayload(row, 'Vision Operations');
    expect(payload).toMatchObject({
      OrganizationName: 'Vision Operations',
      SourceHeaderId: '1',
      SourceLineId: '0',
      TransactionMode: '1',
      SourceCode: 'SERVICE',
      UseCurrentCostFlag: 'true',
    });
    expect(payload).not.toHaveProperty('AccountCombination');
  });
});
