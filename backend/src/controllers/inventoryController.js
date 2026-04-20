/**
 * Inventory Upload controller.
 * Handles CSV parsing, Oracle REST API calls, and result persistence.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const prisma = require('../services/prisma');

// Prefix used to tag validation failure messages so retry logic can identify them
const VALIDATION_ERROR_PREFIX = 'Validation: ';
const MISSING_BARCODE_ERROR = 'Empty item number (barcode)';

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
  'order lines/base uom': 'TransactionUnitOfMeasure',
  'order lines/base quantity': 'TransactionQuantity',
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
    if (lowerKey === 'order lines/order ref') {
      const rawRef = value ?? '';
      const refStr = String(rawRef);
      const subinventory = extractBranchFromRef(refStr) || refStr.trim();
      if (subinventory && !('SubinventoryCode' in normalized)) {
        normalized.SubinventoryCode = subinventory;
      }
      if (!('TransactionReference' in normalized)) {
        normalized.TransactionReference = rawRef;
      }
    }
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
    return MISSING_BARCODE_ERROR;
  }
  if (!row.TransactionTypeName || row.TransactionTypeName.trim() === '') {
    return 'Empty transaction type';
  }
  const qty = parseFloat(row.TransactionQuantity);
  if (isNaN(qty) || qty === 0) {
    return 'Zero or invalid transaction quantity';
  }
  const { value: formattedDate, error: dateError } = formatDateToISO(row.TransactionDate);
  if (dateError) {
    return dateError;
  }
  // Cache parsed date to avoid recomputing in mapRowToPayload
  row.__formattedTransactionDate = formattedDate;
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
 * Cleans an order reference by trimming whitespace.
 * Preserves the full reference text including Arabic characters.
 */
function cleanReference(ref) {
  if (!ref) return '';
  return ref.trim();
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
 * @returns {{ value?: string, error?: string }} ISO 8601 formatted timestamp or error
 */
function formatDateToISO(dateStr) {
  const raw = String(dateStr ?? '').trim();
  if (!raw) return { error: 'Empty transaction date' };

  // Use only the date part before any whitespace or time separator
  const datePart = raw.split(/[T\s]/)[0];
  const sep = datePart.includes('/') ? '/' : '-';
  const parts = datePart.split(sep);
  if (parts.length !== 3) {
    return { error: `Invalid transaction date format: ${raw}` };
  }

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) {
    return { error: `Invalid transaction date format: ${raw}` };
  }

  let [a, b, c] = nums;
  let year;
  let month;
  let day;

  if (a > 999) {
    // Year-first formats (YYYY-MM-DD or YYYY-DD-MM)
    year = a;
    if (b > 12 && c <= 12) {
      day = b;
      month = c;
    } else {
      month = b;
      day = c;
    }
  } else {
    // Day-first formats (DD-MM-YYYY) with fallback for MM-DD-YYYY
    year = c;
    if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
  }

  if (!year || !month || !day) {
    return { error: `Invalid transaction date format: ${raw}` };
  }

  const isoYear = year.toString().padStart(4, '0');
  const isoMonth = month.toString().padStart(2, '0');
  const isoDay = day.toString().padStart(2, '0');

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const valid =
    dateObj.getUTCFullYear() === year &&
    dateObj.getUTCMonth() + 1 === month &&
    dateObj.getUTCDate() === day;
  if (!valid) {
    return { error: `Invalid calendar date: ${raw}` };
  }

  return { value: `${isoYear}-${isoMonth}-${isoDay}T00:00:00.000+00:00` };
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
  const txDate = row.__formattedTransactionDate || formatDateToISO(row.TransactionDate).value || '';

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
 * Attempts to extract an Oracle error message from a successful-looking
 * response body. Oracle sometimes returns HTTP 2xx with an `error` field
 * populated instead of throwing an HTTP error status.
 *
 * Oracle-specific: ProcessStatus "3" = error, ErrorCode + ErrorExplanation
 * carry the actual reason for rejection.
 */
function extractOracleError(responseBody) {
  let parsed = responseBody;
  if (typeof responseBody === 'string') {
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      parsed = responseBody;
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    // Oracle-specific: ProcessStatus "3" means the transaction was rejected.
    // Values: "1" = success, "2" = pending/queued, "3" = error
    // Normalize to string once to handle both numeric and string responses.
    const processStatus = parsed.ProcessStatus != null ? String(parsed.ProcessStatus) : null;
    if (processStatus === '3') {
      const errorCode = (parsed.ErrorCode || '').toString().trim();
      const errorExplanation = (parsed.ErrorExplanation || '').toString().trim();
      if (errorCode && errorExplanation) {
        return `[${errorCode}] ${errorExplanation}`;
      }
      if (errorCode) {
        return `Oracle error code: ${errorCode}`;
      }
      if (errorExplanation) {
        return errorExplanation;
      }
      return `Oracle ProcessStatus=3 (transaction rejected)`;
    }

    // Also catch non-null ErrorCode regardless of ProcessStatus (belt-and-suspenders)
    const errorCode = (parsed.ErrorCode || '').toString().trim();
    const errorExplanation = (parsed.ErrorExplanation || '').toString().trim();
    if (errorCode) {
      const suffix = errorExplanation ? ` ${errorExplanation}` : '';
      return `[${errorCode}]${suffix}`;
    }
  }

  // Generic nested error field scanner (existing behaviour preserved)
  function normalize(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed.toLowerCase() === 'success') return null;
      return trimmed;
    }
    if (Array.isArray(val)) {
      for (const entry of val) {
        const found = normalize(entry);
        if (found) return found;
      }
      return null;
    }
    if (typeof val === 'object') {
      const fields = ['error', 'Error', 'ERROR', 'errors', 'Errors', 'ERRORS', 'errorMessage', 'ErrorMessage'];
      for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(val, field)) {
          const found = normalize(val[field]);
          if (found) return found;
        }
      }
      return null;
    }
    return null;
  }

  return normalize(parsed);
}

