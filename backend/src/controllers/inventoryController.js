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
  // If SubinventoryCode is empty, try to extract from TransactionReference
  let subinventory = row.SubinventoryCode?.trim();
  if (!subinventory && row.TransactionReference) {
    subinventory = extractBranchFromRef(row.TransactionReference);
    if (subinventory) {
      row.SubinventoryCode = subinventory;
    }
  }
  if (!subinventory) {
    return 'Empty branch/subinventory code';
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
 * Converts a date string from various formats to the ISO 8601 timestamp
 * format required by Oracle: YYYY-MM-DDTHH:MM:SS.000+00:00.
 *
 * Supported input formats:
 *   DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD,
 *   and any of the above followed by a time component.
 *
 * @param {string} dateStr – raw date string from CSV
 * @returns {string} ISO 8601 formatted timestamp
 */
function formatDateToISO(dateStr) {
  if (!dateStr) return '';
  let trimmed = dateStr.trim();

  // Strip any time component – we only use the date part
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx !== -1) {
    trimmed = trimmed.substring(0, spaceIdx);
  }

  let year, month, day;
  // Determine separator and field order
  const sep = trimmed.includes('/') ? '/' : '-';
  const parts = trimmed.split(sep);
  if (parts.length !== 3) {
    console.warn(`[Inventory] Unable to parse date "${trimmed}" – expected DD-MM-YYYY or YYYY-MM-DD format`);
    return trimmed; // can't parse – return as-is
  }

  if (parts[0].length === 4) {
    // YYYY-MM-DD or YYYY/MM/DD
    [year, month, day] = parts;
  } else {
    // DD-MM-YYYY or DD/MM/YYYY
    [day, month, year] = parts;
  }

  // Zero-pad to two digits
  month = month.padStart(2, '0');
  day = day.padStart(2, '0');

  return `${year}-${month}-${day}T00:00:00.000+00:00`;
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

  // Convert TransactionDate to ISO 8601 format required by Oracle
  const txDate = formatDateToISO(row.TransactionDate);

  // Default TransactionUnitOfMeasure to "Each" when not provided
  const uom = row.TransactionUnitOfMeasure?.trim() || 'Each';

  // TransactionQuantity is already validated (non-NaN, non-zero) in validateRow.
  // Preserve the original CSV string value (e.g. "-1.00") instead of parsing and
  // re-stringifying, which would lose trailing zeros.
  const txQty = row.TransactionQuantity?.trim() || '0';

  const txRef = cleanReference(row.TransactionReference);

  return {
    OrganizationName: organizationName,
    TransactionTypeName: row.TransactionTypeName?.trim(),
    ItemNumber: row.ItemNumber?.trim(),
    SubinventoryCode: subinventory,
    TransactionDate: txDate,
    TransactionQuantity: txQty,
    TransactionReference: txRef,
    ExternalSystemTransactionReference: txRef,
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
 * Processes upload rows in the background.
 * Updates the database after each row so the frontend can poll for progress.
 */
async function processUploadRows(upload, records, organizationName) {
  let successCount = 0;
  let failureCount = 0;
  const failures = [];

  // Oracle API configuration from environment variables
  const oracleAuth = Buffer.from(
    `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
  ).toString('base64');

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
      console.error(`[Inventory] Upload #${upload.id} Row ${rowNumber} FAILED (validation): ${validationError} | Item: ${row.ItemNumber || 'N/A'}`);

      // Update progress in database
      await prisma.inventoryUpload.update({
        where: { id: upload.id },
        data: { successCount, failureCount },
      });
      continue;
    }

    // Map CSV columns to Oracle API payload (OrganizationName from form field)
    const payload = mapRowToPayload(row, organizationName);

    // Log the payload being sent (detailed logging matching Python reference)
    console.log(`[Inventory] Upload #${upload.id} Row ${rowNumber} PAYLOAD: ${JSON.stringify(payload)}`);

    try {
      // Send to Oracle REST API
      const apiResponse = await axios.post(process.env.ORACLE_INVENTORY_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${oracleAuth}`,
        },
        timeout: 30000,
      });
      successCount++;
      // Log full API response data
      const responseData = typeof apiResponse.data === 'object'
        ? JSON.stringify(apiResponse.data)
        : String(apiResponse.data || '');
      console.log(`[Inventory] Upload #${upload.id} Row ${rowNumber} SUCCESS | Item: ${payload.ItemNumber} | HTTP ${apiResponse.status} | Response: ${responseData.substring(0, 500)}`);
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
      // Log detailed error response
      const errorBody = apiErr.response?.data
        ? (typeof apiErr.response.data === 'object' ? JSON.stringify(apiErr.response.data) : String(apiErr.response.data))
        : '';
      console.error(`[Inventory] Upload #${upload.id} Row ${rowNumber} FAILED (API): ${errMsg} | Item: ${payload.ItemNumber} | HTTP ${apiErr.response?.status || 'N/A'} | Response: ${errorBody.substring(0, 500)}`);
    }

    // Update progress in database after each row
    await prisma.inventoryUpload.update({
      where: { id: upload.id },
      data: { successCount, failureCount },
    });
  }

  // Persist failure records in bulk
  if (failures.length > 0) {
    await prisma.inventoryFailureRecord.createMany({ data: failures });
  }

  // Update final upload status
  const finalStatus = failureCount === 0 ? 'COMPLETED' : successCount === 0 ? 'FAILED' : 'PARTIAL';
  await prisma.inventoryUpload.update({
    where: { id: upload.id },
    data: {
      successCount,
      failureCount,
      status: finalStatus,
    },
  });

  console.log(`[Inventory] Upload #${upload.id} COMPLETE | Total: ${records.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus}`);
}

/**
 * POST /api/inventory/bulk-upload
 * Accepts a multipart CSV file, validates rows, sends each valid row to
 * the Oracle inventory staged transactions REST API, and stores results.
 * Returns immediately with the upload ID so the frontend can poll for progress.
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

    // Normalize column names so alternative headers are accepted
    for (let i = 0; i < records.length; i++) {
      records[i] = normalizeRow(records[i]);
    }

    // Create the upload record in PROCESSING state
    const upload = await prisma.inventoryUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        totalRecords: records.length,
        status: 'PROCESSING',
      },
    });

    // Respond immediately with upload ID and total records so the
    // frontend can start polling for progress
    res.json({
      uploadId: upload.id,
      totalRecords: records.length,
      successCount: 0,
      failureCount: 0,
      status: 'PROCESSING',
    });

    // Process rows in the background (fire and forget)
    processUploadRows(upload, records, organizationName).catch((err) => {
      console.error(`[Inventory] Upload #${upload.id} BACKGROUND ERROR:`, err);
      prisma.inventoryUpload.update({
        where: { id: upload.id },
        data: { status: 'FAILED' },
      }).catch((dbErr) => {
        console.error(`[Inventory] Upload #${upload.id} failed to update status after background error:`, dbErr);
      });
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
        const apiResponse = await axios.post(process.env.ORACLE_INVENTORY_API_URL, rawDataObj, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
        });
        // Remove the failure record on success
        await prisma.inventoryFailureRecord.delete({ where: { id: failure.id } });
        retrySuccess++;
        console.log(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} SUCCESS | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiResponse.status}`);
      } catch (apiErr) {
        retryFail++;
        const errMsg =
          apiErr.response?.data?.detail ||
          apiErr.response?.data?.message ||
          apiErr.message ||
          'Oracle API error';
        stillFailing.push({ ...failure, errorMessage: errMsg });
        console.error(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} FAILED: ${errMsg} | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiErr.response?.status || 'N/A'}`);
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

    console.log(`[Inventory Retry] Upload #${uploadId} COMPLETE | Retried: ${failures.length} | Success: ${retrySuccess} | Still failing: ${retryFail}`);

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

/**
 * GET /api/inventory/uploads/:id/progress
 * Returns current processing progress for a specific upload.
 * Used by the frontend to poll during background processing.
 */
async function getUploadProgress(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    const upload = await prisma.inventoryUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    return res.json({
      uploadId: upload.id,
      totalRecords: upload.totalRecords,
      successCount: upload.successCount,
      failureCount: upload.failureCount,
      status: upload.status,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { bulkUpload, listUploads, getFailures, retryUpload, downloadTemplate, getUploadProgress };
