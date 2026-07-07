/**
 * Standard Receipt controller (REST).
 * Transforms CSV rows into JSON payloads and POSTs them to Oracle's
 * standardReceipts REST resource (ORACLE_STANDARD_RECEIPT_API_URL).
 *
 * The REST resource resolves receipts by name/number (not internal IDs), which is
 * far more robust than the SOAP path — no ReceiptMethodId / RemittanceBankAccountId /
 * CustomerId to look up or get wrong.
 *
 * CSV columns (all required):
 *   ReceiptNumber               - unique receipt identifier (e.g. Cash-2918528)
 *   ReceiptMethod               - receipt method NAME (e.g. Cash, Visa, Mada)
 *   ReceiptDate                 - receipt date
 *   BusinessUnit                - Oracle business unit NAME
 *   CustomerAccountNumber       - customer account number
 *   CustomerSite                - customer bill-to site
 *   Amount                      - receipt amount (positive)
 *   Currency                    - ISO currency code (e.g. SAR)
 *   RemittanceBankAccountNumber - remittance bank account NUMBER
 *   AccountingDate              - GL/accounting date (must be an open period)
 *
 * Kept from the SOAP era: skip rules (amount=0 / credit / negative), dedup against
 * FusionStandardReceipt, FusionStandardReceipt persistence for the AR pipeline,
 * concurrency, retry on 5xx, and the progress endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const pLimit = require('p-limit');
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

const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 3;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const REQUEST_TIMEOUT = parseInt(process.env.ORACLE_SOAP_TIMEOUT) || 30000;

function asText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf-8');
  if (data && Array.isArray(data.data)) return Buffer.from(data.data).toString('utf-8');
  try { return JSON.stringify(data); } catch { return String(data); }
}

function snippet(text, length = 400) {
  if (!text) return '';
  return text.length > length ? text.slice(0, length) : text;
}

function normalizeDate(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error(`${fieldName} is required`);

  // Already YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;

  // DD-MM-YYYY
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  // YYYY/MM/DD
  const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;

  // DD/MM/YYYY  and  D/M/YYYY (Excel/US style, e.g. 5/22/2026 → interpreted as M/D/YYYY below)
  const dmySlashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmySlashMatch) {
    let [, a, b, y] = dmySlashMatch;
    // Heuristic: if the first part > 12 it must be the day (DD/MM); otherwise treat as MM/DD (US export).
    let month, day;
    if (parseInt(a) > 12) { day = a; month = b; } else { month = a; day = b; }
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Excel serial number
  const isNumeric = /^\d+(\.\d+)?$/.test(value);
  if (isNumeric) {
    const excelSerialNumber = parseFloat(value);
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const adjustedSerial = excelSerialNumber > 60 ? excelSerialNumber - 1 : excelSerialNumber;
    const dateFromSerial = new Date(excelEpoch.getTime() + adjustedSerial * 24 * 60 * 60 * 1000);
    const yearStr = String(dateFromSerial.getUTCFullYear()).padStart(4, '0');
    const monthStr = String(dateFromSerial.getUTCMonth() + 1).padStart(2, '0');
    const dayStr = String(dateFromSerial.getUTCDate()).padStart(2, '0');
    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, MM/DD/YYYY, or an Excel serial number`);
}

function normalizeAmount(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('Amount is required');
  const normalizedValue = value.replace(/,/g, '');
  const numeric = Number(normalizedValue);
  if (!Number.isFinite(numeric)) throw new Error('Amount must be a valid number');
  return normalizedValue;
}

/**
 * Normalize a CSV row into the exact JSON body Oracle's standardReceipts REST
 * resource expects. AccountingDate falls back to ReceiptDate when blank.
 */
