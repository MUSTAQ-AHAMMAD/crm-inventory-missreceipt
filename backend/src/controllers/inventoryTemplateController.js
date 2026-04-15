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
  subinventory: [
    'branch/name',
    'branch',
    'order lines/branch/name',
    'order lines/product/name',
    'product/name',
    'product name',
  ],
  itemNumber: [
    'order lines/product/barcode',
    'product/barcode',
    'product barcode',
    'barcode',
    'item number',
  ],
  transactionReference: ['order lines/order ref', 'order ref', 'order reference'],
  transactionDate: ['order lines/order ref/date', 'order ref date', 'date'],
  quantity: ['total', 'order lines/total', 'order lines/base quantity', 'base quantity', 'quantity', 'qty'],
  unitOfMeasure: ['order lines/base uom', 'base uom', 'uom', 'unit of measure'],
};

const REQUIRED_LABELS = {
  subinventory: 'Branch/Name (prefix before "/")',
  itemNumber: 'Product/Barcode',
  transactionReference: 'Order Ref',
  quantity: 'Total',
};

const REQUIRED_FIELDS = ['subinventory', 'itemNumber', 'transactionReference', 'quantity'];

const PREVIEW_LIMIT = 50;
const MAX_WARNINGS = 20;

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

  for (const field of REQUIRED_FIELDS) {
    const aliases = COLUMN_ALIASES[field] || [];
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

function pickOptionalField(row, aliases) {
  for (const alias of aliases) {
    const normalizedKey = normalizeKey(alias);
    if (Object.prototype.hasOwnProperty.call(row, normalizedKey)) {
      const value = String(row[normalizedKey] ?? '').trim();
      if (value) return value;
      break;
    }
  }
  return '';
}

function parseQuantity(raw, rowNumber, label = 'Quantity') {
  const cleaned = String(raw ?? '').replace(/,/g, '').trim();
  if (cleaned === '') {
    throw validationError(`Row ${rowNumber}: Missing ${label} value`);
  }
  const qty = Number(cleaned);
  if (!Number.isFinite(qty)) {
    throw validationError(`Row ${rowNumber}: Invalid ${label} value "${cleaned}"`);
  }
  return qty;
}

function parseDate(raw, rowNumber) {
  if (!raw) throw validationError(`Row ${rowNumber}: Missing TransactionDate`);
  const trimmed = String(raw).trim();
  const spaceIdx = trimmed.indexOf(' ');
  const datePart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);

  const sep = datePart.includes('/') ? '/' : datePart.includes('-') ? '-' : null;
  if (!sep) {
    throw validationError(`Row ${rowNumber}: Invalid TransactionDate value "${trimmed}"`);
  }
  const parts = datePart.split(sep);
  if (parts.length !== 3) {
    throw validationError(`Row ${rowNumber}: Invalid TransactionDate value "${trimmed}"`);
  }

  let year, month, day;
  if (parts[0].length === 4) {
    [year, month, day] = parts;
  } else {
    [day, month, year] = parts;
  }

  month = month.padStart(2, '0');
  day = day.padStart(2, '0');

  if (!year || !month || !day || Number.isNaN(Number(year)) || Number.isNaN(Number(month)) || Number.isNaN(Number(day))) {
    throw validationError(`Row ${rowNumber}: Invalid TransactionDate value "${trimmed}"`);
  }

  return `${year}-${month}-${day}`;
}

function extractSubinventoryFromName(raw, rowNumber) {
  if (!raw) {
    throw validationError(`Row ${rowNumber}: Missing SubinventoryCode`);
  }
  const value = String(raw).trim();
  const prefix = value.split('/')[0]?.trim();
  if (!prefix) {
    throw validationError(`Row ${rowNumber}: Missing SubinventoryCode`);
  }
  return prefix;
}

function currentDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function convertRecords(records) {
  ensureRequiredHeaders(records);

  const aggregated = new Map();
  const warnings = [];
  let skippedRows = 0;

  const addWarning = (message) => {
    if (warnings.length < MAX_WARNINGS) {
      warnings.push(message);
    }
  };

  records.forEach((row, idx) => {
    const rowNumber = idx + 2; // account for header row
    const normalized = toNormalizedRow(row);

    const hasAnyValue = Object.values(normalized).some((val) => String(val ?? '').trim() !== '');
    if (!hasAnyValue) {
      skippedRows += 1;
      addWarning(`Row ${rowNumber}: Skipped empty row`);
      return;
    }

    try {
      const itemNumber = pickField(normalized, COLUMN_ALIASES.itemNumber, REQUIRED_LABELS.itemNumber, rowNumber);
      const subinventory = extractSubinventoryFromName(
        pickField(normalized, COLUMN_ALIASES.subinventory, REQUIRED_LABELS.subinventory, rowNumber),
        rowNumber
      );
      const transactionReference = pickField(
        normalized,
        COLUMN_ALIASES.transactionReference,
        REQUIRED_LABELS.transactionReference,
        rowNumber
      );
      const transactionDate = (() => {
        const rawDate = pickOptionalField(normalized, COLUMN_ALIASES.transactionDate);
        return rawDate ? parseDate(rawDate, rowNumber) : currentDateString();
      })();
      const transactionUnitOfMeasure = pickOptionalField(normalized, COLUMN_ALIASES.unitOfMeasure) || 'Each';
      const quantity = parseQuantity(
        pickField(normalized, COLUMN_ALIASES.quantity, REQUIRED_LABELS.quantity, rowNumber),
        rowNumber,
        REQUIRED_LABELS.quantity
      );

      const key = `${subinventory}|||${itemNumber}|||${transactionReference}|||${transactionDate}|||${transactionUnitOfMeasure}`;
      const existing = aggregated.get(key);

      if (existing) {
        existing.TransactionQuantity += quantity;
      } else {
        aggregated.set(key, {
          TransactionTypeName: '',
          ItemNumber: itemNumber,
          SubinventoryCode: subinventory,
          TransactionDate: transactionDate,
          TransactionQuantity: quantity,
          TransactionReference: transactionReference,
          TransactionUnitOfMeasure: transactionUnitOfMeasure,
        });
      }
    } catch (err) {
      if (err.isValidation) {
        skippedRows += 1;
        addWarning(err.message);
        return;
      }
      throw err;
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

  return { converted, warnings, skippedRows };
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
    const { converted, warnings, skippedRows } = convertRecords(records);

    const previewRows = converted.slice(0, PREVIEW_LIMIT);

    return res.json({
      totalRows: converted.length,
      previewRows,
      headers: OUTPUT_COLUMNS,
      warnings,
      skippedRows,
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
    const { converted, skippedRows } = convertRecords(records);
    const csv = toCsv(converted);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=\"inventory_template_generated.csv\"');
    res.setHeader('X-Inventory-Template-Skipped-Rows', skippedRows);
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
