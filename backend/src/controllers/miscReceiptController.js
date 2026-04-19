/**
 * Miscellaneous Receipt controller.
 * Transforms CSV rows into SOAP XML envelopes and sends them to Oracle's
 * MiscellaneousReceiptService SOAP endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const prisma = require('../services/prisma');

// Required CSV columns (receipt method is optional if your org needs it)
const REQUIRED_FIELDS = [
  'Amount',
  'CurrencyCode',
  'DepositDate',
  'ReceiptDate',
  'GlDate',
  'OrgId',
  'ReceiptNumber',
  'ReceivableActivityName',
  'BankAccountNumber',
];

// Template + display columns (defaults to required fields; receipt method fields are supported but optional)
const TEMPLATE_FIELDS = [...REQUIRED_FIELDS];

// SOAP namespaces and action for Oracle MiscellaneousReceiptService
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const MISC_COMMON_NS =
  'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';
const SOAP_ACTION = 'createMiscellaneousReceipt';
const SOAP_ACTION_HEADER = `"${SOAP_ACTION}"`;
const REQUIRED_CURRENCY = 'SAR';

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

function extractXmlPayload(text) {
  if (!text) return '';
  const xmlStart = text.indexOf('<?xml');
  if (xmlStart !== -1) return text.slice(xmlStart);
  const envStart = text.search(/<\s*[\w.:-]*Envelope/i);
  return envStart !== -1 ? text.slice(envStart) : text;
}

function extractSoapFaultMessage(text) {
  const xml = extractXmlPayload(text);
  if (!xml) return null;
  const faultMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) return faultMatch[1].trim();
  const textMatch = xml.match(/<[\w.:-]*Text[^>]*>([\s\S]*?)<\/[\w.:-]*Text>/i);
  return textMatch ? textMatch[1].trim() : null;
}

function snippet(text, length = 500) {
  if (!text) return '';
  return text.length > length ? text.slice(0, length) : text;
}

/**
 * Validates that the parsed CSV has the required headers and non-empty values.
 * Returns an error string when validation fails; otherwise null.
 */
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

/**
 * Generates a SOAP XML envelope for a single miscellaneous receipt row.
 *
 * @param {Object} row - CSV row data
 * @returns {string} SOAP XML string
 */
function generateSoapEnvelope(row) {
  const receiptMethodIdTag = row.ReceiptMethodId
    ? `        <com:ReceiptMethodId>${escapeXml(row.ReceiptMethodId)}</com:ReceiptMethodId>\n`
    : '';
  const receiptMethodNameTag = row.ReceiptMethodName
    ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:com="${MISC_COMMON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>
      <com:miscellaneousReceipt>
        <com:Amount>${escapeXml(row.Amount)}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:DepositDate>${escapeXml(row.DepositDate)}</com:DepositDate>
        <com:GlDate>${escapeXml(row.GlDate)}</com:GlDate>
${receiptMethodIdTag}${receiptMethodNameTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </com:miscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** Escapes special XML characters to prevent injection */
function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureNegativeAmount(rawAmount) {
  const trimmed = String(rawAmount ?? '').trim();
  if (trimmed === '') {
    throw new Error('Amount is required');
  }
  const decimalMatch = trimmed.match(/\.(\d+)/);
  const decimals = decimalMatch ? decimalMatch[1].length : 0;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    throw new Error('Amount must be a valid number');
  }
  const negativeValue = numeric > 0 ? -numeric : numeric;
  return decimals > 0 ? negativeValue.toFixed(decimals) : negativeValue.toString();
}

function normalizeDate(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }
  throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
}

