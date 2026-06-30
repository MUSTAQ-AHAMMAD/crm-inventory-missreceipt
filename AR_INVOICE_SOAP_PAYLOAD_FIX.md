# AR Invoice SOAP Payload Structure Fix

## Problem Summary

The AR invoice creation via SOAP API was failing with `ServiceStatus: E` errors due to incorrect payload structure. Oracle was rejecting requests before validating business logic because the SOAP envelope structure didn't match Oracle's expected format.

## Root Causes Identified

1. **Missing Required Fields**: Line items lacked `UomCode`, `CurrencyCode` (per line), and `SalesOrderLine`
2. **Field Name Mismatches**: Payload field names didn't map correctly to Oracle SOAP element names
3. **Payment Terms Capitalization**: Using `IMMEDIATE` instead of `Immediate`
4. **ConversionRateType Handling**: Not conditionally omitted for SAR currency

## Changes Implemented

### 1. SOAP Envelope Builder (`backend/src/services/soapEnvelopeBuilder.js`)

**Field Mapping Corrections:**
- `BillToCustomerNumber` → `<inv:BillToAccountNumber>` (was incorrectly mapped to `BillToLocation`)
- `BillToSite` → `<inv:BillToLocation>` (was missing)
- `PaymentTerms` → `<inv:PaymentTermsName>` (correct mapping confirmed)
- `AccountingDate` → `<inv:GlDate>` (was missing)

**Line-Level Required Fields Added:**
```xml
<inv:UomCode>EA</inv:UomCode>
<inv:CurrencyCode>SAR</inv:CurrencyCode>
<inv:SalesOrderLine>1</inv:SalesOrderLine>
```

**ConversionRateType Logic:**
- Conditionally omit when `InvoiceCurrencyCode = 'SAR'` (ledger currency)
- Oracle rejects this field with error AR-856150 when currency matches ledger

**Returns/Discounts Handling:**
- Support both `MemoLine` and `MemoLineName` fields for discount items
- When `ItemNumber` is empty, use `MemoLineName` instead

### 2. Vend Invoice Controller (`backend/src/controllers/vendInvoiceController.js`)

**Line Item Generation:**
```javascript
// Added to every line item
UomCode: 'EA',
CurrencyCode: 'SAR',
SalesOrderLine: lineNumber,

// For discount items
MemoLineName: 'Discount Item',
MemoLine: 'Discount Item',
```

**Payment Terms:**
```javascript
PaymentTerms: 'Immediate',  // Changed from 'IMMEDIATE'
```

### 3. AR Invoice Controller (`backend/src/controllers/arInvoiceController.js`)

**Validation Updates:**
- Accept `MemoLineName` in addition to `MemoLine` for discount/return items
- Added comments noting that `UomCode`, `CurrencyCode`, and `SalesOrderLine` default to safe values if missing

### 4. Frontend Updates

**ArInvoicePage.jsx:**
- Updated sample payload to include `UomCode`, `CurrencyCode`, `SalesOrderLine`
- Changed `PaymentTerms` from `IMMEDIATE` to `Immediate`

**HelpPage.jsx:**
- Updated field documentation to reflect new requirements

**AR_INVOICE_FEATURE.md:**
- Updated sample payload in documentation

## Corrected Payload Structure

### Header Fields
```json
{
  "BillToCustomerName": "Red Sea Mall",
  "BillToCustomerNumber": "9",
  "BillToSite": "9",
  "BusinessUnit": "AlQurashi-KSA",
  "TransactionSource": "Vend",
  "TransactionType": "Vend Invoice",
  "InvoiceCurrencyCode": "SAR",
  "PaymentTerms": "Immediate",
  "TransactionDate": "2026-06-01",
  "AccountingDate": "2026-06-01"
}
```

**Note:** `ConversionRateType` is omitted when `InvoiceCurrencyCode = 'SAR'`

### Line Item Fields (Regular Items)
```json
{
  "LineNumber": 1,
  "ItemNumber": "6287020283765",
  "Description": "NEW MUSK COLLECTION-3*3 (SFQ)*(SLQ)/ Each",
  "Quantity": 1,
  "UnitSellingPrice": 300,
  "UomCode": "EA",
  "CurrencyCode": "SAR",
  "SalesOrder": "REDSEA/60822",
  "SalesOrderLine": 1,
  "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
}
```

### Line Item Fields (Returns/Discounts)
```json
{
  "LineNumber": 104,
  "MemoLineName": "RETURN",
  "Description": "Return - DIAMOND COLLECTION",
  "Quantity": 1,
  "UnitSellingPrice": -126.09,
  "UomCode": "EA",
  "CurrencyCode": "SAR",
  "SalesOrder": "REDSEA/60786",
  "SalesOrderLine": 104,
  "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
}
```

