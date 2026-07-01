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
 *
 * Sources of truth:
 *   - FusionSOAPClient/src/com/oracle/xmlns/adf/svc/types/AmountType.java
 *   - FusionStdReceiptTransform.java  (Standard)
 *   - FusionMiscReceiptTransform.java (Misc – DepositDate is NOT sent)
 *   - FusionCustomerProfileClient.java (CustomerProfile – getActiveCustomerProfile)
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

// ReceivablesCustomerProfileService (used for getActiveCustomerProfile)
// Source: FusionCustomerProfileClient.java / CustomerProfileService.java
const CUST_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/customers/customerProfileService/types/';
const CUST_SVC_NS   = 'http://xmlns.oracle.com/apps/financials/receivables/customers/customerProfileService/';
/** SOAPAction for getActiveCustomerProfile – used as the second arg to callWithCustomEnvelope */
const CUST_PROFILE_SOAP_ACTION = `${CUST_SVC_NS}getActiveCustomerProfile`;

// RecInvoiceService (AR Invoice createSimpleInvoice)
const AR_INV_TYP_NS = 'http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/types/';
const AR_INV_SVC_NS = 'http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/';
const AR_INV_ADF_NS = 'http://xmlns.oracle.com/adf/svc/types/';
/** SOAPAction for createSimpleInvoice – used as the second arg to callWithCustomEnvelope */
const AR_INVOICE_SOAP_ACTION = 'createSimpleInvoice';

// ── Helpers ────────────────────────────────────────────────────────────────────

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
 * Rounds a numeric value to 2 decimal places for currency amounts.
 * Handles strings and numbers. Returns the value as a string with 2 decimal places.
 * 
 * Note: This function assumes the value has already been validated as non-null
 * by the calling envelope builder's required field checks.
 * 
 * @param {string|number} value - The value to round (should be non-null)
 * @returns {string} The rounded value as a string with 2 decimal places
 * @throws {Error} If the value cannot be converted to a valid number
 */
function roundAmount(value) {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`Invalid numeric value for amount: "${value}"`);
  }
  return (Math.round(num * 100) / 100).toFixed(2);
}

// ── Standard Receipt ───────────────────────────────────────────────────────────

/**
 * Builds a createStandardReceipt SOAP envelope.
 *
 * Required row fields:
 *   ReceiptNumber, ReceiptDate, Amount, CurrencyCode,
 *   ReceiptMethodId, RemittanceBankAccountId, CustomerId, OrgId
 *
 * Mirrors Java FusionStdReceiptTransform.mapStdReceiptModel().
 */
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

/**
 * Builds a createMiscellaneousReceipt SOAP envelope.
 *
 * Required row fields:
 *   Amount, CurrencyCode, ReceiptNumber, ReceiptDate,
 *   GlDate, ReceivableActivityName, BankAccountName, OrgId
 *
 * Optional row fields:
 *   ReceiptMethodName  (omitted from envelope when falsy)
 *
 * NOTE: DepositDate is intentionally NOT included — Java
 * FusionMiscReceiptTransform does not set it.
 *
 * Mirrors Java FusionMiscReceiptTransform.mapMiscReceiptModel().
 */
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

// ── Customer Profile (getActiveCustomerProfile) ────────────────────────────────

/**
 * Builds a getActiveCustomerProfile SOAP envelope for ReceivablesCustomerProfileService.
 *
 * Mirrors Java FusionCustomerProfileClient.getCustomerAccountId(accountNumber):
 *   customerProfile.setAccountNumber(createCustomerProfileAccountNumber(accountNumber));
 *   customerProfileService.getActiveCustomerProfile(customerProfile);
 *
 * The SOAPAction header must be CUST_PROFILE_SOAP_ACTION (exported below).
 *
 * @param {string|number} accountNumber - Oracle AR customer account number
 */
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

// ── AR Invoice (RecInvoiceService / createSimpleInvoice) ───────────────────────

/**
 * Wraps an optional string value in an XML tag only when value is non-empty.
 * Used by buildArInvoiceSoapEnvelope.
 */
function optionalTag(ns, tag, value) {
  if (value == null || String(value).trim() === '') return '';
  return `        <${ns}:${tag}>${escapeXml(String(value).trim())}</${ns}:${tag}>\n`;
}