function normalizeRow(row) {
  return {
    ...row,
    Amount: ensureNegativeAmount(row.Amount),
    CurrencyCode: REQUIRED_CURRENCY,
    ReceiptNumber: String(row.ReceiptNumber ?? '').trim(),
    ReceiptDate: normalizeDate(row.ReceiptDate, 'ReceiptDate'),
    DepositDate: normalizeDate(row.DepositDate, 'DepositDate'),
    GlDate: normalizeDate(row.GlDate, 'GlDate'),
    ReceiptMethodId:
      row.ReceiptMethodId !== undefined && row.ReceiptMethodId !== null
        ? String(row.ReceiptMethodId).trim()
        : undefined,
    ReceiptMethodName:
      row.ReceiptMethodName !== undefined && row.ReceiptMethodName !== null
        ? String(row.ReceiptMethodName).trim()
        : undefined,
    ReceivableActivityName: String(row.ReceivableActivityName ?? '').trim(),
    BankAccountNumber: String(row.BankAccountNumber ?? '').trim(),
    OrgId: String(row.OrgId ?? '').trim(),
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

/**
 * POST /api/misc-receipt/preview
 * Parses the uploaded CSV and returns the generated SOAP XML for review –
 * does NOT send to Oracle.
 */
async function previewXml(req, res, next) {
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
      xml: generateSoapEnvelope(row),
    }));

    return res.json({ totalRows: normalizedRecords.length, previews });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/misc-receipt/upload
 * Transforms each CSV row into a SOAP XML envelope, sends it to Oracle,
 * and persists the upload + failure records in the database.
 */
