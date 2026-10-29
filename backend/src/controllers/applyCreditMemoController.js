/**
 * Apply Credit Memo controller.
 *
 * Applies an on-account credit memo to an invoice via Oracle Fusion's
 * CreditMemoService SOAP operation `createApplyOnAccountCreditMemo`.
 *
 * A CSV row supplies the business keys directly (no REST ID lookups needed —
 * Oracle resolves them internally):
 *   BusinessUnit, CreditMemoTrxNumber, InvoiceTrxNumber, AmountApplied,
 *   ApplyDate, GlDate
 *
 * SOAP envelope (verified working sample):
 *   <typ:createApplyOnAccountCreditMemo>
 *     <typ:applyOnAccountCreditMemo>
 *       <cred:BusinessUnit>AlQurashi-KSA</cred:BusinessUnit>
 *       <cred:CreditMemoTrxNumber>1408161</cred:CreditMemoTrxNumber>
 *       <cred:InvoiceTrxNumber>2942527</cred:InvoiceTrxNumber>
 *       <cred:AmountApplied>216.52</cred:AmountApplied>
 *       <cred:ApplyDate>2026-08-06</cred:ApplyDate>
 *       <cred:GlDate>2026-08-06</cred:GlDate>
 *     </typ:applyOnAccountCreditMemo>
 *   </typ:createApplyOnAccountCreditMemo>
 *
 * Processing mirrors applyReceiptController: parse CSV → one SOAP call per row →
 * aggregate results. Rows run concurrently (bounded by CONCURRENT_REQUESTS) with
 * per-call retry, and results are returned synchronously.
 */

const { parse } = require('csv-parse/sync');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

// CSV columns matching the createApplyOnAccountCreditMemo payload.
const REQUIRED_FIELDS = [
  'BusinessUnit',
  'CreditMemoTrxNumber',
  'InvoiceTrxNumber',
  'AmountApplied',
  'ApplyDate',
  'GlDate',
];

// Parallel processing + retry configuration (same env knobs as Apply Receipt).
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS, 10) || 5;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10) || 3;
const RETRY_MIN_TIMEOUT = 1000; // 1 second
const RETRY_MAX_TIMEOUT = 10000; // 10 seconds

// SOAP namespaces for CreditMemoService - createApplyOnAccountCreditMemo operation
const SOAP_ENV_NS  = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYP_NS  = 'http://xmlns.oracle.com/apps/financials/receivables/transactions/creditMemos/creditMemoService/types/';
const SOAP_CRED_NS = 'http://xmlns.oracle.com/apps/financials/receivables/transactions/creditMemos/creditMemoService/';

const SOAP_ACTION = 'createApplyOnAccountCreditMemo';

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

