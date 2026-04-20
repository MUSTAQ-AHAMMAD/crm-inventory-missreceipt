/**
 * Inventory Template Generation controller.
 * Converts Amro inventory export CSV files into the inventory transaction
 * template format with aggregated quantities (inverted signs) and derived transaction types.
 *
 * Quantity Conversion:
 * - REFUND transactions: Quantity is kept positive (no inversion) → "Vend RMA"
 * - Non-REFUND transactions with positive quantities → Negative quantities → "Vend Sales Issue"
 * - Non-REFUND transactions with negative quantities → Positive quantities → "Vend RMA"
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

// Aliases are matched case-insensitively against the original header (trimmed).
// Order matters — more specific aliases should come first.
const COLUMN_ALIASES = {
  orderRef: [
    'order lines/order ref',
    'order ref',
    'order reference',
  ],
  itemNumber: [
    'order lines/product/barcode',
    'product/barcode',
    'product barcode',
    'barcode',
    'item number',
  ],
  transactionDate: [
    'order lines/order ref/date',
    'order ref date',
    'date',
  ],
  quantity: [
    'total',
    'order lines/total',
    'order lines/base quantity',
    'base quantity',
    'quantity',
    'qty',
  ],
  unitOfMeasure: [
    'order lines/base uom',
    'base uom',
    'uom',
    'unit of measure',
  ],
  orderType: [
    'order lines/picking type/name',
    'picking type/name',
    'picking type',
    'order type',
    'type',
  ],
};

const REQUIRED_LABELS = {
  orderRef: 'Order Lines/Order Ref',
  itemNumber: 'Product/Barcode',
  quantity: 'Total',
};

const REQUIRED_FIELDS = ['orderRef', 'itemNumber', 'quantity'];

const PREVIEW_LIMIT = 50;
const MAX_WARNINGS = 20;

function validationError(message) {
  const err = new Error(message);
  err.isValidation = true;
  return err;
}

function parseCsv(buffer) {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (!records.length) {
    throw validationError('CSV file is empty.');
  }

  return records;
}

/**
 * Builds a lookup map from normalised header → original header.
 * Normalisation here is ONLY lowercase + trim — we keep slashes and spaces
 * so that "order lines/order ref" and "order lines/order ref/date" remain distinct.
 */
function buildHeaderMap(record) {
  const map = new Map();
  for (const key of Object.keys(record)) {
    map.set(key.trim().toLowerCase(), key);
  }
  return map;
}

function ensureRequiredHeaders(records) {
  const headerMap = buildHeaderMap(records[0] || {});
  const missing = [];

  for (const field of REQUIRED_FIELDS) {
    const aliases = COLUMN_ALIASES[field] || [];
    const hasMatch = aliases.some((alias) => headerMap.has(alias.trim().toLowerCase()));
    if (!hasMatch) {
      missing.push(REQUIRED_LABELS[field]);
    }
  }

  if (missing.length > 0) {
    throw validationError(`CSV is missing required columns: ${missing.join(', ')}`);
  }
}

/**
 * Picks the first alias that exists in the row (case-insensitive, trim only).
 * Throws a validation error if no alias resolves to a non-empty value.
 */
function pickField(row, headerMap, aliases, label, rowNumber) {
  for (const alias of aliases) {
    const originalKey = headerMap.get(alias.trim().toLowerCase());
    if (originalKey !== undefined) {
      const value = String(row[originalKey] ?? '').trim();
      if (value) return value;
    }
  }
  throw validationError(`Row ${rowNumber}: Missing ${label}`);
}

/**
 * Same as pickField but returns '' instead of throwing when not found.
 */
