/**
 * Standard Receipt controller - migrated to SOAP to match Java FusionReceiptClient.
 * Transforms CSV rows into SOAP envelopes and sends them to Oracle's
 * StandardReceiptService (createStandardReceipt operation).
 *
 * Field mapping from Java StandardReceiptRequest / FusionStdReceiptMapping:
 *   ReceiptNumber   - unique receipt identifier (format: PaymentType-TransactionNumber)
 *   ReceiptDate     - receipt date (also used for GlDate and DepositDate)
 *   Amount          - receipt amount (positive)
 *   CurrencyCode    - ISO currency code (e.g. SAR)
 *   ReceiptMethodId - numeric payment method ID from Oracle Fusion
 *   RegisterName    - VendhqRegister.registerName; used to derive RemittanceBankAccountId
 *                     (Java: receiptIsCash ? register.cashAccountId : register.bankAccountId)
 *   CustomerId      - numeric customer party ID from Oracle Fusion
 *   OrgId           - numeric Oracle Fusion business unit / org ID
 */

const { parse } = require('csv-parse/sync');
const pLimit = require('p-limit');
const prisma = require('../services/prisma');
const { createOracleSoapClient } = require('../services/OracleSoapClient');
const { buildStandardReceiptEnvelope } = require('../services/soapEnvelopeBuilder');

// CSV fields – RegisterName replaces RemittanceBankAccountId so users provide a register
// name instead of a raw Oracle ID.  The controller resolves the correct bank account ID
// (cashAccountId or bankAccountId) from VendhqRegister + FusionReceiptMethod, exactly
// mirroring Java FusionStdReceiptMapping.mapToStandardReceipt().
const REQUIRED_FIELDS = [
  'ReceiptNumber',
  'ReceiptDate',
  'Amount',
  'CurrencyCode',
  'ReceiptMethodId',
  'RegisterName',
  'CustomerId',
  'OrgId',
];

const TEMPLATE_FIELDS = [...REQUIRED_FIELDS];

const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 3;

function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
    ReceiptNumber:   String(row.ReceiptNumber   ?? '').trim(),
    ReceiptDate:     normalizeDate(row.ReceiptDate, 'ReceiptDate'),
    Amount:          normalizeAmount(row.Amount),
    CurrencyCode:    String(row.CurrencyCode    ?? '').trim().toUpperCase(),
    ReceiptMethodId: String(row.ReceiptMethodId ?? '').trim(),
    RegisterName:    String(row.RegisterName    ?? '').trim(),
    CustomerId:      String(row.CustomerId      ?? '').trim(),
    OrgId:           String(row.OrgId           ?? '').trim(),
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

/**
 * Mirrors Java FusionStdReceiptMapping lines 33-35:
 *   setRemittanceBankAccountId(
 *     receiptMethodMeta.getReceiptIsCash().equals("1")
 *       ? registerDetails.getCashAccountId().longValue()
 *       : registerDetails.getBankAccountId().longValue());
 *
 * Looks up VendhqRegister by RegisterName, looks up FusionReceiptMethod by
 * ReceiptMethodId, and returns the appropriate Oracle bank account ID string.
 * Falls back to parsing the ReceiptNumber prefix ("Cash-...") when the receipt
 * method is not found in FusionReceiptMethod.
 * Note: FusionReceiptMethod.receiptIsCash is stored as a Boolean in Prisma.
 */
async function resolveRemittanceBankAccountId(row, rowNumber) {
  const register = await prisma.vendhqRegister.findFirst({
    where: { registerName: row.RegisterName },
  });
  if (!register) {
    throw new Error(
      `Row ${rowNumber}: Register '${row.RegisterName}' not found in VendhqRegister. ` +
      `Check the RegisterName column.`
    );
  }

  // Determine isCash: prefer DB lookup, fallback to ReceiptNumber prefix ("Cash-...")
  const receiptMethod = await prisma.fusionReceiptMethod.findFirst({
    where: { receiptMethodId: row.ReceiptMethodId },
  });
  const isCash = receiptMethod
    ? receiptMethod.receiptIsCash === true
    : row.ReceiptNumber.toUpperCase().startsWith('CASH-');

  const remittanceBankAccountId = isCash
    ? register.cashAccountId
    : register.bankAccountId;

  if (!remittanceBankAccountId) {
    const needed = isCash ? 'cashAccountId' : 'bankAccountId';
    throw new Error(
      `Row ${rowNumber}: Register '${row.RegisterName}' has no ${needed}. ` +
      `Update VendhqRegister with the correct Oracle bank account ID.`
    );
  }

  return String(remittanceBankAccountId);
}

/**
 * Sends the SOAP envelope to Oracle's StandardReceiptService.
 */
async function sendSoapRequest(soapXml, receiptNumber) {
  const endpoint = process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL;
  if (!endpoint) {
    throw new Error('Oracle SOAP configuration missing. Check ORACLE_STANDARD_RECEIPT_SOAP_URL in .env');
  }

  console.log(`\n[StandardReceipt] Sending SOAP request for ${receiptNumber}`);
  const soapClient = createOracleSoapClient(endpoint);
  const response = await soapClient.callWithCustomEnvelope(soapXml, 'createStandardReceipt');
  console.log(`✅ Success for ${receiptNumber} - HTTP ${response.status}`);
  return { success: true, data: response.data, status: response.status };
}

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

    // Resolve RemittanceBankAccountId from VendhqRegister for each row
    const enrichedRecords = [];
    for (let i = 0; i < normalizedRecords.length; i++) {
      const rowNumber = i + 2;
      try {
        const remittanceBankAccountId = await resolveRemittanceBankAccountId(normalizedRecords[i], rowNumber);
        enrichedRecords.push({ ...normalizedRecords[i], RemittanceBankAccountId: remittanceBankAccountId });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const previews = enrichedRecords.map((row, i) => ({
      rowNumber: i + 2,
      receiptNumber: row.ReceiptNumber,
      xml: buildStandardReceiptEnvelope(row),
    }));

    return res.json({ totalRows: enrichedRecords.length, previews });
  } catch (err) {
    next(err);
  }
}

