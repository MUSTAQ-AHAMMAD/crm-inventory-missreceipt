/**
 * Miscellaneous Receipt controller.
 * Transforms CSV rows into SOAP XML envelopes and sends them to Oracle's
 * MiscellaneousReceiptService SOAP endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const prisma = require('../services/prisma');

// Required CSV columns (receipt method handled separately to allow ID or name)
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

// At least one of these must be provided to identify the receipt method
const RECEIPT_METHOD_FIELDS = [
  'ReceiptMethodId',
  'ReceiptMethodName',
];

// Template + display columns (includes both method columns)
const TEMPLATE_FIELDS = [
  'Amount',
  'CurrencyCode',
  'DepositDate',
  'ReceiptDate',
  'GlDate',
  'OrgId',
  'ReceiptNumber',
  ...RECEIPT_METHOD_FIELDS,
  'ReceivableActivityName',
  'BankAccountNumber',
];

// SOAP namespaces and action for Oracle MiscellaneousReceiptService
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const MISC_SERVICE_NS =
  'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/';
const MISC_TYPES_NS = `${MISC_SERVICE_NS}types/`;
const SOAP_ACTION = `${MISC_TYPES_NS}createMiscellaneousReceipt`;
const SOAP_ACTION_HEADER = `"${SOAP_ACTION}"`;

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
  const hasReceiptMethodHeader = RECEIPT_METHOD_FIELDS.some((field) => headers.includes(field));
  if (missingHeaders.length > 0) {
    return `CSV is missing required columns: ${missingHeaders.join(', ')}`;
  }
  if (!hasReceiptMethodHeader) {
    return 'CSV is missing required columns: ReceiptMethodId or ReceiptMethodName';
  }

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const missingValues = REQUIRED_FIELDS.filter((field) => {
      const value = row[field];
      return value === undefined || value === null || String(value).trim() === '';
    });
    const hasReceiptMethodValue = RECEIPT_METHOD_FIELDS.some((field) => {
      const value = row[field];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
    if (!hasReceiptMethodValue) {
      missingValues.push('ReceiptMethodId or ReceiptMethodName');
    }
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
    ? `        <ser:ReceiptMethodId>${escapeXml(row.ReceiptMethodId)}</ser:ReceiptMethodId>\n`
    : '';
  const receiptMethodNameTag = row.ReceiptMethodName
    ? `        <ser:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</ser:ReceiptMethodName>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${MISC_TYPES_NS}" xmlns:ser="${MISC_SERVICE_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>
      <typ:miscellaneousReceipt>
        <ser:CurrencyCode>${escapeXml(row.CurrencyCode)}</ser:CurrencyCode>
        <ser:Amount>${escapeXml(row.Amount)}</ser:Amount>
        <ser:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</ser:ReceiptNumber>
        <ser:ReceiptDate>${escapeXml(row.ReceiptDate)}</ser:ReceiptDate>
        <ser:DepositDate>${escapeXml(row.DepositDate)}</ser:DepositDate>
        <ser:GlDate>${escapeXml(row.GlDate)}</ser:GlDate>
${receiptMethodIdTag}${receiptMethodNameTag}        <ser:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</ser:ReceivableActivityName>
        <ser:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</ser:BankAccountNumber>
        <ser:OrgId>${escapeXml(row.OrgId)}</ser:OrgId>
      </typ:miscellaneousReceipt>
    </typ:createMiscellaneousReceipt>
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
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const previews = records.map((row, i) => ({
      rowNumber: i + 2,
      xml: generateSoapEnvelope(row),
    }));

    return res.json({ totalRows: records.length, previews });
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
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Generate combined XML payload (all rows) for storage
    const allXml = records.map(generateSoapEnvelope).join('\n\n');

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

    // Send each row to the SOAP endpoint
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2;
      const soapXml = generateSoapEnvelope(row);
      const requestPreview = snippet(soapXml);

      try {
        const response = await axios.post(process.env.ORACLE_SOAP_URL, soapXml, {
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
    }

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
    const responseLog =
      responseLogs.length > 0 ? responseLogs.join('\n') : responseMessage;

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
      `[MiscReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${records.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus}`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: records.length,
      successCount,
      failureCount,
      status: finalStatus,
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
    '1000.00,USD,2024-01-20,2024-01-15,2024-01-15,101,REC001,98765,Check,Misc Activity,123456789';
  const csv = `${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="misc_receipt_template.csv"');
  return res.send(csv);
}

module.exports = { previewXml, upload, listUploads, getUpload, downloadTemplate };
