/**
 * AR Pipeline Controller
 *
 * Provides endpoints for the end-to-end AR processing pipeline:
 *   1. AR Invoice (status from FusionInvoiceHeader)
 *   2. Standard Receipt (status from FusionStandardReceipt)
 *   3. Misc Receipt (status from FusionMiscReceipt)
 *   4. Apply Receipt (auto-matched pairs, verify, submit)
 *
 * Auto-matching logic:
 *   Standard receipts created by the Vend Receipt Generator are named
 *   "{PaymentMethod}-{InvoiceTxnNumber}" (e.g. "Mada-2912269").
 *   We extract the numeric suffix from receiptNumber and compare it to
 *   FusionInvoiceHeader.txnNumber to pair them.
 *
 *   Fallback: match by customerId (FusionStandardReceipt) ==
 *   billToAccNumber (FusionInvoiceHeader) AND same date.
 */

const prisma = require('../services/prisma');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const { createOracleSoapClient } = require('../services/OracleSoapClient');
const { buildArInvoiceSoapEnvelope, AR_INVOICE_SOAP_ACTION } = require('../services/soapEnvelopeBuilder');
const { sendRawSoapRequest } = require('../services/rawSoapSender');
const {
  getBatchConfig,
  isTransientError: isBatchTransientError,
} = require('../services/batchOracleService');
const ultraFastBulkInvoiceService = require('../services/ultraFastBulkInvoiceService');
const { streamingManager } = require('../services/streamingInvoiceService');

// Pull concurrency / retry / timeout from the centralised batch config
// (mirrors jdbc-config.properties pool settings + oracleDbClient.js retry loop)
const _batchCfg = getBatchConfig();
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS, 10) || 5;
const MAX_RETRIES = _batchCfg.retry.maxRetries;
const RETRY_MIN_TIMEOUT = _batchCfg.retry.minTimeout;
const RETRY_MAX_TIMEOUT = _batchCfg.retry.maxTimeout;

// Concurrency for AR Invoice batch creation (Pass 1).
// Configurable via ORACLE_INVOICE_CONCURRENCY env var (default from batchCfg).
const INVOICE_CONCURRENCY = _batchCfg.concurrency;

/** Classify an error as transient (worth retrying).
 *  Delegates to the centralised batchOracleService.isTransientError()
 *  which mirrors the identical guard in oracle-crm/src/oracleDbClient.js. */
function isTransientError(err) {
  return isBatchTransientError(err);
}

