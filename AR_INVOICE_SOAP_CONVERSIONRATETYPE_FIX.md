# AR Invoice SOAP ConversionRateType Fix

## Issue Description

All AR invoice creations were failing with the error:
```
Failure in SDOSerializer.deserialize
```

This error appeared for all 3 invoices in the AR Pipeline:
- Red Sea Mall (428 lines)
- Nakhla IT Systems (LLC) Tamara (5 lines)  
- Tabby Saudi For communication and IT (29 lines)

## Root Cause

The SOAP envelope builder (`backend/src/services/soapEnvelopeBuilder.js`) was **incorrectly always including** the `ConversionRateType` field in SOAP requests, even when the invoice currency was SAR (Saudi Riyal).

Oracle Fusion rejects the `ConversionRateType` field when the invoice currency matches the ledger currency (SAR), returning the cryptic error **"Failure in SDOSerializer.deserialize"**. This is Oracle error code **AR-856150**.

### The Bug

```javascript
// INCORRECT CODE (before fix)
const conversionRateType = payload.ConversionRateType || 'Corporate';
...
<typ:ConversionRateType>${escapeXml(conversionRateType)}</typ:ConversionRateType>
```

This always included `ConversionRateType` in the SOAP envelope, causing Oracle to reject SAR-currency invoices.

## Solution

Modified `buildArInvoiceSoapEnvelope()` in `backend/src/services/soapEnvelopeBuilder.js` to **conditionally omit** `ConversionRateType` when the currency is SAR:

```javascript
// CORRECT CODE (after fix)
const isSAR = currency.toUpperCase() === 'SAR';
const conversionRateTypeTag = isSAR 
  ? '' 
  : `        <typ:ConversionRateType>${escapeXml(payload.ConversionRateType || 'Corporate')}</typ:ConversionRateType>\n`;
```

### Behavior After Fix

| Currency | ConversionRateType | Reason |
|----------|-------------------|--------|
| SAR | **Omitted** | SAR is the ledger currency; Oracle rejects this field (AR-856150) |
| USD, EUR, etc. | **Included** (defaults to "Corporate") | Non-ledger currencies require conversion rate type |

## Testing

Verified the fix with test payloads:

### Test 1: SAR Currency
```xml
<typ:InvoiceCurrencyCode>SAR</typ:InvoiceCurrencyCode>
<!-- ConversionRateType correctly omitted -->
<typ:PaymentTermsName>Immediate</typ:PaymentTermsName>
```
✅ **Result**: ConversionRateType correctly omitted

### Test 2: USD Currency
```xml
<typ:InvoiceCurrencyCode>USD</typ:InvoiceCurrencyCode>
<typ:ConversionRateType>Corporate</typ:ConversionRateType>
<typ:PaymentTermsName>Immediate</typ:PaymentTermsName>
```
✅ **Result**: ConversionRateType correctly included

## Files Changed

1. **`backend/src/services/soapEnvelopeBuilder.js`** - Fixed `buildArInvoiceSoapEnvelope()` function
2. **`AR_INVOICE_SOAP_STRUCTURE_FIX.md`** - Updated documentation to clarify conditional behavior

## How to Apply the Fix

1. **Pull the latest changes** from the repository
2. **Restart the backend server**:
   ```bash
   # Stop the current backend
   # Then restart it
   cd backend
   npm start
   ```
3. **Retry your AR invoice creation** in the AR Pipeline page

The "Failure in SDOSerializer.deserialize" errors should now be resolved.

## Related Issues

This fix resolves the conflict between two pieces of documentation:
- `AR_INVOICE_SOAP_PAYLOAD_FIX.md` (older) - correctly stated ConversionRateType should be omitted for SAR
- `AR_INVOICE_SOAP_STRUCTURE_FIX.md` (newer) - incorrectly stated ConversionRateType should always be included

The correct behavior (now implemented) matches the REST API behavior in `arInvoiceDataController.js`, which also conditionally omits `ConversionRateType` for SAR invoices.

## Memory Updated

- ❌ **Downvoted incorrect memory**: "ConversionRateType always included"
- ✅ **Created correct memory**: "ConversionRateType conditionally omitted for SAR to avoid AR-856150 error"

## Oracle Error Reference

- **Error Code**: AR-856150
- **Error Message**: "Failure in SDOSerializer.deserialize"
- **Cause**: ConversionRateType provided when invoice currency matches ledger currency
- **Solution**: Omit ConversionRateType field from SOAP envelope when currency is SAR