function pickOptionalField(row, headerMap, aliases) {
  for (const alias of aliases) {
    const originalKey = headerMap.get(alias.trim().toLowerCase());
    if (originalKey !== undefined) {
      const value = String(row[originalKey] ?? '').trim();
      if (value) return value;
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

  if (
    !year || !month || !day ||
    Number.isNaN(Number(year)) ||
    Number.isNaN(Number(month)) ||
    Number.isNaN(Number(day))
  ) {
    throw validationError(`Row ${rowNumber}: Invalid TransactionDate value "${trimmed}"`);
  }

  return `${year}-${month}-${day}`;
}

// "ALARIDAH/8371" → "ALARIDAH"
function extractSubinventoryFromOrderRef(raw, rowNumber) {
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
    const rowNumber = idx + 2;

    // Build header map once per row (headers are the same for all rows,
    // but building from the row keys is safe and simple).
    const headerMap = buildHeaderMap(row);

    const hasAnyValue = Object.values(row).some((val) => String(val ?? '').trim() !== '');
    if (!hasAnyValue) {
      skippedRows += 1;
      addWarning(`Row ${rowNumber}: Skipped empty row`);
      return;
    }

    try {
      const itemNumber = pickField(row, headerMap, COLUMN_ALIASES.itemNumber, REQUIRED_LABELS.itemNumber, rowNumber);

      // "ALARIDAH/8371" — used for both SubinventoryCode and TransactionReference
      const orderRefRaw = pickField(row, headerMap, COLUMN_ALIASES.orderRef, REQUIRED_LABELS.orderRef, rowNumber);

      // SubinventoryCode = "ALARIDAH"
      const subinventory = extractSubinventoryFromOrderRef(orderRefRaw, rowNumber);

      // TransactionReference = "ALARIDAH/8371"
      const transactionReference = orderRefRaw;

      const transactionDate = (() => {
        const rawDate = pickOptionalField(row, headerMap, COLUMN_ALIASES.transactionDate);
        return rawDate ? parseDate(rawDate, rowNumber) : currentDateString();
      })();

      const transactionUnitOfMeasure =
        pickOptionalField(row, headerMap, COLUMN_ALIASES.unitOfMeasure) || 'Each';

      const quantity = parseQuantity(
        pickField(row, headerMap, COLUMN_ALIASES.quantity, REQUIRED_LABELS.quantity, rowNumber),
        rowNumber,
        REQUIRED_LABELS.quantity
      );

      // Check if this is a refund transaction
      const orderType = pickOptionalField(row, headerMap, COLUMN_ALIASES.orderType) || '';
      const isRefund = orderType.toUpperCase().includes('REFUND');

      const key = `${subinventory}|||${itemNumber}|||${transactionReference}|||${transactionDate}|||${transactionUnitOfMeasure}`;
      const existing = aggregated.get(key);

      if (existing) {
        existing.TransactionQuantity += quantity;
        // If any row in the aggregation is a refund, mark the entire aggregation as refund
        existing.isRefund = existing.isRefund || isRefund;
      } else {
        aggregated.set(key, {
          TransactionTypeName: '',
          ItemNumber: itemNumber,
          SubinventoryCode: subinventory,
          TransactionDate: transactionDate,
          TransactionQuantity: quantity,
          TransactionReference: transactionReference,
          TransactionUnitOfMeasure: transactionUnitOfMeasure,
          isRefund: isRefund,
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

  const converted = Array.from(aggregated.values()).map((row) => {
    // For refund transactions, keep the quantity positive (don't invert)
    // For non-refund transactions, invert the quantity sign: positive becomes negative, negative becomes positive
    const finalQuantity = row.isRefund ? Math.abs(row.TransactionQuantity) : -row.TransactionQuantity;

    return {
      TransactionTypeName:
        finalQuantity > 0
          ? 'Vend RMA'
          : finalQuantity < 0
            ? 'Vend Sales Issue'
            : '',
      ItemNumber: row.ItemNumber,
      SubinventoryCode: row.SubinventoryCode,
      TransactionDate: row.TransactionDate,
      TransactionQuantity: finalQuantity,
      TransactionReference: row.TransactionReference,
      TransactionUnitOfMeasure: row.TransactionUnitOfMeasure,
    };
  });

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
  // Add UTF-8 BOM (Byte Order Mark) to ensure proper encoding of Arabic and other Unicode characters
  const BOM = '\uFEFF';
  return `${BOM}${header}\n${body}\n`;
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

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory_template_generated.csv"');
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