// SOAP namespaces — match applyReceiptController (standardReceiptService/commonService)
const SOAP_ENV_NS   = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/standardReceiptService/commonService/types/';
const SOAP_COM_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/standardReceiptService/commonService/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise an ISO timestamp, plain date string, or JavaScript Date object to YYYY-MM-DD */
function toDateString(val) {
  if (!val) return null;
  // Date objects must use toISOString() — String() gives locale format which doesn't match
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Parse an Oracle date string to a UTC-midnight Date object.
 * Always extracts the YYYY-MM-DD component and ignores any time/timezone so
 * that the stored txnDate aligns with the midnight-UTC range used by
 * findInvoiceHeader in vendReceiptController.
 */
function parseOracleDateToUTCMidnight(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return new Date(`${m[1]}T00:00:00.000Z`);
  // Fallback: try generic Date parse
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? null
    : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Extract numeric invoice number embedded in a receipt number like "Mada-2912269" */
function extractInvoiceNumberFromReceipt(receiptNumber) {
  if (!receiptNumber) return null;
  // Match the last numeric segment at the end (e.g. "-2912269" in "Mada-2912269")
  const m2 = receiptNumber.match(/-(\d+)$/);
  return m2 ? parseInt(m2[1], 10) : null;
}

/** Build SOAP XML for createApplyReceipt using business keys (mirrors applyReceiptController) */
function buildSoapXml(row) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${SOAP_TYPES_NS}"
  xmlns:com="${SOAP_COM_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createApplyReceipt>
      <typ:applyReceipt>
        <com:TransactionNumber>${esc(row.TransactionNumber)}</com:TransactionNumber>
        <com:ReceiptNumber>${esc(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:AmountApplied>${esc(row.AmountApplied)}</com:AmountApplied>
        <com:ReceiptCurrency>${esc(row.ReceiptCurrency)}</com:ReceiptCurrency>
        <com:TransactionSource>${esc(row.TransactionSource)}</com:TransactionSource>
        <com:TxnDate>${esc(row.TxnDate)}</com:TxnDate>
        <com:AccountingDate>${esc(row.AccountingDate)}</com:AccountingDate>
        <com:ApplicationDate>${esc(row.AccountingDate)}</com:ApplicationDate>
      </typ:applyReceipt>
    </typ:createApplyReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** Send apply receipt via SOAP using business keys */
async function applyReceiptSoap(row) {
  const soapXml = buildSoapXml(row);
  const url = process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;
  if (!url) throw new Error('ORACLE_APPLY_RECEIPT_SOAP_URL not configured in .env');

  // Log the full row and SOAP payload so field-level mismatches are visible in the server log
  console.log(`[Pipeline:ApplyReceipt] >>> Row fields:
    TransactionNumber : ${row.TransactionNumber}
    ReceiptNumber     : ${row.ReceiptNumber}
    AmountApplied     : ${row.AmountApplied}
    ReceiptCurrency   : ${row.ReceiptCurrency}
    TransactionSource : ${row.TransactionSource}
    TxnDate           : ${row.TxnDate}
    AccountingDate    : ${row.AccountingDate}`);
  console.log(`[Pipeline:ApplyReceipt] >>> Full SOAP payload:\n${soapXml}`);

  const soapClient = createOracleSoapClient(url);
  const response = await soapClient.callWithCustomEnvelope(soapXml, 'createApplyReceipt');

  console.log(`[Pipeline:ApplyReceipt] <<< Response HTTP ${response.status} for ${row.TransactionNumber} ← ${row.ReceiptNumber}`);
  console.log(`[Pipeline:ApplyReceipt] <<< Response body:\n${response.data}`);

  return response;
}

/**
 * Extract invoice data from SOAP XML response.
 * Parses the createSimpleInvoiceResponse structure from Oracle RecInvoiceService.
 * 
 * @param {object} parsed - Parsed XML object from OracleSoapClient
 * @returns {object} - Extracted invoice data matching REST response format
 */
function extractInvoiceDataFromSoap(parsed) {
  try {
    // Navigate SOAP envelope structure
    const envelope = parsed['soapenv:Envelope'] || parsed['env:Envelope'] || parsed['Envelope'] || {};
    const body = envelope['soapenv:Body'] || envelope['env:Body'] || envelope['Body'] || {};
    const response = body['ns2:createSimpleInvoiceResponse'] || 
                     body['createSimpleInvoiceResponse'] || 
                     body['inv:createSimpleInvoiceResponse'] || 
                     body['typ:createSimpleInvoiceResponse'] || 
                     {};
    const result = response['result'] || response['ns2:result'] || response['inv:result'] || response['typ:result'] || {};

    // Extract invoice data from the result
    // The SOAP response structure will vary, but typically includes fields like:
    // - TrxNumber (TransactionNumber)
    // - CustomerTrxId
    // - Other invoice fields
    
    const invoiceData = {
      TransactionNumber: result['TrxNumber'] || result['TransactionNumber'] || null,
      CustomerTrxId: result['CustomerTrxId'] || null,
      BillToCustomerName: result['BillToCustomerName'] || null,
      BillToCustomerNumber: result['BillToAccountNumber'] || result['BillToCustomerNumber'] || null,
      BillToSite: result['BillToLocation'] || result['BillToSite'] || null,
      BusinessUnit: result['BusinessUnit'] || null,
      TransactionSource: result['TransactionSource'] || null,
      TransactionType: result['TransactionType'] || null,
      TransactionDate: result['TrxDate'] || result['TransactionDate'] || null,
      AccountingDate: result['GlDate'] || result['AccountingDate'] || null,
      InvoiceCurrencyCode: result['InvoiceCurrencyCode'] || null,
      PaymentTerms: result['PaymentTermsName'] || result['PaymentTerms'] || null,
    };

    return invoiceData;
  } catch (error) {
    console.error('[AR Pipeline] Error extracting data from SOAP response:', error.message);
    return {};
  }
}

/** Extract Oracle error from response */
function extractOracleError(data) {
  if (!data) return null;
  if (typeof data === 'string') {
    const faultMatch = data.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i);
    if (faultMatch) return faultMatch[1].slice(0, 300);
    const errorMatch = data.match(/<[^:]+:message[^>]*>([^<]+)<\/[^:]+:message>/i);
    if (errorMatch) return errorMatch[1].slice(0, 300);
  }
  if (data && typeof data === 'object') {
    if (data.detail) return String(data.detail).slice(0, 300);
    if (data.title) return String(data.title).slice(0, 300);
    if (data.o_errorCode) return `${data.o_errorCode}: ${String(data.o_errorMessage || '').slice(0, 250)}`;
    if (Array.isArray(data.items) && data.items[0]?.detail) return String(data.items[0].detail).slice(0, 300);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/ar-pipeline/summary
// Returns counts for each step grouped by store + date
// ---------------------------------------------------------------------------
async function getSummary(req, res, next) {
  try {
    const { dateFrom, dateTo, store } = req.query;

    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      dateFilter.lte = d;
    }

    const invoiceWhere = {
      status: { in: ['Success', 'SUCCESS'] },
    };
    if (Object.keys(dateFilter).length > 0) invoiceWhere.txnDate = dateFilter;
    if (store) invoiceWhere.billToCustName = { contains: store };

    // Fetch ALL invoices matching the filter — no hard cap so large batches are never silently truncated.
    const invoices = await prisma.fusionInvoiceHeader.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        txnNumber: true,
        customerTxnId: true,
        billToCustName: true,
        billToAccNumber: true,
        businessUnit: true,
        txnDate: true,
        status: true,
        txnSource: true,
      },
      orderBy: [{ txnDate: 'desc' }, { billToCustName: 'asc' }],
    });

    // Get ALL standard receipts in range — no hard cap.
    const receiptWhere = {
      status: { in: ['Success', 'SUCCESS'] },
    };
    if (Object.keys(dateFilter).length > 0) receiptWhere.receiptDate = dateFilter;

    const standardReceipts = await prisma.fusionStandardReceipt.findMany({
      where: receiptWhere,
      select: {
        id: true,
        receiptNumber: true,
        receiptDate: true,
        amount: true,
        customerId: true,
        orgId: true,
        receiptMethodId: true,
        status: true,
      },
    });

    // Get ALL misc receipts in range — no hard cap.
    const miscWhere = {
      status: { in: ['Success', 'SUCCESS'] },
    };
    if (Object.keys(dateFilter).length > 0) miscWhere.receiptDate = dateFilter;

    const miscReceipts = await prisma.fusionMiscReceipt.findMany({
      where: miscWhere,
      select: {
        id: true,
        receiptNumber: true,
        receiptDate: true,
        amount: true,
        receiptMethodName: true,
        status: true,
      },
    });

    // Get ALL already-applied pairs — no hard cap.
    const appliedWhere = {};
    if (Object.keys(dateFilter).length > 0) appliedWhere.applicationDate = dateFilter;
    const applied = await prisma.fusionApplyReceipt.findMany({
      where: appliedWhere,
      select: { txnNumber: true, receiptNumber: true, status: true },
    });
    const appliedKeys = new Set(applied.map((a) => `${a.txnNumber}||${a.receiptNumber}`));

    // Build receipt lookup index: { txnNumber → [receiptNumber, ...] }
    const receiptsByInvoice = {};
    for (const r of standardReceipts) {
      const invoiceNum = extractInvoiceNumberFromReceipt(r.receiptNumber);
      if (invoiceNum != null) {
        if (!receiptsByInvoice[invoiceNum]) receiptsByInvoice[invoiceNum] = [];
        receiptsByInvoice[invoiceNum].push(r);
      }
    }

    // Build pairs
    const pairs = invoices.map((inv) => {
      const matchedReceipts = receiptsByInvoice[inv.txnNumber] || [];
      const pairs = matchedReceipts.map((r) => ({
        receiptId: r.id,
        receiptNumber: r.receiptNumber,
        amount: r.amount,
        alreadyApplied: appliedKeys.has(`${inv.txnNumber}||${r.receiptNumber}`),
      }));

      const pendingPairs = pairs.filter((p) => !p.alreadyApplied);
      return {
        invoiceId: inv.id,
        txnNumber: inv.txnNumber,
        customerTxnId: inv.customerTxnId,
        store: inv.billToCustName,
        businessUnit: inv.businessUnit,
        txnDate: inv.txnDate ? toDateString(inv.txnDate) : null,
        status: inv.status,
        receipts: pairs,
        pendingCount: pendingPairs.length,
        totalReceiptsMatched: pairs.length,
      };
    });

    // Group summary by store + date
    const grouped = {};
    for (const p of pairs) {
      const key = `${p.store || 'Unknown'}__${p.txnDate || 'Unknown'}`;
      if (!grouped[key]) {
        grouped[key] = {
          store: p.store,
          date: p.txnDate,
          invoices: [],
          totalReceipts: 0,
          pendingApply: 0,
        };
      }
      grouped[key].invoices.push(p);
      grouped[key].totalReceipts += p.totalReceiptsMatched;
      grouped[key].pendingApply += p.pendingCount;
    }

    res.json({
      invoiceCount: invoices.length,
      standardReceiptCount: standardReceipts.length,
      miscReceiptCount: miscReceipts.length,
      appliedCount: applied.length,
      pairs,
      grouped: Object.values(grouped),
      standardReceipts,
      miscReceipts,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/ar-pipeline/pending-apply
// Returns unmatched invoice→receipt pairs ready to apply
// ---------------------------------------------------------------------------
async function getPendingApply(req, res, next) {
  try {
    const { dateFrom, dateTo, store } = req.query;

    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      dateFilter.lte = d;
    }

    const invoiceWhere = { status: { in: ['Success', 'SUCCESS'] } };
    if (Object.keys(dateFilter).length > 0) invoiceWhere.txnDate = dateFilter;
    if (store) invoiceWhere.billToCustName = { contains: store };

    // Fetch ALL matching invoices and receipts — no hard cap so no pairs are silently dropped.
    const invoices = await prisma.fusionInvoiceHeader.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        txnNumber: true,
        customerTxnId: true,
        billToCustName: true,
        businessUnit: true,
        txnDate: true,
      },
    });

    const receiptWhere = { status: { in: ['Success', 'SUCCESS'] } };
    if (Object.keys(dateFilter).length > 0) receiptWhere.receiptDate = dateFilter;

    const standardReceipts = await prisma.fusionStandardReceipt.findMany({
      where: receiptWhere,
      select: { id: true, receiptNumber: true, receiptDate: true, amount: true },
    });

    // Fetch ALL already-applied pairs — no hard cap.
    const applied = await prisma.fusionApplyReceipt.findMany({
      select: { txnNumber: true, receiptNumber: true },
    });
    const appliedKeys = new Set(applied.map((a) => `${a.txnNumber}||${a.receiptNumber}`));

    // Index receipts by invoice number
    const receiptsByInvoice = {};
    for (const r of standardReceipts) {
      const invoiceNum = extractInvoiceNumberFromReceipt(r.receiptNumber);
      if (invoiceNum != null) {
        if (!receiptsByInvoice[invoiceNum]) receiptsByInvoice[invoiceNum] = [];
        receiptsByInvoice[invoiceNum].push(r);
      }
    }

    const pendingPairs = [];
    for (const inv of invoices) {
      const matched = receiptsByInvoice[inv.txnNumber] || [];
      for (const r of matched) {
        const key = `${inv.txnNumber}||${r.receiptNumber}`;
        if (!appliedKeys.has(key)) {
          pendingPairs.push({
            invoiceId: inv.id,
            txnNumber: inv.txnNumber,
            store: inv.billToCustName,
            txnDate: toDateString(inv.txnDate),
            receiptId: r.id,
            receiptNumber: r.receiptNumber,
            amount: r.amount,
          });
        }
      }
    }

    res.json({ pendingPairs, total: pendingPairs.length });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/ar-pipeline/submit-apply
// Accepts array of { txnNumber, receiptNumber } and applies them via Oracle SOAP.
// Uses local DB for txnSource / accountingDate / amount (no Oracle REST lookups needed).
// ---------------------------------------------------------------------------
async function submitApply(req, res, next) {
  try {
    const { pairs } = req.body;

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'pairs must be a non-empty array.' });
    }

    if (!process.env.ORACLE_APPLY_RECEIPT_SOAP_URL) {
      return res.status(500).json({ error: 'Missing env var: ORACLE_APPLY_RECEIPT_SOAP_URL' });
    }

    // Create an upload record for tracking
    const uploadRecord = await prisma.applyReceiptUpload.create({
      data: {
        userId: req.user.id,
        filename: `pipeline-auto-${new Date().toISOString().slice(0, 10)}.csv`,
        totalRecords: pairs.length,
        totalReceipts: pairs.length,
        status: 'PROCESSING',
        responseLog: '',
      },
    });

    res.json({
      uploadId: uploadRecord.id,
      message: `Processing ${pairs.length} apply receipt(s). Poll /api/apply-receipt/uploads/${uploadRecord.id}/progress for status.`,
    });

    // Process asynchronously (after response sent)
    setImmediate(async () => {
      try {
      // Bulk-load invoice data (txnSource, txnDate) and receipt data (amount, currencyCode) from local DB
      const txnNumbers    = [...new Set(pairs.map((p) => p.txnNumber).filter(Boolean))];
      const receiptNumbers = [...new Set(pairs.map((p) => p.receiptNumber).filter(Boolean))];

      // Convert txnNumbers to BigInt, filtering out invalid values
      const txnNumbersBigInt = txnNumbers
        .map((n) => {
          try {
            const num = BigInt(n);
            return num > 0 ? num : null;
          } catch {
            return null;
          }
        })
        .filter((n) => n !== null);

      const [invoiceHeaders, standardReceipts] = await Promise.all([
        prisma.fusionInvoiceHeader.findMany({
          where: {
            txnNumber: { in: txnNumbersBigInt },
            status: { in: ['Success', 'SUCCESS'] },
          },
          select: { txnNumber: true, txnSource: true, txnDate: true, glDate: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.fusionStandardReceipt.findMany({
          where: {
            receiptNumber: { in: receiptNumbers },
            status: { in: ['Success', 'SUCCESS'] },
          },
          select: { receiptNumber: true, amount: true, currencyCode: true, receiptDate: true, glDate: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      // Index by txnNumber and receiptNumber (first match wins — latest-first ordering keeps newest)
      const invoiceByTxn = {};
      for (const h of invoiceHeaders) {
        if (h.txnNumber != null && !invoiceByTxn[h.txnNumber]) {
          invoiceByTxn[h.txnNumber] = h;
        }
      }
      const receiptByNum = {};
      for (const r of standardReceipts) {
        if (r.receiptNumber && !receiptByNum[r.receiptNumber]) {
          receiptByNum[r.receiptNumber] = r;
        }
      }

      const limit = pLimit(CONCURRENT_REQUESTS);
      let successCount = 0;
      let failureCount = 0;
      const logs = [];

      const tasks = pairs.map((pair, idx) =>
        limit(async () => {
          const { txnNumber, receiptNumber } = pair;

          // Safely convert txnNumber to BigInt for lookup
          let txnNumBigInt;
          try {
            txnNumBigInt = BigInt(txnNumber);
          } catch (err) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId:      uploadRecord.id,
                rowNumber:     idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage:  `Invalid txnNumber format: ${err.message}`,
                errorStep:     'INVOICE_LOOKUP',
              },
            });
            logs.push(`FAILED Invalid txnNumber ${txnNumber}: ${err.message}`);
            return;
          }

          const inv = invoiceByTxn[txnNumBigInt];
          const rec = receiptByNum[receiptNumber];

          if (!inv) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId:      uploadRecord.id,
                rowNumber:     idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage:  `Invoice ${txnNumber} not found in local DB`,
                errorStep:     'INVOICE_LOOKUP',
              },
            });
            logs.push(`FAILED Invoice lookup ${txnNumber}: not found in DB`);
            return;
          }

          if (!rec) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId:      uploadRecord.id,
                rowNumber:     idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage:  `Receipt ${receiptNumber} not found in local DB`,
                errorStep:     'RECEIPT_LOOKUP',
              },
            });
            logs.push(`FAILED Receipt lookup ${receiptNumber}: not found in DB`);
            return;
          }

          const txnSource      = inv.txnSource  || '';
          // Fall back to receipt date when the invoice header has no txnDate/glDate
          const accountingDate = toDateString(inv.txnDate ?? inv.glDate ?? rec.receiptDate ?? rec.glDate);
          const amount         = rec.amount != null ? String(rec.amount) : '';
          const currencyCode   = rec.currencyCode || 'SAR';

          if (!txnSource || !accountingDate || !amount) {
            failureCount++;
            const missing = [
              !txnSource      && 'txnSource',
              !accountingDate && 'txnDate',
              !amount         && 'amount',
            ].filter(Boolean).join(', ');
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId:      uploadRecord.id,
                rowNumber:     idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage:  `Missing required fields: ${missing}`,
                errorStep:     'INVOICE_LOOKUP',
              },
            });
            logs.push(`FAILED Invoice ${txnNumber}: missing ${missing}`);
            return;
          }

          const row = {
            TransactionNumber: String(txnNumber),
            ReceiptNumber:     receiptNumber,
            AmountApplied:     amount,
            ReceiptCurrency:   currencyCode,
            TransactionSource: txnSource,
            TxnDate:           accountingDate,
            AccountingDate:    accountingDate,
          };

          try {
            await pRetry(
              () => applyReceiptSoap(row),
              { retries: MAX_RETRIES, minTimeout: RETRY_MIN_TIMEOUT, maxTimeout: RETRY_MAX_TIMEOUT }
            );
            successCount++;

            // Store in FusionApplyReceipt so this pair is excluded from future pending-apply queries
            await prisma.fusionApplyReceipt.create({
              data: {
                requestId:       uploadRecord.id,
                status:          'SUCCESS',
                message:         'Applied via pipeline',
                requestDate:     new Date(),
                accountingDate:  new Date(`${accountingDate}T00:00:00.000Z`),
                applicationDate: new Date(`${accountingDate}T00:00:00.000Z`),
                txnNumber:       String(txnNumber),
                receiptNumber:   receiptNumber,
                amountApplied:   rec.amount ?? null,
                currencyCode:    currencyCode,
                txnSource:       txnSource,
                region:          'SA',
              },
            }).catch((storeErr) => {
              console.error(`[Pipeline] Failed to store FusionApplyReceipt for ${txnNumber}←${receiptNumber}: ${storeErr.message}`);
            });

            logs.push(`SUCCESS Apply ${txnNumber} ← ${receiptNumber}`);
          } catch (err) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId:      uploadRecord.id,
                rowNumber:     idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage:  err.message,
                errorStep:     'APPLY_RECEIPT',
              },
            });
            logs.push(`FAILED Apply ${txnNumber} ← ${receiptNumber}: ${err.message}`);
          }
        })
      );

      await Promise.all(tasks);

      const finalStatus =
        failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';

      await prisma.applyReceiptUpload.update({
        where: { id: uploadRecord.id },
        data: {
          successCount,
          failureCount,
          status:          finalStatus,
          responseMessage: `${successCount} succeeded, ${failureCount} failed out of ${pairs.length}.`,
          responseLog:     logs.join('\n'),
        },
      });
      } catch (fatalErr) {
        console.error('[Pipeline:submitApply] Fatal background error:', fatalErr.message);
        await prisma.applyReceiptUpload.update({
          where: { id: uploadRecord.id },
          data: {
            status:          'FAILED',
            responseMessage: `Fatal error: ${fatalErr.message}`,
          },
        }).catch(() => {});
      }
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/ar-pipeline/invoices
// List FusionInvoiceHeader records with optional filters
// ---------------------------------------------------------------------------
async function listInvoices(req, res, next) {
  try {
    const { dateFrom, dateTo, store, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = {};
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = new Date(dateFrom);
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        where.txnDate.lte = d;
      }
    }
    if (store) where.billToCustName = { contains: store };

    const [invoices, total] = await Promise.all([
      prisma.fusionInvoiceHeader.findMany({
        where,
        skip,
        take: parseInt(limit, 10),
        orderBy: [{ txnDate: 'desc' }, { billToCustName: 'asc' }],
      }),
      prisma.fusionInvoiceHeader.count({ where }),
    ]);

    res.json({ invoices, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/ar-pipeline/standard-receipts
// List FusionStandardReceipt records with optional filters
// ---------------------------------------------------------------------------
async function listStandardReceipts(req, res, next) {
  try {
    const { dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = {};
    if (dateFrom || dateTo) {
      where.receiptDate = {};
      if (dateFrom) where.receiptDate.gte = new Date(dateFrom);
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        where.receiptDate.lte = d;
      }
    }

    const [records, total] = await Promise.all([
      prisma.fusionStandardReceipt.findMany({
        where,
        skip,
        take: parseInt(limit, 10),
        orderBy: [{ receiptDate: 'desc' }, { receiptNumber: 'asc' }],
      }),
      prisma.fusionStandardReceipt.count({ where }),
    ]);

    res.json({ records, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/ar-pipeline/misc-receipts
// List FusionMiscReceipt records with optional filters
// ---------------------------------------------------------------------------
async function listMiscReceipts(req, res, next) {
  try {
    const { dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = {};
    if (dateFrom || dateTo) {
      where.receiptDate = {};
      if (dateFrom) where.receiptDate.gte = new Date(dateFrom);
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        where.receiptDate.lte = d;
      }
    }

    const [records, total] = await Promise.all([
      prisma.fusionMiscReceipt.findMany({
        where,
        skip,
        take: parseInt(limit, 10),
        orderBy: [{ receiptDate: 'desc' }, { receiptNumber: 'asc' }],
      }),
      prisma.fusionMiscReceipt.count({ where }),
    ]);

    res.json({ records, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/ar-pipeline/create-invoice-batch
// Creates multiple AR Invoice payloads in Oracle via SOAP API.
// 
// ✅ ENHANCED: Auto-detects large invoices (>500 lines) and uses Ultra-Fast Bulk processing
// ✅ FIXED: Uses raw SOAP sender to avoid namespace issues from XML parser
// ---------------------------------------------------------------------------
async function createInvoiceBatch(req, res, next) {
  try {
    const { payloads } = req.body;

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ error: 'payloads must be a non-empty array.' });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ULTRA-FAST BULK PROCESSING AUTO-DETECTION
    // ══════════════════════════════════════════════════════════════════════
    // Check if any invoice exceeds the bulk processing threshold
    const bulkThreshold = parseInt(process.env.ORACLE_BULK_INVOICE_THRESHOLD || '500', 10);
    const largeInvoices = payloads.filter(p => ultraFastBulkInvoiceService.shouldUseBulkProcessing(p));
    
    if (largeInvoices.length > 0) {
      console.log(`[Pipeline] Detected ${largeInvoices.length} large invoice(s) (>${bulkThreshold} lines) - switching to Ultra-Fast Bulk processing`);
      
      // Create a batch tracking record
      const batch = await prisma.arInvoiceBatch.create({
        data: {
          userId:       req.user.id,
          totalRecords: payloads.length,
          status:       'PROCESSING',
        },
      });
      
      // Respond immediately with batch ID
      res.json({
        batchId: batch.id,
        total:   payloads.length,
        bulkProcessing: true,
        largeInvoiceCount: largeInvoices.length,
        message: `Processing ${largeInvoices.length} large invoice(s) using Ultra-Fast Bulk processing. Poll /api/ar-pipeline/invoice-batch/${batch.id}/progress for status.`,
      });
      
      // Process asynchronously using bulk service
      setImmediate(async () => {
        const batchTag = `[Pipeline][Batch#${batch.id}][BULK]`;
        console.log(`${batchTag} ▶ START | invoices=${payloads.length} | largeInvoices=${largeInvoices.length}`);
        
        let successCount = 0;
        let failureCount = 0;
        
        for (let i = 0; i < payloads.length; i++) {
          const payload = payloads[i];
          const lineCount = payload.receivablesInvoiceLines?.length || 0;
          const invoiceTag = `${batchTag} [${i + 1}/${payloads.length}]`;
          
          // Create upload record
          const uploadRecord = await prisma.arInvoiceUpload.create({
            data: {
              userId:         req.user.id,
              batchId:        batch.id,
              payloadJson:    JSON.stringify(payload),
              responseStatus: 'PROCESSING',
            },
          });
          
          try {
            // Use bulk processing for large invoices
            if (ultraFastBulkInvoiceService.shouldUseBulkProcessing(payload)) {
              console.log(`${invoiceTag} Using BULK processing | lines=${lineCount}`);
              
              const result = await ultraFastBulkInvoiceService.processBulk(payload, {
                userId: req.user.id,
                batchId: batch.id,
                onProgress: (progress) => {
                  // Broadcast progress via WebSocket if available
                  streamingManager.broadcastProgress(batch.id, progress);
                },
              });
              
              // Update upload record with success
              await prisma.arInvoiceUpload.update({
                where: { id: uploadRecord.id },
                data: {
                  responseStatus: 'SUCCESS',
                  responseMessage: `Bulk processing completed in ${result.duration}`,
                  oracleData: JSON.stringify({
                    TransactionNumber: result.transactionNumber,
                    InvoiceId: result.invoiceId,
                    CustomerTrxId: result.customerTrxId,
                    GroupId: result.groupId,
                    ChunksProcessed: result.chunksProcessed,
                  }),
                  httpStatus: 200,
                },
              });
              
              successCount++;
              console.log(`✅ ${invoiceTag} BULK SUCCESS | TxnNumber=${result.transactionNumber} | duration=${result.duration}`);
              
            } else {
              // Use standard SOAP processing for small invoices
              console.log(`${invoiceTag} Using SOAP processing | lines=${lineCount}`);
              // Fall through to standard processing below
              continue;
            }
            
          } catch (error) {
            failureCount++;
            console.error(`❌ ${invoiceTag} BULK FAILED | error=${error.message}`);
            
            // Update upload record with failure
            await prisma.arInvoiceUpload.update({
              where: { id: uploadRecord.id },
              data: {
                responseStatus: 'FAILED',
                responseMessage: error.message,
              },
            }).catch(() => {});
          }
        }
        
        // Update batch status
        const finalStatus = failureCount === 0 ? 'COMPLETED' : failureCount === payloads.length ? 'FAILED' : 'PARTIAL';
        await prisma.arInvoiceBatch.update({
          where: { id: batch.id },
          data: {
            status: finalStatus,
            successCount,
            failureCount,
          },
        }).catch(() => {});
        
        console.log(`${batchTag} ■ COMPLETE | success=${successCount} | failed=${failureCount} | status=${finalStatus}`);
      });
      
      return; // Exit early, response already sent
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // STANDARD SOAP PROCESSING (for invoices < threshold)
    // ══════════════════════════════════════════════════════════════════════

    const endpoint     = process.env.ORACLE_AR_INVOICE_SOAP_URL;
    const username     = process.env.ORACLE_USERNAME;
    const password     = process.env.ORACLE_PASSWORD;

    if (!username || !password) {
      return res.status(500).json({ error: 'Oracle credentials not configured. Check ORACLE_USERNAME and ORACLE_PASSWORD in .env' });
    }
    if (!endpoint) {
      return res.status(500).json({ error: 'ORACLE_AR_INVOICE_SOAP_URL is not configured in .env' });
    }

    // Create a batch tracking record and respond immediately
    const batch = await prisma.arInvoiceBatch.create({
      data: {
        userId:       req.user.id,
        totalRecords: payloads.length,
        status:       'PROCESSING',
      },
    });

    res.json({
      batchId: batch.id,
      total:   payloads.length,
      message: `Processing ${payloads.length} invoice(s). Poll /api/ar-pipeline/invoice-batch/${batch.id}/progress for status.`,
    });

    // Process asynchronously after response is sent
    setImmediate(async () => {
      try {
      const batchTag = `[Pipeline][Batch#${batch.id}]`;

      // ── Batch start summary ──────────────────────────────────────────────
      console.log(`${batchTag} ▶ START | invoices=${payloads.length} | concurrency=${INVOICE_CONCURRENCY} | timeout=${_batchCfg.invoiceTimeout}ms | endpoint=${endpoint}`);

      // Pre-create all upload records so each invoice is immediately traceable.
      const uploadRecordResults = await Promise.allSettled(
        payloads.map((payload) =>
          prisma.arInvoiceUpload.create({
            data: {
              userId:         req.user.id,
              batchId:        batch.id,
              payloadJson:    JSON.stringify(payload),
              responseStatus: 'PROCESSING',
            },
          })
        )
      );

      const preFailCount = uploadRecordResults.filter(r => r.status === 'rejected').length;
      if (preFailCount > 0) {
        console.warn(`${batchTag} ⚠ ${preFailCount}/${payloads.length} upload records failed to pre-create (will retry inline)`);
      }

      const workItems = payloads.map((payload, i) => {
        const pre = uploadRecordResults[i];
        return { payload, uploadRecord: pre?.status === 'fulfilled' ? pre.value : null, index: i + 1 };
      });

      let successCount = 0;
      let failureCount = 0;
      const transientItems = [];

      const oracleAuth = Buffer.from(`${username}:${password}`).toString('base64');
      const invoiceTimeout = _batchCfg.invoiceTimeout;

      /**
       * Submits one invoice to Oracle via SOAP and persists the result.
       */
      async function processOne(payload, uploadRecord, isRetry, index) {
        if (!uploadRecord) {
          try {
            uploadRecord = await prisma.arInvoiceUpload.create({
              data: {
                userId:         req.user.id,
                batchId:        batch.id,
                payloadJson:    JSON.stringify(payload),
                responseStatus: 'PROCESSING',
              },
            });
          } catch (dbErr) {
            console.error(`${batchTag} [${index}] Could not create upload record: ${dbErr.message}`);
            return { success: false, isTransient: false, uploadRecord: null };
          }
        }

        const invoiceTag = `${batchTag} [${index}/${workItems.length}][Upload#${uploadRecord.id}]`;
        const lineCount  = (payload.receivablesInvoiceLines ?? []).length;
        const customer   = payload.BillToCustomerNumber ?? payload.BillToCustomerName ?? 'unknown';
        const txnDate    = payload.TransactionDate ?? 'unknown';

        console.log(
          `${invoiceTag} ► SUBMITTING | customer=${customer} | date=${txnDate} | lines=${lineCount}` +
          (isRetry ? ' | [RETRY]' : '')
        );

        let responseStatus  = 'SUCCESS';
        let responseMessage = 'Invoice created successfully';
        let oracleData      = null;
        let httpStatus      = null;
        let transient       = false;
        const t0            = Date.now();

        // Build SOAP envelope
        const soapXml = buildArInvoiceSoapEnvelope(payload);
        
        if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
          console.log(`${invoiceTag} ═══ SOAP ENVELOPE START ═══`);
          console.log(soapXml);
          console.log(`${invoiceTag} ═══ SOAP ENVELOPE END ═══`);
        }

        try {
          // ✅ FIX: Use raw SOAP sender instead of the OracleSoapClient
          const response = await sendRawSoapRequest(
            endpoint,
            soapXml,
            'createSimpleInvoice',
            oracleAuth,
            {
              timeout: invoiceTimeout,
              connectTimeout: 30000,
            }
          );

          const elapsed = Date.now() - t0;
          httpStatus = response.status;
          
          if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
            console.log(`${invoiceTag} ═══ FULL API RESPONSE START ═══`);
            console.log(`${invoiceTag} Status: ${response.status}`);
            console.log(`${invoiceTag} Response Data (XML):`, response.data);
            console.log(`${invoiceTag} ═══ FULL API RESPONSE END ═══`);
          }
          
          // Parse SOAP response to extract invoice data
          const parsed = parseSoapResponse(response.data);
          oracleData = parsed.invoiceData || {};

          if (response.status >= 400) {
            responseStatus  = 'FAILED';
            responseMessage = `Oracle returned HTTP ${httpStatus}`;
          }

          if (responseStatus === 'SUCCESS') {
            if (!oracleData?.TransactionNumber) {
              responseStatus  = 'FAILED';
              responseMessage = 'Oracle returned HTTP 200 but no TransactionNumber — possible duplicate CrossReference or oversized payload';
              const oracleErr = extractOracleError(response.data);
              console.error(`❌ ${invoiceTag} FAILED (${elapsed}ms) HTTP ${httpStatus} - ${responseMessage}`);
              if (oracleErr) console.error(`❌ ${invoiceTag} Oracle error: ${oracleErr}`);
              console.error(`❌ ${invoiceTag} ═══ FULL ORACLE RESPONSE START ═══`);
              console.error(response.data);
              console.error(`❌ ${invoiceTag} ═══ FULL ORACLE RESPONSE END ═══`);
            } else {
              const custTxnId = oracleData.CustomerTrxId ?? oracleData.CustomerTxnId ?? 'N/A';
              console.log(`✅ ${invoiceTag} SUCCESS (${elapsed}ms) | TxnNumber=${oracleData.TransactionNumber} | CustomerTrxId=${custTxnId} | HTTP ${httpStatus}`);
            }
          } else {
            const oracleErr = extractOracleError(response.data);
            console.error(`❌ ${invoiceTag} FAILED (${elapsed}ms) HTTP ${httpStatus} - ${responseMessage}`);
            if (oracleErr) console.error(`❌ ${invoiceTag} Oracle error: ${oracleErr}`);
            console.error(`❌ ${invoiceTag} ═══ FULL ORACLE RESPONSE START ═══`);
            console.error(response.data);
            console.error(`❌ ${invoiceTag} ═══ FULL ORACLE RESPONSE END ═══`);
          }
        } catch (err) {
          const elapsed   = Date.now() - t0;
          responseStatus  = 'FAILED';
          responseMessage = err.message;
          transient       = isTransientError(err);
          const label     = transient && !isRetry ? 'TRANSIENT (queued for retry)' : 'FAILED';
          console.error(`❌ ${invoiceTag} ${label} (${elapsed}ms) | error=${err.code ?? err.message}`);
        }

        // For pass-1 transient failures, mark as queued-for-retry
        if (transient && !isRetry) {
          await prisma.arInvoiceUpload.update({
            where: { id: uploadRecord.id },
            data: {
              responseStatus:  'FAILED',
              responseMessage: `Transient error - queued for retry: ${responseMessage}`,
              httpStatus:      null,
            },
          }).catch(() => {});
          return { success: false, isTransient: true, uploadRecord };
        }

        // Persist final result to upload record
        await prisma.arInvoiceUpload.update({
          where: { id: uploadRecord.id },
          data: {
            responseStatus,
            responseMessage,
            responseBody: oracleData ? JSON.stringify(oracleData) : responseMessage,
            httpStatus,
          },
        }).catch(() => {});

        // Persist to FusionInvoiceHeader + FusionInvoiceLine
        try {
          const txnNumberRaw = oracleData?.TransactionNumber ?? null;
          const custTxnIdRaw = oracleData?.CustomerTrxId ?? oracleData?.CustomerTxnId ?? null;
          const billToAccRaw = payload.BillToCustomerNumber;

          const fusionHeader = await prisma.fusionInvoiceHeader.create({
            data: {
              requestId:        uploadRecord.id,
              status:           responseStatus === 'SUCCESS' ? 'SUCCESS' : 'Failed',
              message:          responseMessage,
              requestDate:      new Date(),
              billToCustName:   payload.BillToCustomerName   ?? null,
              billToLocation:   payload.BillToSite            ?? null,
              billToAccNumber:  billToAccRaw ? BigInt(billToAccRaw) : null,
              businessUnit:     payload.BusinessUnit          ?? null,
              paymentTermsName: payload.PaymentTerms          ?? null,
              txnSource:        payload.TransactionSource     ?? null,
              txnType:          payload.TransactionType       ?? null,
              txnDate:          parseOracleDateToUTCMidnight(payload.TransactionDate),
              glDate:           parseOracleDateToUTCMidnight(payload.AccountingDate),
              currencyCode:     payload.InvoiceCurrencyCode   ?? null,
              txnNumber:        txnNumberRaw ? BigInt(txnNumberRaw) : null,
              customerTxnId:    custTxnIdRaw ? BigInt(custTxnIdRaw) : null,
              region:           'SA',
            },
          });

          if (responseStatus === 'SUCCESS') {
            const lines = payload.receivablesInvoiceLines ?? [];
            if (lines.length > 0) {
              await prisma.fusionInvoiceLine.createMany({
                data: lines.map((line) => ({
                  requestId:        uploadRecord.id,
                  status:           'SUCCESS',
                  requestDate:      new Date(),
                  headerId:         fusionHeader.id,
                  invoiceNumber:    txnNumberRaw != null ? String(txnNumberRaw) : null,
                  lineNumber:       line.LineNumber       != null ? parseInt(line.LineNumber, 10)      : null,
                  itemNumber:       line.ItemNumber       ?? null,
                  description:      line.Description      ?? null,
                  quantity:         line.Quantity          != null ? parseFloat(line.Quantity)         : null,
                  unitSellingPrice: line.UnitSellingPrice  != null ? parseFloat(line.UnitSellingPrice) : null,
                  taxCode:          line.TaxClassificationCode ?? null,
                  salesOrder:       line.SalesOrder        ?? null,
                  region:           'SA',
                })),
              });
            }
            console.log(`   ${invoiceTag} DB saved | Header#${fusionHeader.id} | lines=${lines.length}`);
          }
        } catch (storeErr) {
          console.error(`${invoiceTag} Failed to store fusion data: ${storeErr.message}`);
        }

        return { success: responseStatus === 'SUCCESS', isTransient: false, uploadRecord };
      }

      // ── Pass 1: process all invoices concurrently ──────────────────────
      const pass1Start = Date.now();
      console.log(`${batchTag} ── Pass 1 START | ${workItems.length} invoice(s) | concurrency=${INVOICE_CONCURRENCY}`);
      const limitPass1 = pLimit(INVOICE_CONCURRENCY);
      await Promise.all(
        workItems.map((item) =>
          limitPass1(async () => {
            const result = await processOne(item.payload, item.uploadRecord, false, item.index);
            if (result.success) {
              successCount++;
            } else if (result.isTransient) {
              transientItems.push({ payload: item.payload, uploadRecord: result.uploadRecord, index: item.index });
            } else {
              failureCount++;
            }
          })
        )
      );
      console.log(
        `${batchTag} ── Pass 1 DONE (${Date.now() - pass1Start}ms) | ` +
        `✅ ${successCount} succeeded | ❌ ${failureCount} failed | ⚠ ${transientItems.length} transient`
      );

      // ── Pass 2: retry transient failures sequentially ──────────────────
      if (transientItems.length > 0) {
        const pass2Start = Date.now();
        console.log(`${batchTag} ── Pass 2 START | retrying ${transientItems.length} transient failure(s) sequentially`);
        for (const item of transientItems) {
          const result = await processOne(item.payload, item.uploadRecord, true, item.index);
          if (result.success) {
            successCount++;
          } else {
            failureCount++;
          }
        }
        console.log(
          `${batchTag} ── Pass 2 DONE (${Date.now() - pass2Start}ms) | ` +
          `✅ ${successCount} total succeeded | ❌ ${failureCount} total failed`
        );
      }

      const finalStatus = failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
      const retryNote   = transientItems.length > 0 ? ` (${transientItems.length} retried after transient error)` : '';
      const finalMessage = `${successCount} succeeded, ${failureCount} failed out of ${payloads.length}${retryNote}.`;
      console.log(`${batchTag} ■ COMPLETE | status=${finalStatus} | ${finalMessage}`);
      await prisma.arInvoiceBatch.update({
        where: { id: batch.id },
        data: {
          successCount,
          failureCount,
          status:  finalStatus,
          message: finalMessage,
        },
      });
      } catch (fatalErr) {
        console.error(`${batchTag ?? '[Pipeline]'} ✖ FATAL background error: ${fatalErr.message}`, fatalErr.stack);
        await prisma.arInvoiceBatch.update({
          where: { id: batch.id },
          data: { status: 'FAILED', message: `Fatal error: ${fatalErr.message}` },
        }).catch(() => {});
      }
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Helper: Parse SOAP response to extract invoice data
// ---------------------------------------------------------------------------
function parseSoapResponse(xmlData) {
  try {
    const result = { invoiceData: {} };
    
    // Extract TransactionNumber
    const txnMatch = xmlData.match(/<ns2:TransactionNumber>([^<]+)<\/ns2:TransactionNumber>/i) ||
                     xmlData.match(/<TransactionNumber>([^<]+)<\/TransactionNumber>/i) ||
                     xmlData.match(/<TrxNumber>([^<]+)<\/TrxNumber>/i);
    if (txnMatch) {
      result.invoiceData.TransactionNumber = txnMatch[1];
    }
    
    // Extract CustomerTrxId
    const custMatch = xmlData.match(/<ns2:CustomerTrxId>([^<]+)<\/ns2:CustomerTrxId>/i) ||
                      xmlData.match(/<CustomerTrxId>([^<]+)<\/CustomerTrxId>/i);
    if (custMatch) {
      result.invoiceData.CustomerTrxId = custMatch[1];
    }
    
    // Check ServiceStatus
    const statusMatch = xmlData.match(/<ns2:ServiceStatus>([^<]+)<\/ns2:ServiceStatus>/i) ||
                        xmlData.match(/<ServiceStatus>([^<]+)<\/ServiceStatus>/i);
    if (statusMatch) {
      result.invoiceData.ServiceStatus = statusMatch[1];
    }
    
    return result;
  } catch (error) {
    console.error('[AR Pipeline] Error parsing SOAP response:', error.message);
    return { invoiceData: {} };
  }
}

// ---------------------------------------------------------------------------
// GET /api/ar-pipeline/invoice-batch/:batchId/progress
// Poll for batch invoice creation status
// ---------------------------------------------------------------------------
async function getInvoiceBatchProgress(req, res, next) {
  try {
    const batchId = parseInt(req.params.batchId, 10);
    if (isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batch ID.' });
    }

    const batch = await prisma.arInvoiceBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found.' });
    }

    if (req.user.role === 'USER' && batch.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const processed = batch.successCount + batch.failureCount;

    let invoiceResults = null;
    if (batch.status !== 'PROCESSING') {
      const uploads = await prisma.arInvoiceUpload.findMany({
        where: { batchId },
        select: {
          id: true,
          responseStatus: true,
          responseMessage: true,
          responseBody: true,
          payloadJson: true,
        },
        orderBy: { id: 'asc' },
      });

      const uploadIds = uploads.map((u) => u.id);
      const headers = await prisma.fusionInvoiceHeader.findMany({
        where: { requestId: { in: uploadIds } },
        select: { id: true, requestId: true },
      });
      const headerByUploadId = {};
      for (const h of headers) {
        if (h.requestId && !headerByUploadId[h.requestId]) {
          headerByUploadId[h.requestId] = h.id;
        }
      }

      invoiceResults = uploads.map((u, i) => {
        let customerName = null;
        let date = null;
        let txnNumber = null;
        try {
          const payload = JSON.parse(u.payloadJson || '{}');
          customerName = payload.BillToCustomerName || null;
          date = payload.TransactionDate || null;
        } catch { /* ignore */ }
        try {
          const body = JSON.parse(u.responseBody || '{}');
          const raw = body.TransactionNumber ?? body.TrxNumber ?? null;
          txnNumber = raw != null ? String(raw) : null;
        } catch { /* ignore */ }
        return {
          index: i,
          uploadId: u.id,
          headerId: headerByUploadId[u.id] ?? null,
          customerName,
          date,
          txnNumber,
          status:  u.responseStatus || 'FAILED',
          message: u.responseMessage || null,
        };
      });
    }

    return res.json({
      batchId:        batch.id,
      totalRecords:   batch.totalRecords,
      successCount:   batch.successCount,
      failureCount:   batch.failureCount,
      processed,
      status:         batch.status,
      message:        batch.message,
      invoiceResults,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/ar-pipeline/invoices/:headerId/txn-number
// Manually set the txnNumber for a FusionInvoiceHeader record
// ---------------------------------------------------------------------------
async function setInvoiceTxnNumber(req, res, next) {
  try {
    const headerId = parseInt(req.params.headerId, 10);
    if (isNaN(headerId)) {
      return res.status(400).json({ error: 'Invalid headerId.' });
    }

    const { txnNumber } = req.body;
    
    // Validate txnNumber
    const txnNumStr = String(txnNumber ?? '').trim();
    if (!txnNumStr) {
      return res.status(400).json({ error: 'txnNumber is required and must be a positive integer.' });
    }
    
    let txnNum;
    try {
      txnNum = BigInt(txnNumStr);
      if (txnNum <= 0) {
        return res.status(400).json({ error: 'txnNumber must be a positive integer.' });
      }
    } catch (err) {
      return res.status(400).json({ error: `Invalid txnNumber: ${err.message}` });
    }

    const header = await prisma.fusionInvoiceHeader.findUnique({
      where: { id: headerId },
      select: { id: true, requestId: true, txnNumber: true },
    });

    if (!header) {
      return res.status(404).json({ error: 'Invoice header not found.' });
    }

    const updated = await prisma.fusionInvoiceHeader.update({
      where: { id: headerId },
      data: { txnNumber: txnNum },
    });

    if (header.requestId) {
      const existing = await prisma.arInvoiceUpload.findUnique({
        where: { id: header.requestId },
        select: { responseBody: true },
      });
      let existingData = {};
      try { existingData = existing?.responseBody ? JSON.parse(existing.responseBody) : {}; } catch (_) {}
      await prisma.arInvoiceUpload.update({
        where: { id: header.requestId },
        data: {
          responseBody: JSON.stringify({ ...existingData, TransactionNumber: txnNum }),
        },
      }).catch((err) => {
        console.warn(`[Pipeline:setTxnNumber] Could not update ArInvoiceUpload ${header.requestId}: ${err.message}`);
      });
    }

    console.log(`[Pipeline:setTxnNumber] FusionInvoiceHeader ${headerId} txnNumber set to ${txnNum} by user ${req.user?.id}`);

    return res.json({
      id: updated.id,
      txnNumber: updated.txnNumber,
      message: `Transaction number ${txnNum} saved for invoice header ${headerId}.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
  getPendingApply,
  submitApply,
  listInvoices,
  listStandardReceipts,
  listMiscReceipts,
  createInvoiceBatch,
  getInvoiceBatchProgress,
  setInvoiceTxnNumber,
};