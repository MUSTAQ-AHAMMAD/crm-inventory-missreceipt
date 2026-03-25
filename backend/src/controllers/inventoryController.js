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

// Number of Oracle API requests to send in parallel per batch.
// Increase for faster throughput; decrease if Oracle rate-limits.
const CONCURRENCY = 10;

// How many success / failure records to accumulate before flushing to DB.
const DB_FLUSH_SIZE = 500;

/**
 * Processes upload rows in the background using concurrent batches.
 * Sends CONCURRENCY rows to the Oracle API in parallel, flushes success/failure
 * records to the database periodically, and updates progress after each batch
 * so the frontend can poll efficiently.
 */
async function processUploadRows(upload, records, organizationName) {
  let successCount = 0;
  let failureCount = 0;
  let pendingSuccesses = [];
  let pendingFailures = [];

  // Oracle API configuration from environment variables
  const oracleAuth = Buffer.from(
    `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
  ).toString('base64');

  /** Flush accumulated success/failure records to the database. */
  async function flushRecords() {
    if (pendingSuccesses.length > 0) {
      await prisma.inventorySuccessRecord.createMany({ data: pendingSuccesses });
      pendingSuccesses = [];
    }
    if (pendingFailures.length > 0) {
      await prisma.inventoryFailureRecord.createMany({ data: pendingFailures });
      pendingFailures = [];
    }
  }

  /** Process a single row: validate, map, call Oracle API. */
  async function processRow(row, rowNumber) {
    const validationError = validateRow(row);
    if (validationError) {
      return {
        type: 'failure',
        rowNumber,
        rawData: JSON.stringify(row),
        error: `${VALIDATION_ERROR_PREFIX}${validationError}`,
      };
    }

    const payload = mapRowToPayload(row, organizationName);

    try {
      const apiResponse = await axios.post(process.env.ORACLE_INVENTORY_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${oracleAuth}`,
        },
        timeout: 30000,
      });
      const responseData = typeof apiResponse.data === 'object'
        ? JSON.stringify(apiResponse.data)
        : String(apiResponse.data || '');
      console.log(`[Inventory] Upload #${upload.id} Row ${rowNumber} SUCCESS | Item: ${payload.ItemNumber} | HTTP ${apiResponse.status} | Response: ${responseData.substring(0, 500)}`);
      return { type: 'success', rowNumber, rawData: JSON.stringify(payload) };
    } catch (apiErr) {
      const errMsg =
        apiErr.response?.data?.detail ||
        apiErr.response?.data?.message ||
        apiErr.message ||
        'Oracle API error';
      const errorBody = apiErr.response?.data
        ? (typeof apiErr.response.data === 'object' ? JSON.stringify(apiErr.response.data) : String(apiErr.response.data))
        : '';
      console.error(`[Inventory] Upload #${upload.id} Row ${rowNumber} FAILED (API): ${errMsg} | Item: ${payload.ItemNumber} | HTTP ${apiErr.response?.status || 'N/A'} | Response: ${errorBody.substring(0, 500)}`);
      return { type: 'failure', rowNumber, rawData: JSON.stringify(payload), error: errMsg };
    }
  }

  // Process rows in concurrent batches of CONCURRENCY
  for (let batchStart = 0; batchStart < records.length; batchStart += CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONCURRENCY, records.length);
    const batch = records.slice(batchStart, batchEnd);

    const batchResults = await Promise.all(
      batch.map((row, idx) => processRow(row, batchStart + idx + 2)) // +2: 1-based + header row
    );

    for (const result of batchResults) {
      if (result.type === 'success') {
        successCount++;
        pendingSuccesses.push({
          uploadId: upload.id,
          rowNumber: result.rowNumber,
          rawData: result.rawData,
        });
      } else {
        failureCount++;
        pendingFailures.push({
          uploadId: upload.id,
          rowNumber: result.rowNumber,
          rawData: result.rawData,
          errorMessage: result.error,
        });
      }
    }

    // Flush to DB when buffers are large enough to avoid memory pressure
    if (pendingSuccesses.length >= DB_FLUSH_SIZE || pendingFailures.length >= DB_FLUSH_SIZE) {
      await flushRecords();
    }

    // Update progress counters after each batch (not each row)
    await prisma.inventoryUpload.update({
      where: { id: upload.id },
      data: { successCount, failureCount },
    });
  }

  // Flush any remaining buffered records
  await flushRecords();

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
        organizationName,
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

    // Process retries in concurrent batches for speed
    for (let batchStart = 0; batchStart < failures.length; batchStart += CONCURRENCY) {
      const batch = failures.slice(batchStart, Math.min(batchStart + CONCURRENCY, failures.length));

      const batchResults = await Promise.all(batch.map(async (failure) => {
        const rawDataObj = (() => { try { return JSON.parse(failure.rawData); } catch { return failure.rawData; } })();

        // Skip validation failures (they don't have the Oracle payload fields)
        if (failure.errorMessage.startsWith(VALIDATION_ERROR_PREFIX)) {
          return { status: 'skip', failure };
        }

        try {
          const apiResponse = await axios.post(process.env.ORACLE_INVENTORY_API_URL, rawDataObj, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${oracleAuth}`,
            },
            timeout: 30000,
          });
          console.log(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} SUCCESS | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiResponse.status}`);
          return { status: 'success', failure };
        } catch (apiErr) {
          const errMsg =
            apiErr.response?.data?.detail ||
            apiErr.response?.data?.message ||
            apiErr.message ||
            'Oracle API error';
          console.error(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} FAILED: ${errMsg} | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiErr.response?.status || 'N/A'}`);
          return { status: 'fail', failure, errMsg };
        }
      }));

      for (const result of batchResults) {
        if (result.status === 'success') {
          retrySuccess++;
          await prisma.inventoryFailureRecord.delete({ where: { id: result.failure.id } });
          // Store as success record
          await prisma.inventorySuccessRecord.create({
            data: {
              uploadId,
              rowNumber: result.failure.rowNumber,
              rawData: result.failure.rawData,
            },
          });
        } else if (result.status === 'skip') {
          retryFail++;
          stillFailing.push({ ...result.failure, errorMessage: result.failure.errorMessage });
        } else {
          retryFail++;
          stillFailing.push({ ...result.failure, errorMessage: result.errMsg });
        }
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
      organizationName: upload.organizationName,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/uploads/:id/detail
 * Returns full upload details including both success and failure records
 * for complete visibility of the upload process.
 */
async function getUploadDetail(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    const upload = await prisma.inventoryUpload.findUnique({
      where: { id: uploadId },
      include: { user: { select: { email: true } } },
    });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const recordType = req.query.type || 'all'; // 'all', 'success', 'failure'

    let successes = [];
    let failures = [];
    let totalSuccessRecords = 0;
    let totalFailureRecords = 0;

    if (recordType === 'all' || recordType === 'success') {
      [successes, totalSuccessRecords] = await Promise.all([
        prisma.inventorySuccessRecord.findMany({
          where: { uploadId },
          orderBy: { rowNumber: 'asc' },
          skip: recordType === 'success' ? skip : 0,
          take: recordType === 'success' ? limit : 10,
        }),
        prisma.inventorySuccessRecord.count({ where: { uploadId } }),
      ]);
      successes = successes.map((s) => ({
        ...s,
        rawData: (() => { try { return JSON.parse(s.rawData); } catch { return s.rawData; } })(),
      }));
    }

    if (recordType === 'all' || recordType === 'failure') {
      [failures, totalFailureRecords] = await Promise.all([
        prisma.inventoryFailureRecord.findMany({
          where: { uploadId },
          orderBy: { rowNumber: 'asc' },
          skip: recordType === 'failure' ? skip : 0,
          take: recordType === 'failure' ? limit : 10,
        }),
        prisma.inventoryFailureRecord.count({ where: { uploadId } }),
      ]);
      failures = failures.map((f) => ({
        ...f,
        rawData: (() => { try { return JSON.parse(f.rawData); } catch { return f.rawData; } })(),
      }));
    }

    return res.json({
      upload,
      successes,
      failures,
      totalSuccessRecords,
      totalFailureRecords,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/uploads/:id/successes
 * Returns paginated success records for a specific upload.
 */
async function getSuccessRecords(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    const upload = await prisma.inventoryUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const [successes, total] = await Promise.all([
      prisma.inventorySuccessRecord.findMany({
        where: { uploadId },
        orderBy: { rowNumber: 'asc' },
        skip,
        take: limit,
      }),
      prisma.inventorySuccessRecord.count({ where: { uploadId } }),
    ]);

    const parsed = successes.map((s) => ({
      ...s,
      rawData: (() => { try { return JSON.parse(s.rawData); } catch { return s.rawData; } })(),
    }));

    return res.json({ upload, successes: parsed, total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = { bulkUpload, listUploads, getFailures, retryUpload, downloadTemplate, getUploadProgress, getUploadDetail, getSuccessRecords };
