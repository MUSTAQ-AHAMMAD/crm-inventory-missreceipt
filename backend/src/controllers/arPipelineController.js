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
const axios = require('axios');
const pLimit = require('p-limit');
const pRetry = require('p-retry');

const CONCURRENT_REQUESTS = 3;
const MAX_RETRIES = 2;
const RETRY_MIN_TIMEOUT = 2000;
const RETRY_MAX_TIMEOUT = 8000;

// SOAP namespaces (same as applyReceiptController)
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/applyReceiptsService/types/';
const SOAP_COM_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/applyReceiptsService/';
const SOAP_APP_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/applyReceiptsService/applicationDetails/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise an ISO timestamp or plain date to YYYY-MM-DD */
function toDateString(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Extract numeric invoice number embedded in a receipt number like "Mada-2912269" */
function extractInvoiceNumberFromReceipt(receiptNumber) {
  if (!receiptNumber) return null;
  // Match the last numeric segment that is not followed by "-MISC"
  const m = receiptNumber.match(/-(\d+)(?!-MISC)(?:-[^-]*)?$/);
  // More precise: ends with -<digits> (and nothing after, or another -word that isn't MISC)
  const m2 = receiptNumber.match(/-(\d+)$/);
  return m2 ? parseInt(m2[1], 10) : null;
}

/** Build SOAP XML for createApplyReceipt */
function buildSoapXml(customerTrxId, receiptId, amount, transactionDate) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${SOAP_TYPES_NS}"
  xmlns:com="${SOAP_COM_NS}"
  xmlns:app="${SOAP_APP_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createApplyReceipt>
      <typ:applyReceipt>
        <com:AmountApplied>${esc(amount)}</com:AmountApplied>
        <com:ReceiptId>${esc(receiptId)}</com:ReceiptId>
        <com:CustomerTrxId>${esc(customerTrxId)}</com:CustomerTrxId>
        <com:ApplicationDate>${esc(transactionDate)}</com:ApplicationDate>
        <com:AccountingDate>${esc(transactionDate)}</com:AccountingDate>
      </typ:applyReceipt>
    </typ:createApplyReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** Look up invoice in Oracle to get CustomerTransactionId */
async function lookupInvoice(invoiceNumber, oracleAuth) {
  const url = process.env.ORACLE_RECEIVABLES_INVOICES_API_URL;
  const query = `TransactionNumber=${invoiceNumber}`;
  const response = await axios.get(`${url}?q=${encodeURIComponent(query)}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Basic ${oracleAuth}` },
    timeout: 30000,
  });
  const items = response.data?.items || [];
  if (items.length === 0) throw new Error(`Invoice '${invoiceNumber}' not found in Oracle`);
  const raw = items[0].TransactionDate;
  const m = raw ? String(raw).match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return {
    customerTrxId: String(items[0].CustomerTransactionId),
    transactionDate: m ? m[1] : null,
  };
}

/** Look up standard receipt in Oracle to get StandardReceiptId and Amount */
async function lookupReceipt(receiptNumber, oracleAuth) {
  const url = process.env.ORACLE_STANDARD_RECEIPTS_LOOKUP_API_URL;
  const query = `ReceiptNumber="${receiptNumber}"`;
  const response = await axios.get(`${url}?q=${encodeURIComponent(query)}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Basic ${oracleAuth}` },
    timeout: 30000,
  });
  const items = response.data?.items || [];
  if (items.length === 0) throw new Error(`Receipt '${receiptNumber}' not found in Oracle`);
  const receipt = items[0];
  return {
    receiptId: String(receipt.StandardReceiptId),
    amount: String(receipt.Amount),
    receiptDate: String(receipt.ReceiptDate),
  };
}

