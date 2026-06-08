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

const axios = require('axios');
const XLSX = require('xlsx');
const pLimit = require('p-limit');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');
const { createOracleSoapClient } = require('../services/OracleSoapClient');
const { buildStandardReceiptEnvelope, buildMiscReceiptEnvelope } = require('../services/soapEnvelopeBuilder');

// ─── Constants ────────────────────────────────────────────────────────────────

// Fallback Oracle Org ID used only when region-based lookup fails.
// Java equivalent: session.getFusionBusinessUnitIdMapfindByRegion(region).getBusinessUnitId()
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

// ─── Org ID Resolution ────────────────────────────────────────────────────────
/**
 * Mirrors Java FusionStdReceiptMapping line:
 *   setOrgId(session.getFusionBusinessUnitIdMapfindByRegion(outletDetail.getRegion())
 *              .getBusinessUnitId().longValue())
 *
 * Looks up the Oracle Org ID for a region from existing FusionStandardReceipt
 * records (seeded from Oracle historical data). Falls back to STATIC_ORG_ID
 * when no seeded record is found for the region.
 */
async function resolveOrgIdByRegion(region) {
  if (!region) return STATIC_ORG_ID;
  const receipt = await prisma.fusionStandardReceipt.findFirst({
    where: { region: region.toUpperCase(), status: 'Success', orgId: { not: null } },
    select: { orgId: true },
  });
  return receipt?.orgId || STATIC_ORG_ID;
}

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

/**
 * Resolve Oracle CustomerAccountId from a customer account number via the
 * Oracle Fusion REST API.
 *
 * Mirrors Java FusionCustomerProfileClient.getCustomerAccountId(accountNumber)
 * and oracle-crm oracleClient.getCustomer(accountNumber).
 *
 * Requires ORACLE_CUSTOMERS_API_URL, ORACLE_USERNAME, ORACLE_PASSWORD in .env.
 *
 * @param {string|number} accountNumber - Oracle AR customer account number
 * @returns {string|null} CustomerAccountId as a string, or null on failure
 */
async function lookupCustomerAccountIdFromOracle(accountNumber) {
  const url = process.env.ORACLE_CUSTOMERS_API_URL;
  if (!url || !accountNumber) return null;

  // Sanitize: Oracle AR account numbers are numeric; strip anything that is not
  // a digit, letter, hyphen, or underscore before interpolating into the query.
  const safeAccNumber = String(accountNumber).replace(/[^A-Za-z0-9\-_]/g, '');
  if (!safeAccNumber) return null;

  const oracleAuth = Buffer.from(
    `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
  ).toString('base64');

  // Oracle Fusion REST API uses 'AccountNumber' as the customer account number
  // field name (maps to HZ_CUST_ACCOUNTS.ACCOUNT_NUMBER).  Some older Oracle
  // versions also recognise 'CustomerAccountNumber'.  Try both before giving up.
  const queryFields = [
    `AccountNumber='${safeAccNumber}'`,
    `CustomerAccountNumber='${safeAccNumber}'`,
  ];

  for (const q of queryFields) {
    try {
      const response = await axios.get(url, {
        params: {
          q,
          fields: 'CustomerAccountId',
          limit: 1,
        },
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${oracleAuth}`,
        },
        timeout: 30000,
      });
      const items = response.data?.items || [];
      if (items.length > 0 && items[0].CustomerAccountId) {
        return String(items[0].CustomerAccountId);
      }
    } catch (err) {
      console.warn(`[vendReceipt] Oracle customer lookup failed (q=${q}) for account '${accountNumber}': ${err.message}`);
    }
  }
  return null;
}

