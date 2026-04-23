/**
 * Apply Receipt controller.
 * Processes CSV with invoice numbers and receipt numbers, looks up IDs from Oracle REST APIs,
 * then applies receipts via SOAP StandardReceiptService.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const prisma = require('../services/prisma');

// CSV column names - InvoiceNumber plus up to 4 receipt numbers
const REQUIRED_FIELDS = ['InvoiceNumber'];
const RECEIPT_FIELDS = ['ReceiptNumber1', 'ReceiptNumber2', 'ReceiptNumber3', 'ReceiptNumber4'];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...RECEIPT_FIELDS];

// Configuration for parallel processing and retries
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 5;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const RETRY_MIN_TIMEOUT = 1000; // 1 second
const RETRY_MAX_TIMEOUT = 10000; // 10 seconds

// SOAP namespaces for StandardReceiptService
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/standardReceiptService/types/';
const SOAP_ACTION = 'applyReceipt';
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

/**
 * Validates CSV structure - must have InvoiceNumber and at least one ReceiptNumber column
 */
function validateCsv(records) {
  if (!records || records.length === 0) {
    return 'CSV file is empty';
  }

  const headers = Object.keys(records[0] || {}).map((h) => h.trim());

  // Check for required InvoiceNumber column
  if (!headers.includes('InvoiceNumber')) {
    return 'CSV is missing required column: InvoiceNumber';
  }

  // Check that at least one receipt number column exists
  const hasReceiptColumn = RECEIPT_FIELDS.some(field => headers.includes(field));
  if (!hasReceiptColumn) {
    return `CSV must have at least one receipt number column (${RECEIPT_FIELDS.join(', ')})`;
  }

  // Validate each row has invoice number
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const invoiceNum = String(row.InvoiceNumber ?? '').trim();
    if (!invoiceNum) {
      return `Row ${i + 2}: InvoiceNumber is required`;
    }

    // Check that at least one receipt number is provided
    const hasReceipt = RECEIPT_FIELDS.some(field => {
      const val = String(row[field] ?? '').trim();
      return val !== '';
    });

    if (!hasReceipt) {
      return `Row ${i + 2}: At least one ReceiptNumber must be provided`;
    }
  }

  return null;
}

/**
 * Normalizes a single CSV row - extracts invoice and receipt numbers
 */
function normalizeRow(row) {
  const invoiceNumber = String(row.InvoiceNumber ?? '').trim();
  const receiptNumbers = RECEIPT_FIELDS
    .map(field => String(row[field] ?? '').trim())
    .filter(val => val !== '');

  return {
    invoiceNumber,
    receiptNumbers,
  };
}

/**
 * Looks up CustomerTransactionId from Oracle REST API by invoice number
 */
async function lookupInvoice(invoiceNumber, oracleAuth) {
  const url = process.env.ORACLE_RECEIVABLES_INVOICES_API_URL;
  const query = `TransactionNumber=${invoiceNumber}`;

  const response = await axios.get(`${url}?q=${encodeURIComponent(query)}`, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${oracleAuth}`,
    },
    timeout: 30000,
  });

  const items = response.data?.items || [];
  if (items.length === 0) {
    throw new Error(`Invoice '${invoiceNumber}' not found in Oracle`);
  }

  return {
    customerTrxId: String(items[0].CustomerTransactionId),
    data: items[0],
  };
}

/**
 * Looks up StandardReceiptId, Amount, and ReceiptDate from Oracle REST API by receipt number
 */
async function lookupReceipt(receiptNumber, oracleAuth) {
  const url = process.env.ORACLE_STANDARD_RECEIPTS_LOOKUP_API_URL;
  const query = `ReceiptNumber="${receiptNumber}"`;

  const response = await axios.get(`${url}?q=${encodeURIComponent(query)}`, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${oracleAuth}`,
    },
    timeout: 30000,
  });

  const items = response.data?.items || [];
  if (items.length === 0) {
    throw new Error(`Receipt '${receiptNumber}' not found in Oracle`);
  }

  const receipt = items[0];
  return {
    receiptId: String(receipt.StandardReceiptId),
    amount: String(receipt.Amount),
    receiptDate: String(receipt.ReceiptDate),
    data: receipt,
  };
}

/**
 * Builds SOAP XML envelope for applyReceipt operation
 */
function buildApplyReceiptXml(customerTrxId, receiptId, amount, receiptDate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${SOAP_TYPES_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:applyReceipt>
      <typ:ReceiptId>${receiptId}</typ:ReceiptId>
      <typ:CustomerTrxId>${customerTrxId}</typ:CustomerTrxId>
      <typ:AmountApplied>${amount}</typ:AmountApplied>
      <typ:ApplicationDate>${receiptDate}</typ:ApplicationDate>
      <typ:AccountingDate>${receiptDate}</typ:AccountingDate>
    </typ:applyReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Sends SOAP request to apply receipt
 */
async function applyReceiptSoap(customerTrxId, receiptId, amount, receiptDate, oracleAuth) {
  const soapXml = buildApplyReceiptXml(customerTrxId, receiptId, amount, receiptDate);
  const url = process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;

  const response = await axios.post(url, soapXml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: SOAP_ACTION_HEADER,
      Authorization: `Basic ${oracleAuth}`,
    },
    timeout: 30000,
    responseType: 'text',
    validateStatus: () => true, // Don't throw on non-2xx
  });

  return response;
}