/**
 * Converts a response body to a short, printable string for logging.
 */
function stringifyResponseBody(body, fallback = '') {
  if (body === undefined || body === null) return fallback;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed ? body : fallback || body;
  }
  try {
    const json = JSON.stringify(body);
    if (json === '{}' && fallback) return fallback;
    return json;
  } catch {
    const asString = String(body);
    return asString.trim() ? asString : fallback;
  }
}

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
  const seenPayloads = new Set();

  // Preload previously successful payloads for this user + organization to
  // avoid re-processing rows that already succeeded in earlier uploads.
  const previousSuccesses = await prisma.inventorySuccessRecord.findMany({
    where: {
      upload: {
        userId: upload.userId,
        organizationName,
      },
    },
    select: { rawData: true },
  });
  for (const { rawData } of previousSuccesses) {
    seenPayloads.add(rawData);
  }

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
      if (validationError === MISSING_BARCODE_ERROR) {
        console.warn(`[Inventory] Upload #${upload.id} Row ${rowNumber} SKIPPED: Missing barcode`);
        return { type: 'skip-missing-barcode', rowNumber };
      }
      return {
        type: 'failure',
        rowNumber,
        rawData: JSON.stringify(row),
        error: `${VALIDATION_ERROR_PREFIX}${validationError}`,
      };
    }

    const payload = mapRowToPayload(row, organizationName);
    const payloadJson = JSON.stringify(payload);

    if (seenPayloads.has(payloadJson)) {
      return { type: 'skip-duplicate', rowNumber };
    }

    try {
      const apiResponse = await axios.post(process.env.ORACLE_INVENTORY_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${oracleAuth}`,
        },
        timeout: 30000,
      });
      const responseText = stringifyResponseBody(
        apiResponse.data,
        apiResponse.statusText || `HTTP ${apiResponse.status}`
      );
      const embeddedError = extractOracleError(apiResponse.data);
      if (embeddedError) {
        const oracleErrorCode = (apiResponse.data?.ErrorCode || '').toString().trim() || null;
        const oracleProcessStatus = apiResponse.data?.ProcessStatus != null
          ? String(apiResponse.data.ProcessStatus)
          : null;
        console.error(
          `[Inventory] Upload #${upload.id} Row ${rowNumber} FAILED (Oracle ProcessStatus=${apiResponse.data?.ProcessStatus} ErrorCode=${apiResponse.data?.ErrorCode || 'N/A'}): ${embeddedError} | Item: ${payload.ItemNumber} | HTTP ${apiResponse.status} | Response: ${responseText.substring(0, 1000)}`
        );
        return {
          type: 'failure',
          rowNumber,
          rawData: payloadJson,
          error: embeddedError,
          responseBody: responseText,
          responseStatus: apiResponse.status,
          oracleErrorCode,
          oracleProcessStatus,
        };
      }
      console.log(`[Inventory] Upload #${upload.id} Row ${rowNumber} SUCCESS | Item: ${payload.ItemNumber} | HTTP ${apiResponse.status} | Response: ${responseText.substring(0, 500)}`);
      return {
        type: 'success',
        rowNumber,
        rawData: payloadJson,
        responseBody: responseText,
        responseStatus: apiResponse.status,
      };
    } catch (apiErr) {
      const errMsg =
        apiErr.response?.data?.detail ||
        apiErr.response?.data?.message ||
        apiErr.message ||
        'Oracle API error';
      const errorBody = stringifyResponseBody(
        apiErr.response?.data,
        apiErr.response?.statusText || apiErr.message || 'No response body'
      );
      console.error(`[Inventory] Upload #${upload.id} Row ${rowNumber} FAILED (API): ${errMsg} | Item: ${payload.ItemNumber} | HTTP ${apiErr.response?.status || 'N/A'} | Response: ${errorBody.substring(0, 500)}`);
      return {
        type: 'failure',
        rowNumber,
        rawData: payloadJson,
        error: errMsg,
        responseBody: errorBody,
        responseStatus: apiErr.response?.status,
      };
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
          responseBody: result.responseBody || null,
          responseStatus: result.responseStatus ?? null,
        });
        seenPayloads.add(result.rawData);
      } else if (result.type === 'skip-duplicate') {
        // Count as success for this upload to keep progress accurate,
        // but do not create another success record.
        successCount++;
      } else if (result.type === 'skip-missing-barcode') {
        // Skip rows with missing barcodes without recording a failure
        successCount++;
      } else {
        failureCount++;
        pendingFailures.push({
          uploadId: upload.id,
          rowNumber: result.rowNumber,
          rawData: result.rawData,
          errorMessage: result.error,
          responseBody: result.responseBody || null,
          responseStatus: result.responseStatus ?? null,
          oracleErrorCode: result.oracleErrorCode || null,
          oracleProcessStatus: result.oracleProcessStatus || null,
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
      bom: true,
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
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

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
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

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

    // Avoid retrying rows that already succeeded in any upload for this user/org
    const seenPayloads = new Set();
    const uploadOrg = upload.organizationName;
    const previousSuccesses = await prisma.inventorySuccessRecord.findMany({
      where: {
        upload: {
          userId: upload.userId,
          organizationName: uploadOrg,
        },
      },
      select: { rawData: true },
    });
    for (const { rawData } of previousSuccesses) {
      seenPayloads.add(rawData);
    }

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

        // Skip if we've already succeeded with this payload
        if (seenPayloads.has(failure.rawData)) {
          return { status: 'skip-duplicate', failure };
        }

        try {
          const apiResponse = await axios.post(process.env.ORACLE_INVENTORY_API_URL, rawDataObj, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${oracleAuth}`,
            },
            timeout: 30000,
          });
          const responseText = stringifyResponseBody(
            apiResponse.data,
            apiResponse.statusText || `HTTP ${apiResponse.status}`
          );
          const embeddedError = extractOracleError(apiResponse.data);
          if (embeddedError) {
            const oracleErrorCode = (apiResponse.data?.ErrorCode || '').toString().trim() || null;
            const oracleProcessStatus = apiResponse.data?.ProcessStatus != null
              ? String(apiResponse.data.ProcessStatus)
              : null;
            console.error(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} FAILED (Oracle ProcessStatus=${apiResponse.data?.ProcessStatus} ErrorCode=${apiResponse.data?.ErrorCode || 'N/A'}): ${embeddedError} | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiResponse.status} | Response: ${responseText.substring(0, 1000)}`);
            return {
              status: 'fail',
              failure,
              errMsg: embeddedError,
              responseBody: responseText,
              responseStatus: apiResponse.status,
              oracleErrorCode,
              oracleProcessStatus,
            };
          }
          console.log(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} SUCCESS | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiResponse.status} | Response: ${responseText.substring(0, 500)}`);
          return {
            status: 'success',
            failure,
            responseBody: responseText,
            responseStatus: apiResponse.status,
          };
        } catch (apiErr) {
          const errMsg =
            apiErr.response?.data?.detail ||
            apiErr.response?.data?.message ||
            apiErr.message ||
            'Oracle API error';
          const responseText = stringifyResponseBody(
            apiErr.response?.data,
            apiErr.response?.statusText || apiErr.message || 'No response body'
          );
          console.error(`[Inventory Retry] Upload #${uploadId} Row ${failure.rowNumber} FAILED: ${errMsg} | Item: ${rawDataObj.ItemNumber || 'N/A'} | HTTP ${apiErr.response?.status || 'N/A'}`);
          return {
            status: 'fail',
            failure,
            errMsg,
            responseBody: responseText,
            responseStatus: apiErr.response?.status,
          };
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
              responseBody: result.responseBody || null,
              responseStatus: result.responseStatus ?? null,
            },
          });
          seenPayloads.add(result.failure.rawData);
        } else if (result.status === 'skip') {
          retryFail++;
          stillFailing.push({ ...result.failure, errorMessage: result.failure.errorMessage });
        } else if (result.status === 'skip-duplicate') {
          // Treat as already handled success; remove failure record
          await prisma.inventoryFailureRecord.delete({ where: { id: result.failure.id } });
          retrySuccess++;
        } else {
          retryFail++;
          await prisma.inventoryFailureRecord.update({
            where: { id: result.failure.id },
            data: {
              errorMessage: result.errMsg,
              responseBody: result.responseBody || null,
              responseStatus: result.responseStatus ?? null,
              oracleErrorCode: result.oracleErrorCode || null,
              oracleProcessStatus: result.oracleProcessStatus || null,
            },
          });
          stillFailing.push({
            ...result.failure,
            errorMessage: result.errMsg,
            responseBody: result.responseBody || null,
            responseStatus: result.responseStatus ?? null,
          });
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
  // Add UTF-8 BOM (Byte Order Mark) to ensure proper encoding of Arabic and other Unicode characters
  const BOM = '\uFEFF';
  const csv = `${BOM}${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
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
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

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
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

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
 * GET /api/inventory/uploads/:id/debug-log
 * Returns a merged, paginated view of all success and failure records
 * including the raw payload sent to Oracle and the response received.
 * This endpoint is intended for deep debugging when Oracle rejects data.
 */
async function getDebugLog(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

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
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;

    const [totalSuccessRecords, totalFailureRecords] = await Promise.all([
      prisma.inventorySuccessRecord.count({ where: { uploadId } }),
      prisma.inventoryFailureRecord.count({ where: { uploadId } }),
    ]);
    const totalRecords = totalSuccessRecords + totalFailureRecords;

    const rawRecords = await prisma.$queryRaw`
      SELECT id, rowNumber, rawData, responseBody, responseStatus,
             NULL as errorMessage, NULL as oracleErrorCode, NULL as oracleProcessStatus,
             createdAt, 'SUCCESS' as recordType
      FROM InventorySuccessRecord
      WHERE uploadId = ${uploadId}
      UNION ALL
      SELECT id, rowNumber, rawData, responseBody, responseStatus,
             errorMessage, oracleErrorCode, oracleProcessStatus,
             createdAt, 'FAILURE' as recordType
      FROM InventoryFailureRecord
      WHERE uploadId = ${uploadId}
      ORDER BY rowNumber ASC, createdAt ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const parseJson = (val) => {
      if (val === null || val === undefined) return val;
      if (typeof val !== 'string') return val;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    };

    const records = rawRecords.map((r) => ({
      ...r,
      rawData: parseJson(r.rawData),
      responseBody: parseJson(r.responseBody),
    }));

    return res.json({
      upload,
      records,
      totalRecords,
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
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

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

module.exports = { bulkUpload, listUploads, getFailures, retryUpload, downloadTemplate, getUploadProgress, getUploadDetail, getSuccessRecords, getDebugLog };