/**
 * Look up the Oracle customer party ID (CustomerId) for a given account number.
 *
 * Strategy 1: Invoice-chain lookup (works after the first successful submission)
 *   Find FusionInvoiceHeader entries with the matching billToAccNumber, then
 *   look for a FusionStandardReceipt whose receipt number ends with -{txnNumber}.
 *
 * Strategy 1b: VendSales Metadata lookup via invoice number (first-run safe)
 *   Given the txnNumber embedded in the receipt number (e.g. "Visa-2672577" → 2672577),
 *   look up FusionInvoiceHeader by txnNumber, then resolve FusionSalesMetadata
 *   using the invoice's billToLocation (siteNumber).  Returns billToAccount as
 *   the CustomerId.  This strategy succeeds even when no prior FusionStandardReceipt
 *   records exist for the store.
 *
 * Strategy 2: Bank-account-ID fallback (works with seeded historical data)
 *   If strategy 1 yields nothing, search FusionStandardReceipt directly by
 *   remittanceBankAccId.  Because each store has a unique Oracle bank account ID
 *   (from VendhqRegister.bankAccountId) and seeded historical receipts include
 *   this ID, the correct party ID can be retrieved without a matching invoice
 *   header.  This prevents first-run failures for stores present in seed data.
 *
 * Strategy 3: Subinventory → VendhqRegister → all account IDs.
 *
 * Strategy 3b: Subinventory → FusionSalesMetadata → billToAccount (direct fallback)
 *   When the subinventory is known but no prior receipt records exist, look up
 *   FusionSalesMetadata directly by subinventory and use billToAccount as the
 *   CustomerId.
 *
 * Strategy 4: Oracle REST customer lookup (first-run / no seeded data).
 *   Mirrors Java FusionCustomerProfileClient.getCustomerAccountId(accountNumber).
 *   Calls GET /fscmRestApi/.../customers?q=AccountNumber='...' (falls back to
 *   CustomerAccountNumber='...') to resolve the
 *   Oracle-internal CustomerAccountId when all DB strategies fail.
 *
 * @param {string|number} customerAccNumber - billToAccNumber from the invoice header
 * @param {string|null}   bankAccountId     - VendhqRegister.bankAccountId (optional)
 * @param {string|null}   subinventory      - store/subinventory code (optional)
 * @param {string|number} txnNumber         - invoice transaction number (optional)
 * Returns null when no strategy locates a party ID.
 */
