/**
 * Apply Receipt controller.
 * Implements the same processing as Java FusionApplyReceiptTransform:
 * - CSV provides TransactionNumber (invoice), ReceiptNumber, AmountApplied,
 *   ReceiptCurrency, TransactionSource, and AccountingDate directly.
 * - No REST ID lookups needed; Oracle resolves business keys internally.
 * - SOAP fields mirror Java exactly:
 *     TransactionNumber, ReceiptNumber, AmountApplied, ReceiptCurrency,
 *     TransactionSource, AccountingDate, ApplicationDate
 */

const { parse } = require('csv-parse/sync');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const prisma = require('../services/prisma');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

// CSV columns matching Java ApplyReceiptRequest model fields
const REQUIRED_FIELDS = [
  'TransactionNumber',
  'ReceiptNumber',
  'AmountApplied',
  'ReceiptCurrency',
  'TransactionSource',
  'AccountingDate',
];

// Configuration for parallel processing and retries
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 5;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const RETRY_MIN_TIMEOUT = 1000; // 1 second
const RETRY_MAX_TIMEOUT = 10000; // 10 seconds

// SOAP namespaces for StandardReceiptService - createApplyReceipt operation
const SOAP_ENV_NS   = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/standardReceiptService/commonService/types/';
const SOAP_COM_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/standardReceiptService/commonService/';

const SOAP_ACTION = 'createApplyReceipt';

function asText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf-8');
  if (data?.data && Array.isArray(data.data)) {
    return Buffer.from(data.data).toString('utf-8');
  }
  if (typeof data === 'object' && data.toString) {
    return data.toString();
  }
  return String(data);
}

function snippet(text, length = 500) {
  if (!text) return '';
  return text.length > length ? text.slice(0, length) : text;
}

function extractSoapFaultMessage(text) {
  const xml = text || '';
  const faultMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) return faultMatch[1].trim();
  const textMatch = xml.match(/<[\w.:-]*Text[^>]*>([\s\S]*?)<\/[\w.:-]*Text>/i);
  return textMatch ? textMatch[1].trim() : null;
}

function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes a date value to YYYY-MM-DD.
 * Accepts YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, DD/MM/YYYY, or Excel serial numbers.
 */
