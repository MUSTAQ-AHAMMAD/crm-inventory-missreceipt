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
        <com:Amount currencyCode="${escapeXml(row.CurrencyCode)}">${escapeXml(row.Amount)}</com:Amount>
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
        <com:Amount currencyCode="${escapeXml(row.CurrencyCode)}">${escapeXml(row.Amount)}</com:Amount>
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

module.exports = {
  buildStandardReceiptEnvelope,
  buildMiscReceiptEnvelope,
  buildCustomerProfileEnvelope,
  CUST_PROFILE_SOAP_ACTION,
};
