/**
 * Miscellaneous Receipt controller.
 * Transforms CSV rows into SOAP XML envelopes and sends them to Oracle's
 * MiscellaneousReceiptService SOAP endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const pLimit = require('p-limit');
const prisma = require('../services/prisma');

// Required CSV columns
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

// Template fields
const TEMPLATE_FIELDS = [...REQUIRED_FIELDS];

// SOAP namespaces - CRITICAL: Must match WSDL exactly
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_COMMON_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';
const REQUIRED_CURRENCY = 'SAR';

// Configuration
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 3;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

/**
 * Escapes special XML characters
 */
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
 * Ensures amount is negative (Oracle requires negative amounts for bank charges)
 */
function ensureNegativeAmount(rawAmount) {
  const trimmed = String(rawAmount ?? '').trim();
  if (trimmed === '') {
    throw new Error('Amount is required');
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    throw new Error('Amount must be a valid number');
  }
  const negativeValue = numeric > 0 ? -numeric : numeric;
  return negativeValue.toString();
}

/**
 * Normalizes date to YYYY-MM-DD format
 */
function normalizeDate(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }

  // Already in YYYY-MM-DD format
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;

  // DD-MM-YYYY format
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  // YYYY/MM/DD format
  const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;

  // DD/MM/YYYY format
  const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format`);
}

/**
 * Normalizes a single CSV row
 */
function normalizeRow(row) {
  return {
    Amount: ensureNegativeAmount(row.Amount),
    CurrencyCode: REQUIRED_CURRENCY,
    ReceiptNumber: String(row.ReceiptNumber ?? '').trim(),
    ReceiptDate: normalizeDate(row.ReceiptDate, 'ReceiptDate'),
    DepositDate: normalizeDate(row.DepositDate, 'DepositDate'),
    GlDate: normalizeDate(row.GlDate, 'GlDate'),
    ReceiptMethodName: row.ReceiptMethodName ? String(row.ReceiptMethodName).trim() : undefined,
    ReceivableActivityName: String(row.ReceivableActivityName ?? '').trim(),
    BankAccountNumber: String(row.BankAccountNumber ?? '').trim(),
    OrgId: String(row.OrgId ?? '').trim(),
  };
}

/**
 * Validates CSV records
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
 * Generates the CORRECT SOAP XML envelope for Oracle Fusion
 * Uses the commonService namespace as specified in the WSDL
 */
function generateSoapEnvelope(row) {
  const receiptMethodNameTag = row.ReceiptMethodName
    ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:com="${SOAP_COMMON_NS}">
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
${receiptMethodNameTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </com:miscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Sends SOAP request to Oracle with retry logic
 */
async function sendSoapRequest(soapXml, receiptNumber, rowNumber, uploadId) {
  const endpoint = process.env.ORACLE_SOAP_URL;
  const username = process.env.ORACLE_USERNAME;
  const password = process.env.ORACLE_PASSWORD;

  if (!endpoint || !username || !password) {
    throw new Error('Oracle SOAP configuration missing. Check ORACLE_SOAP_URL, ORACLE_USERNAME, ORACLE_PASSWORD');
  }

  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Attempt ${attempt}/${MAX_RETRIES}] Sending request for ${receiptNumber}`);

      const response = await axios.post(endpoint, soapXml, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '',
          'Authorization': `Basic ${auth}`,
          'Accept': 'text/xml, application/xml',
        },
        timeout: 30000,
        // Keep response as text to parse XML
        transformResponse: [(data) => data],
      });

      // Check for SOAP fault in response
      if (response.data && response.data.includes('<env:Fault>')) {
        const faultMatch = response.data.match(/<faultstring>(.*?)<\/faultstring>/);
        const faultMessage = faultMatch ? faultMatch[1] : 'SOAP Fault occurred';
        throw new Error(faultMessage);
      }

      // Check for success response
      if (response.data && response.data.includes('createMiscellaneousReceiptResponse')) {
        console.log(`✅ Success for ${receiptNumber}`);
        return { success: true, data: response.data, status: response.status };
      }

      // If we get here but no clear success indicator, check status
      if (response.status === 200 || response.status === 201) {
        console.log(`✅ Success (HTTP ${response.status}) for ${receiptNumber}`);
        return { success: true, data: response.data, status: response.status };
      }

      throw new Error(`Unexpected response: HTTP ${response.status}`);

    } catch (error) {
      lastError = error;
      const errorMessage = error.response?.data || error.message;
      const faultMatch = String(errorMessage).match(/<faultstring>(.*?)<\/faultstring>/);
      const friendlyError = faultMatch ? faultMatch[1] : error.message;

      console.error(`[Attempt ${attempt}/${MAX_RETRIES}] Failed for ${receiptNumber}: ${friendlyError}`);

      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Request failed after all retries');
}