function normalizeDate(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error(`${fieldName} is required`);

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;

  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;

  const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;

  const isNumeric = /^\d+(\.\d+)?$/.test(value);
  if (isNumeric) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const serial = parseFloat(value);
    const adjusted = serial > 60 ? serial - 1 : serial;
    const date = new Date(excelEpoch.getTime() + adjusted * 86400000);
    const y = String(date.getUTCFullYear()).padStart(4, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format`);
}

/**
 * Validates CSV structure — all required columns must be present and non-empty.
 */
function validateCsv(records) {
  if (!records || records.length === 0) {
    return 'CSV file is empty';
  }

  const headers = Object.keys(records[0] || {}).map((h) => h.trim());
  const missingHeaders = REQUIRED_FIELDS.filter((f) => !headers.includes(f));
  if (missingHeaders.length > 0) {
    return `CSV is missing required columns: ${missingHeaders.join(', ')}`;
  }

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const missingValues = REQUIRED_FIELDS.filter((f) => {
      const v = row[f];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missingValues.length > 0) {
      return `Row ${i + 2} is missing values for: ${missingValues.join(', ')}`;
    }
  }

  return null;
}

/**
 * Normalizes a single CSV row — mirrors Java ApplyReceiptRequest fields.
 */
function normalizeRow(row) {
  const accountingDate = normalizeDate(row.AccountingDate, 'AccountingDate');
  return {
    TransactionNumber: String(row.TransactionNumber ?? '').trim(),
    ReceiptNumber:     String(row.ReceiptNumber     ?? '').trim(),
    AmountApplied:     String(row.AmountApplied     ?? '').trim(),
    ReceiptCurrency:   String(row.ReceiptCurrency   ?? '').trim().toUpperCase(),
    TransactionSource: String(row.TransactionSource ?? '').trim(),
    AccountingDate:    accountingDate,
    TxnDate:           accountingDate, // derived from AccountingDate — no separate column needed
  };
}

/**
 * Builds the SOAP XML envelope for createApplyReceipt, matching Java
 * FusionApplyReceiptTransform.mapApplyReceiptModel():
 *   - TransactionNumber  → invoice transaction number (business key)
 *   - ReceiptNumber      → receipt number (business key)
 *   - AmountApplied      → amount to apply
 *   - ReceiptCurrency    → ISO currency code
 *   - TransactionSource  → transaction source used on the invoice
 *   - TxnDate            → invoice transaction date (taken from uploaded file)
 *   - AccountingDate     → accounting date (also used as ApplicationDate)
 *   - ApplicationDate    → application date (same value as AccountingDate)
 */
function buildApplyReceiptXml(row) {
  if (!row.TransactionNumber || !row.ReceiptNumber || !row.AmountApplied ||
      !row.ReceiptCurrency   || !row.TransactionSource || !row.AccountingDate || !row.TxnDate) {
    throw new Error('Missing required fields for createApplyReceipt SOAP call');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${SOAP_TYPES_NS}"
  xmlns:com="${SOAP_COM_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createApplyReceipt>
      <typ:applyReceipt>
        <com:TransactionNumber>${escapeXml(row.TransactionNumber)}</com:TransactionNumber>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:AmountApplied>${escapeXml(row.AmountApplied)}</com:AmountApplied>
        <com:ReceiptCurrency>${escapeXml(row.ReceiptCurrency)}</com:ReceiptCurrency>
        <com:TransactionSource>${escapeXml(row.TransactionSource)}</com:TransactionSource>
        <com:TxnDate>${escapeXml(row.TxnDate)}</com:TxnDate>
        <com:AccountingDate>${escapeXml(row.AccountingDate)}</com:AccountingDate>
        <com:ApplicationDate>${escapeXml(row.AccountingDate)}</com:ApplicationDate>
      </typ:applyReceipt>
    </typ:createApplyReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Sends the SOAP createApplyReceipt request using OracleSoapClient.
 */
async function applyReceiptSoap(row) {
  const soapXml = buildApplyReceiptXml(row);
  const url = process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;

  if (!url) {
    throw new Error('ORACLE_APPLY_RECEIPT_SOAP_URL not configured in .env');
  }

  console.log(`[ApplyReceipt] Sending SOAP for TrxNumber: ${row.TransactionNumber}, Receipt: ${row.ReceiptNumber}, Amount: ${row.AmountApplied}`);

  const soapClient = createOracleSoapClient(url);
  const response = await soapClient.callWithCustomEnvelope(soapXml, SOAP_ACTION);

  console.log(`[ApplyReceipt] SOAP successful - HTTP ${response.status}`);
  return { status: response.status, statusText: response.statusText, data: response.data };
}

/**
 * Preview endpoint - parses CSV and shows the exact SOAP payloads that would be sent.
 * No Oracle API calls are made; all data comes directly from the CSV (Java approach).
 */
async function previewPayload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    let normalizedRecords;
    try {
      normalizedRecords = records.map((r, i) => {
        try { return normalizeRow(r); }
        catch (e) { throw new Error(`Row ${i + 2}: ${e.message}`); }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const previews = normalizedRecords.map((row, i) => ({
      rowNumber: i + 2,
      transactionNumber: row.TransactionNumber,
      receiptNumber: row.ReceiptNumber,
      amountApplied: row.AmountApplied,
      soapPayload: buildApplyReceiptXml(row),
    }));

    return res.json({ totalRows: records.length, previews });
  } catch (err) {
    next(err);
  }
}

/**
 * Verify endpoint - same as preview but validates CSV data without calling Oracle.
 * With the Java approach, there is nothing extra to verify since all fields come
 * directly from the CSV.
 */
async function verifyPayload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    if (!process.env.ORACLE_APPLY_RECEIPT_SOAP_URL) {
      return res.status(500).json({ error: 'Missing required environment variable: ORACLE_APPLY_RECEIPT_SOAP_URL' });
    }

    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    let normalizedRecords;
    try {
      normalizedRecords = records.map((r, i) => {
        try { return normalizeRow(r); }
        catch (e) { throw new Error(`Row ${i + 2}: ${e.message}`); }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const verifiedPayloads = normalizedRecords.map((row, i) => ({
      rowNumber: i + 2,
      transactionNumber: row.TransactionNumber,
      receiptNumber: row.ReceiptNumber,
      amountApplied: row.AmountApplied,
      receiptCurrency: row.ReceiptCurrency,
      transactionSource: row.TransactionSource,
      txnDate: row.TxnDate,
      accountingDate: row.AccountingDate,
      soapPayload: buildApplyReceiptXml(row),
    }));

    return res.json({
      totalRows: records.length,
      verifiedPayloadsCount: verifiedPayloads.length,
      errorsCount: 0,
      verifiedPayloads,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Upload endpoint - processes CSV and sends createApplyReceipt SOAP calls to Oracle.
 * Mirrors Java FusionReceiptClient.saveApplyStandardReceipt() processing flow:
 *   for each row → build SOAP from business keys → send to Oracle.
 */
async function upload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    if (!process.env.ORACLE_APPLY_RECEIPT_SOAP_URL) {
      return res.status(500).json({
        error: 'Missing required environment variable: ORACLE_APPLY_RECEIPT_SOAP_URL',
      });
    }

    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    let normalizedRecords;
    try {
      normalizedRecords = records.map((r, i) => {
        try { return normalizeRow(r); }
        catch (e) { throw new Error(`Row ${i + 2}: ${e.message}`); }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Create upload record
    const uploadRecord = await prisma.applyReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        totalRecords: normalizedRecords.length,
        totalReceipts: normalizedRecords.length,
        status: 'PROCESSING',
        responseLog: '',
      },
    });

    let successCount = 0;
    let failureCount = 0;
    const failures = [];
    const responseLogs = [];
    let firstErrorMessage = '';
    let lastSuccessMessage = '';
    const startTime = Date.now();

    // Process all rows in parallel — one SOAP call per row (Java approach)
    const limit = pLimit(CONCURRENT_REQUESTS);

    const processingPromises = normalizedRecords.map((row, rowIndex) => {
      return limit(async () => {
        const rowNumber = rowIndex + 2;

        try {
          const applyResponse = await pRetry(
            async () => applyReceiptSoap(row),
            { retries: MAX_RETRIES, minTimeout: RETRY_MIN_TIMEOUT, maxTimeout: RETRY_MAX_TIMEOUT }
          );

          const responseText = asText(applyResponse.data);

          if (applyResponse.status >= 400 || responseText.includes('soap:Fault') || responseText.includes('faultstring')) {
            failureCount++;
            const faultMsg = extractSoapFaultMessage(responseText) || `HTTP ${applyResponse.status}`;
            failures.push({
              uploadId: uploadRecord.id,
              rowNumber,
              invoiceNumber: row.TransactionNumber,
              receiptNumber: row.ReceiptNumber,
              errorMessage: faultMsg,
              errorStep: 'APPLY_RECEIPT',
              requestPayload: snippet(buildApplyReceiptXml(row), 2000),
              responseBody: snippet(responseText, 2000),
              responseStatus: applyResponse.status,
              customerTrxId: null,
              receiptId: null,
            });
            if (!firstErrorMessage) {
              firstErrorMessage = `Row ${rowNumber} Receipt ${row.ReceiptNumber}: ${faultMsg}`;
            }
            responseLogs.push(
              `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED | TrxNumber: ${row.TransactionNumber} | Receipt: ${row.ReceiptNumber} | ${faultMsg}`
            );
          } else {
            successCount++;
            lastSuccessMessage = `Applied receipt ${row.ReceiptNumber} to invoice ${row.TransactionNumber}`;
            responseLogs.push(
              `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | TrxNumber: ${row.TransactionNumber} | Receipt: ${row.ReceiptNumber} | HTTP ${applyResponse.status}`
            );
          }
        } catch (err) {
          failureCount++;
          const errorMsg = err.message || 'Apply receipt failed';
          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            invoiceNumber: row.TransactionNumber,
            receiptNumber: row.ReceiptNumber,
            errorMessage: errorMsg,
            errorStep: 'APPLY_RECEIPT',
            requestPayload: snippet(buildApplyReceiptXml(row), 2000),
            responseBody: snippet(asText(err.response?.data), 2000),
            responseStatus: err.response?.status || null,
            customerTrxId: null,
            receiptId: null,
          });
          if (!firstErrorMessage) {
            firstErrorMessage = `Row ${rowNumber} Receipt ${row.ReceiptNumber}: ${errorMsg}`;
          }
          responseLogs.push(
            `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED | TrxNumber: ${row.TransactionNumber} | Receipt: ${row.ReceiptNumber} | ${errorMsg}`
          );
        }
      });
    });

    await Promise.all(processingPromises);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    const avgTime = normalizedRecords.length > 0
      ? (totalTime / normalizedRecords.length).toFixed(2) : '0.00';

    if (failures.length > 0) {
      await prisma.applyReceiptFailure.createMany({ data: failures });
    }

    const finalStatus =
      failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const responseMessage =
      firstErrorMessage || lastSuccessMessage || `${successCount} succeeded, ${failureCount} failed`;
    const performanceLog = `Total time: ${totalTime}s | Avg per row: ${avgTime}s | Concurrency: ${CONCURRENT_REQUESTS}`;
    const responseLog = responseLogs.length > 0
      ? responseLogs.join('\n') + '\n\n' + performanceLog
      : responseMessage + '\n' + performanceLog;

    const updatedUpload = await prisma.applyReceiptUpload.update({
      where: { id: uploadRecord.id },
      data: { successCount, failureCount, status: finalStatus, responseMessage, responseLog },
    });

    console.log(
      `[ApplyReceipt] Upload #${uploadRecord.id} COMPLETE | Rows: ${normalizedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus} | Time: ${totalTime}s`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: normalizedRecords.length,
      totalReceipts: normalizedRecords.length,
      successCount,
      failureCount,
      status: finalStatus,
      processingTimeSeconds: parseFloat(totalTime),
      averageTimePerRow: parseFloat(avgTime),
      concurrency: CONCURRENT_REQUESTS,
      maxRetries: MAX_RETRIES,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List all apply receipt uploads for the current user (or all if admin)
 */
async function listUploads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [uploads, total] = await Promise.all([
      prisma.applyReceiptUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.applyReceiptUpload.count({ where }),
    ]);

    return res.json({ uploads, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * Get details of a specific apply receipt upload including failures
 */
async function getUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const uploadRecord = await prisma.applyReceiptUpload.findUnique({
      where: { id: uploadId },
      include: {
        user: { select: { email: true } },
        failures: true,
      },
    });

    if (!uploadRecord) {
      return res.status(404).json({ error: 'Upload not found.' });
    }

    if (req.user.role === 'USER' && uploadRecord.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    return res.json(uploadRecord);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/apply-receipt/uploads/:id/progress
 * Returns current processing progress for a specific apply receipt upload
 */
async function getUploadProgress(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const upload = await prisma.applyReceiptUpload.findUnique({
      where: { id: uploadId },
    });

    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }

    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    return res.json({
      uploadId: upload.id,
      totalRecords: upload.totalRecords,
      totalReceipts: upload.totalReceipts,
      successCount: upload.successCount,
      failureCount: upload.failureCount,
      status: upload.status,
      responseMessage: upload.responseMessage,
      responseLog: upload.responseLog,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/apply-receipt/uploads/:id/retry
 * Retries all failed rows for a specific apply receipt upload.
 * Re-uses the stored requestPayload SOAP XML (all fields are already encoded in it).
 */
async function retryUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const upload = await prisma.applyReceiptUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const url = process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;
    if (!url) {
      return res.status(500).json({ error: 'ORACLE_APPLY_RECEIPT_SOAP_URL not configured in .env' });
    }

    const failures = await prisma.applyReceiptFailure.findMany({ where: { uploadId } });
    if (failures.length === 0) {
      return res.json({ retrySuccess: 0, retryFail: 0, message: 'No failures to retry.' });
    }

    let retrySuccess = 0;
    let retryFail = 0;

    const limit = pLimit(CONCURRENT_REQUESTS);

    const processingPromises = failures.map((failure) =>
      limit(async () => {
        if (!failure.requestPayload) {
          retryFail++;
          return;
        }

        try {
          const soapClient = createOracleSoapClient(url);
          const response = await soapClient.callWithCustomEnvelope(failure.requestPayload, SOAP_ACTION);
          const responseText = asText(response.data);

          if (response.status >= 400 || responseText.includes('soap:Fault') || responseText.includes('faultstring')) {
            retryFail++;
            const faultMsg = extractSoapFaultMessage(responseText) || `HTTP ${response.status}`;

            await prisma.applyReceiptFailure.update({
              where: { id: failure.id },
              data: {
                errorMessage: faultMsg.substring(0, 500),
                responseBody: snippet(responseText, 2000),
                responseStatus: response.status,
              },
            });

            console.error(`[ApplyReceipt Retry] Upload #${uploadId} Row ${failure.rowNumber} FAILED | Receipt: ${failure.receiptNumber} | ${faultMsg}`);
          } else {
            retrySuccess++;
            await prisma.applyReceiptFailure.delete({ where: { id: failure.id } });
            console.log(`[ApplyReceipt Retry] Upload #${uploadId} Row ${failure.rowNumber} SUCCESS | Receipt: ${failure.receiptNumber}`);
          }
        } catch (err) {
          retryFail++;
          const errorMsg = (err.message || 'Apply receipt failed').substring(0, 500);

          await prisma.applyReceiptFailure.update({
            where: { id: failure.id },
            data: {
              errorMessage: errorMsg,
              responseBody: snippet(asText(err.response?.data), 2000),
              responseStatus: err.response?.status || null,
            },
          });

          console.error(`[ApplyReceipt Retry] Upload #${uploadId} Row ${failure.rowNumber} FAILED: ${errorMsg} | Receipt: ${failure.receiptNumber}`);
        }
      })
    );

    await Promise.all(processingPromises);

    const newSuccessCount = upload.successCount + retrySuccess;
    const newFailureCount = upload.failureCount - retrySuccess;
    const finalStatus = newFailureCount === 0 ? 'SUCCESS' : newSuccessCount > 0 ? 'PARTIAL' : 'FAILED';

    await prisma.applyReceiptUpload.update({
      where: { id: uploadId },
      data: {
        successCount: { increment: retrySuccess },
        failureCount: { decrement: retrySuccess },
        status: finalStatus,
      },
    });

    console.log(`[ApplyReceipt Retry] Upload #${uploadId} COMPLETE | Retried: ${failures.length} | Success: ${retrySuccess} | Still failing: ${retryFail}`);

    return res.json({ retrySuccess, retryFail });
  } catch (err) {
    next(err);
  }
}

/**
 * Download CSV template — matches Java ApplyReceiptRequest fields:
 *   TransactionNumber, ReceiptNumber, AmountApplied, ReceiptCurrency,
 *   TransactionSource, AccountingDate
 */
function downloadTemplate(_req, res) {
  const header = REQUIRED_FIELDS.join(',');
  const sample = 'BLK-ALAR-00000008,mada-12244,5000.00,SAR,Manual,2024-01-20';
  const sample2 = 'BLK-ALAR-00000009,visa-12245,3500.50,SAR,Manual,2024-01-21';

  const BOM = '\uFEFF';
  const csv = `${BOM}${header}\n${sample}\n${sample2}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="apply_receipt_template.csv"');
  return res.send(csv);
}

module.exports = {
  previewPayload,
  verifyPayload,
  upload,
  listUploads,
  getUpload,
  getUploadProgress,
  downloadTemplate,
  retryUpload,
};