async function upload(req, res, next) {
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

    // Generate combined XML payload (all rows) for storage
    const allXml = normalizedRecords.map(generateSoapEnvelope).join('\n\n');

    // Create upload record
    const uploadRecord = await prisma.miscReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        xmlPayload: allXml,
        responseStatus: 'PROCESSING',
        responseLog: '',
      },
    });

    // Oracle SOAP API credentials
    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    let successCount = 0;
    let failureCount = 0;
    const failures = [];
    const responseLogs = [];
    let firstErrorMessage = '';
    let lastSuccessMessage = '';
    const logContext = `Action=${SOAP_ACTION_HEADER} | Endpoint=${process.env.ORACLE_SOAP_URL}`;
    const startTime = Date.now();

    // Create a limit function for concurrent requests
    const limit = pLimit(CONCURRENT_REQUESTS);

    // Process all rows with parallel processing and retry logic
    const processingPromises = normalizedRecords.map((row, i) => {
      return limit(async () => {
        const rowNumber = i + 2;
        const soapXml = generateSoapEnvelope(row);
        const requestPreview = snippet(soapXml);

        try {
          // Use p-retry for automatic retries with exponential backoff
          const response = await pRetry(
            async () => {
              const res = await axios.post(process.env.ORACLE_SOAP_URL, soapXml, {
                headers: {
                  'Content-Type': 'text/xml; charset=utf-8',
                  Accept: 'text/xml',
                  SOAPAction: SOAP_ACTION_HEADER,
                  Authorization: `Basic ${oracleAuth}`,
                },
                timeout: 30000,
                responseType: 'text',
                validateStatus: () => true, // capture SOAP faults even when HTTP status is 500
              });

              const responseText = asText(res.data);
              const faultMsg = extractSoapFaultMessage(responseText);

              // Throw error for retryable SOAP faults or server errors
              if (res.status >= 500 && res.status < 600) {
                throw new Error(`HTTP ${res.status}: Server error`);
              }
              if (faultMsg && faultMsg.includes('timeout')) {
                throw new Error(`SOAP timeout: ${faultMsg}`);
              }

              return res;
            },
            {
              retries: MAX_RETRIES,
              minTimeout: RETRY_MIN_TIMEOUT,
              maxTimeout: RETRY_MAX_TIMEOUT,
              onFailedAttempt: (error) => {
                console.warn(
                  `[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} Retry ${error.attemptNumber}/${MAX_RETRIES}: ${error.message}`
                );
              },
            }
          );

          const responseText = asText(response.data);
          const xmlPayload = extractXmlPayload(responseText);
          const faultMsg = extractSoapFaultMessage(responseText);
          const hasHttpError = response.status >= 400;

          if (hasHttpError || faultMsg) {
            failureCount++;
            const errorDetail =
              faultMsg ||
              `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`.trim();
            const errorSnippet = snippet(errorDetail);
            failures.push({
              uploadId: uploadRecord.id,
              rowNumber,
              rawData: JSON.stringify(row), // SQLite stores JSON as a string
              errorMessage: errorSnippet,
              requestPayload: snippet(soapXml, 2000),
              responseBody: snippet(xmlPayload || responseText, 2000),
              responseStatus: response.status,
            });
            if (!firstErrorMessage) {
              firstErrorMessage = `Row ${rowNumber}: ${errorSnippet}`;
            }
            const logLine = `[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (${faultMsg ? 'SOAP fault' : 'HTTP error'}): ${snippet(
              faultMsg || xmlPayload || responseText
            )} | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${response.status} | ${logContext} | Request: ${requestPreview}`;
            responseLogs.push(logLine);
            console.error(logLine);
          } else {
            successCount++;
            const successSnippet = snippet(xmlPayload || responseText) || 'Success';
            if (!lastSuccessMessage) {
              lastSuccessMessage = successSnippet || 'Success';
            }
            const logLine = `[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${response.status} | Response: ${successSnippet || 'Success'} | ${logContext}`;
            responseLogs.push(logLine);
            console.log(logLine);
          }
        } catch (apiErr) {
          failureCount++;
          const responseText = asText(apiErr.response?.data);
          const faultMsg = extractSoapFaultMessage(responseText);
          const errMsg =
            faultMsg ||
            responseText ||
            apiErr.message ||
            'Oracle SOAP API error';
          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row), // SQLite stores JSON as a string
            errorMessage: typeof errMsg === 'string' ? snippet(errMsg) : JSON.stringify(errMsg || '').substring(0, 500),
            requestPayload: snippet(soapXml, 2000),
            responseBody: snippet(responseText || apiErr.message, 2000),
            responseStatus: apiErr.response?.status || null,
          });
          const errSnippet =
            typeof errMsg === 'string'
              ? snippet(errMsg)
              : JSON.stringify(errMsg || '').substring(0, 500);
          if (!firstErrorMessage) {
            firstErrorMessage = `Row ${rowNumber}: ${errSnippet}`;
          }
          const logLine = `[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (API): ${errSnippet} | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${apiErr.response?.status || 'N/A'} | ${logContext} | Request: ${requestPreview}`;
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

    // Persist failures
    if (failures.length > 0) {
      await prisma.miscReceiptFailure.createMany({ data: failures });
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

    // Update upload record with results
    const updatedUpload = await prisma.miscReceiptUpload.update({
      where: { id: uploadRecord.id },
      data: {
        responseStatus: finalStatus,
        responseMessage,
        responseLog,
      },
    });

    console.log(
      `[MiscReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${normalizedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus} | Time: ${totalTime}s | Avg: ${avgTimePerRecord}s/record`
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

/**
 * GET /api/misc-receipt/uploads
 * Returns a paginated list of misc receipt uploads.
 */
async function listUploads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [uploads, total] = await Promise.all([
      prisma.miscReceiptUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.miscReceiptUpload.count({ where }),
    ]);

    return res.json({ uploads, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/misc-receipt/uploads/:id
 * Returns details for a specific misc receipt upload including failures.
 */
async function getUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const uploadRecord = await prisma.miscReceiptUpload.findUnique({
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

    // Parse rawData JSON strings back to objects for the frontend
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
 * GET /api/misc-receipt/template
 * Returns a downloadable CSV template for misc receipt uploads.
 */
function downloadTemplate(_req, res) {
  const header = TEMPLATE_FIELDS.join(',');
  const sample =
    '-100.00,SAR,2024-01-20,2024-01-20,2024-01-20,101,REC001,Misc Activity,123456789';
  // Add UTF-8 BOM (Byte Order Mark) to ensure proper encoding of Arabic and other Unicode characters
  const BOM = '\uFEFF';
  const csv = `${BOM}${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="misc_receipt_template.csv"');
  return res.send(csv);
}

module.exports = { previewXml, upload, listUploads, getUpload, downloadTemplate };
