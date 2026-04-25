/**
 * Miscellaneous Receipt controller - Uses OracleSoapClient for Oracle Fusion
 * Handles SOAP requests with proper authentication and error handling
 */

const { parse } = require('csv-parse/sync');
const pLimit = require('p-limit');
const prisma = require('../services/prisma');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

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

const TEMPLATE_FIELDS = [...REQUIRED_FIELDS];

// SOAP namespaces - MATCHES WSDL EXACTLY
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/types/';
const SOAP_COMMON_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';
const REQUIRED_CURRENCY = 'SAR';

const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 3;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

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
  if (trimmed === '') throw new Error('Amount is required');
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) throw new Error('Amount must be a valid number');
  return (numeric > 0 ? -numeric : numeric).toString();
}

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

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format`);
}

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
 * Generates SOAP envelope WITHOUT WS-Security (using simple Basic Auth)
 */
function generateSoapEnvelope(row) {
  const receiptMethodNameTag = row.ReceiptMethodName
    ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${SOAP_TYPES_NS}" xmlns:com="${SOAP_COMMON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>
      <com:MiscellaneousReceipt>
        <com:Amount>${escapeXml(row.Amount)}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:DepositDate>${escapeXml(row.DepositDate)}</com:DepositDate>
        <com:GlDate>${escapeXml(row.GlDate)}</com:GlDate>
${receiptMethodNameTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </com:MiscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Sends SOAP request using OracleSoapClient with proper authentication and error handling
 */
async function sendSoapRequest(soapXml, receiptNumber) {
  const endpoint = process.env.ORACLE_SOAP_URL;

  if (!endpoint) {
    throw new Error('Oracle SOAP configuration missing. Check ORACLE_SOAP_URL in .env');
  }

  try {
    console.log(`\n[MiscReceipt] Sending SOAP request for ${receiptNumber}`);

    // Create SOAP client with automatic WSDL discovery
    const soapClient = createOracleSoapClient(endpoint);

    // Use SOAPAction for createMiscellaneousReceipt operation
    const SOAP_ACTION = 'createMiscellaneousReceipt';

    const response = await soapClient.callWithCustomEnvelope(soapXml, SOAP_ACTION);

    console.log(`✅ Success for ${receiptNumber} - HTTP ${response.status}`);
    return { success: true, data: response.data, status: response.status };

  } catch (error) {
    console.error(`❌ Failed for ${receiptNumber}: ${error.message}`);
    throw error;
  }
}

/**
 * POST /api/misc-receipt/preview
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

    const limit = pLimit(CONCURRENT_REQUESTS);
    const processingPromises = normalizedRecords.map((row, i) => {
      return limit(async () => {
        const rowNumber = i + 2;
        const soapXml = generateSoapEnvelope(row);

        try {
          console.log(`\n📤 Processing Row ${rowNumber}: ${row.ReceiptNumber}`);
          
          const result = await sendSoapRequest(soapXml, row.ReceiptNumber);

          successCount++;
          const logLine = `[SUCCESS] Row ${rowNumber}: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.log(`✅ ${logLine}`);

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
          console.error(`❌ ${logLine}`);
        }
      });
    });

    await Promise.all(processingPromises);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);

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