/** Send apply receipt via SOAP */
async function applyReceiptSoap(customerTrxId, receiptId, amount, transactionDate) {
  const soapXml = buildSoapXml(customerTrxId, receiptId, amount, transactionDate);
  const url = process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;
  if (!url) throw new Error('ORACLE_APPLY_RECEIPT_SOAP_URL not configured in .env');

  const oracleAuth = Buffer.from(`${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`).toString('base64');
  const response = await axios.post(url, soapXml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'createApplyReceipt',
      Authorization: `Basic ${oracleAuth}`,
    },
    timeout: 60000,
  });
  return response;
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

    // Get standard receipts in range
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

    // Get misc receipts in range
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

    // Get already-applied pairs
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

    // Get already applied
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
// Accepts array of { txnNumber, receiptNumber } and applies them via Oracle SOAP
// ---------------------------------------------------------------------------
async function submitApply(req, res, next) {
  try {
    const { pairs } = req.body;

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'pairs must be a non-empty array.' });
    }

    const missing = [
      'ORACLE_RECEIVABLES_INVOICES_API_URL',
      'ORACLE_STANDARD_RECEIPTS_LOOKUP_API_URL',
      'ORACLE_APPLY_RECEIPT_SOAP_URL',
    ].filter((v) => !process.env[v]);
    if (missing.length > 0) {
      return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
    }

    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

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
      const limit = pLimit(CONCURRENT_REQUESTS);
      let successCount = 0;
      let failureCount = 0;
      const logs = [];

      const tasks = pairs.map((pair, idx) =>
        limit(async () => {
          const { txnNumber, receiptNumber } = pair;

          let customerTrxId, transactionDate, receiptId, amount;

          try {
            const inv = await pRetry(() => lookupInvoice(txnNumber, oracleAuth), {
              retries: MAX_RETRIES,
              minTimeout: RETRY_MIN_TIMEOUT,
              maxTimeout: RETRY_MAX_TIMEOUT,
            });
            customerTrxId = inv.customerTrxId;
            transactionDate = inv.transactionDate;
          } catch (err) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId: uploadRecord.id,
                rowNumber: idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage: err.message,
                errorStep: 'INVOICE_LOOKUP',
              },
            });
            logs.push(`FAILED Invoice lookup ${txnNumber}: ${err.message}`);
            return;
          }

          try {
            const rec = await pRetry(() => lookupReceipt(receiptNumber, oracleAuth), {
              retries: MAX_RETRIES,
              minTimeout: RETRY_MIN_TIMEOUT,
              maxTimeout: RETRY_MAX_TIMEOUT,
            });
            receiptId = rec.receiptId;
            amount = rec.amount;
          } catch (err) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId: uploadRecord.id,
                rowNumber: idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage: err.message,
                errorStep: 'RECEIPT_LOOKUP',
                customerTrxId: customerTrxId ? String(customerTrxId) : null,
              },
            });
            logs.push(`FAILED Receipt lookup ${receiptNumber}: ${err.message}`);
            return;
          }

          try {
            await pRetry(
              () => applyReceiptSoap(customerTrxId, receiptId, amount, transactionDate),
              { retries: MAX_RETRIES, minTimeout: RETRY_MIN_TIMEOUT, maxTimeout: RETRY_MAX_TIMEOUT }
            );
            successCount++;
            logs.push(`SUCCESS Apply ${txnNumber} ← ${receiptNumber}`);
          } catch (err) {
            failureCount++;
            await prisma.applyReceiptFailure.create({
              data: {
                uploadId: uploadRecord.id,
                rowNumber: idx + 1,
                invoiceNumber: String(txnNumber),
                receiptNumber: String(receiptNumber),
                errorMessage: err.message,
                errorStep: 'APPLY_RECEIPT',
                customerTrxId: customerTrxId ? String(customerTrxId) : null,
                receiptId: receiptId ? String(receiptId) : null,
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
          status: finalStatus,
          responseMessage: `${successCount} succeeded, ${failureCount} failed out of ${pairs.length}.`,
          responseLog: logs.join('\n'),
        },
      });
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
        orderBy: [{ receiptDate: 'desc' }],
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
        orderBy: [{ receiptDate: 'desc' }],
      }),
      prisma.fusionMiscReceipt.count({ where }),
    ]);

    res.json({ records, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
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
};
