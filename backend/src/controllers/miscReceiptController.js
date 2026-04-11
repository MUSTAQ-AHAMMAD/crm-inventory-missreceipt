/**
 * Miscellaneous Receipt controller.
 * Transforms CSV rows into SOAP XML envelopes and sends them to Oracle's
 * MiscellaneousReceiptService SOAP endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const prisma = require('../services/prisma');

// Expected CSV columns for Misc Receipt uploads
const REQUIRED_FIELDS = [
  'CurrencyCode',
  'Amount',
  'ReceiptNumber',
  'ReceiptDate',
  'GlDate',
  'ReceiptMethodId',
  'ReceiptMethodName',
  'BankAccountName',
  'ReceivableActivityName',
  'OrgId',
];

// SOAP namespaces and action for Oracle MiscellaneousReceiptService
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const MISC_SERVICE_NS =
  'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/';
const MISC_TYPES_NS = `${MISC_SERVICE_NS}types/`;
const SOAP_ACTION = `${MISC_TYPES_NS}createMiscellaneousReceipt`;

/**
 * Generates a SOAP XML envelope for a single miscellaneous receipt row.
 *
 * @param {Object} row - CSV row data
 * @returns {string} SOAP XML string
 */
function generateSoapEnvelope(row) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${MISC_TYPES_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>
      <typ:miscellaneousReceipt>
        <typ:CurrencyCode>${escapeXml(row.CurrencyCode)}</typ:CurrencyCode>
        <typ:Amount>
          <typ:value>${escapeXml(row.Amount)}</typ:value>
          <typ:currencyCode>${escapeXml(row.CurrencyCode)}</typ:currencyCode>
        </typ:Amount>
        <typ:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</typ:ReceiptNumber>
        <typ:ReceiptDate>${escapeXml(row.ReceiptDate)}</typ:ReceiptDate>
        <typ:GlDate>${escapeXml(row.GlDate)}</typ:GlDate>
        <typ:ReceiptMethodId>${escapeXml(row.ReceiptMethodId)}</typ:ReceiptMethodId>
        <typ:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</typ:ReceiptMethodName>
        <typ:BankAccountName>${escapeXml(row.BankAccountName)}</typ:BankAccountName>
        <typ:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</typ:ReceivableActivityName>
        <typ:OrgId>${escapeXml(row.OrgId)}</typ:OrgId>
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

    // Generate combined XML payload (all rows) for storage
    const allXml = records.map(generateSoapEnvelope).join('\n\n');

    // Create upload record
    const uploadRecord = await prisma.miscReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        xmlPayload: allXml,
        responseStatus: 'PROCESSING',
      },
    });

    // Oracle SOAP API credentials
    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    let successCount = 0;
    let failureCount = 0;
    const failures = [];
    let lastResponseStatus = 'SUCCESS';
    let lastResponseMessage = '';

    // Send each row to the SOAP endpoint
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2;
      const soapXml = generateSoapEnvelope(row);

      try {
        const response = await axios.post(process.env.ORACLE_SOAP_URL, soapXml, {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            Accept: 'text/xml',
            SOAPAction: SOAP_ACTION,
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
        });

        // Parse SOAP response for fault detection
        if (response.data && response.data.includes('faultstring')) {
          const faultMatch = response.data.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
          const faultMsg = faultMatch ? faultMatch[1] : 'SOAP fault';
          failureCount++;
          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row), // SQLite stores JSON as a string
            errorMessage: faultMsg,
          });
          lastResponseStatus = 'PARTIAL';
          console.error(`[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (SOAP fault): ${faultMsg} | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${response.status}`);
        } else {
          successCount++;
          lastResponseMessage = response.data?.substring(0, 500) || 'Success';
          console.log(`[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${response.status}`);
        }
      } catch (apiErr) {
        failureCount++;
        const errMsg =
          apiErr.response?.data || apiErr.message || 'Oracle SOAP API error';
        failures.push({
          uploadId: uploadRecord.id,
          rowNumber,
          rawData: JSON.stringify(row), // SQLite stores JSON as a string
          errorMessage: typeof errMsg === 'string' ? errMsg.substring(0, 500) : JSON.stringify(errMsg).substring(0, 500),
        });
        lastResponseStatus = failureCount === records.length ? 'FAILED' : 'PARTIAL';
        console.error(`[MiscReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (API): ${typeof errMsg === 'string' ? errMsg.substring(0, 200) : JSON.stringify(errMsg).substring(0, 200)} | Receipt: ${row.ReceiptNumber || 'N/A'} | HTTP ${apiErr.response?.status || 'N/A'}`);
      }
    }

    // Persist failures
    if (failures.length > 0) {
      await prisma.miscReceiptFailure.createMany({ data: failures });
    }

    // Update upload record with results
    const updatedUpload = await prisma.miscReceiptUpload.update({
      where: { id: uploadRecord.id },
      data: {
        responseStatus: lastResponseStatus,
        responseMessage: lastResponseMessage || `${successCount} succeeded, ${failureCount} failed`,
      },
    });

    console.log(`[MiscReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${records.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${lastResponseStatus}`);

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: records.length,
      successCount,
      failureCount,
      status: lastResponseStatus,
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
  const header = REQUIRED_FIELDS.join(',');
  const sample = 'USD,1000.00,REC001,2024-01-15,2024-01-15,12345,Check,Main Bank,Misc Activity,101';
  const csv = `${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="misc_receipt_template.csv"');
  return res.send(csv);
}

module.exports = { previewXml, upload, listUploads, getUpload, downloadTemplate };
