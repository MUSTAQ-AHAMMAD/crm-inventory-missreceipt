/**
 * Shared SOAP envelope builders for Oracle Fusion receipt services.
 *
 * This module is the single source of truth for how Standard and Misc receipt
 * SOAP payloads are serialised.  All controllers MUST import from here instead
 * of defining their own envelope functions — duplicate implementations are what
 * caused the recurring Amount-format bugs.
 *
 * Correct Oracle AmountType serialisation (matches Java @XmlValue / @XmlAttribute):
 *   <com:Amount currencyCode="SAR">422.00</com:Amount>
 */

'use strict';

// ── Shared namespace constants ─────────────────────────────────────────────────
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

// StandardReceiptService
const STD_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/standardReceiptService/commonService/types/';
const STD_COM_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/standardReceiptService/commonService/';

// MiscellaneousReceiptService
const MISC_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/types/';
const MISC_COM_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';
const MISC_MIS_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/model/flex/MiscellaneousReceiptDff/';

// ReceivablesCustomerProfileService
const CUST_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/customers/customerProfileService/types/';
const CUST_SVC_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/customers/customerProfileService/';
const CUST_PROFILE_SOAP_ACTION = `${CUST_SVC_NS}getActiveCustomerProfile`;

// RecInvoiceService (AR Invoice createSimpleInvoice)
const AR_INV_TYP_NS = 'http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/types/';
const AR_INV_SVC_NS = 'http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/';
const AR_INVOICE_SOAP_ACTION = 'createSimpleInvoice';

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function roundAmount(value) {
  if (value === null || value === undefined) return '0.00';
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`Invalid numeric value for amount: "${value}"`);
  }
  return (Math.round(num * 100) / 100).toFixed(2);
}

/**
 * Coerce a customer/account number to a clean digit-only string.
 *
 * Oracle account numbers are pure integers.  This strips any non-digit noise —
 * most importantly a trailing "n" BigInt-literal artifact (e.g. "300000158776674n"
 * from a BigInt that was stringified via console/inspect tooling) — that would
 * otherwise be sent verbatim to Oracle and rejected, or crash a later BigInt()
 * conversion.  Returns '' when there are no digits.
 */
function sanitizeAccountNumber(value) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

/**
 * Coerce a sales-order reference to a clean ASCII token (e.g. "REDSEA/60713").
 *
 * Refund/return rows sometimes arrive with non-ASCII noise merged into the
 * order ref (observed: "REDSEA/60713استرداد الأموال" — the Arabic word for
 * "refund" appended). Oracle rejects the malformed reference, so strip any
 * non-printable-ASCII characters and trim.
 */
function sanitizeSalesOrder(value) {
  if (value == null) return '';
  return String(value).replace(/[^\x20-\x7E]/g, '').trim();
}

/**
 * Map a source unit-of-measure to the Oracle UOM code the AR invoice service accepts.
 *
 * Oracle rejects an unknown UOM with AR-856356 ("You must enter a valid unit of
 * measure") and fails the whole transaction. Per the Oracle setup:
 *   Each / EA        → "Ea"
 *   Gram / G / GR    → "G"
 * Anything unknown/blank falls back to "Ea" (the safe default for countable goods).
 */
function mapUomCode(value) {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'G' || v === 'GR' || v === 'GRAM' || v === 'GRAMS' || v === 'GM') return 'G';
  return 'Ea';
}

// ── Standard Receipt ───────────────────────────────────────────────────────────