/**
 * Builds a createSimpleInvoice SOAP envelope for Oracle RecInvoiceService.
 *
 * CORRECT STRUCTURE (verified working - created invoice #2678575):
 *   Root: typ:createSimpleInvoice → typ:invoiceHeaderInformation
 *
 * Oracle field mappings:
 *   BillToCustomerName     → BillToCustomerName
 *   BillToCustomerNumber   → BillToAccountNumber   (payload field name)
 *   BillToSite             → BillToLocation        (payload field name)
 *   BusinessUnit           → BusinessUnit
 *   TransactionSource      → TransactionSource
 *   TransactionType        → TransactionType
 *   InvoiceCurrencyCode    → InvoiceCurrencyCode
 *   ConversionRateType     → ConversionRateType    (ALWAYS included, defaults to "Corporate")
 *   PaymentTerms           → PaymentTermsName      (payload field name, UPPERCASE recommended)
 *   TransactionDate        → TrxDate
 *   AccountingDate         → GlDate                (payload field name)
 *
 * Line fields (REQUIRED by Oracle):
 *   LineNumber, ItemNumber (or MemoLineName for discounts/returns),
 *   Description, Quantity (with unitCode attribute),
 *   UnitSellingPrice (with currencyCode attribute),
 *   SalesOrder, SalesOrderLine, TaxClassificationCode
 *
 * @param {object} payload - AR Invoice payload with header + receivablesInvoiceLines
 */
function buildArInvoiceSoapEnvelope(payload) {
  const lines    = payload.receivablesInvoiceLines || [];
  const currency = payload.InvoiceCurrencyCode || 'SAR';

  const lineXml = lines.map((line) => {
    // UomCode: required per-line UOM (defaults to 'Ea' - capitalized)
    const uomCode       = String(line.UomCode ?? line.UnitOfMeasure ?? line.UOM ?? 'Ea').trim();
    // CurrencyCode: required per-line currency (defaults to header currency)
    const lineCurrency  = String(line.CurrencyCode ?? currency).trim();
    
    const isDiscount    = !line.ItemNumber || String(line.ItemNumber).trim() === '';
    const itemTag       = isDiscount ? '' : `          <typ:ItemNumber>${escapeXml(line.ItemNumber)}</typ:ItemNumber>\n`;
    const memoTag       = isDiscount ? `          <typ:MemoLineName>${escapeXml(line.MemoLineName ?? line.MemoLine ?? 'Discount Item')}</typ:MemoLineName>\n` : '';
    const soTag         = line.SalesOrder     ? `          <typ:SalesOrder>${escapeXml(line.SalesOrder)}</typ:SalesOrder>\n`                 : '';
    const solTag        = line.SalesOrderLine != null ? `          <typ:SalesOrderLine>${escapeXml(line.SalesOrderLine)}</typ:SalesOrderLine>\n` : '';

    return `        <typ:InvoiceLine>
          <typ:LineNumber>${escapeXml(line.LineNumber)}</typ:LineNumber>
${itemTag}${memoTag}          <typ:Description>${escapeXml(line.Description)}</typ:Description>
          <typ:Quantity unitCode="${escapeXml(uomCode)}">${escapeXml(line.Quantity)}</typ:Quantity>
          <typ:UnitSellingPrice currencyCode="${escapeXml(lineCurrency)}">${escapeXml(roundAmount(line.UnitSellingPrice))}</typ:UnitSellingPrice>
${soTag}${solTag}          <typ:TaxClassificationCode>${escapeXml(line.TaxClassificationCode)}</typ:TaxClassificationCode>
        </typ:InvoiceLine>`;
  }).join('\n');

  // ConversionRateType: Always include, defaults to "Corporate"
  // (Previous implementation incorrectly omitted this for SAR)
  const conversionRateType = payload.ConversionRateType || 'Corporate';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"
  xmlns:typ="${AR_INV_TYP_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createSimpleInvoice>
      <typ:invoiceHeaderInformation>
        ${optionalTag('typ', 'BillToCustomerName',   payload.BillToCustomerName)}
        ${optionalTag('typ', 'BillToAccountNumber',  payload.BillToCustomerNumber)}
        ${optionalTag('typ', 'BillToLocation',       payload.BillToSite)}
        ${optionalTag('typ', 'BusinessUnit',         payload.BusinessUnit)}
        ${optionalTag('typ', 'TransactionSource',    payload.TransactionSource)}
        ${optionalTag('typ', 'TransactionType',      payload.TransactionType)}
        <typ:InvoiceCurrencyCode>${escapeXml(currency)}</typ:InvoiceCurrencyCode>
        <typ:ConversionRateType>${escapeXml(conversionRateType)}</typ:ConversionRateType>
        ${optionalTag('typ', 'PaymentTermsName',     payload.PaymentTerms)}
        <typ:TrxDate>${escapeXml(payload.TransactionDate)}</typ:TrxDate>
        ${optionalTag('typ', 'GlDate', payload.AccountingDate)}
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
  CUST_PROFILE_SOAP_ACTION,
  AR_INVOICE_SOAP_ACTION,
};
