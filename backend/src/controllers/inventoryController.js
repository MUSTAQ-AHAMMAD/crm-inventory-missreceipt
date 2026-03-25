/**
 * Inventory Upload controller.
 * Handles CSV parsing, Oracle REST API calls, and result persistence.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const prisma = require('../services/prisma');

// Prefix used to tag validation failure messages so retry logic can identify them
const VALIDATION_ERROR_PREFIX = 'Validation: ';

// Required CSV column names mapped to Oracle REST API fields
// OrganizationName is now provided via a form field, not the CSV
const REQUIRED_FIELDS = [
  'TransactionTypeName',
  'ItemNumber',
  'SubinventoryCode',
  'TransactionDate',
  'TransactionQuantity',
  'TransactionReference',
  'TransactionUnitOfMeasure',
];

// Maps alternative CSV column headers (lowercase) to the canonical field names.
// This allows users to upload CSVs exported from other systems (e.g. Odoo) that
// use different column naming conventions.
const COLUMN_ALIASES = {
  'order lines/product/barcode': 'ItemNumber',
  'barcode': 'ItemNumber',
  'item number': 'ItemNumber',
  'product barcode': 'ItemNumber',
  'transaction type name': 'TransactionTypeName',
  'transaction type': 'TransactionTypeName',
  'subinventory code': 'SubinventoryCode',
  'subinventory': 'SubinventoryCode',
  'order lines/branch/name': 'SubinventoryCode',
  'branch': 'SubinventoryCode',
  'branch/name': 'SubinventoryCode',
  'transaction date': 'TransactionDate',
  'order lines/order ref/date': 'TransactionDate',
  'date': 'TransactionDate',
  'transaction quantity': 'TransactionQuantity',
  'diff': 'TransactionQuantity',
  'quantity': 'TransactionQuantity',
  'transaction reference': 'TransactionReference',
  'order lines/order ref': 'TransactionReference',
  'order ref': 'TransactionReference',
  'transaction unit of measure': 'TransactionUnitOfMeasure',
  'unit of measure': 'TransactionUnitOfMeasure',
  'uom': 'TransactionUnitOfMeasure',
  'order lines/product/name': 'ProductName',
};

/**
 * Normalizes a single parsed CSV row by mapping alternative column names
 * to the canonical field names used by the rest of the pipeline.
 * When a canonical field already exists (e.g. the CSV already has an
 * "ItemNumber" column), it takes priority over any alias.
 * The original row is not mutated; a new object is returned.
 */
