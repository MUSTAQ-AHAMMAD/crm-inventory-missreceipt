/**
 * Inventory Template Generation controller.
 * Converts Amro inventory export CSV files into the inventory transaction
 * template format with aggregated quantities and derived transaction types.
 */

const { parse } = require('csv-parse/sync');

const OUTPUT_COLUMNS = [
  'TransactionTypeName',
  'ItemNumber',
  'SubinventoryCode',
  'TransactionDate',
  'TransactionQuantity',
  'TransactionReference',
  'TransactionUnitOfMeasure',
];

const COLUMN_ALIASES = {
  subinventory: ['order lines/branch/name', 'branch/name', 'branch name', 'branch'],
  itemNumber: ['order lines/product/barcode', 'product/barcode', 'barcode', 'item number'],
  transactionReference: ['order lines/order ref', 'order ref', 'order reference'],
  quantity: ['total', 'sum of total', 'order lines/total', 'total qty', 'quantity', 'qty'],
};

const REQUIRED_LABELS = {
  subinventory: 'Branch/Name (Order Lines/Branch/Name)',
  itemNumber: 'Product/Barcode (Order Lines/Product/Barcode)',
  transactionReference: 'Order Ref (Order Lines/Order Ref)',
  quantity: 'Total',
};

const PREVIEW_LIMIT = 50;

function validationError(message) {
  const err = new Error(message);
  err.isValidation = true;
  return err;
}

function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsv(buffer) {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (!records.length) {
    throw validationError('CSV file is empty.');
  }

  return records;
}

function ensureRequiredHeaders(records) {
  const headerSet = new Set(Object.keys(records[0] || {}).map(normalizeKey));
  const missing = [];

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const hasMatch = aliases.some((alias) => headerSet.has(normalizeKey(alias)));
    if (!hasMatch) {
      missing.push(REQUIRED_LABELS[field]);
    }
  }

  if (missing.length > 0) {
    throw validationError(`CSV is missing required columns: ${missing.join(', ')}`);
  }
}

function toNormalizedRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
}

function pickField(row, aliases, label, rowNumber) {
  for (const alias of aliases) {
    const normalizedKey = normalizeKey(alias);
    if (Object.prototype.hasOwnProperty.call(row, normalizedKey)) {
      const value = String(row[normalizedKey] ?? '').trim();
      if (value) return value;
      break;
    }
  }
  throw validationError(`Row ${rowNumber}: Missing ${label}`);
}

function parseQuantity(raw, rowNumber) {
  const cleaned = String(raw ?? '').replace(/,/g, '').trim();
  if (cleaned === '') {
    throw validationError(`Row ${rowNumber}: Missing Total value`);
  }
  const qty = Number(cleaned);
  if (!Number.isFinite(qty)) {
    throw validationError(`Row ${rowNumber}: Invalid Total value "${cleaned}"`);
  }
  return qty;
}

function convertRecords(records) {
  ensureRequiredHeaders(records);

  const today = new Date().toISOString().slice(0, 10);
  const aggregated = new Map();

  records.forEach((row, idx) => {
    const rowNumber = idx + 2; // account for header row
    const normalized = toNormalizedRow(row);

    const itemNumber = pickField(normalized, COLUMN_ALIASES.itemNumber, REQUIRED_LABELS.itemNumber, rowNumber);
    const subinventory = pickField(normalized, COLUMN_ALIASES.subinventory, REQUIRED_LABELS.subinventory, rowNumber);
    const transactionReference = pickField(
      normalized,
      COLUMN_ALIASES.transactionReference,
      REQUIRED_LABELS.transactionReference,
      rowNumber
    );
    const quantity = parseQuantity(
      pickField(normalized, COLUMN_ALIASES.quantity, REQUIRED_LABELS.quantity, rowNumber),
      rowNumber
    );

    const key = `${subinventory}|||${itemNumber}|||${transactionReference}`;
    const existing = aggregated.get(key);

    if (existing) {
      existing.TransactionQuantity += quantity;
    } else {
      aggregated.set(key, {
        TransactionTypeName: '',
        ItemNumber: itemNumber,
        SubinventoryCode: subinventory,
        TransactionDate: today,
        TransactionQuantity: quantity,
        TransactionReference: transactionReference,
        TransactionUnitOfMeasure: 'Ea',
      });
    }
  });

  const converted = Array.from(aggregated.values()).map((row) => ({
    ...row,
    TransactionTypeName:
      row.TransactionQuantity > 0
        ? 'Vend RMA'
        : row.TransactionQuantity < 0
          ? 'Vend Sales Issue'
          : '',
  }));

  if (!converted.length) {
    throw validationError('No rows to convert after processing CSV.');
  }

  return converted;
}

function toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows) {
  const header = OUTPUT_COLUMNS.join(',');
  const body = rows
    .map((row) => OUTPUT_COLUMNS.map((col) => toCsvValue(row[col])).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

async function previewTemplate(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    const records = parseCsv(req.file.buffer);
    const converted = convertRecords(records);

    const previewRows = converted.slice(0, PREVIEW_LIMIT);

    return res.json({
      totalRows: converted.length,
      previewRows,
      headers: OUTPUT_COLUMNS,
    });
  } catch (err) {
    if (err.isValidation) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    const records = parseCsv(req.file.buffer);
    const converted = convertRecords(records);
    const csv = toCsv(converted);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=\"inventory_template_generated.csv\"');
    return res.send(csv);
  } catch (err) {
    if (err.isValidation) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  previewTemplate,
  downloadTemplate,
};
