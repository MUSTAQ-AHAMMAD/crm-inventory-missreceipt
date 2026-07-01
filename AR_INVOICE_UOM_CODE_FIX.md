# AR Invoice UOM Code Error Fix

## Error Code
`JBO-AR:::AR_INVALID_UOM_CODE`

## Problem Description
Oracle Fusion was rejecting AR invoice SOAP requests with the error code `JBO-AR:::AR_INVALID_UOM_CODE`. This error indicated that the Unit of Measure (UOM) code in the SOAP payload was either missing, invalid, or incorrectly formatted.

## Root Cause Analysis

### Missing SOAP Elements
The SOAP envelope builder (`backend/src/services/soapEnvelopeBuilder.js`) was missing critical standalone XML elements that Oracle requires:
1. `<inv:UomCode>` - Missing after the `<inv:Quantity>` element
2. `<inv:CurrencyCode>` - Missing after the `<inv:UnitSellingPrice>` element

Oracle's SOAP API requires **BOTH**:
- XML **attributes** on parent elements (`unitCode` on `Quantity`, `currencyCode` on `UnitSellingPrice`)
- Separate **child elements** (`<inv:UomCode>`, `<inv:CurrencyCode>`)

### Incorrect Default Value
The default UOM code was set to `'Ea'` (mixed case) instead of `'EA'` (uppercase), and there was no uppercase enforcement for custom UOM codes.

## Changes Implemented

### File Modified
`backend/src/services/soapEnvelopeBuilder.js`

### Specific Changes

#### 1. Default Value and Uppercase Enforcement (Line 172)
**Before:**
```javascript
const uomCode = String(line.UomCode ?? line.UnitOfMeasure ?? line.UOM ?? 'Ea').trim();
```

**After:**
```javascript
const uomCode = String(line.UomCode ?? line.UnitOfMeasure ?? line.UOM ?? 'EA').trim().toUpperCase();
```

Changes:
- Changed default from `'Ea'` to `'EA'`
- Added `.toUpperCase()` to enforce uppercase regardless of input

#### 2. Added Missing SOAP Elements (Lines 196, 198)
**Before:**
```xml
<inv:Quantity unitCode="${escapeXml(uomCode)}">${Math.abs(line.Quantity || 0)}</inv:Quantity>
<inv:UnitSellingPrice currencyCode="${escapeXml(lineCurrency)}">${roundAmount(line.UnitSellingPrice)}</inv:UnitSellingPrice>
```

**After:**
```xml
<inv:Quantity unitCode="${escapeXml(uomCode)}">${Math.abs(line.Quantity || 0)}</inv:Quantity>
<inv:UomCode>${escapeXml(uomCode)}</inv:UomCode>
<inv:UnitSellingPrice currencyCode="${escapeXml(lineCurrency)}">${roundAmount(line.UnitSellingPrice)}</inv:UnitSellingPrice>
<inv:CurrencyCode>${escapeXml(lineCurrency)}</inv:CurrencyCode>
```

Changes:
- Added `<inv:UomCode>` element after `<inv:Quantity>`
- Added `<inv:CurrencyCode>` element after `<inv:UnitSellingPrice>`

## Correct SOAP Structure

### Complete Invoice Line Structure
```xml
<inv:InvoiceLine>
  <inv:LineNumber>1</inv:LineNumber>
  <inv:ItemNumber>TEST123</inv:ItemNumber>
  <inv:Description>Test Item</inv:Description>
  <inv:Quantity unitCode="EA">1</inv:Quantity>
  <inv:UomCode>EA</inv:UomCode>
  <inv:UnitSellingPrice currencyCode="SAR">300.00</inv:UnitSellingPrice>
  <inv:CurrencyCode>SAR</inv:CurrencyCode>
  <inv:SalesOrder>SO123</inv:SalesOrder>
  <inv:SalesOrderLine>1</inv:SalesOrderLine>
  <inv:TaxClassificationCode>OUTPUT-GOODS-DOM-15%</inv:TaxClassificationCode>
</inv:InvoiceLine>
```

### Key Requirements
1. **Quantity Element**: Must include `unitCode` attribute with uppercase UOM code (e.g., "EA")
2. **UomCode Element**: Must be a separate child element with the same uppercase value
3. **UnitSellingPrice Element**: Must include `currencyCode` attribute
4. **CurrencyCode Element**: Must be a separate child element with the same value

## Validation Results
- ✅ Code Review: No issues found
- ✅ CodeQL Security Scan: No alerts
- ✅ Syntax Check: Passed

## References
- Original documentation: `AR_INVOICE_SOAP_PAYLOAD_FIX.md` (lines 163-168)
- Modified file: `backend/src/services/soapEnvelopeBuilder.js` (lines 172, 196, 198)
- Oracle SOAP namespace: `http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/`

## Impact
This fix resolves the `JBO-AR:::AR_INVALID_UOM_CODE` error and ensures all AR invoice SOAP payloads conform to Oracle Fusion's expected structure. The fix applies to:
- All AR invoice creation flows
- Vend invoice processing
- AR pipeline batch processing
- Manual AR invoice submissions

## Testing Recommendations
1. Test AR invoice creation with default UOM code (should use 'EA')
2. Test AR invoice creation with custom UOM codes (should be converted to uppercase)
3. Test AR invoice creation with various currencies
4. Verify Oracle accepts the new SOAP structure without validation errors