function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const lowerKey = key.trim().toLowerCase();
    const canonical = COLUMN_ALIASES[lowerKey];
    if (canonical && !(canonical in normalized)) {
      normalized[canonical] = value;
    }
    // Always keep the original key so no data is lost
    if (!(key in normalized)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * Validates a parsed CSV row and returns an error message if invalid.
 * Returns null when the row is valid.
 *
 * Skips rows with:
 *  - Empty item number (barcode)
 *  - Empty transaction type
 *  - Zero or invalid transaction quantity
 *  - Missing subinventory (tries to extract from TransactionReference)
 */
function validateRow(row) {
  if (!row.ItemNumber || row.ItemNumber.trim() === '') {
    return 'Empty item number (barcode)';
  }
  if (!row.TransactionTypeName || row.TransactionTypeName.trim() === '') {
    return 'Empty transaction type';
  }
  const qty = parseFloat(row.TransactionQuantity);
  if (isNaN(qty) || qty === 0) {
    return 'Zero or invalid transaction quantity';
  }
  return null;
}

/**
 * Extracts branch/subinventory code from a reference string.
 * Format: "BRANCHNAME/OrderNumber"
 */
function extractBranchFromRef(ref) {
  if (!ref) return null;
  const parts = ref.split('/');
  return parts.length >= 2 ? parts[0].trim() : null;
}

/**
 * Extracts a clean order reference by taking the first whitespace-delimited
 * token from the reference string.
 */
function cleanReference(ref) {
  if (!ref) return '';
  const trimmed = ref.trim();
  const parts = trimmed.split(/\s+/);
  return parts[0] || trimmed;
}

/**
 * Maps a CSV row to the Oracle REST API payload format.
 * Includes the fixed fields required by the Oracle inventoryStagedTransactions
 * REST API (SourceHeaderId, SourceLineId, TransactionMode, SourceCode,
 * UseCurrentCostFlag) that the Python reference script also sends.
 *
 * @param {object} row – parsed CSV row
 * @param {string} organizationName – provided via the upload form field
 */
function mapRowToPayload(row, organizationName) {
  // If SubinventoryCode is empty, try to extract it from TransactionReference
  let subinventory = row.SubinventoryCode?.trim();
  if (!subinventory && row.TransactionReference) {
    subinventory = extractBranchFromRef(row.TransactionReference) || '';
  }

  // Parse date (supports YYYY-MM-DD HH:MM:SS or YYYY-MM-DD)
  let txDate = row.TransactionDate?.trim();
  if (txDate && txDate.includes(' ')) {
    txDate = txDate.split(' ')[0]; // keep only date part
  }

  // Default TransactionUnitOfMeasure to "Each" when not provided
  const uom = row.TransactionUnitOfMeasure?.trim() || 'Each';

  // TransactionQuantity is already validated (non-NaN, non-zero) in validateRow
  const qty = parseFloat(row.TransactionQuantity);

  return {
    OrganizationName: organizationName,
    TransactionTypeName: row.TransactionTypeName?.trim(),
    ItemNumber: row.ItemNumber?.trim(),
    SubinventoryCode: subinventory,
    TransactionDate: txDate,
    TransactionQuantity: String(isNaN(qty) ? 0 : qty),
    TransactionReference: cleanReference(row.TransactionReference),
    TransactionUnitOfMeasure: uom,
    // Fixed fields required by the Oracle inventoryStagedTransactions REST API.
    // Values match the working Python reference script provided by the client.
    SourceHeaderId: '1',
    SourceLineId: '0',
    TransactionMode: '1',
    SourceCode: 'SERVICE',
    UseCurrentCostFlag: 'true',
  };
}

/**
 * POST /api/inventory/bulk-upload
 * Accepts a multipart CSV file, validates rows, sends each valid row to
 * the Oracle inventory staged transactions REST API, and stores results.
 */
async function bulkUpload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    const organizationName = req.body.organizationName?.trim();
    if (!organizationName) {
      return res.status(400).json({ error: 'Organization name is required.' });
    }

    // Parse the CSV file buffer
    const records = parse(req.file.buffer, {
      columns: true,       // use first row as headers
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    // Create the upload record in PENDING state
    const upload = await prisma.inventoryUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        totalRecords: records.length,
        status: 'PROCESSING',
      },
    });

    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    // Oracle API configuration from environment variables
    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    // Normalize column names so alternative headers are accepted
    for (let i = 0; i < records.length; i++) {
      records[i] = normalizeRow(records[i]);
    }

    // Process each CSV row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2; // +2: 1-based + header row

      // Validate the row
      const validationError = validateRow(row);
      if (validationError) {
        failureCount++;
        failures.push({
          uploadId: upload.id,
          rowNumber,
          rawData: JSON.stringify(row), // keep the raw row for validation failures (debugging)
          errorMessage: `${VALIDATION_ERROR_PREFIX}${validationError}`,
        });
        continue;
      }

      // Map CSV columns to Oracle API payload (OrganizationName from form field)
      const payload = mapRowToPayload(row, organizationName);

      try {
        // Send to Oracle REST API
        await axios.post(process.env.ORACLE_INVENTORY_API_URL, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
        });
        successCount++;
      } catch (apiErr) {
        failureCount++;
        const errMsg =
          apiErr.response?.data?.detail ||
          apiErr.response?.data?.message ||
          apiErr.message ||
          'Oracle API error';
        failures.push({
          uploadId: upload.id,
          rowNumber,
          rawData: JSON.stringify(payload), // store the mapped payload so retry can re-send it
          errorMessage: errMsg,
        });
      }
    }

    // Persist failure records in bulk
    if (failures.length > 0) {
      await prisma.inventoryFailureRecord.createMany({ data: failures });
    }

    // Update upload summary
    const updatedUpload = await prisma.inventoryUpload.update({
      where: { id: upload.id },
      data: {
        successCount,
        failureCount,
        status: failureCount === 0 ? 'COMPLETED' : successCount === 0 ? 'FAILED' : 'PARTIAL',
      },
    });

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: records.length,
      successCount,
      failureCount,
      status: updatedUpload.status,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/uploads
 * Returns a paginated list of inventory uploads for the current user
 * (admins see all uploads).
 */