/**
 * POST /api/misc-receipt/preview
 * Preview SOAP XML without sending to Oracle
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

    const normalizedRecords = records.map(row => normalizeRow(row));
    const previews = normalizedRecords.map((row, i) => ({
      rowNumber: i + 2,
      receiptNumber: row.ReceiptNumber,
      xml: generateSoapEnvelope(row),
    }));

    return res.json({ totalRows: normalizedRecords.length, previews });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/misc-receipt/upload
 * Upload CSV and send to Oracle
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
      normalizedRecords = records.map(row => normalizeRow(row));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Create upload record
    const uploadRecord = await prisma.miscReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        xmlPayload: normalizedRecords.map(generateSoapEnvelope).join('\n\n'),
        responseStatus: 'PROCESSING',
        responseLog: '',
      },
    });

    let successCount = 0;
    let failureCount = 0;
    const failures = [];
    const responseLogs = [];
    const startTime = Date.now();

    // Process with concurrency limit
    const limit = pLimit(CONCURRENT_REQUESTS);
    const processingPromises = normalizedRecords.map((row, i) => {
      return limit(async () => {
        const rowNumber = i + 2;
        const soapXml = generateSoapEnvelope(row);

        try {
          console.log(`\n📤 Processing Row ${rowNumber}: ${row.ReceiptNumber}`);
          console.log(`XML: ${soapXml.substring(0, 200)}...`);

          const result = await sendSoapRequest(soapXml, row.ReceiptNumber, rowNumber, uploadRecord.id);

          successCount++;
          const logLine = `[SUCCESS] Row ${rowNumber}: ${row.ReceiptNumber} | Status: ${result.status}`;
          responseLogs.push(logLine);
          console.log(logLine);

        } catch (error) {
          failureCount++;
          const errorMessage = error.message || 'Unknown error';
          
          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row),
            errorMessage: errorMessage.substring(0, 500),
            requestPayload: soapXml.substring(0, 2000),
            responseBody: error.response?.data?.substring(0, 2000) || errorMessage,
            responseStatus: error.response?.status || null,
          });

          const logLine = `[FAILED] Row ${rowNumber}: ${row.ReceiptNumber} | Error: ${errorMessage}`;
          responseLogs.push(logLine);
          console.error(logLine);
        }
      });
    });

    await Promise.all(processingPromises);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);

    // Save failures to database
    if (failures.length > 0) {
      await prisma.miscReceiptFailure.createMany({ data: failures });
    }

    const finalStatus = failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const responseMessage = `${successCount} succeeded, ${failureCount} failed`;
    const responseLog = responseLogs.join('\n');

    await prisma.miscReceiptUpload.update({
      where: { id: uploadRecord.id },
      data: {
        responseStatus: finalStatus,
        responseMessage,
        responseLog,
      },
    });

    console.log(`\n📊 Upload #${uploadRecord.id} COMPLETE: ${successCount} success, ${failureCount} failed (${totalTime}s)`);

    return res.json({
      uploadId: uploadRecord.id,
      totalRecords: normalizedRecords.length,
      successCount,
      failureCount,
      status: finalStatus,
      processingTimeSeconds: parseFloat(totalTime),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/misc-receipt/uploads
 * List all uploads
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
 * Get specific upload details
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

    // Parse rawData JSON strings
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
 * GET /api/misc-receipt/uploads/:id/progress
 * Get upload progress
 */
async function getUploadProgress(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const upload = await prisma.miscReceiptUpload.findUnique({
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
      status: upload.responseStatus,
      responseMessage: upload.responseMessage,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/misc-receipt/template
 * Download CSV template
 */
function downloadTemplate(_req, res) {
  const header = TEMPLATE_FIELDS.join(',');
  const sample = '-100.00,SAR,2024-01-20,2024-01-20,2024-01-20,101,REC001,Bank Charge,123456789';
  const BOM = '\uFEFF';
  const csv = `${BOM}${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="misc_receipt_template.csv"');
  return res.send(csv);
}

module.exports = {
  previewXml,
  upload,
  listUploads,
  getUpload,
  getUploadProgress,
  downloadTemplate
};
