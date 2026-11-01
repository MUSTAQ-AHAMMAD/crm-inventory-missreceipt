/**
 * Credit Memo service (REST).
 *
 * Oracle Fusion has no SOAP credit-memo operation (RecInvoiceService only exposes
 * createSimpleInvoice), so credit memos are created via the REST resource
 *   POST {ORACLE_RECEIVABLES_CREDIT_MEMOS_API_URL}
 *        e.g. .../fscmRestApi/resources/11.13.18.05/receivablesCreditMemos
 *
 * Payload shape (from a verified working sample):
 *   {
 *     BillToCustomerNumber, BillToSite, BusinessUnit, TransactionSource,
 *     TransactionType,            // invoice type + " - CN"
 *     TransactionDate, AccountingDate, CrossReference, InternalNotes,
 *     receivablesCreditMemoLines: [{
 *       ItemNumber, LineNumber,
 *       LineQuantityCredit,       // NEGATIVE for a credit (e.g. "-1")
 *       UnitSellingPrice,         // POSITIVE
 *       SalesOrderNumber, TaxClassificationCode,
 *       receivablesCreditMemoLineTaxLines: [{ TaxAmount, TaxRegimeCode, TaxRateCode }]
 *     }]
 *   }
 *
 * Sign convention: a credit line moves the minus sign onto the quantity and keeps
 * the unit price positive, so the extended amount (LineQuantityCredit × UnitSellingPrice)
 * equals the original signed line total. The tax line mirrors that sign.
 */

'use strict';

const axios = require('axios');

const REQUEST_TIMEOUT = parseInt(process.env.ORACLE_SOAP_TIMEOUT, 10) || 300000;
const MAX_RETRIES = parseInt(process.env.ORACLE_REST_MAX_RETRIES, 10) || 2;