function normalizeRow(row) {
  const receiptDate = normalizeDate(row.ReceiptDate, 'ReceiptDate');
  const accountingRaw = String(row.AccountingDate ?? '').trim();
  const accountingDate = accountingRaw ? normalizeDate(accountingRaw, 'AccountingDate') : receiptDate;
  return {
    ReceiptNumber:               String(row.ReceiptNumber ?? '').trim(),
    ReceiptMethod:               String(row.ReceiptMethod ?? '').trim(),
    ReceiptDate:                 receiptDate,
    BusinessUnit:                String(row.BusinessUnit ?? '').trim(),
    CustomerAccountNumber:       String(row.CustomerAccountNumber ?? '').trim(),
    CustomerSite:                String(row.CustomerSite ?? '').trim(),
    Amount:                      normalizeAmount(row.Amount),
    Currency:                    String(row.Currency ?? '').trim().toUpperCase(),
    RemittanceBankAccountNumber: String(row.RemittanceBankAccountNumber ?? '').trim(),
    AccountingDate:              accountingDate,
  };
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

// AccountingDate is allowed to be blank (falls back to ReceiptDate), so it is not
// enforced as a per-value requirement here.
const REQUIRED_VALUE_FIELDS = REQUIRED_FIELDS.filter((f) => f !== 'AccountingDate');

function validateCsv(records) {
  const headers = Object.keys(records[0] || {}).map((h) => h.trim());
  const missingHeaders = REQUIRED_FIELDS.filter((field) => !headers.includes(field));
  if (missingHeaders.length > 0) {
    return `CSV is missing required columns: ${missingHeaders.join(', ')}`;
  }

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const missingValues = REQUIRED_VALUE_FIELDS.filter((field) => {
      const value = row[field];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missingValues.length > 0) {
      return `Row ${i + 2} is missing values for: ${missingValues.join(', ')}`;
    }
  }

  return null;
}

/**
 * POST a single receipt to Oracle's standardReceipts REST resource.
 * Retries on 5xx up to MAX_RETRIES. Returns the axios response (validateStatus
 * always true so the caller inspects response.status).
 */
async function sendRestRequest(payload, receiptNumber) {
  const endpoint = process.env.ORACLE_STANDARD_RECEIPT_API_URL;
  if (!endpoint) {
    throw new Error('Oracle standard receipt REST URL is not configured. Check ORACLE_STANDARD_RECEIPT_API_URL in .env');
  }
  const auth = Buffer.from(`${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`).toString('base64');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Basic ${auth}`,
  };

  let response = null;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    response = await axios.post(endpoint, payload, { headers, timeout: REQUEST_TIMEOUT, validateStatus: () => true });
    if (response.status >= 500 && response.status < 600 && attempt <= MAX_RETRIES) {
      console.warn(`[StandardReceipt] ${receiptNumber} retry ${attempt}/${MAX_RETRIES}: HTTP ${response.status}`);
      continue;
    }
    break;
  }
  return response;
}

async function previewXml(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
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
      receiptNumber: row.ReceiptNumber,
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
      return res.status(500).json({ error: 'Oracle standard receipt REST URL is not configured. Check ORACLE_STANDARD_RECEIPT_API_URL in .env' });
    }

    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
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

    let successCount = 0;
    let failureCount = 0;
    let skipCount = 0;
    const failures = [];
    const responseLogs = [];
    let firstErrorMessage = '';
    let lastSuccessMessage = '';
    const startTime = Date.now();
    const logContext = `Endpoint=${process.env.ORACLE_STANDARD_RECEIPT_API_URL}`;

    const limit = pLimit(CONCURRENT_REQUESTS);

    const processingPromises = normalizedRecords.map((row, i) => {
      return limit(async () => {
        const rowNumber = i + 2;
        const amountNum = parseFloat(row.Amount);

        // Skip receipts with Amount = 0 or non-numeric Amount
        if (!Number.isFinite(amountNum) || amountNum === 0) {
          skipCount++;
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SKIPPED: Amount is 0 | Receipt: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.log(`⏭️  ${logLine}`);
          return;
        }

        // Skip receipts whose number contains "credit"
        if (/credit/i.test(row.ReceiptNumber)) {
          skipCount++;
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SKIPPED: receipt number contains 'credit' | Receipt: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.log(`⏭️  ${logLine}`);
          return;
        }

        // Skip negative amounts – handled as miscellaneous receipts, not standard receipts
        if (amountNum < 0) {
          skipCount++;
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SKIPPED: negative amount (${row.Amount}) – handled as misc receipt | Receipt: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.log(`⏭️  ${logLine}`);
          return;
        }

        // Deduplication: skip when receipt already succeeded in Fusion
        const existingReceipt = await prisma.fusionStandardReceipt.findFirst({
          where: { receiptNumber: row.ReceiptNumber, status: 'Success' },
          select: { id: true },
        });
        if (existingReceipt) {
          skipCount++;
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SKIPPED: receipt already exists in Fusion | Receipt: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.log(`⏭️  ${logLine}`);
          return;
        }

        let response = null;
        let sendError = null;
        try {
          console.log(`\n📤 Processing Row ${rowNumber}: ${row.ReceiptNumber}`);
          response = await sendRestRequest(row, row.ReceiptNumber);
        } catch (error) {
          sendError = error;
        }

        const responseText = asText(response ? response.data : (sendError && sendError.response && sendError.response.data));
        const httpStatus = response ? response.status : (sendError && sendError.response ? sendError.response.status : null);
        const failed = !!sendError || (response && response.status >= 400);

        if (failed) {
          failureCount++;
          const errorMessage = sendError
            ? (asText(sendError.response && sendError.response.data) || sendError.message || 'Oracle REST error')
            : snippet(responseText || `HTTP ${httpStatus}`);
          if (!firstErrorMessage) firstErrorMessage = `Row ${rowNumber}: ${snippet(errorMessage)}`;

          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row),
            errorMessage: String(errorMessage).substring(0, 500),
            requestPayload: JSON.stringify(row, null, 2),
            responseBody: snippet(responseText, 2000),
            responseStatus: httpStatus,
          });

          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED: ${snippet(errorMessage)} | HTTP ${httpStatus} | Receipt: ${row.ReceiptNumber} | ${logContext}`;
          responseLogs.push(logLine);
          console.error(`❌ ${logLine}`);

          // Persist failed receipt so the AR pipeline has a record of all attempts.
          try {
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:     uploadRecord.id,
                status:        'Failed',
                message:       String(errorMessage).substring(0, 500),
                requestDate:   new Date(),
                receiptNumber: row.ReceiptNumber,
                amount:        Number.isFinite(parseFloat(row.Amount)) ? parseFloat(row.Amount) : null,
                region:        'SA',
                integMode:     'MANUAL',
              },
            });
          } catch (dbErr) {
            console.error(`[StandardReceipt] DB save failed for ${row.ReceiptNumber}: ${dbErr.message}`);
          }
        } else {
          successCount++;
          if (!lastSuccessMessage) lastSuccessMessage = snippet(responseText || 'Success');
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | Receipt: ${row.ReceiptNumber} | HTTP ${httpStatus}`;
          responseLogs.push(logLine);
          console.log(`✅ ${logLine}`);

          // Persist successful receipt so the AR pipeline can match it against invoices.
          try {
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:     uploadRecord.id,
                status:        'Success',
                message:       null,
                requestDate:   new Date(),
                currencyCode:  row.Currency,
                receiptDate:   row.ReceiptDate ? new Date(row.ReceiptDate) : null,
                glDate:        row.AccountingDate ? new Date(row.AccountingDate) : null,
                depositDate:   row.ReceiptDate ? new Date(row.ReceiptDate) : null,
                receiptNumber: row.ReceiptNumber,
                amount:        Number.isFinite(parseFloat(row.Amount)) ? parseFloat(row.Amount) : null,
                region:        'SA',
                integMode:     'MANUAL',
              },
            });
          } catch (dbErr) {
            console.error(`[StandardReceipt] DB save failed for ${row.ReceiptNumber}: ${dbErr.message}`);
          }
        }
      });
    });

    await Promise.all(processingPromises);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    const avgTimePerRecord = (totalTime / normalizedRecords.length).toFixed(2);

    if (failures.length > 0) {
      await prisma.standardReceiptFailure.createMany({ data: failures });
    }

    const finalStatus = failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const responseMessage =
      firstErrorMessage || lastSuccessMessage || `${successCount} succeeded, ${failureCount} failed`;
    const performanceLog = `Total time: ${totalTime}s | Avg per record: ${avgTimePerRecord}s | Concurrency: ${CONCURRENT_REQUESTS}`;
    const responseLog =
      responseLogs.length > 0
        ? responseLogs.join('\n') + '\n\n' + performanceLog
        : responseMessage + '\n' + performanceLog;

    const updatedUpload = await prisma.standardReceiptUpload.update({
      where: { id: uploadRecord.id },
      data: { successCount, failureCount, status: finalStatus, responseMessage, responseLog },
    });

    console.log(
      `[StandardReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${normalizedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Skipped: ${skipCount} | Status: ${finalStatus} | Time: ${totalTime}s`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: normalizedRecords.length,
      successCount,
      failureCount,
      skipCount,
      status: finalStatus,
      processingTimeSeconds: parseFloat(totalTime),
      averageTimePerRecord: parseFloat(avgTimePerRecord),
      concurrency: CONCURRENT_REQUESTS,
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

    const upload = await prisma.standardReceiptUpload.findUnique({ where: { id: uploadId } });

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
  // REST format uses NAMES / NUMBERS, not internal IDs:
  //   ReceiptMethod               - method name exactly as in Oracle (Cash, Visa, Mada, Master, AMEX)
  //   BusinessUnit                - Oracle business unit name
  //   CustomerAccountNumber       - customer account number
  //   RemittanceBankAccountNumber - remittance bank account number
  //   ReceiptDate/AccountingDate  - AccountingDate must be in an OPEN AR period (blank → uses ReceiptDate)
  const sample =
    'Cash-0000000001,Cash,2026-06-30,<Business Unit>,<Customer Acct #>,<Site>,1500.00,SAR,<Remit Bank Acct #>,2026-06-30';
  const BOM = '﻿';
  const csv = `${BOM}${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="standard_receipt_template.csv"');
  return res.send(csv);
}

module.exports = {
  previewXml,
  upload,
  listUploads,
  getUpload,
  getUploadProgress,
  downloadTemplate,
  // exported for tests
  normalizeRow,
  validateCsv,
  normalizeDate,
  normalizeAmount,
};