/**
 * Preview endpoint - parses CSV and shows what would be sent
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

    const previews = [];
    for (let i = 0; i < records.length; i++) {
      const normalized = normalizeRow(records[i]);

      for (const receiptNum of normalized.receiptNumbers) {
        previews.push({
          rowNumber: i + 2,
          invoiceNumber: normalized.invoiceNumber,
          receiptNumber: receiptNum,
          soapTemplate: buildApplyReceiptXml(
            '{CustomerTrxId}',
            '{ReceiptId}',
            '{AmountApplied}',
            '{ApplicationDate/AccountingDate}'
          ),
        });
      }
    }

    return res.json({
      totalRows: records.length,
      totalApplications: previews.length,
      previews
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Upload endpoint - processes CSV and applies receipts to invoices
 */
async function upload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    // Validate environment configuration
    const requiredEnvVars = [
      'ORACLE_RECEIVABLES_INVOICES_API_URL',
      'ORACLE_STANDARD_RECEIPTS_LOOKUP_API_URL',
      'ORACLE_APPLY_RECEIPT_SOAP_URL',
    ];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      return res.status(500).json({
        error: `Missing required environment variables: ${missing.join(', ')}`
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

    const normalizedRecords = records.map(normalizeRow);

    // Create upload record
    const uploadRecord = await prisma.applyReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        totalRecords: normalizedRecords.length,
        totalReceipts: normalizedRecords.reduce((sum, r) => sum + r.receiptNumbers.length, 0),
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
    const startTime = Date.now();

    // Process all rows with parallel processing
    const limit = pLimit(CONCURRENT_REQUESTS);

    const processingPromises = normalizedRecords.map((row, rowIndex) => {
      return limit(async () => {
        const rowNumber = rowIndex + 2;
        const { invoiceNumber, receiptNumbers } = row;

        // Step 1: Look up invoice to get CustomerTrxId
        let customerTrxId = null;
        try {
          const invoiceResult = await pRetry(
            async () => lookupInvoice(invoiceNumber, oracleAuth),
            {
              retries: MAX_RETRIES,
              minTimeout: RETRY_MIN_TIMEOUT,
              maxTimeout: RETRY_MAX_TIMEOUT,
            }
          );
          customerTrxId = invoiceResult.customerTrxId;

          responseLogs.push(
            `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} Invoice lookup SUCCESS | Invoice: ${invoiceNumber} | CustomerTrxId: ${customerTrxId}`
          );
        } catch (invoiceErr) {
          // Invoice lookup failed - all receipts for this row fail
          for (const receiptNum of receiptNumbers) {
            failureCount++;
            const errorMsg = invoiceErr.message || 'Invoice lookup failed';
            failures.push({
              uploadId: uploadRecord.id,
              rowNumber,
              invoiceNumber,
              receiptNumber: receiptNum,
              errorMessage: errorMsg,
              errorStep: 'INVOICE_LOOKUP',
              requestPayload: `GET ${process.env.ORACLE_RECEIVABLES_INVOICES_API_URL}?q=TransactionNumber=${invoiceNumber}`,
              responseBody: snippet(asText(invoiceErr.response?.data), 2000),
              responseStatus: invoiceErr.response?.status || null,
              customerTrxId: null,
              receiptId: null,
            });

            if (!firstErrorMessage) {
              firstErrorMessage = `Row ${rowNumber}: ${errorMsg}`;
            }

            responseLogs.push(
              `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (Invoice Lookup) | Invoice: ${invoiceNumber} | ${errorMsg}`
            );
          }
          return; // Skip receipt processing for this row
        }

        // Step 2 & 3: For each receipt, look it up and apply it
        for (const receiptNum of receiptNumbers) {
          let receiptId = null;
          let amount = null;
          let receiptDate = null;

          try {
            // Look up receipt details
            const receiptResult = await pRetry(
              async () => lookupReceipt(receiptNum, oracleAuth),
              {
                retries: MAX_RETRIES,
                minTimeout: RETRY_MIN_TIMEOUT,
                maxTimeout: RETRY_MAX_TIMEOUT,
              }
            );

            receiptId = receiptResult.receiptId;
            amount = receiptResult.amount;
            receiptDate = receiptResult.receiptDate;

            responseLogs.push(
              `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} Receipt lookup SUCCESS | Receipt: ${receiptNum} | ReceiptId: ${receiptId} | Amount: ${amount}`
            );

            // Apply the receipt via SOAP
            const applyResponse = await pRetry(
              async () => applyReceiptSoap(customerTrxId, receiptId, amount, receiptDate, oracleAuth),
              {
                retries: MAX_RETRIES,
                minTimeout: RETRY_MIN_TIMEOUT,
                maxTimeout: RETRY_MAX_TIMEOUT,
              }
            );

            const responseText = asText(applyResponse.data);

            if (applyResponse.status >= 400 || responseText.includes('soap:Fault') || responseText.includes('faultstring')) {
              // SOAP fault or HTTP error
              failureCount++;
              const faultMsg = extractSoapFaultMessage(responseText) || `HTTP ${applyResponse.status}`;
              failures.push({
                uploadId: uploadRecord.id,
                rowNumber,
                invoiceNumber,
                receiptNumber: receiptNum,
                errorMessage: faultMsg,
                errorStep: 'APPLY_RECEIPT',
                requestPayload: buildApplyReceiptXml(customerTrxId, receiptId, amount, receiptDate),
                responseBody: snippet(responseText, 2000),
                responseStatus: applyResponse.status,
                customerTrxId,
                receiptId,
              });

              if (!firstErrorMessage) {
                firstErrorMessage = `Row ${rowNumber} Receipt ${receiptNum}: ${faultMsg}`;
              }

              responseLogs.push(
                `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (Apply) | Receipt: ${receiptNum} | ${faultMsg}`
              );
            } else {
              // Success
              successCount++;
              lastSuccessMessage = `Applied receipt ${receiptNum} to invoice ${invoiceNumber}`;
              responseLogs.push(
                `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} SUCCESS | Invoice: ${invoiceNumber} | Receipt: ${receiptNum} | HTTP ${applyResponse.status}`
              );
            }

          } catch (err) {
            // Receipt lookup or apply failed
            failureCount++;
            const errorMsg = err.message || 'Receipt processing failed';
            const errorStep = receiptId ? 'APPLY_RECEIPT' : 'RECEIPT_LOOKUP';

            failures.push({
              uploadId: uploadRecord.id,
              rowNumber,
              invoiceNumber,
              receiptNumber: receiptNum,
              errorMessage: errorMsg,
              errorStep,
              requestPayload: receiptId
                ? buildApplyReceiptXml(customerTrxId, receiptId, amount, receiptDate)
                : `GET ${process.env.ORACLE_STANDARD_RECEIPTS_LOOKUP_API_URL}?q=ReceiptNumber="${receiptNum}"`,
              responseBody: snippet(asText(err.response?.data), 2000),
              responseStatus: err.response?.status || null,
              customerTrxId,
              receiptId,
            });

            if (!firstErrorMessage) {
              firstErrorMessage = `Row ${rowNumber} Receipt ${receiptNum}: ${errorMsg}`;
            }

            responseLogs.push(
              `[ApplyReceipt] Upload #${uploadRecord.id} Row ${rowNumber} FAILED (${errorStep}) | Receipt: ${receiptNum} | ${errorMsg}`
            );
          }
        }
      });
    });

    // Wait for all processing to complete
    await Promise.all(processingPromises);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    const totalApplications = normalizedRecords.reduce((sum, r) => sum + r.receiptNumbers.length, 0);
    const avgTimePerApplication = (totalTime / totalApplications).toFixed(2);

    // Save failures to database
    if (failures.length > 0) {
      await prisma.applyReceiptFailure.createMany({ data: failures });
    }

    // Determine final status
    const finalStatus =
      failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';

    const responseMessage =
      firstErrorMessage ||
      lastSuccessMessage ||
      `${successCount} succeeded, ${failureCount} failed`;

    const performanceLog = `Total time: ${totalTime}s | Avg per application: ${avgTimePerApplication}s | Concurrency: ${CONCURRENT_REQUESTS}`;
    const responseLog =
      responseLogs.length > 0
        ? responseLogs.join('\n') + '\n\n' + performanceLog
        : responseMessage + '\n' + performanceLog;

    // Update upload record with final results
    const updatedUpload = await prisma.applyReceiptUpload.update({
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
      `[ApplyReceipt] Upload #${uploadRecord.id} COMPLETE | Total Rows: ${normalizedRecords.length} | Total Applications: ${totalApplications} | Success: ${successCount} | Failed: ${failureCount} | Status: ${finalStatus} | Time: ${totalTime}s`
    );

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: normalizedRecords.length,
      totalReceipts: totalApplications,
      successCount,
      failureCount,
      status: finalStatus,
      processingTimeSeconds: parseFloat(totalTime),
      averageTimePerApplication: parseFloat(avgTimePerApplication),
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
 * Download CSV template
 */
function downloadTemplate(_req, res) {
  const header = ALL_FIELDS.join(',');
  const sample = 'BLK-ALAR-00000008,mada-12244,visa-12244,mastercard-12244,amex-12244';
  const sample2 = 'BLK-ALAR-00000009,mada-12245,,,';

  // Add UTF-8 BOM for proper encoding
  const BOM = '\uFEFF';
  const csv = `${BOM}${header}\n${sample}\n${sample2}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="apply_receipt_template.csv"');
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
