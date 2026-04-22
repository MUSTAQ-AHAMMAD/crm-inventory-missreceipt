/**
 * Standard Receipt controller.
 * Transforms CSV rows into REST payloads and sends them to Oracle's
 * standardReceipts REST endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const prisma = require('../services/prisma');

const REQUIRED_FIELDS = [
  'ReceiptNumber',
  'ReceiptMethod',
  'ReceiptDate',
  'BusinessUnit',
  'CustomerAccountNumber',
  'CustomerSite',
  'Amount',
  'Currency',
  'RemittanceBankAccountNumber',
  'AccountingDate',
];

const TEMPLATE_FIELDS = [...REQUIRED_FIELDS];

// Configuration for parallel processing and retries
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 5;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const RETRY_MIN_TIMEOUT = 1000; // 1 second
const RETRY_MAX_TIMEOUT = 10000; // 10 seconds

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

function snippet(text, length = 400) {
  if (!text) return '';
  return text.length > length ? text.slice(0, length) : text;
}

function normalizeDate(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error(`${fieldName} is required`);

  // Check if it's already in YYYY-MM-DD format
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;

  // Check if it's in DD-MM-YYYY format
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  // Check if it's in YYYY/MM/DD format (with forward slashes)
  const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;

  // Check if it's in DD/MM/YYYY format (with forward slashes)
  const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;

  // Check if it's an Excel serial number (numeric value without separators)
  const isNumeric = /^\d+(\.\d+)?$/.test(value);
  if (isNumeric) {
    const excelSerialNumber = parseFloat(value);

    // Excel serial number: days since 1900-01-01 (with 1900 leap year bug)
    // Excel incorrectly treats 1900 as a leap year, so dates after Feb 28, 1900 are off by 1
    // Excel serial 1 = 1900-01-01, Serial 60 = 1900-02-29 (doesn't exist), Serial 61 = 1900-03-01
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Dec 30, 1899
    const adjustedSerial = excelSerialNumber > 60 ? excelSerialNumber - 1 : excelSerialNumber;
    const dateFromSerial = new Date(excelEpoch.getTime() + adjustedSerial * 24 * 60 * 60 * 1000);

    const year = dateFromSerial.getUTCFullYear();
    const month = dateFromSerial.getUTCMonth() + 1;
    const day = dateFromSerial.getUTCDate();

    const yearStr = String(year).padStart(4, '0');
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');

    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format, or an Excel serial number`);
}

function normalizeAmount(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('Amount is required');

  // Remove thousand separators (commas) to handle formats like "22,614.89"
  const normalizedValue = value.replace(/,/g, '');

  const numeric = Number(normalizedValue);
  if (!Number.isFinite(numeric)) {
    throw new Error('Amount must be a valid number');
  }
  return normalizedValue;
}

function normalizeRow(row) {
  return {
    ReceiptNumber: String(row.ReceiptNumber ?? '').trim(),
    ReceiptMethod: String(row.ReceiptMethod ?? '').trim(),
    ReceiptDate: normalizeDate(row.ReceiptDate, 'ReceiptDate'),
    BusinessUnit: String(row.BusinessUnit ?? '').trim(),
    CustomerAccountNumber: String(row.CustomerAccountNumber ?? '').trim(),
    CustomerSite: String(row.CustomerSite ?? '').trim(),
    Amount: normalizeAmount(row.Amount),
    Currency: String(row.Currency ?? '').trim().toUpperCase(),
    RemittanceBankAccountNumber: String(row.RemittanceBankAccountNumber ?? '').trim(),
    AccountingDate: normalizeDate(row.AccountingDate, 'AccountingDate'),
  };
}

function validateCsv(records) {
  const headers = Object.keys(records[0] || {}).map((h) => h.trim());
  const missingHeaders = REQUIRED_FIELDS.filter((field) => !headers.includes(field));
  if (missingHeaders.length > 0) {
    return `CSV is missing required columns: ${missingHeaders.join(', ')}`;
  }

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const missingValues = REQUIRED_FIELDS.filter((field) => {
      const value = row[field];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missingValues.length > 0) {
      return `Row ${i + 2} is missing values for: ${missingValues.join(', ')}`;
    }
  }

  return null;
}

function normalizeRecords(records) {
  const normalized = [];
  for (let i = 0; i < records.length; i++) {
    try {
      normalized.push(normalizeRow(records[i]));
    } catch (err) {
      throw new Error(`Row ${i + 2}: ${err.message}`);
    }
  }
  return normalized;
}

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
      normalizedRecords = normalizeRecords(records);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const previews = normalizedRecords.map((row, i) => ({
      rowNumber: i + 2,
      payload: row,
    }));

    return res.json({ totalRows: normalizedRecords.length, previews });
  } catch (err) {
    next(err);
  }
}

async function upload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    if (!process.env.ORACLE_STANDARD_RECEIPT_API_URL) {
      return res.status(500).json({ error: 'Oracle standard receipt API URL is not configured.' });
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
      normalizedRecords = normalizeRecords(records);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const uploadRecord = await prisma.standardReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        payloadJson: JSON.stringify(normalizedRecords, null, 2),
        totalRecords: normalizedRecords.length,
        status: 'PROCESSING',
        responseLog: '',
      },
    });

    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    let successCount = 0;
    let failureCount = 0;
    const failures = [];
    const responseLogs = [];
    let firstErrorMessage = '';
    let lastSuccessMessage = '';
    const logContext = `Endpoint=${process.env.ORACLE_STANDARD_RECEIPT_API_URL}`;
    const startTime = Date.now();

    // Create a limit function for concurrent requests
    const limit = pLimit(CONCURRENT_REQUESTS);

    // Process all rows with parallel processing and retry logic
    const processingPromises = normalizedRecords.map((row, i) => {
      return limit(async () => {
        const rowNumber = i + 2;
        const requestPreview = snippet(JSON.stringify(row));

        try {
          // Use p-retry for automatic retries with exponential backoff
          const response = await pRetry(
            async () => {
              const res = await axios.post(process.env.ORACLE_STANDARD_RECEIPT_API_URL, row, {
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  Authorization: `Basic ${oracleAuth}`,
                },
                timeout: 30000,
                validateStatus: () => true,
              });

              // Throw error for retryable status codes
              if (res.status >= 500 && res.status < 600) {
                throw new Error(`HTTP ${res.status}: Server error`);
              }

              return res;
            },
            {
              retries: MAX_RETRIES,
              minTimeout: RETRY_MIN_TIMEOUT,
              maxTimeout: RETRY_MAX_TIMEOUT,
              onFailedAttempt: (error) => {
                console.warn(
                  `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} Retry ${error.attemptNumber}/${MAX_RETRIES}: ${error.message}`
                );
              },
            }
          );

          const responseText = asText(response.data);
          if (response.status >= 400) {
            failureCount++;
            const errorDetail = snippet(responseText || `HTTP ${response.status}`);
            failures.push({
              uploadId: uploadRecord.id,
              rowNumber,
              rawData: JSON.stringify(row),
              errorMessage: errorDetail,
              requestPayload: JSON.stringify(row, null, 2),
              responseBody: snippet(responseText, 2000),
              responseStatus: response.status,
            });
            if (!firstErrorMessage) {
              firstErrorMessage = `Row ${rowNumber}: ${errorDetail}`;
            }
            const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED: ${errorDetail} | HTTP ${response.status} | ${logContext} | Request: ${requestPreview}`;
            responseLogs.push(logLine);
            console.error(logLine);
          } else {
            successCount++;
            const successSnippet = snippet(responseText || 'Success');
            if (!lastSuccessMessage) {
              lastSuccessMessage = successSnippet;
            }
            const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${response.status} | Response: ${successSnippet} | ${logContext}`;
            responseLogs.push(logLine);
            console.log(logLine);
          }
        } catch (apiErr) {
          failureCount++;
          const responseText = asText(apiErr.response?.data);
          const errorDetail = snippet(
            responseText ||
              apiErr.message ||
              'Oracle standard receipt API error'
          );
          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row),
            errorMessage: errorDetail,
            requestPayload: JSON.stringify(row, null, 2),
            responseBody: snippet(responseText || apiErr.message, 2000),
            responseStatus: apiErr.response?.status || null,
          });
          if (!firstErrorMessage) {
            firstErrorMessage = `Row ${rowNumber}: ${errorDetail}`;
          }
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (API): ${errorDetail} | ${logContext} | Request: ${requestPreview}`;
          responseLogs.push(logLine);
          console.error(logLine);
        }
      });
    });

    // Wait for all requests to complete
    await Promise.all(processingPromises);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    const avgTimePerRecord = (totalTime / normalizedRecords.length).toFixed(2);

    if (failures.length > 0) {
      await prisma.standardReceiptFailure.createMany({ data: failures });
    }

    const finalStatus =
      failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const responseMessage =
      firstErrorMessage ||
      lastSuccessMessage ||
      `${successCount} succeeded, ${failureCount} failed`;
    const performanceLog = `Total time: ${totalTime}s | Avg per record: ${avgTimePerRecord}s | Concurrency: ${CONCURRENT_REQUESTS}`;
    const responseLog =
      responseLogs.length > 0 ? responseLogs.join('\n') + '\n\n' + performanceLog : responseMessage + '\n' + performanceLog;

    const updatedUpload = await prisma.standardReceiptUpload.update({
      where: { id: uploadRecord.id },
      data: {
        successCount,
        failureCount,
        status: finalStatus,
        responseMessage,
        responseLog,
      },
    });

    console.log(
      `[StandardReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${normalizedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus} | Time: ${totalTime}s | Avg: ${avgTimePerRecord}s/record`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: normalizedRecords.length,
      successCount,
      failureCount,
      status: finalStatus,
      processingTimeSeconds: parseFloat(totalTime),
      averageTimePerRecord: parseFloat(avgTimePerRecord),
      concurrency: CONCURRENT_REQUESTS,
      maxRetries: MAX_RETRIES,
    });
  } catch (err) {
    next(err);
  }
}

async function listUploads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [uploads, total] = await Promise.all([
      prisma.standardReceiptUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.standardReceiptUpload.count({ where }),
    ]);

    return res.json({ uploads, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function getUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const uploadRecord = await prisma.standardReceiptUpload.findUnique({
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

    const parsedRecord = {
      ...uploadRecord,
      failures: uploadRecord.failures.map((f) => ({
        ...f,
        rawData: (() => { try { return JSON.parse(f.rawData); } catch { return f.rawData; } })(),
      })),
    };

    return res.json(parsedRecord);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/standard-receipt/uploads/:id/progress
 * Returns current processing progress for a specific standard receipt upload
 */
async function getUploadProgress(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const upload = await prisma.standardReceiptUpload.findUnique({
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

function downloadTemplate(_req, res) {
  const header = TEMPLATE_FIELDS.join(',');
  const sample =
    'Visa-BLK-ALAR-00000008,Visa,2026-03-05,AlQurashi-KSA,116012,100005,422,SAR,157-95017321-ALARIDAH,2026-03-05';
  // Add UTF-8 BOM (Byte Order Mark) to ensure proper encoding of Arabic and other Unicode characters
  const BOM = '\uFEFF';
  const csv = `${BOM}${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="standard_receipt_template.csv"');
  return res.send(csv);
}

module.exports = {
  previewPayload,
  upload,
  listUploads,
  getUpload,
  getUploadProgress,
  downloadTemplate,
};