function snippet(text, length = 2000) {
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
 * Normalizes a date value to YYYY-MM-DD.
 * Accepts YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, DD/MM/YYYY, or Excel serial numbers.
 */
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

  const isNumeric = /^\d+(\.\d+)?$/.test(value);
  if (isNumeric) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const serial = parseFloat(value);
    const adjusted = serial > 60 ? serial - 1 : serial;
    const date = new Date(excelEpoch.getTime() + adjusted * 86400000);
    const y = String(date.getUTCFullYear()).padStart(4, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format`);
}

/**
 * Validates CSV structure — all required columns must be present and non-empty.
 */
function validateCsv(records) {
  if (!records || records.length === 0) {
    return 'CSV file is empty';
  }

  const headers = Object.keys(records[0] || {}).map((h) => h.trim());
  const missingHeaders = REQUIRED_FIELDS.filter((f) => !headers.includes(f));
  if (missingHeaders.length > 0) {
    return `CSV is missing required columns: ${missingHeaders.join(', ')}`;
  }

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const missingValues = REQUIRED_FIELDS.filter((f) => {
      const v = row[f];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missingValues.length > 0) {
      return `Row ${i + 2} is missing values for: ${missingValues.join(', ')}`;
    }
  }

  return null;
}

/**
 * Normalizes a single CSV row into the fields the SOAP builder expects.
 * ApplyDate and GlDate are normalized to YYYY-MM-DD; amount/keys are trimmed strings.
 */
function normalizeRow(row) {
  const amountRaw = String(row.AmountApplied ?? '').trim().replace(/,/g, '');
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) {
    throw new Error(`AmountApplied must be a number (got "${row.AmountApplied}")`);
  }

  return {
    BusinessUnit:        String(row.BusinessUnit        ?? '').trim(),
    CreditMemoTrxNumber: String(row.CreditMemoTrxNumber ?? '').trim(),
    InvoiceTrxNumber:    String(row.InvoiceTrxNumber    ?? '').trim(),
    AmountApplied:       amountRaw,
    ApplyDate:           normalizeDate(row.ApplyDate, 'ApplyDate'),
    GlDate:              normalizeDate(row.GlDate, 'GlDate'),
  };
}

/**
 * Builds the SOAP XML envelope for createApplyOnAccountCreditMemo.
 */
function buildApplyCreditMemoXml(row) {
  if (!row.BusinessUnit || !row.CreditMemoTrxNumber || !row.InvoiceTrxNumber ||
      !row.AmountApplied || !row.ApplyDate || !row.GlDate) {
    throw new Error('Missing required fields for createApplyOnAccountCreditMemo SOAP call');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${SOAP_TYP_NS}"
  xmlns:cred="${SOAP_CRED_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createApplyOnAccountCreditMemo>
      <typ:applyOnAccountCreditMemo>
        <cred:BusinessUnit>${escapeXml(row.BusinessUnit)}</cred:BusinessUnit>
        <cred:CreditMemoTrxNumber>${escapeXml(row.CreditMemoTrxNumber)}</cred:CreditMemoTrxNumber>
        <cred:InvoiceTrxNumber>${escapeXml(row.InvoiceTrxNumber)}</cred:InvoiceTrxNumber>
        <cred:AmountApplied>${escapeXml(row.AmountApplied)}</cred:AmountApplied>
        <cred:ApplyDate>${escapeXml(row.ApplyDate)}</cred:ApplyDate>
        <cred:GlDate>${escapeXml(row.GlDate)}</cred:GlDate>
      </typ:applyOnAccountCreditMemo>
    </typ:createApplyOnAccountCreditMemo>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Sends the createApplyOnAccountCreditMemo SOAP request using OracleSoapClient.
 */
async function applyCreditMemoSoap(row) {
  const soapXml = buildApplyCreditMemoXml(row);
  const url = process.env.ORACLE_APPLY_CREDIT_MEMO_SOAP_URL;

  if (!url) {
    throw new Error('ORACLE_APPLY_CREDIT_MEMO_SOAP_URL not configured in .env');
  }

  console.log(`[ApplyCreditMemo] Sending SOAP for CreditMemo: ${row.CreditMemoTrxNumber}, Invoice: ${row.InvoiceTrxNumber}, Amount: ${row.AmountApplied}`);

  const soapClient = createOracleSoapClient(url);
  const response = await soapClient.callWithCustomEnvelope(soapXml, SOAP_ACTION);

  console.log(`[ApplyCreditMemo] SOAP successful - HTTP ${response.status}`);
  return { status: response.status, statusText: response.statusText, data: response.data };
}

/**
 * POST /api/apply-credit-memo/preview
 * Parses the CSV and returns the exact SOAP payloads that would be sent.
 * No Oracle calls are made.
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

    let normalizedRecords;
    try {
      normalizedRecords = records.map((r, i) => {
        try { return normalizeRow(r); }
        catch (e) { throw new Error(`Row ${i + 2}: ${e.message}`); }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const previews = normalizedRecords.map((row, i) => ({
      rowNumber: i + 2,
      businessUnit: row.BusinessUnit,
      creditMemoTrxNumber: row.CreditMemoTrxNumber,
      invoiceTrxNumber: row.InvoiceTrxNumber,
      amountApplied: row.AmountApplied,
      applyDate: row.ApplyDate,
      glDate: row.GlDate,
      soapPayload: buildApplyCreditMemoXml(row),
    }));

    return res.json({ totalRows: records.length, previews });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/apply-credit-memo/upload
 * Processes the CSV and sends one createApplyOnAccountCreditMemo SOAP call per row.
 * Returns per-row results synchronously.
 */
async function upload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    if (!process.env.ORACLE_APPLY_CREDIT_MEMO_SOAP_URL) {
      return res.status(500).json({
        error: 'Missing required environment variable: ORACLE_APPLY_CREDIT_MEMO_SOAP_URL',
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

    let normalizedRecords;
    try {
      normalizedRecords = records.map((r, i) => {
        try { return normalizeRow(r); }
        catch (e) { throw new Error(`Row ${i + 2}: ${e.message}`); }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let successCount = 0;
    let failureCount = 0;
    const results = new Array(normalizedRecords.length);
    const startTime = Date.now();

    const limit = pLimit(CONCURRENT_REQUESTS);

    const processingPromises = normalizedRecords.map((row, rowIndex) => {
      return limit(async () => {
        const rowNumber = rowIndex + 2;
        try {
          const applyResponse = await pRetry(
            async () => applyCreditMemoSoap(row),
            { retries: MAX_RETRIES, minTimeout: RETRY_MIN_TIMEOUT, maxTimeout: RETRY_MAX_TIMEOUT }
          );

          const responseText = asText(applyResponse.data);

          // OracleSoapClient throws on SOAP fault / 4xx / 5xx, so a resolved
          // response is normally a success; this is a belt-and-braces check.
          if (applyResponse.status >= 400 || /soap:Fault|faultstring/i.test(responseText)) {
            failureCount++;
            const faultMsg = extractSoapFaultMessage(responseText) || `HTTP ${applyResponse.status}`;
            results[rowIndex] = {
              rowNumber,
              status: 'FAILED',
              businessUnit: row.BusinessUnit,
              creditMemoTrxNumber: row.CreditMemoTrxNumber,
              invoiceTrxNumber: row.InvoiceTrxNumber,
              amountApplied: row.AmountApplied,
              message: faultMsg,
              httpStatus: applyResponse.status,
            };
            console.log(`[ApplyCreditMemo] Row ${rowNumber} FAILED | CreditMemo: ${row.CreditMemoTrxNumber} | Invoice: ${row.InvoiceTrxNumber} | ${faultMsg}`);
          } else {
            successCount++;
            results[rowIndex] = {
              rowNumber,
              status: 'SUCCESS',
              businessUnit: row.BusinessUnit,
              creditMemoTrxNumber: row.CreditMemoTrxNumber,
              invoiceTrxNumber: row.InvoiceTrxNumber,
              amountApplied: row.AmountApplied,
              message: `Applied credit memo ${row.CreditMemoTrxNumber} to invoice ${row.InvoiceTrxNumber}`,
              httpStatus: applyResponse.status,
            };
            console.log(`[ApplyCreditMemo] Row ${rowNumber} SUCCESS | CreditMemo: ${row.CreditMemoTrxNumber} | Invoice: ${row.InvoiceTrxNumber} | HTTP ${applyResponse.status}`);
          }
        } catch (err) {
          failureCount++;
          const errorMsg = err.message || 'Apply credit memo failed';
          results[rowIndex] = {
            rowNumber,
            status: 'FAILED',
            businessUnit: row.BusinessUnit,
            creditMemoTrxNumber: row.CreditMemoTrxNumber,
            invoiceTrxNumber: row.InvoiceTrxNumber,
            amountApplied: row.AmountApplied,
            message: errorMsg,
            responseBody: snippet(asText(err.response?.data)),
            httpStatus: err.response?.status || null,
          };
          console.log(`[ApplyCreditMemo] Row ${rowNumber} FAILED | CreditMemo: ${row.CreditMemoTrxNumber} | Invoice: ${row.InvoiceTrxNumber} | ${errorMsg}`);
        }
      });
    });

    await Promise.all(processingPromises);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgTime = normalizedRecords.length > 0
      ? (totalTime / normalizedRecords.length).toFixed(2) : '0.00';

    const status = failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';

    console.log(
      `[ApplyCreditMemo] Upload COMPLETE | Rows: ${normalizedRecords.length} | Success: ${successCount} | Failed: ${failureCount} | Status: ${status} | Time: ${totalTime}s`
    );

    return res.json({
      totalRecords: normalizedRecords.length,
      successCount,
      failureCount,
      status,
      processingTimeSeconds: parseFloat(totalTime),
      averageTimePerRow: parseFloat(avgTime),
      concurrency: CONCURRENT_REQUESTS,
      maxRetries: MAX_RETRIES,
      results,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/apply-credit-memo/template
 * Download CSV template with the required columns and sample rows.
 */
function downloadTemplate(_req, res) {
  const header = REQUIRED_FIELDS.join(',');
  const sample1 = 'AlQurashi-KSA,1408161,2942527,216.52,2026-08-06,2026-08-06';
  const sample2 = 'AlQurashi-KSA,1408162,2942528,150.00,2026-08-06,2026-08-06';

  const BOM = '﻿';
  const csv = `${BOM}${header}\n${sample1}\n${sample2}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="apply_credit_memo_template.csv"');
  return res.send(csv);
}

module.exports = {
  previewPayload,
  upload,
  downloadTemplate,
  // exported for tests
  buildApplyCreditMemoXml,
  normalizeRow,
  validateCsv,
};