async function lookupCustomerPartyId(customerAccNumber, bankAccountId = null, subinventory = null, txnNumber = null) {
  if (!customerAccNumber && !bankAccountId && !subinventory && !txnNumber) return null;

  // ── Strategy 1: invoice header → receipt chain ───────────────────────────
  if (customerAccNumber) {
    // billToAccNumber is stored as Int; coerce to integer for the DB lookup
    const accNum = typeof customerAccNumber === 'number'
      ? customerAccNumber
      : parseInt(String(customerAccNumber).replace(/\D/g, ''), 10);

    if (!isNaN(accNum) && accNum > 0) {
      const invoices = await prisma.fusionInvoiceHeader.findMany({
        where: { billToAccNumber: accNum, status: 'SUCCESS' },
        select: { txnNumber: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      for (const inv of invoices) {
        if (!inv.txnNumber) continue;
        // Match receipt numbers of the form "{Method}-{txnNumber}"
        const receipt = await prisma.fusionStandardReceipt.findFirst({
          where: {
            receiptNumber: { endsWith: `-${inv.txnNumber}` },
            customerId:    { not: null },
            status:        'Success',
          },
          select: { customerId: true },
        });
        if (receipt?.customerId) return receipt.customerId;
      }
    }
  }

  // ── Strategy 1b: txnNumber → FusionInvoiceHeader → FusionSalesMetadata → Oracle REST ───
  // Looks up the invoice by its transaction number, then resolves the matching
  // FusionSalesMetadata record via the invoice's billToLocation (siteNumber).
  // Falls back to matching by billToAccNumber when billToLocation is absent.
  // Uses Oracle REST to convert the account number into the real CUST_ACCOUNT_ID
  // required by StandardReceipt SOAP — billToAccount is the AR account NUMBER
  // (e.g. 57014), not the internal CUST_ACCOUNT_ID (e.g. 300000158776674).
  if (txnNumber) {
    const txnNum = parseInt(String(txnNumber).replace(/\D/g, ''), 10);
    if (!isNaN(txnNum) && txnNum > 0) {
      const inv = await prisma.fusionInvoiceHeader.findFirst({
        where: { txnNumber: txnNum },
        select: { billToLocation: true, billToAccNumber: true },
        orderBy: { createdAt: 'desc' },
      });
      if (inv) {
        let meta = null;
        if (inv.billToLocation) {
          meta = await prisma.fusionSalesMetadata.findFirst({
            where: { siteNumber: inv.billToLocation },
            select: { billToAccount: true },
          });
        }
        if (!meta && inv.billToAccNumber) {
          meta = await prisma.fusionSalesMetadata.findFirst({
            where: { billToAccount: inv.billToAccNumber },
            select: { billToAccount: true },
          });
        }
        if (meta?.billToAccount) {
          const realId = await lookupCustomerAccountIdFromOracle(meta.billToAccount);
          if (realId) {
            console.log(`[vendReceipt] Strategy 1b: resolved CustomerId=${realId} from Oracle REST via txnNumber=${txnNum}`);
            return realId;
          }
        // Oracle REST unavailable – fall through to Strategy 2 (bank-account-ID lookup)
        }
      }
    }
  }

  // ── Strategy 2: bank account ID fallback (seeded historical data) ─────────
  // Each store has a unique Oracle bank account ID stored in VendhqRegister.
  // Historical (seeded) FusionStandardReceipt rows carry the same bank account
  // ID in remittanceBankAccId, so we can retrieve the party ID per store
  // without needing a matching FusionInvoiceHeader entry.
  if (bankAccountId) {
    const receipt = await prisma.fusionStandardReceipt.findFirst({
      where: {
        remittanceBankAccId: String(bankAccountId),
        customerId:          { not: null },
        status:              'Success',
      },
      orderBy: { createdAt: 'desc' },
      select: { customerId: true },
    });
    if (receipt?.customerId) return receipt.customerId;
  }

  // ── Strategy 3: subinventory → VendhqRegister → all account IDs ──────────
  // When the payload's RemittanceBankAccountNumber is empty (register not found
  // during generation) OR only one account type was tried in strategy 2, try all
  // Oracle account IDs (bankAccountId + cashAccountId) from VendhqRegister for
  // this store.  This covers the case where the seeded FusionStandardReceipt has
  // records for a different account type than the current payment method.
  if (subinventory) {
    let reg = await prisma.vendhqRegister.findFirst({
      where: { registerName: { equals: subinventory } },
      select: { bankAccountId: true, cashAccountId: true },
    });
    if (!reg && subinventory.length >= 4) {
      reg = await prisma.vendhqRegister.findFirst({
        where: { registerName: { startsWith: subinventory.slice(0, 4) } },
        select: { bankAccountId: true, cashAccountId: true },
      });
    }

    if (reg) {
      // Collect all account IDs from the register, excluding the one already
      // tried in strategy 2 to avoid a redundant database round-trip.
      const triedId = bankAccountId ? String(bankAccountId) : null;
      const candidates = [reg.bankAccountId, reg.cashAccountId]
        .filter(Boolean)
        .map(String)
        .filter((id) => id !== triedId);

      if (candidates.length > 0) {
        const receipt = await prisma.fusionStandardReceipt.findFirst({
          where: {
            remittanceBankAccId: { in: candidates },
            customerId:          { not: null },
            status:              'Success',
          },
          orderBy: { createdAt: 'desc' },
          select: { customerId: true },
        });
        if (receipt?.customerId) return receipt.customerId;
      }
    }
  }

  // ── Strategy 3b: subinventory → FusionSalesMetadata → Oracle REST ────────
  // Direct fallback when no prior FusionStandardReceipt records exist for this
  // store.  Looks up FusionSalesMetadata by normalized subinventory, then uses
  // Oracle REST to convert billToAccount (AR account NUMBER) into the real
  // CUST_ACCOUNT_ID required by StandardReceipt SOAP.
  if (subinventory) {
    const normalizedSubinventory = String(subinventory)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .toUpperCase();
    const meta = await prisma.fusionSalesMetadata.findFirst({
      where: { subinventory: normalizedSubinventory },
      select: { billToAccount: true },
      orderBy: { id: 'asc' },
    });
    if (meta?.billToAccount) {
      const realId = await lookupCustomerAccountIdFromOracle(meta.billToAccount);
      if (realId) {
        console.log(`[vendReceipt] Strategy 3b: resolved CustomerId=${realId} from Oracle REST via subinventory=${normalizedSubinventory}`);
        return realId;
      }
      // Oracle REST unavailable – fall through to Strategy 4
    }
  }

  // ── Strategy 4: Oracle REST customer lookup ───────────────────────────────
  // Used when DB strategies 1-3 all fail (e.g. first-run, no seeded data).
  // Mirrors Java FusionCustomerProfileClient.getCustomerAccountId(accountNumber)
  // and oracle-crm oracleClient.getCustomer(accountNumber).
  if (customerAccNumber) {
    const oracleCustomerId = await lookupCustomerAccountIdFromOracle(customerAccNumber);
    if (oracleCustomerId) return oracleCustomerId;
  }

  return null;
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

  // 3b. Fallback: match by billToAccNumber when billToLocation produced no results
  if (headers.length === 0 && customerAccNumber) {
    const accountNumber = parseInt(customerAccNumber, 10);
    if (!isNaN(accountNumber)) {
      headers = await prisma.fusionInvoiceHeader.findMany({
        where: {
          billToAccNumber: accountNumber,
          txnDate: { gte: dayStart, lte: dayEnd },
          status: 'SUCCESS',
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
    }
  }

  // 4. Fallback: match by billToCustName containing the subinventory code
  if (headers.length === 0) {
    headers = await prisma.fusionInvoiceHeader.findMany({
      where: {
        billToCustName: { contains: subinventory, mode: 'insensitive' },
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

      if (!invoiceInfo) {
        warnings.push(
          `No invoice found for store=${subinventory}, date=${date}, type=${paymentType}. Skipping ${rawMethod}.`
        );
        continue;
      }

      if (!invoiceInfo.txnNumber) {
        warnings.push(
          `Invoice found for store=${subinventory}, date=${date}, type=${paymentType} but TransactionNumber is missing (Oracle may not have returned it). Skipping ${rawMethod}.`
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

      // Resolve the Oracle Org ID from the register's region – mirrors Java
      // FusionStdReceiptMapping: setOrgId(session.getFusionBusinessUnitIdMapfindByRegion(...))
      const registerRegion = register?.region || region;
      const resolvedOrgId  = await resolveOrgIdByRegion(registerRegion);

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
        // SOAP-specific fields (Java FusionStdReceiptMapping)
        ReceiptMethodId:           rm?.receiptMethodId || '',
        OrgId:                     resolvedOrgId,
        Region:                    registerRegion,
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
          BankAccountName:       bankAccountText,
          OrgId:                 resolvedOrgId,
          Region:                registerRegion,
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
 * Sends generated standard receipt payloads to Oracle SOAP (StandardReceiptService).
 * Mirrors standardReceiptController.js – uses ORACLE_STANDARD_RECEIPT_SOAP_URL.
 * Stores each Oracle response into FusionStandardReceipt.
 */
async function submitStandardReceipts(req, res, next) {
  try {
    const { batchId, payloads } = req.body;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ error: 'payloads array is required.' });
    }
    if (!process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL) {
      return res.status(500).json({ error: 'ORACLE_STANDARD_RECEIPT_SOAP_URL is not configured.' });
    }

    let successCount = 0;
    let failureCount = 0;
    let skipCount = 0;
    const logs = [];
    const limit = pLimit(CONCURRENT_REQUESTS);
    const startTime = Date.now();

    const tasks = payloads.map((payload, i) =>
      limit(async () => {
        // Strip internal _meta before processing
        const { _meta, ...apiPayload } = payload;

        const amountNum = parseFloat(apiPayload.Amount);

        // Skip receipts with Amount = 0 or non-numeric Amount
        if (!Number.isFinite(amountNum) || amountNum === 0) {
          skipCount++;
          logs.push(`[SKIP] Row ${i + 2}: ${apiPayload.ReceiptNumber} | Amount is 0 – skipped`);
          return;
        }

        // Skip receipts whose number contains "credit" (e.g. "Credit On Cust-...")
        if (apiPayload.ReceiptNumber && /credit/i.test(apiPayload.ReceiptNumber)) {
          skipCount++;
          logs.push(`[SKIP] Row ${i + 2}: ${apiPayload.ReceiptNumber} | Receipt number contains 'credit' – skipped`);
          return;
        }

        // Skip negative amounts – they are handled as miscellaneous receipts, not standard receipts
        if (amountNum < 0) {
          skipCount++;
          logs.push(`[SKIP] Row ${i + 2}: ${apiPayload.ReceiptNumber} | Negative amount (${apiPayload.Amount}) – handled as misc receipt, skipped for standard`);
          return;
        }

        // Deduplication: if a receipt with the same number was already successfully created in Fusion,
        // skip the SOAP call and proceed directly to the Apply Receipt step.
        const existingReceipt = await prisma.fusionStandardReceipt.findFirst({
          where: { receiptNumber: apiPayload.ReceiptNumber, status: 'Success' },
          select: { id: true },
        });
        if (existingReceipt) {
          skipCount++;
          logs.push(`[SKIP] Row ${i + 2}: ${apiPayload.ReceiptNumber} | Receipt already exists in Fusion – skipping to Apply Receipt step`);
          return;
        }

        // Look up Oracle CustomerAccountId for this customer.
        // Strategies 1, 2, 3 search prior successful FusionStandardReceipt records in the DB.
        // Strategy 1b uses the invoice txnNumber to resolve via FusionSalesMetadata.
        // Strategy 3b uses subinventory to resolve via FusionSalesMetadata directly.
        // Strategy 4 (fallback) resolves via Oracle REST GET /customers — mirrors Java
        // FusionCustomerProfileClient.getCustomerAccountId(accountNumber).
        const customerId = await lookupCustomerPartyId(
          apiPayload.CustomerAccountNumber,
          apiPayload.RemittanceBankAccountNumber || null,
          _meta?.subinventory || null,
          _meta?.txnNumber    || null,
        );

        // Build SOAP row: map REST-oriented payload fields to SOAP field names.
        // Region comes from the generated payload (resolved per-register); used to
        // persist the correct region to FusionStandardReceipt (not hardcoded DEFAULT_REGION).
        const payloadRegion = apiPayload.Region || DEFAULT_REGION;
        const soapRow = {
          ReceiptNumber:          apiPayload.ReceiptNumber,
          ReceiptDate:            apiPayload.ReceiptDate,
          Amount:                 apiPayload.Amount,
          CurrencyCode:           apiPayload.Currency || DEFAULT_CURRENCY,
          ReceiptMethodId:        apiPayload.ReceiptMethodId || '',
          RemittanceBankAccountId: apiPayload.RemittanceBankAccountNumber || '',
          CustomerId:             customerId || '',
          OrgId:                  apiPayload.OrgId || STATIC_ORG_ID,
        };

        const missingFields = ['ReceiptNumber', 'ReceiptDate', 'Amount', 'CurrencyCode',
          'ReceiptMethodId', 'RemittanceBankAccountId', 'CustomerId', 'OrgId']
          .filter(f => !soapRow[f]);

        if (missingFields.length > 0) {
          failureCount++;
          const msg = `Missing required SOAP fields: ${missingFields.join(', ')}`;
          await prisma.fusionStandardReceipt.create({
            data: {
              requestId:    batchId || null,
              status:       'Failed',
              message:      msg,
              requestDate:  new Date(),
              receiptNumber: apiPayload.ReceiptNumber,
              amount:       parseFloat(apiPayload.Amount) || null,
              region:       payloadRegion,
              integMode:    'MANUAL',
              batchId:      batchId || null,
            },
          });
          logs.push(`[FAIL] Row ${i + 2}: ${apiPayload.ReceiptNumber} | ${msg}`);
          return;
        }

        const soapXml = buildStandardReceiptEnvelope(soapRow);

        let soapResponse = null;
        let soapErr = null;

        try {
          console.log(`\n📤 [StandardReceipt] Processing Row ${i + 2}: ${soapRow.ReceiptNumber}`);
          const soapClient = createOracleSoapClient(process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL);
          soapResponse = await soapClient.callWithCustomEnvelope(soapXml, 'createStandardReceipt');
        } catch (err) {
          soapErr = err;
        }

        if (soapErr) {
          failureCount++;
          const errorMessage = snippet(soapErr.message, 500);
          try {
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:    batchId || null,
                status:       'Failed',
                message:      errorMessage,
                requestDate:  new Date(),
                receiptNumber: soapRow.ReceiptNumber,
                amount:       parseFloat(soapRow.Amount) || null,
                region:       payloadRegion,
                integMode:    'MANUAL',
                batchId:      batchId || null,
              },
            });
          } catch (dbErr) {
            console.error(`[StandardReceipt] DB save failed for ${soapRow.ReceiptNumber}: ${dbErr.message}`);
          }
          logs.push(`[ERROR] Row ${i + 2}: ${soapRow.ReceiptNumber} | ${errorMessage}`);
          console.error(`❌ [StandardReceipt] Failed: ${soapRow.ReceiptNumber} | ${errorMessage}`);
        } else {
          successCount++;
          try {
            await prisma.fusionStandardReceipt.create({
              data: {
                requestId:           batchId || null,
                status:              'Success',
                message:             null,
                requestDate:         new Date(),
                currencyCode:        soapRow.CurrencyCode,
                receiptDate:         soapRow.ReceiptDate ? new Date(soapRow.ReceiptDate) : null,
                glDate:              soapRow.ReceiptDate ? new Date(soapRow.ReceiptDate) : null,
                receiptNumber:       soapRow.ReceiptNumber,
                receiptMethodId:     soapRow.ReceiptMethodId || null,
                remittanceBankAccId: soapRow.RemittanceBankAccountId || null,
                depositDate:         soapRow.ReceiptDate ? new Date(soapRow.ReceiptDate) : null,
                customerId:          soapRow.CustomerId || null,
                orgId:               soapRow.OrgId,
                amount:              parseFloat(soapRow.Amount) || null,
                region:              payloadRegion,
                integMode:           'MANUAL',
                batchId:             batchId || null,
              },
            });
          } catch (dbErr) {
            console.error(`[StandardReceipt] DB save failed for ${soapRow.ReceiptNumber}: ${dbErr.message}`);
          }
          logs.push(`[OK] Row ${i + 2}: ${soapRow.ReceiptNumber} | HTTP ${soapResponse.status}`);
          console.log(`✅ [StandardReceipt] Success: ${soapRow.ReceiptNumber}`);
        }
      })
    );

    await Promise.all(tasks);

    // Update batch status – preserve existing misc counters
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
      skipCount,
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
        const soapXml = buildMiscReceiptEnvelope(apiPayload);

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
              bankAccNumber:    apiPayload.BankAccountName || null,
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