function buildStandardReceiptEnvelope(row) {
  const required = [
    'ReceiptNumber', 'ReceiptDate', 'Amount', 'CurrencyCode',
    'ReceiptMethodId', 'RemittanceBankAccountId', 'CustomerId', 'OrgId',
  ];
  for (const f of required) {
    if (row[f] === undefined || row[f] === null || row[f] === '') {
      throw new Error(`Missing required field: ${f}`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${STD_TYPES_NS}"
  xmlns:com="${STD_COM_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createStandardReceipt>
      <typ:standardReceipt>
        <com:Amount currencyCode="${escapeXml(row.CurrencyCode)}">${escapeXml(roundAmount(row.Amount))}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:GlDate>${escapeXml(row.ReceiptDate)}</com:GlDate>
        <com:DepositDate>${escapeXml(row.ReceiptDate)}</com:DepositDate>
        <com:ReceiptMethodId>${escapeXml(row.ReceiptMethodId)}</com:ReceiptMethodId>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:RemittanceBankAccountId>${escapeXml(row.RemittanceBankAccountId)}</com:RemittanceBankAccountId>
        <com:CustomerId>${escapeXml(row.CustomerId)}</com:CustomerId>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </typ:standardReceipt>
    </typ:createStandardReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── Miscellaneous Receipt ──────────────────────────────────────────────────────

function buildMiscReceiptEnvelope(row) {
  const required = [
    'Amount', 'CurrencyCode', 'ReceiptNumber', 'ReceiptDate',
    'GlDate', 'ReceivableActivityName', 'BankAccountName', 'OrgId',
  ];
  for (const f of required) {
    if (row[f] === undefined || row[f] === null || row[f] === '') {
      throw new Error(`Missing required field: ${f}`);
    }
  }

  const receiptMethodNameTag = row.ReceiptMethodName
    ? `        <com:ReceiptMethodName>${escapeXml(row.ReceiptMethodName)}</com:ReceiptMethodName>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${MISC_TYPES_NS}"
  xmlns:com="${MISC_COM_NS}"
  xmlns:mis="${MISC_MIS_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>
      <typ:miscellaneousReceipt>
        <com:Amount currencyCode="${escapeXml(row.CurrencyCode)}">${escapeXml(roundAmount(row.Amount))}</com:Amount>
        <com:CurrencyCode>${escapeXml(row.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(row.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(row.ReceiptDate)}</com:ReceiptDate>
        <com:GlDate>${escapeXml(row.GlDate)}</com:GlDate>
${receiptMethodNameTag}        <com:ReceivableActivityName>${escapeXml(row.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountName>${escapeXml(row.BankAccountName)}</com:BankAccountName>
        <com:OrgId>${escapeXml(row.OrgId)}</com:OrgId>
      </typ:miscellaneousReceipt>
    </typ:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── Customer Profile ──────────────────────────────────────────────────────────

function buildCustomerProfileEnvelope(accountNumber) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${CUST_TYPES_NS}"
  xmlns:svc="${CUST_SVC_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:getActiveCustomerProfile>
      <typ:customerProfile>
        <svc:AccountNumber>${escapeXml(String(accountNumber))}</svc:AccountNumber>
      </typ:customerProfile>
    </typ:getActiveCustomerProfile>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── AR Invoice (RecInvoiceService / createSimpleInvoice) ────────────────────

/**
 * Builds a createSimpleInvoice SOAP envelope for Oracle RecInvoiceService.
 * 
 * ✅ CORRECT STRUCTURE (verified working):
 *   Root: typ:createSimpleInvoice → typ:invoiceHeaderInformation
 *   Details: inv: namespace for ALL invoice fields and lines
 * 
 * @param {object} payload - AR Invoice payload with header + receivablesInvoiceLines
 */
function buildArInvoiceSoapEnvelope(payload) {
  const lines    = payload.receivablesInvoiceLines || [];
  const currency = payload.InvoiceCurrencyCode || 'SAR';

  // Build invoice lines using inv: namespace
  const lineXml = lines.map((line) => {
    const lineNum = line.LineNumber || 0;
    // Map the line's unit of measure to a valid Oracle UOM code (Each→Ea, Gram→G).
    // Forcing "Ea" for every line previously failed gram-measured items with AR-856356.
    const uomCode = mapUomCode(line.UomCode);
    const lineCurrency = String(line.CurrencyCode ?? currency).trim();
    
    // Determine if this is a discount/memo line
    const isDiscount = !line.ItemNumber || String(line.ItemNumber).trim() === '';

    let lineXml = `
        <inv:InvoiceLine>
          <inv:LineNumber>${lineNum}</inv:LineNumber>`;

    if (isDiscount) {
      // ✅ Discount lines use MemoLineName
      const memoName = line.MemoLineName ?? line.MemoLine ?? 'Discount Item';
      lineXml += `
          <inv:MemoLineName>${escapeXml(memoName)}</inv:MemoLineName>`;
    } else {
      // ✅ Regular items use ItemNumber
      lineXml += `
          <inv:ItemNumber>${escapeXml(line.ItemNumber)}</inv:ItemNumber>`;
    }

    lineXml += `
          <inv:Description>${escapeXml(line.Description || '')}</inv:Description>
          <inv:Quantity unitCode="${escapeXml(uomCode)}">${Math.abs(line.Quantity || 0)}</inv:Quantity>
          <inv:UnitSellingPrice currencyCode="${escapeXml(lineCurrency)}">${roundAmount(line.UnitSellingPrice)}</inv:UnitSellingPrice>`;

    // SalesOrder (optional but recommended) — sanitised to strip non-ASCII noise
    // (e.g. Arabic "refund" text merged into a return line's order ref).
    const salesOrder = sanitizeSalesOrder(line.SalesOrder);
    if (salesOrder) {
      lineXml += `
          <inv:SalesOrder>${escapeXml(salesOrder)}</inv:SalesOrder>`;
    }
    
    // SalesOrderLine (optional but recommended)
    if (line.SalesOrderLine != null) {
      lineXml += `
          <inv:SalesOrderLine>${line.SalesOrderLine}</inv:SalesOrderLine>`;
    }

    // ✅ Tax code ONLY for regular items (NOT memo lines)
    if (!isDiscount && line.TaxClassificationCode) {
      lineXml += `
          <inv:TaxClassificationCode>${line.TaxClassificationCode}</inv:TaxClassificationCode>`;
    }

    lineXml += `
        </inv:InvoiceLine>`;
    return lineXml;
  }).join('');

  // ✅ CRITICAL: Use inv: namespace for ALL invoice details
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
    xmlns:soapenv="${SOAP_ENV_NS}" 
    xmlns:typ="${AR_INV_TYP_NS}" 
    xmlns:inv="${AR_INV_SVC_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createSimpleInvoice>
      <typ:invoiceHeaderInformation>
        <inv:BillToCustomerName>${escapeXml(payload.BillToCustomerName || '')}</inv:BillToCustomerName>
        <inv:BillToAccountNumber>${sanitizeAccountNumber(payload.BillToCustomerNumber)}</inv:BillToAccountNumber>
        <inv:BillToLocation>${payload.BillToSite || ''}</inv:BillToLocation>
        <inv:BusinessUnit>${payload.BusinessUnit || 'AlQurashi-KSA'}</inv:BusinessUnit>
        <inv:TransactionSource>${payload.TransactionSource || 'Vend'}</inv:TransactionSource>
        <inv:TransactionType>${payload.TransactionType || 'Vend Invoice'}</inv:TransactionType>
        <inv:InvoiceCurrencyCode>${escapeXml(currency)}</inv:InvoiceCurrencyCode>
        <inv:ConversionRateType>Corporate</inv:ConversionRateType>
        <inv:PaymentTermsName>IMMEDIATE</inv:PaymentTermsName>
        <inv:TrxDate>${escapeXml(payload.TransactionDate || '')}</inv:TrxDate>
        <inv:GlDate>${escapeXml(payload.AccountingDate || '')}</inv:GlDate>
${lineXml}
      </typ:invoiceHeaderInformation>
    </typ:createSimpleInvoice>
  </soapenv:Body>
</soapenv:Envelope>`;
}

module.exports = {
  buildStandardReceiptEnvelope,
  buildMiscReceiptEnvelope,
  buildCustomerProfileEnvelope,
  buildArInvoiceSoapEnvelope,
  sanitizeAccountNumber,
  sanitizeSalesOrder,
  mapUomCode,
  CUST_PROFILE_SOAP_ACTION,
  AR_INVOICE_SOAP_ACTION,
};