/**
 * Vend Receipt controller.
 *
 * Generates Standard Receipt and Misc Receipt payloads from Vend Payment Lines,
 * matching each store+date+paymentType combination to an existing AR Invoice
 * stored in FusionInvoiceHeader, then submits to Oracle Fusion via REST / SOAP.
 *
 * Receipt number conventions:
 *   Standard : {PaymentMethod}-{txnNumber}          e.g. Mada-2912269
 *   Misc     : {PaymentMethod}-{txnNumber}-MISC      e.g. Mada-2912269-MISC
 *
 * Exclusion rules:
 *   - Tabby / Tamara : NO standard receipt, NO misc receipt
 *   - Cash / Cash rounding / Gift Card / Credit On Cust : NO misc receipt
 *     (Cash rounding produces a special misc receipt – see CASH_ROUNDING_METHODS)
 *
 * Misc receipt amount formula (non-cash, non-Tabby/Tamara):
 *   temp1       = payment.amount × bankCharge
 *   temp2       = 1 + tax
 *   miscCharges = temp1 × temp2
 *   amount      = 0 - miscCharges   (always negative)
 *
 * Cash rounding misc receipt:
 *   miscCharges = payment.amount  (raw, can be negative or positive)
 *   amount      = 0 - miscCharges
 */

const XLSX = require('xlsx');
const axios = require('axios');
const pLimit = require('p-limit');
const pRetry = require('p-retry');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');
const { createOracleSoapClient } = require('../services/OracleSoapClient');

// ─── Constants ────────────────────────────────────────────────────────────────

const STATIC_ORG_ID = '300000001421038';
const DEFAULT_CURRENCY = 'SAR';
const DEFAULT_REGION = 'SA';
const DEFAULT_BUSINESS_UNIT = 'AlQurashi-KSA';

// Payment types that must be excluded from ALL receipt generation
const EXCLUDED_PAYMENT_TYPES = ['TABBY', 'TAMARA'];

// Payment method names (normalised upper) that produce NO misc receipt
// (they still get a standard receipt if not in EXCLUDED_PAYMENT_TYPES)
const NO_MISC_METHODS_UPPER = new Set([
  'CASH',
  'CREDIT ON CUST',
  'GIFT CARD',
]);

// Payment methods treated as "cash rounding" – get a special misc receipt formula
const CASH_ROUNDING_METHODS_UPPER = new Set(['CASH ROUNDING']);

const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 5;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

// SOAP namespaces for MiscellaneousReceiptService
const SOAP_ENV_NS    = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS  = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/types/';
const SOAP_COMMON_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';
const SOAP_MIS_NS    = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/model/flex/MiscellaneousReceiptDff/';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normCell(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normUpper(value) {
  return normCell(value).toUpperCase();
}

function normHeaderKey(value) {
  return normUpper(value)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,\-_]+$/g, '')
    .trim();
}

const HEADER_CACHE = Symbol('headerCache');
function getRowHeaderMap(row) {
  if (row[HEADER_CACHE]) return row[HEADER_CACHE];
  const map = new Map();
  for (const [k, v] of Object.entries(row)) {
    const nk = normHeaderKey(k);
    const nv = normCell(v);
    if (!map.get(nk) || nv) map.set(nk, nv);
  }
  Object.defineProperty(row, HEADER_CACHE, { value: map, enumerable: false });
  return map;
}

function getField(row, aliases) {
  const map = getRowHeaderMap(row);
  for (const a of aliases) {
    const v = map.get(normHeaderKey(a));
    if (v) return v;
  }
  return '';
}

function parseNum(row, aliases, def = 0) {
  const raw = getField(row, aliases);
  if (!raw) return def;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : def;
}

function normalizeDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  const dtMatch = s.match(/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+\d{2}:\d{2}/);
  if (dtMatch) return dtMatch[1].replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmyMatch = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  const dmySlash = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) return `${dmySlash[3]}-${dmySlash[2]}-${dmySlash[1]}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const adj = serial > 60 ? serial - 1 : serial;
    const d = new Date(epoch.getTime() + adj * 86400000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return null;
}

function getPaymentType(method) {
  const u = normUpper(method);
  if (u.includes('TABBY')) return 'TABBY';
  if (u.includes('TAMARA')) return 'TAMARA';
  return 'NORMAL';
}

function parseExcel(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sn = wb.SheetNames[0];
  if (!sn) throw new Error(`No sheets in ${filename}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeXml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildMiscSoapEnvelope(row) {
  const methodTag = row.ReceiptMethodName
    ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${SOAP_TYPES_NS}"
  xmlns:com="${SOAP_COMMON_NS}"
  xmlns:mis="${SOAP_MIS_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>
      <typ:miscellaneousReceipt>
        <com:Amount>${escapeXml(row.Amount)}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:DepositDate>${escapeXml(row.DepositDate)}</com:DepositDate>
        <com:GlDate>${escapeXml(row.GlDate)}</com:GlDate>
${methodTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(row.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </typ:miscellaneousReceipt>
    </typ:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function asText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf-8');
  if (data?.data && Array.isArray(data.data)) return Buffer.from(data.data).toString('utf-8');
  return String(data);
}

function snippet(text, len = 500) {
  return text && text.length > len ? text.slice(0, len) : (text || '');
}

// ─── Receipt method cache ──────────────────────────────────────────────────────

/**
 * Look up FusionReceiptMethod for a payment method name and region.
 * Tries exact name match first, then case-insensitive.
 */
async function getReceiptMethod(methodName, region) {
  const normalised = normCell(methodName);
  let rm = await prisma.fusionReceiptMethod.findFirst({
    where: { receiptMethodName: normalised, region },
  });
  if (!rm) {
    // case-insensitive fallback
    const all = await prisma.fusionReceiptMethod.findMany({ where: { region } });
    rm = all.find((r) => r.receiptMethodName.toUpperCase() === normalised.toUpperCase()) || null;
  }
  return rm;
}

/**
 * Resolve the canonical receiptMethodName from FusionReceiptMethod.
 * Falls back to the raw payment method name if no DB record found.
 */
async function canonicalMethodName(rawMethod, region) {
  const rm = await getReceiptMethod(rawMethod, region);
  return rm ? rm.receiptMethodName : normCell(rawMethod);
}

// ─── Invoice lookup ────────────────────────────────────────────────────────────

/**
 * Find the FusionInvoiceHeader that matches a given store + date + paymentType.
 *
 * Strategy:
 *  1. Use FusionSalesMetadata to resolve siteNumber for (paymentType, subinventory)
 *  2. Search FusionInvoiceHeader where billToLocation = siteNumber AND txnDate = date
 *
 * Returns the most recently created header if multiple exist.
 */
async function findInvoiceHeader(subinventory, date, paymentType) {
  // 1. Resolve customer site via FusionSalesMetadata
  let siteNumber = null;
  let businessUnit = DEFAULT_BUSINESS_UNIT;
  let customerAccNumber = null;

  try {
    const meta = await fusionMetadataService.findByCustomerType(paymentType, subinventory);
    if (meta) {
      siteNumber = meta.siteNumber;
      businessUnit = meta.businessUnit || DEFAULT_BUSINESS_UNIT;
      customerAccNumber = meta.billToAccount ? String(meta.billToAccount) : null;
    }
  } catch (_) { /* ignore */ }

  // 2. Build date range for the given date (midnight to midnight UTC)
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd   = new Date(`${date}T23:59:59.999Z`);

  // 3. Try matching by billToLocation (siteNumber)
  let headers = [];
  if (siteNumber) {
    headers = await prisma.fusionInvoiceHeader.findMany({
      where: {
        billToLocation: siteNumber,
        txnDate: { gte: dayStart, lte: dayEnd },
        status: 'SUCCESS',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
  }

  // 4. Fallback: match by billToCustName containing the subinventory code
  if (headers.length === 0) {
    headers = await prisma.fusionInvoiceHeader.findMany({
      where: {
        billToCustName: { contains: subinventory },
        txnDate: { gte: dayStart, lte: dayEnd },
        status: 'SUCCESS',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
  }

  if (headers.length === 0) return null;

  const h = headers[0];
  return {
    txnNumber: h.txnNumber,
    businessUnit: h.businessUnit || businessUnit,
    customerAccNumber: h.billToAccNumber ? String(h.billToAccNumber) : customerAccNumber,
    customerSite: h.billToLocation || siteNumber || '',
    headerId: h.id,
  };
}

// ─── Payload generation ────────────────────────────────────────────────────────

/**
 * POST /api/vend-receipt/generate
 *
 * Accepts a Payment Lines Excel file.  Groups payments by date + store + paymentType,
 * matches to existing FusionInvoiceHeader records, then generates:
 *   - Standard receipt payloads (per payment method, excl. Tabby/Tamara)
 *   - Misc receipt payloads    (per non-cash method, excl. Tabby/Tamara)
 *
 * Returns the generated payloads for review WITHOUT submitting to Oracle.
 */
async function generateReceipts(req, res, next) {
  try {
    if (!req.files || !req.files.paymentLines) {
      return res.status(400).json({ error: 'paymentLines Excel file is required.' });
    }

    const file = req.files.paymentLines;
    const region = String(req.body.region || DEFAULT_REGION).trim().toUpperCase();

    let paymentLines;
    try {
      paymentLines = parseExcel(file.data, file.name);
    } catch (err) {
      return res.status(400).json({ error: `Failed to parse payment lines: ${err.message}` });
    }

    if (paymentLines.length === 0) {
      return res.status(400).json({ error: 'Payment lines file is empty.' });
    }

    // ── Step 1: Group payment amounts by key ──────────────────────────────────
    // Key: `${date}|${subinventory}|${paymentType}|${methodName}`
    // We accumulate the total amount per payment method per store per day.
    const groups = new Map();
    // Also track register name → subinventory for lookup
    const registerSubinventoryMap = {};

    for (const row of paymentLines) {
      const orderRef    = getField(row, ['Order Ref', 'Order Lines/Order Ref', 'Order Reference']);
      const storeCode   = normUpper(orderRef.split('/')[0] || '');
      const regName     = normUpper(getField(row, ['Store', 'Branch', 'Register Name'])) || storeCode;
      const subinventory = regName || storeCode;
      const rawMethod   = getField(row, ['Payment Method', 'Payments/Payment Method', 'Payments/Method', 'Order Payment/Method', 'Order Payment/Payment Method', 'Method']);
      const rawDate     = getField(row, ['Date', 'Payment Date', 'Order Lines/Order Ref/Date', 'Order Date']);
      const amount      = parseNum(row, ['Amount', 'Payment Amount', 'Total', 'Payments/Amount', 'Order Payment/Amount']);
      const date        = normalizeDate(rawDate || getField(row, ['Order Ref/Date']));

      if (!subinventory || !rawMethod || !date || amount === 0) continue;

      const paymentType = getPaymentType(rawMethod);

      if (storeCode) registerSubinventoryMap[storeCode] = subinventory;

      const key = `${date}|${subinventory}|${paymentType}|${normUpper(rawMethod)}`;

      if (!groups.has(key)) {
        groups.set(key, {
          date,
          subinventory,
          paymentType,
          rawMethod: normCell(rawMethod),
          totalAmount: 0,
        });
      }
      groups.get(key).totalAmount = round4(groups.get(key).totalAmount + amount);
    }

    if (groups.size === 0) {
      return res.status(400).json({
        error: 'No valid payment lines found. Check that the file has Date, Store/Order Ref, Payment Method, and Amount columns.',
      });
    }

    // ── Step 2: Resolve invoices and build payloads ───────────────────────────
    const standardPayloads = [];
    const miscPayloads     = [];
    const warnings         = [];
    const invoiceCache     = {};  // cache: `${subinventory}|${date}|${paymentType}` → invoice info

    for (const [, grp] of groups) {
      const { date, subinventory, paymentType, rawMethod, totalAmount } = grp;

      // Skip Tabby / Tamara entirely
      if (EXCLUDED_PAYMENT_TYPES.includes(paymentType)) continue;

      const methodUpper = normUpper(rawMethod);
      const isCashRounding = CASH_ROUNDING_METHODS_UPPER.has(methodUpper);

      // ── Resolve invoice ───────────────────────────────────────────────────
      const invoiceCacheKey = `${subinventory}|${date}|${paymentType}`;
      if (!(invoiceCacheKey in invoiceCache)) {
        invoiceCache[invoiceCacheKey] = await findInvoiceHeader(subinventory, date, paymentType);
      }
      const invoiceInfo = invoiceCache[invoiceCacheKey];

      if (!invoiceInfo || !invoiceInfo.txnNumber) {
        warnings.push(
          `No invoice found for store=${subinventory}, date=${date}, type=${paymentType}. Skipping ${rawMethod}.`
        );
        continue;
      }

      const txnNumber = invoiceInfo.txnNumber;

      // ── Resolve receipt method details ────────────────────────────────────
      const rm = await getReceiptMethod(rawMethod, region);
      const canonicalName = rm ? rm.receiptMethodName : normCell(rawMethod);
      const bankCharge    = rm ? rm.receiptBankCharge : 0;
      const taxRate       = rm ? rm.receiptMethodTax  : 0;

      // ── Resolve register (bank account) ──────────────────────────────────
      const reg = await prisma.vendhqRegister.findFirst({
        where: { registerName: { equals: subinventory } },
      });
      const register = reg || (subinventory.length >= 4
        ? await prisma.vendhqRegister.findFirst({
            where: { registerName: { startsWith: subinventory.slice(0, 4) } },
          })
        : null);

      const bankAccountId  = register?.bankAccountId  || '';  // for standard receipt
      const bankAccountText = register?.bankAccount    || '';  // for misc receipt
      const cashAccountId  = register?.cashAccountId  || '';  // for cash standard receipt

      // ── Standard Receipt ──────────────────────────────────────────────────
      // All NORMAL methods (Cash, Mada, Visa, Master, Debit Card, etc.) get a standard receipt
      const remittanceAccId = (methodUpper === 'CASH' || isCashRounding)
        ? (cashAccountId || bankAccountId)
        : bankAccountId;

      standardPayloads.push({
        ReceiptNumber:             `${canonicalName}-${txnNumber}`,
        ReceiptMethod:             canonicalName,
        ReceiptDate:               date,
        BusinessUnit:              invoiceInfo.businessUnit || DEFAULT_BUSINESS_UNIT,
        CustomerAccountNumber:     invoiceInfo.customerAccNumber || '',
        CustomerSite:              invoiceInfo.customerSite || '',
        Amount:                    String(round2(totalAmount)),
        Currency:                  DEFAULT_CURRENCY,
        RemittanceBankAccountNumber: remittanceAccId,
        AccountingDate:            date,
        // metadata for display
        _meta: { subinventory, date, paymentType, txnNumber, method: canonicalName },
      });

      // ── Misc Receipt ──────────────────────────────────────────────────────
      const noMisc = NO_MISC_METHODS_UPPER.has(methodUpper);

      if (!noMisc) {
        let miscAmount;

        if (isCashRounding) {
          // Special formula: miscCharges = raw amount; amount = 0 - miscCharges
          const miscCharges = totalAmount;
          miscAmount = round4(0 - miscCharges);
        } else {
          // Standard formula
          const temp1       = totalAmount * bankCharge;
          const temp2       = 1 + taxRate;
          const miscCharges = round4(temp1 * temp2);
          miscAmount        = round4(0 - miscCharges);
        }

        miscPayloads.push({
          ReceiptNumber:         `${canonicalName}-${txnNumber}-MISC`,
          Amount:                String(miscAmount),
          CurrencyCode:          DEFAULT_CURRENCY,
          ReceiptDate:           date,
          DepositDate:           date,
          GlDate:                date,
          ReceiptMethodName:     canonicalName,
          ReceivableActivityName: 'Bank Charge',
          BankAccountNumber:     bankAccountText,
          OrgId:                 STATIC_ORG_ID,
          // metadata for display
          _meta: { subinventory, date, paymentType, txnNumber, method: canonicalName, bankCharge, taxRate },
        });
      }
    }

    // ── Step 3: Persist the batch ─────────────────────────────────────────────
    const batch = await prisma.vendReceiptBatch.create({
      data: {
        userId:        req.user.id,
        filename:      file.name,
        region,
        totalStandard: standardPayloads.length,
        totalMisc:     miscPayloads.length,
        status:        'GENERATED',
        payloadsJson:  JSON.stringify({ standardPayloads, miscPayloads }, null, 2),
      },
    });

    return res.json({
      batchId:          batch.id,
      totalStandard:    standardPayloads.length,
      totalMisc:        miscPayloads.length,
      standardPayloads,
      miscPayloads,
      warnings,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Submit Standard Receipts ─────────────────────────────────────────────────

/**
 * POST /api/vend-receipt/submit-standard
 *
 * Sends generated standard receipt payloads to Oracle REST API.
 * Stores each Oracle response row into FusionStandardReceipt.
 */
async function submitStandardReceipts(req, res, next) {
  try {
    const { batchId, payloads } = req.body;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ error: 'payloads array is required.' });
    }
    if (!process.env.ORACLE_STANDARD_RECEIPT_API_URL) {
      return res.status(500).json({ error: 'ORACLE_STANDARD_RECEIPT_API_URL is not configured.' });
    }

    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    let successCount = 0;
    let failureCount = 0;
    const logs = [];
    const limit = pLimit(CONCURRENT_REQUESTS);
    const startTime = Date.now();

    const tasks = payloads.map((payload, i) =>
      limit(async () => {
        // Strip internal _meta before sending
        const { _meta, ...apiPayload } = payload;

        try {
          const response = await pRetry(
            async () => {
              const r = await axios.post(
                process.env.ORACLE_STANDARD_RECEIPT_API_URL,
                apiPayload,
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Basic ${oracleAuth}`,
                  },
                  timeout: 30000,
                  validateStatus: () => true,
                }
              );
              if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
              return r;
            },
            { retries: MAX_RETRIES, minTimeout: 1000, maxTimeout: 10000 }
          );

          const body = asText(response.data);
          let oracleData = {};
          try { oracleData = typeof response.data === 'object' ? response.data : JSON.parse(body); } catch (_) {}

          if (response.status < 400) {
            successCount++;
            // Store Oracle response in FusionStandardReceipt
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:           batchId || null,
                status:              'Success',
                message:             null,
                requestDate:         new Date(),
                currencyCode:        oracleData.Currency || apiPayload.Currency || DEFAULT_CURRENCY,
                receiptDate:         apiPayload.ReceiptDate ? new Date(apiPayload.ReceiptDate) : null,
                glDate:              apiPayload.AccountingDate ? new Date(apiPayload.AccountingDate) : null,
                receiptNumber:       oracleData.ReceiptNumber || apiPayload.ReceiptNumber,
                receiptMethodId:     oracleData.ReceiptMethodId ? String(oracleData.ReceiptMethodId) : null,
                remittanceBankAccId: oracleData.RemittanceBankAccountId ? String(oracleData.RemittanceBankAccountId) : apiPayload.RemittanceBankAccountNumber || null,
                depositDate:         apiPayload.ReceiptDate ? new Date(apiPayload.ReceiptDate) : null,
                customerId:          oracleData.CustomerId ? String(oracleData.CustomerId) : null,
                orgId:               STATIC_ORG_ID,
                amount:              parseFloat(apiPayload.Amount) || null,
                region:              DEFAULT_REGION,
                integMode:           'MANUAL',
                batchId:             batchId || null,
              },
            });
            logs.push(`[OK] Row ${i + 2}: ${apiPayload.ReceiptNumber} | HTTP ${response.status}`);
          } else {
            failureCount++;
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:    batchId || null,
                status:       'Failed',
                message:      snippet(body, 500),
                requestDate:  new Date(),
                receiptNumber: apiPayload.ReceiptNumber,
                amount:       parseFloat(apiPayload.Amount) || null,
                region:       DEFAULT_REGION,
                integMode:    'MANUAL',
                batchId:      batchId || null,
              },
            });
            logs.push(`[FAIL] Row ${i + 2}: ${apiPayload.ReceiptNumber} | HTTP ${response.status} | ${snippet(body, 200)}`);
          }
        } catch (err) {
          failureCount++;
          logs.push(`[ERROR] Row ${i + 2}: ${payload.ReceiptNumber} | ${err.message}`);
        }
      })
    );

    await Promise.all(tasks);

    // Update batch status if batchId provided.
    // Read existing misc counters so we don't overwrite them and append to responseLog.
    if (batchId) {
      try {
        const existing = await prisma.vendReceiptBatch.findUnique({ where: { id: parseInt(batchId, 10) } });
        const existingLog = existing?.responseLog ? existing.responseLog + '\n' : '';
        const totalFail = failureCount + (existing?.failureMisc || 0);
        const totalOk   = successCount + (existing?.successMisc || 0);
        const newStatus = totalFail === 0 ? 'DONE' : totalOk === 0 ? 'FAILED' : 'PARTIAL';
        await prisma.vendReceiptBatch.update({
          where: { id: parseInt(batchId, 10) },
          data: {
            successStandard: successCount,
            failureStandard: failureCount,
            status: newStatus,
            responseLog: existingLog + logs.join('\n'),
          },
        });
      } catch (_) {}
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.json({
      total: payloads.length,
      successCount,
      failureCount,
      processingTimeSeconds: parseFloat(elapsed),
      logs,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Submit Misc Receipts ─────────────────────────────────────────────────────

/**
 * POST /api/vend-receipt/submit-misc
 *
 * Sends generated misc receipt payloads to Oracle SOAP (MiscellaneousReceiptService).
 * Stores each Oracle response row into FusionMiscReceipt.
 */
async function submitMiscReceipts(req, res, next) {
  try {
    const { batchId, payloads } = req.body;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ error: 'payloads array is required.' });
    }
    if (!process.env.ORACLE_SOAP_URL) {
      return res.status(500).json({ error: 'ORACLE_SOAP_URL is not configured.' });
    }

    let successCount = 0;
    let failureCount = 0;
    const logs = [];
    const limit = pLimit(CONCURRENT_REQUESTS);
    const startTime = Date.now();

    const tasks = payloads.map((payload, i) =>
      limit(async () => {
        const { _meta, ...apiPayload } = payload;
        const soapXml = buildMiscSoapEnvelope(apiPayload);

        try {
          const soapClient = createOracleSoapClient(process.env.ORACLE_SOAP_URL);
          const response = await soapClient.callWithCustomEnvelope(soapXml, 'createMiscellaneousReceipt');

          successCount++;
          const bodyText = asText(response.data);

          await prisma.fusionMiscReceipt.create({
            data: {
              requestId:        batchId || null,
              status:           'Success',
              requestDate:      new Date(),
              currencyCode:     apiPayload.CurrencyCode || DEFAULT_CURRENCY,
              glDate:           apiPayload.GlDate   ? new Date(apiPayload.GlDate)   : null,
              receiptDate:      apiPayload.ReceiptDate ? new Date(apiPayload.ReceiptDate) : null,
              receiptMethodName: apiPayload.ReceiptMethodName || null,
              receiptNumber:    apiPayload.ReceiptNumber,
              bankAccNumber:    apiPayload.BankAccountNumber || null,
              recActivityName:  apiPayload.ReceivableActivityName || null,
              amount:           parseFloat(apiPayload.Amount) || null,
              region:           DEFAULT_REGION,
              integMode:        'MANUAL',
              batchId:          batchId || null,
            },
          });
          logs.push(`[OK] Row ${i + 2}: ${apiPayload.ReceiptNumber}`);
        } catch (err) {
          failureCount++;
          await prisma.fusionMiscReceipt.create({
            data: {
              requestId:     batchId || null,
              status:        'Failed',
              message:       snippet(err.message, 500),
              requestDate:   new Date(),
              receiptNumber: apiPayload.ReceiptNumber,
              amount:        parseFloat(apiPayload.Amount) || null,
              region:        DEFAULT_REGION,
              integMode:     'MANUAL',
              batchId:       batchId || null,
            },
          });
          logs.push(`[ERROR] Row ${i + 2}: ${payload.ReceiptNumber} | ${err.message}`);
        }
      })
    );

    await Promise.all(tasks);

    if (batchId) {
      try {
        const existing = await prisma.vendReceiptBatch.findUnique({ where: { id: parseInt(batchId, 10) } });
        const existingLog = existing?.responseLog ? existing.responseLog + '\n' : '';
        const totalFail = failureCount + (existing?.failureStandard || 0);
        const totalOk   = successCount + (existing?.successStandard || 0);
        const newStatus = totalFail === 0 ? 'DONE' : totalOk === 0 ? 'FAILED' : 'PARTIAL';
        await prisma.vendReceiptBatch.update({
          where: { id: parseInt(batchId, 10) },
          data: {
            successMisc: successCount,
            failureMisc: failureCount,
            status: newStatus,
            responseLog: existingLog + logs.join('\n'),
          },
        });
      } catch (_) {}
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.json({
      total: payloads.length,
      successCount,
      failureCount,
      processingTimeSeconds: parseFloat(elapsed),
      logs,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Batch list / get ─────────────────────────────────────────────────────────

async function listBatches(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;
    const where = req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [batches, total] = await Promise.all([
      prisma.vendReceiptBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.vendReceiptBatch.count({ where }),
    ]);

    return res.json({ batches, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function getBatch(req, res, next) {
  try {
    const batchId = parseInt(req.params.id);
    if (isNaN(batchId)) return res.status(400).json({ error: 'Invalid batch ID.' });

    const batch = await prisma.vendReceiptBatch.findUnique({
      where: { id: batchId },
      include: { user: { select: { email: true } } },
    });

    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    if (req.user.role === 'USER' && batch.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    return res.json({
      ...batch,
      payloads: (() => {
        try { return JSON.parse(batch.payloadsJson); }
        catch { return null; }
      })(),
    });
  } catch (err) {
    next(err);
  }
}

// ─── Receipt data tables ──────────────────────────────────────────────────────

async function listReceiptMethods(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(200, parseInt(req.query.limit) || 50);
    const skip   = (page - 1) * limit;
    const region = req.query.region ? String(req.query.region).trim().toUpperCase() : undefined;

    const where = region ? { region } : {};

    const [methods, total] = await Promise.all([
      prisma.fusionReceiptMethod.findMany({ where, orderBy: [{ region: 'asc' }, { receiptMethodName: 'asc' }], skip, take: limit }),
      prisma.fusionReceiptMethod.count({ where }),
    ]);

    return res.json({ methods, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function listStandardReceipts(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const [receipts, total] = await Promise.all([
      prisma.fusionStandardReceipt.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.fusionStandardReceipt.count(),
    ]);

    return res.json({ receipts, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function listMiscReceipts(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const [receipts, total] = await Promise.all([
      prisma.fusionMiscReceipt.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.fusionMiscReceipt.count(),
    ]);

    return res.json({ receipts, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function listApplyReceipts(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const [receipts, total] = await Promise.all([
      prisma.fusionApplyReceipt.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.fusionApplyReceipt.count(),
    ]);

    return res.json({ receipts, total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateReceipts,
  submitStandardReceipts,
  submitMiscReceipts,
  listBatches,
  getBatch,
  listReceiptMethods,
  listStandardReceipts,
  listMiscReceipts,
  listApplyReceipts,
};
