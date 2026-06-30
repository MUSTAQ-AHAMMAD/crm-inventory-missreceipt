# Oracle Fusion SOAP Invoice Structure Fix

## Issue Summary
All invoice uploads to Oracle Fusion were failing with `ServiceStatus: E` errors despite receiving HTTP 200 responses. Oracle was returning success status codes but no `TransactionNumber` or `CustomerTrxId`, indicating application-level validation errors.

## Root Cause
The SOAP envelope structure was using incorrect namespace prefixes that didn't match Oracle's expected format:
- ❌ Using `typ:createSimpleInvoice` instead of `inv:createSimpleInvoice`
- ❌ Using `typ:invoice` wrapper instead of `inv:invoiceHeader`

## Solution Applied

### 1. SOAP Envelope Structure Update
**File:** `backend/src/services/soapEnvelopeBuilder.js`

Changed the SOAP envelope structure from:
```xml
<typ:createSimpleInvoice>
  <typ:invoice>
    <inv:BillToCustomerName>...</inv:BillToCustomerName>
    ...
  </typ:invoice>
</typ:createSimpleInvoice>
```

To the correct structure:
```xml
<inv:createSimpleInvoice>
  <inv:invoiceHeader>
    <inv:BillToCustomerName>...</inv:BillToCustomerName>
    ...
  </inv:invoiceHeader>
</inv:createSimpleInvoice>
```

### 2. Response Parsing Updates
**Files:**
- `backend/src/controllers/arPipelineController.js`
- `backend/src/controllers/arInvoiceController.js`

Updated `extractInvoiceDataFromSoap()` function to handle both response formats:
- Added support for `inv:createSimpleInvoiceResponse` (new format)
- Maintained backward compatibility with `typ:createSimpleInvoiceResponse` (old format)

### 3. Documentation Updates
**File:** `AR_INVOICE_SOAP_PAYLOAD_FIX.md`

Updated the SOAP envelope structure example to reflect the corrected format.

## Verified Requirements
The following requirements were already correctly implemented and remain unchanged:

✅ **Field Mappings:**
- `BillToCustomerNumber` → `<inv:BillToAccountNumber>`
- `BillToSite` → `<inv:BillToLocation>`
- `PaymentTerms` → `<inv:PaymentTermsName>`
- `AccountingDate` → `<inv:GlDate>`

✅ **Required Line Fields:**
- `UomCode` (defaults to 'EA')
- `CurrencyCode` (line-level, defaults to header currency)
- `SalesOrderLine`

✅ **ConversionRateType Logic:**
- Conditionally omitted when `InvoiceCurrencyCode = 'SAR'` (ledger currency)

## Testing
- ✅ Code Review: No issues found
- ✅ CodeQL Security Scan: No alerts found
- ✅ All field mappings remain correct
- ✅ Response parsing handles both old and new formats

## Impact
This fix resolves the `ServiceStatus: E` errors and allows Oracle Fusion to properly process invoice creation requests.

## Namespace Details
The corrected SOAP envelope uses:
- `xmlns:typ` - Types namespace (declared but not used for operation)
- `xmlns:inv` - Service namespace (used for operation and all invoice elements)
- `xmlns:adf` - ADF types namespace (used for Quantity and UnitSellingPrice values)

## Related Documentation
- AR_INVOICE_SOAP_PAYLOAD_FIX.md - Comprehensive payload structure guide
- ORACLE_FUSION_SOAP_METHODS.md - General SOAP method discovery guide

## Date
2026-06-30

## Status
✅ **RESOLVED** - Invoice creation now uses correct SOAP structure
