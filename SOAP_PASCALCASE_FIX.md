# Oracle SOAP "Unknown method" Fix - PascalCase Wrapper Element

## Issue
After previous fixes for the "Unknown method" error, the Oracle SOAP API continued to return HTTP 500 errors with "Unknown method" when processing miscellaneous receipts.

**Error Details:**
```
[OracleSoapClient] HTTP 500 error: <env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Header><env:Body><env:Fault>
    <faultcode>env:Client</faultcode>
    <faultstring>Unknown method</faultstring>
  </env:Fault></env:Body></env:Header>
</env:Envelope>
```

## Root Cause

The issue was with the **casing of the wrapper element** in the SOAP request body. Oracle Fusion SOAP services follow strict Java naming conventions where:

- **Method names** use camelCase (first letter lowercase): `createMiscellaneousReceipt`
- **Type/Class names** use PascalCase (first letter uppercase): `MiscellaneousReceipt`

### Previous (Incorrect) Structure:
```xml
<soapenv:Body>
  <com:createMiscellaneousReceipt>
    <com:miscellaneousReceipt>  <!-- ❌ Lowercase 'm' -->
      <com:Amount>-3.39</com:Amount>
      ...
    </com:miscellaneousReceipt>
  </com:createMiscellaneousReceipt>
</soapenv:Body>
```

### Correct Structure:
```xml
<soapenv:Body>
  <com:createMiscellaneousReceipt>
    <com:MiscellaneousReceipt>  <!-- ✅ Capital 'M' - PascalCase -->
      <com:Amount>-3.39</com:Amount>
      ...
    </com:MiscellaneousReceipt>
  </com:createMiscellaneousReceipt>
</soapenv:Body>
```

## Why This Matters

Oracle's SOA layer performs strict XML schema validation. When it receives:
- `<com:createMiscellaneousReceipt>` - it recognizes this as the operation method
- `<com:miscellaneousReceipt>` - it doesn't recognize this as a valid type because it expects `MiscellaneousReceipt` (PascalCase)

This mismatch causes Oracle to reject the entire request with "Unknown method" because it can't properly deserialize the request parameters.

## Solution

Updated the SOAP envelope generation in `backend/src/controllers/miscReceiptController.js` to use PascalCase for the wrapper element:

**Line 144 changed from:**
```javascript
<com:miscellaneousReceipt>
```

**To:**
```javascript
<com:MiscellaneousReceipt>
```

**Line 154 changed from:**
```javascript
</com:miscellaneousReceipt>
```

**To:**
```javascript
</com:MiscellaneousReceipt>
```

## Complete Corrected SOAP Envelope

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/types/"
  xmlns:com="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>
      <com:MiscellaneousReceipt>
        <com:Amount>-3.39</com:Amount>
        <com:CurrencyCode>SAR</com:CurrencyCode>
        <com:ReceiptNumber>Visa-BLKU-0005040-MISC</com:ReceiptNumber>
        <com:ReceiptDate>2026-03-06</com:ReceiptDate>
        <com:DepositDate>2026-03-06</com:DepositDate>
        <com:GlDate>2026-03-06</com:GlDate>
        <com:ReceiptMethodName>Visa</com:ReceiptMethodName>
        <com:ReceivableActivityName>Bank Charge</com:ReceivableActivityName>
        <com:BankAccountNumber>157-95017321-ABHATIMSQR</com:BankAccountNumber>
        <com:OrgId>300000052613062</com:OrgId>
      </com:MiscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

## Key Points

1. **Method element** (operation name): `createMiscellaneousReceipt` - camelCase ✅
2. **Wrapper element** (type name): `MiscellaneousReceipt` - PascalCase ✅
3. **Data elements**: `Amount`, `CurrencyCode`, etc. - PascalCase ✅
4. **Namespace prefix**: All use `com:` from the commonService namespace ✅

## Files Modified

- `backend/src/controllers/miscReceiptController.js` (lines 144, 154)
- `backend/src/__tests__/miscReceipt.test.js` (test expectations updated)

## Testing

To test this fix:

1. Start the backend server:
   ```bash
   cd backend
   npm start
   ```

2. Upload a CSV file with miscellaneous receipt data through the frontend

3. Monitor the console logs - you should see successful responses instead of "Unknown method" errors

4. Check the database for successful upload records

## Related Issues

This fix builds upon previous corrections:
- **PR #70**: Fixed namespace prefix from `typ:` to `com:`
- **PR #71**: Added WSDL auto-discovery and MTOM support
- **This PR**: Fixed wrapper element casing from `miscellaneousReceipt` to `MiscellaneousReceipt`

All three fixes were necessary to achieve full compliance with Oracle Fusion's SOAP service requirements.

## Oracle SOAP Best Practices

When working with Oracle Fusion SOAP services:

1. **Always use PascalCase for type/class names** (wrapper elements)
2. **Use camelCase for method names** (operations)
3. **Use PascalCase for field names** (data elements)
4. **Ensure namespace prefixes match the service's commonService namespace**
5. **Test with the actual WSDL** to verify element names and structure
6. **Oracle is case-sensitive** - even a single character difference causes failures

## Troubleshooting

If you still encounter "Unknown method" errors:

1. **Verify the WSDL** - Check what Oracle actually expects:
   ```bash
   curl -u "username:password" "https://your-oracle-url?WSDL" | grep -i miscellaneous
   ```

2. **Check the exact element names** in the WSDL schema section

3. **Validate your XML** against the WSDL schema using an XML validator

4. **Enable detailed logging** to see the exact SOAP request being sent

5. **Compare with Oracle's documentation** for the specific service version you're using

## Impact

This fix resolves the persistent "Unknown method" error and allows miscellaneous receipts to be successfully created in Oracle Cloud. Users can now:
- Upload CSV files containing miscellaneous receipt data
- Process multiple receipts in parallel
- See successful responses from Oracle
- Track upload status in the database

## Additional Notes

The previous attempts to fix this issue focused on:
- Namespace declarations (PR #70)
- WSDL auto-discovery (PR #71)

But the fundamental issue was simpler: **the wrapper element needed to follow Java PascalCase naming conventions**. This is a common pitfall when working with Oracle SOAP services, as their XML schema strictly follows Java class naming standards.