// Tax regime per region. KSA is the only one seen in the sample; extend as other
// regions are confirmed. Falls back to KSA REGIME.
const TAX_REGIME_BY_REGION = {
  SA: 'KSA REGIME',
  KSA: 'KSA REGIME',
  SN: 'KSA REGIME',
  OM: 'OMAN REGIME',
  OMAN: 'OMAN REGIME',
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Extract the tax rate fraction from a classification code such as
 * "OUTPUT-GOODS-DOM-15%" → 0.15. Falls back to 0.15 (KSA standard VAT).
 */
function parseTaxRateFraction(taxClassificationCode) {
  const m = String(taxClassificationCode || '').match(/(\d+(?:\.\d+)?)\s*%/);
  const pct = m ? parseFloat(m[1]) : 15;
  return pct / 100;
}

/** Resolve the tax regime code for a region. */
function taxRegimeForRegion(region) {
  const key = String(region || '').trim().toUpperCase();
  return TAX_REGIME_BY_REGION[key] || 'KSA REGIME';
}

/**
 * Build a single receivablesCreditMemoLines entry from a normalized source line.
 *
 * @param {object} line - { ItemNumber?, MemoLineName?, Description?, Quantity, UnitSellingPrice, SalesOrder?, TaxClassificationCode }
 * @param {number} lineNumber - 1-based sequential line number
 * @param {object} opts - { region }
 */
function buildCreditMemoLine(line, lineNumber, opts = {}) {
  const qty = Math.abs(Number(line.Quantity) || 0);
  const price = Number(line.UnitSellingPrice) || 0;
  const unitPrice = round2(Math.abs(price));

  // Keep the sign of the extended amount on the quantity: a price-negative
  // (discount/refund) line becomes a negative credit quantity; a price-positive
  // line stays positive. extended = LineQuantityCredit × UnitSellingPrice.
  const lineQuantityCredit = price < 0 ? -qty : qty;
  const extended = round2(lineQuantityCredit * unitPrice);

  const taxClass = line.TaxClassificationCode || null;
  const taxAmount = round2(extended * parseTaxRateFraction(taxClass));

  const cmLine = {
    LineNumber: String(lineNumber),
    LineQuantityCredit: String(lineQuantityCredit),
    UnitSellingPrice: String(unitPrice),
  };

  // Item lines carry ItemNumber; discount/memo lines carry MemoLine.
  // (The receivablesCreditMemos REST resource rejects "MemoLineName" — AR HTTP 400
  // "Invalid attribute" — it uses "MemoLine", matching the invoice REST resource.)
  if (line.ItemNumber && String(line.ItemNumber).trim() !== '') {
    cmLine.ItemNumber = String(line.ItemNumber);
  } else {
    cmLine.MemoLine = line.MemoLineName || line.MemoLine || 'Discount Item';
  }

  // The line-level description attribute is "LineDescription" ("Description" is only
  // valid on the header / sub-resources, per the receivablesCreditMemos schema).
  if (line.Description) cmLine.LineDescription = String(line.Description);
  // SalesOrderNumber is kept raw (Oracle accepted the raw ref, incl. non-ASCII, in the sample).
  if (line.SalesOrder) cmLine.SalesOrderNumber = String(line.SalesOrder);

  if (taxClass) {
    cmLine.TaxClassificationCode = taxClass;
    cmLine.receivablesCreditMemoLineTaxLines = [
      {
        TaxAmount: String(taxAmount),
        TaxRegimeCode: taxRegimeForRegion(opts.region),
        TaxRateCode: taxClass,
      },
    ];
  }

  return cmLine;
}

/**
 * Build a full receivablesCreditMemos payload from a normalized credit-memo group.
 *
 * @param {object} group
 * @param {string} group.BillToCustomerNumber
 * @param {string} group.BillToSite
 * @param {string} group.BusinessUnit
 * @param {string} group.TransactionSource
 * @param {string} group.TransactionType   - already the "- CN" credit-memo type
 * @param {string} group.TransactionDate
 * @param {string} [group.AccountingDate]
 * @param {string} [group.CrossReference]
 * @param {string} [group.InternalNotes]
 * @param {string} [group.region]
 * @param {Array}  group.lines             - normalized source lines
 */
function buildCreditMemoPayload(group) {
  const lines = (group.lines || []).map((l, i) => buildCreditMemoLine(l, i + 1, { region: group.region }));

  const payload = {
    BillToCustomerNumber: group.BillToCustomerNumber != null ? String(group.BillToCustomerNumber) : '',
    BillToSite: group.BillToSite != null ? String(group.BillToSite) : '',
    BusinessUnit: group.BusinessUnit || '',
    TransactionSource: group.TransactionSource || '',
    TransactionType: group.TransactionType || '',
    TransactionDate: group.TransactionDate || '',
    AccountingDate: group.AccountingDate || group.TransactionDate || '',
    receivablesCreditMemoLines: lines,
  };
  if (group.CrossReference != null) payload.CrossReference = String(group.CrossReference);
  if (group.InternalNotes) payload.InternalNotes = String(group.InternalNotes);

  return payload;
}

/**
 * POST a single credit-memo payload to Oracle's receivablesCreditMemos REST resource.
 * Retries on 5xx up to MAX_RETRIES. validateStatus is always true so the caller
 * inspects response.status (mirrors standardReceiptController.sendRestRequest).
 */
async function sendCreditMemoRest(payload, label = '') {
  const endpoint = process.env.ORACLE_RECEIVABLES_CREDIT_MEMOS_API_URL;
  if (!endpoint) {
    throw new Error('Oracle credit memo REST URL is not configured. Check ORACLE_RECEIVABLES_CREDIT_MEMOS_API_URL in .env');
  }
  const auth = Buffer.from(`${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`).toString('base64');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Basic ${auth}`,
  };

  let response = null;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    response = await axios.post(endpoint, payload, { headers, timeout: REQUEST_TIMEOUT, validateStatus: () => true });
    if (response.status >= 500 && response.status < 600 && attempt <= MAX_RETRIES) {
      console.warn(`[CreditMemo] ${label} retry ${attempt}/${MAX_RETRIES}: HTTP ${response.status}`);
      continue;
    }
    break;
  }
  return response;
}

module.exports = {
  parseTaxRateFraction,
  taxRegimeForRegion,
  buildCreditMemoLine,
  buildCreditMemoPayload,
  sendCreditMemoRest,
};
