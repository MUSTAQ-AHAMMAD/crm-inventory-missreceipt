/**
 * Standard Receipt controller.
 * Transforms CSV rows into REST payloads and sends them to Oracle's
 * standardReceipts REST endpoint.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
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
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
}

function normalizeAmount(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('Amount is required');
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error('Amount must be a valid number');
  }
  return value;
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

    for (let i = 0; i < normalizedRecords.length; i++) {
      const row = normalizedRecords[i];
      const rowNumber = i + 2;
      const requestPreview = snippet(JSON.stringify(row));

      try {
        const response = await axios.post(process.env.ORACLE_STANDARD_RECEIPT_API_URL, row, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
          validateStatus: () => true,
        });

        const responseText = asText(response.data);
        if (response.status >= 400) {
          failureCount++;
          const errorDetail = snippet(responseText || `HTTP ${response.status}`);
          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row),
            errorMessage: errorDetail,
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
        });
        if (!firstErrorMessage) {
          firstErrorMessage = `Row ${rowNumber}: ${errorDetail}`;
        }
        const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (API): ${errorDetail} | ${logContext} | Request: ${requestPreview}`;
        responseLogs.push(logLine);
        console.error(logLine);
      }
    }

    if (failures.length > 0) {
      await prisma.standardReceiptFailure.createMany({ data: failures });
    }

    const finalStatus =
      failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    const responseMessage =
      firstErrorMessage ||
      lastSuccessMessage ||
      `${successCount} succeeded, ${failureCount} failed`;
    const responseLog =
      responseLogs.length > 0 ? responseLogs.join('\n') : responseMessage;

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
      `[StandardReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${normalizedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus}`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: normalizedRecords.length,
      successCount,
      failureCount,
      status: finalStatus,
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
  downloadTemplate,
};