async function upload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    if (!process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL) {
      return res.status(500).json({ error: 'Oracle standard receipt SOAP URL is not configured. Check ORACLE_STANDARD_RECEIPT_SOAP_URL in .env' });
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

    // Resolve RemittanceBankAccountId from VendhqRegister for each row before upload
    const enrichedRecords = [];
    for (let i = 0; i < normalizedRecords.length; i++) {
      const rowNumber = i + 2;
      try {
        const remittanceBankAccountId = await resolveRemittanceBankAccountId(normalizedRecords[i], rowNumber);
        enrichedRecords.push({ ...normalizedRecords[i], RemittanceBankAccountId: remittanceBankAccountId });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const uploadRecord = await prisma.standardReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        payloadJson: JSON.stringify(enrichedRecords, null, 2),
        totalRecords: enrichedRecords.length,
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

    const limit = pLimit(CONCURRENT_REQUESTS);

    const processingPromises = enrichedRecords.map((row, i) => {
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

        // Deduplication: skip SOAP call when receipt already exists in Fusion
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

        const soapXml = buildStandardReceiptEnvelope(row);

        let soapResult = null;
        let soapError = null;

        try {
          console.log(`\n📤 Processing Row ${rowNumber}: ${row.ReceiptNumber}`);
          soapResult = await sendSoapRequest(soapXml, row.ReceiptNumber);
        } catch (error) {
          soapError = error;
        }

        if (soapError) {
          failureCount++;
          const errorMessage = soapError.message || 'Unknown error';
          if (!firstErrorMessage) firstErrorMessage = `Row ${rowNumber}: ${snippet(errorMessage)}`;

          failures.push({
            uploadId: uploadRecord.id,
            rowNumber,
            rawData: JSON.stringify(row),
            errorMessage: errorMessage.substring(0, 500),
            requestPayload: soapXml.substring(0, 2000),
            responseBody: (soapError.response?.data ?? soapError.message ?? '').substring(0, 2000),
            responseStatus: soapError.response?.status || null,
          });

          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED: ${snippet(errorMessage)} | Receipt: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.error(`❌ ${logLine}`);

          // Persist failed receipt to FusionStandardReceipt so the AR pipeline
          // has a complete record of all attempted receipts.
          try {
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:    uploadRecord.id,
                status:       'Failed',
                message:      errorMessage.substring(0, 500),
                requestDate:  new Date(),
                receiptNumber: row.ReceiptNumber,
                amount:       Number.isFinite(parseFloat(row.Amount)) ? parseFloat(row.Amount) : null,
                region:       'SA',
                integMode:    'MANUAL',
              },
            });
          } catch (dbErr) {
            console.error(`[StandardReceipt] DB save failed for ${row.ReceiptNumber}: ${dbErr.message}`);
          }
        } else {
          successCount++;
          if (!lastSuccessMessage) lastSuccessMessage = snippet(soapResult.data || 'Success');
          const logLine = `[StandardReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | Receipt: ${row.ReceiptNumber}`;
          responseLogs.push(logLine);
          console.log(`✅ ${logLine}`);

          // Persist successful receipt to FusionStandardReceipt so the AR pipeline
          // can match it against invoices (getSummary / getPendingApply queries this table).
          try {
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:           uploadRecord.id,
                status:              'Success',
                message:             null,
                requestDate:         new Date(),
                currencyCode:        row.CurrencyCode,
                receiptDate:         row.ReceiptDate ? new Date(row.ReceiptDate) : null,
                glDate:              row.ReceiptDate ? new Date(row.ReceiptDate) : null,
                depositDate:         row.ReceiptDate ? new Date(row.ReceiptDate) : null,
                receiptNumber:       row.ReceiptNumber,
                receiptMethodId:     row.ReceiptMethodId || null,
                remittanceBankAccId: row.RemittanceBankAccountId || null,
                customerId:          row.CustomerId || null,
                orgId:               row.OrgId || null,
                amount:              Number.isFinite(parseFloat(row.Amount)) ? parseFloat(row.Amount) : null,
                region:              'SA',
                integMode:           'MANUAL',
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
    const avgTimePerRecord = (totalTime / enrichedRecords.length).toFixed(2);

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
      `[StandardReceipt] Upload #${uploadRecord.id} COMPLETE | Total: ${enrichedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Skipped: ${skipCount} | Status: ${finalStatus} | Time: ${totalTime}s`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: enrichedRecords.length,
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
  // Sample row: RegisterName replaces RemittanceBankAccountId – use your store's register name
  // (matches VendhqRegister.registerName, e.g. AZIZMALL, WADILABAN, RASHIDABHA …)
  const sample =
    'Visa-BLK-ALAR-00000008,2026-03-05,422.00,SAR,300000001518646,AZIZMALL,300000001234567,300000001421038';
  // Add UTF-8 BOM (Byte Order Mark) to ensure proper encoding of Arabic and other Unicode characters
  const BOM = '\uFEFF';
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
};