async function listUploads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    // Admins and managers can see all uploads; regular users see their own
    const where =
      req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [uploads, total] = await Promise.all([
      prisma.inventoryUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.inventoryUpload.count({ where }),
    ]);

    return res.json({ uploads, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/uploads/:id/failures
 * Returns the failure records for a specific inventory upload.
 */
async function getFailures(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    // Verify the upload exists and belongs to the requesting user (or admin)
    const upload = await prisma.inventoryUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const failures = await prisma.inventoryFailureRecord.findMany({
      where: { uploadId },
      orderBy: { rowNumber: 'asc' },
    });

    // Parse rawData JSON strings back to objects for the frontend
    const parsedFailures = failures.map((f) => ({
      ...f,
      rawData: (() => { try { return JSON.parse(f.rawData); } catch { return f.rawData; } })(),
    }));

    return res.json({ upload, failures: parsedFailures });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/inventory/uploads/:id/retry
 * Retries all failed records for a specific upload.
 */
async function retryUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    const upload = await prisma.inventoryUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const failures = await prisma.inventoryFailureRecord.findMany({ where: { uploadId } });
    if (failures.length === 0) {
      return res.json({ message: 'No failures to retry.' });
    }

    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    let retrySuccess = 0;
    let retryFail = 0;
    const stillFailing = [];

    for (const failure of failures) {
      // rawData is stored as a JSON string – parse it back to an object.
      // For API failures it contains the mapped Oracle payload; for validation
      // failures it contains the raw CSV row (skip those).
      const rawDataObj = (() => { try { return JSON.parse(failure.rawData); } catch { return failure.rawData; } })();

      // Skip validation failures (they don't have the Oracle payload fields)
      if (failure.errorMessage.startsWith(VALIDATION_ERROR_PREFIX)) {
        retryFail++;
        stillFailing.push({ ...failure, errorMessage: failure.errorMessage });
        continue;
      }

      try {
        await axios.post(process.env.ORACLE_INVENTORY_API_URL, rawDataObj, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
        });
        // Remove the failure record on success
        await prisma.inventoryFailureRecord.delete({ where: { id: failure.id } });
        retrySuccess++;
      } catch (apiErr) {
        retryFail++;
        const errMsg =
          apiErr.response?.data?.detail ||
          apiErr.response?.data?.message ||
          apiErr.message ||
          'Oracle API error';
        stillFailing.push({ ...failure, errorMessage: errMsg });
      }
    }

    // Update upload counters
    await prisma.inventoryUpload.update({
      where: { id: uploadId },
      data: {
        successCount: { increment: retrySuccess },
        failureCount: { decrement: retrySuccess },
        status: retryFail === 0 ? 'COMPLETED' : 'PARTIAL',
      },
    });

    return res.json({ retrySuccess, retryFail, stillFailing });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/template
 * Returns a sample CSV template for inventory uploads.
 */
function downloadTemplate(_req, res) {
  const header = REQUIRED_FIELDS.join(',');
  const sample = 'Vend RMA,AS54888,AZIZMALL,2024-01-15,10,REF001,Ea';
  const csv = `${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
  return res.send(csv);
}

module.exports = { bulkUpload, listUploads, getFailures, retryUpload, downloadTemplate };