**Note:** For discount/return items without an `ItemNumber`, use `MemoLineName` field instead.

## SOAP Envelope Structure

The corrected SOAP envelope now generates:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/types/"
  xmlns:inv="http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/"
  xmlns:adf="http://xmlns.oracle.com/adf/svc/types/">
  <soapenv:Header/>
  <soapenv:Body>
    <inv:createSimpleInvoice>
      <inv:invoiceHeader>
        <inv:BillToCustomerName>Red Sea Mall</inv:BillToCustomerName>
        <inv:BillToAccountNumber>9</inv:BillToAccountNumber>
        <inv:BillToLocation>9</inv:BillToLocation>
        <inv:BusinessUnit>AlQurashi-KSA</inv:BusinessUnit>
        <inv:TransactionSource>Vend</inv:TransactionSource>
        <inv:TransactionType>Vend Invoice</inv:TransactionType>
        <inv:InvoiceCurrencyCode>SAR</inv:InvoiceCurrencyCode>
        <!-- ConversionRateType omitted for SAR -->
        <inv:PaymentTermsName>Immediate</inv:PaymentTermsName>
        <inv:TrxDate>2026-06-01</inv:TrxDate>
        <inv:GlDate>2026-06-01</inv:GlDate>
        
        <inv:InvoiceLine>
          <inv:LineNumber>1</inv:LineNumber>
          <inv:ItemNumber>6287020283765</inv:ItemNumber>
          <inv:Description>NEW MUSK COLLECTION-3*3 (SFQ)*(SLQ)/ Each</inv:Description>
          <inv:Quantity>
            <adf:Value>1</adf:Value>
            <adf:UnitCode>EA</adf:UnitCode>
          </inv:Quantity>
          <inv:UomCode>EA</inv:UomCode>
          <inv:UnitSellingPrice>
            <adf:Value>300.00</adf:Value>
            <adf:CurrencyCode>SAR</adf:CurrencyCode>
          </inv:UnitSellingPrice>
          <inv:CurrencyCode>SAR</inv:CurrencyCode>
          <inv:SalesOrder>REDSEA/60822</inv:SalesOrder>
          <inv:SalesOrderLine>1</inv:SalesOrderLine>
          <inv:TaxClassificationCode>OUTPUT-GOODS-DOM-15%</inv:TaxClassificationCode>
        </inv:InvoiceLine>
        
      </inv:invoiceHeader>
    </inv:createSimpleInvoice>
  </soapenv:Body>
</soapenv:Envelope>
```

**Important:** The structure uses `inv:createSimpleInvoice` and `inv:invoiceHeader` (not `typ:createSimpleInvoice` and `typ:invoice`).

## Testing Strategy

1. **Test with Single Invoice First**: Use minimal payload (1-2 line items) to validate structure
2. **Verify Customer/Site Numbers**: Ensure they exist in Oracle before testing
3. **Check UOM Codes**: Confirm 'EA' is valid in your Oracle instance
4. **Tax Classification**: Verify "OUTPUT-GOODS-DOM-15%" exists or adjust to match your setup
5. **Test Returns**: Validate negative amounts work with `MemoLineName`
6. **No Concurrent Testing**: Test sequentially, not in parallel

## Key Takeaways

1. **UomCode, CurrencyCode, SalesOrderLine are REQUIRED** per line item
2. **PaymentTerms must be "Immediate"** (not "IMMEDIATE")
3. **ConversionRateType must be omitted for SAR** (ledger currency)
4. **Field name mapping matters**: `BillToCustomerNumber` → `BillToAccountNumber`, `BillToSite` → `BillToLocation`
5. **Returns/Discounts use MemoLineName** instead of ItemNumber

## Files Modified

1. `backend/src/services/soapEnvelopeBuilder.js` - SOAP envelope generation
2. `backend/src/controllers/vendInvoiceController.js` - Line item generation
3. `backend/src/controllers/arInvoiceController.js` - Validation updates
4. `frontend/src/pages/ArInvoicePage.jsx` - Sample payload
5. `frontend/src/pages/HelpPage.jsx` - Documentation
6. `AR_INVOICE_FEATURE.md` - Feature documentation

## Related Memories

- **AR invoice SOAP API**: Uses `createSimpleInvoice` operation via `buildArInvoiceSoapEnvelope()`
- **ConversionRateType**: Must be omitted when InvoiceCurrencyCode is SAR (ledger currency)
- **SOAP envelope builders**: All in `backend/src/services/soapEnvelopeBuilder.js` (single source of truth)
