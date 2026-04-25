# HTTP 500: Unknown Method Error Fix

## Issue
Users were receiving the error **"HTTP 500: Unknown method"** when uploading miscellaneous receipts via the SOAP API to Oracle Cloud's MiscellaneousReceiptService.

**Error Details:**
```
Response Message: HTTP 500: Unknown method
Action: createMiscellaneousReceipt
Endpoint: https://ehxk.fa.em2.oraclecloud.com/fscmService/MiscellaneousReceiptService
```

## Root Cause
The SOAP XML request had two issues:

1. **Incorrect namespace prefix**: Using `com:` instead of `typ:` for the operation element
2. **Incorrect casing**: Using lowercase `miscellaneousReceipt` instead of PascalCase `MiscellaneousReceipt` for the wrapper element

The code was initially generating:

```xml
<soapenv:Body>
  <com:createMiscellaneousReceipt>
    <com:miscellaneousReceipt>
      <!-- receipt data -->
    </com:miscellaneousReceipt>
  </com:createMiscellaneousReceipt>
</soapenv:Body>
```

However, Oracle's MiscellaneousReceiptService expects:

```xml
<soapenv:Body>
  <typ:createMiscellaneousReceipt>
    <com:MiscellaneousReceipt>
      <!-- receipt data -->
    </com:MiscellaneousReceipt>
  </typ:createMiscellaneousReceipt>
</soapenv:Body>
```

## Why This Matters
Oracle Fusion's SOAP services are strict about namespace usage:
- The **types namespace** (`typ:`) is used for SOAP operation definitions (method signatures)
- The **common/service namespace** (`com:`) is used for data structures and parameters
- Type/class names must use **PascalCase** following Java naming conventions

Using the wrong namespace or casing causes Oracle's SOA layer to fail to dispatch the method, resulting in the "Unknown method" SOAP fault with HTTP 500 status.

## Solution
Updated `backend/src/controllers/miscReceiptController.js` to use the correct namespace prefix and casing:

**Changed:**
- Operation element: `<com:createMiscellaneousReceipt>` → `<typ:createMiscellaneousReceipt>`
- Wrapper element: `<com:miscellaneousReceipt>` → `<com:MiscellaneousReceipt>`

**Namespaces remain unchanged:**
```javascript
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/types/';
const MISC_COMMON_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';
```

## Corrected SOAP XML Structure

### Complete SOAP Envelope
```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/types/"
  xmlns:com="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>
      <com:MiscellaneousReceipt>
        <com:Amount>-100.00</com:Amount>
        <com:CurrencyCode>SAR</com:CurrencyCode>
        <com:ReceiptNumber>REC001</com:ReceiptNumber>
        <com:ReceiptDate>2024-01-20</com:ReceiptDate>
        <com:DepositDate>2024-01-20</com:DepositDate>
        <com:GlDate>2024-01-20</com:GlDate>
        <com:ReceivableActivityName>Misc Activity</com:ReceivableActivityName>
        <com:BankAccountNumber>123456789</com:BankAccountNumber>
        <com:OrgId>101</com:OrgId>
      </com:MiscellaneousReceipt>
    </typ:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

### Key Points:
1. **Operation element** uses `typ:` namespace: `<typ:createMiscellaneousReceipt>`
2. **Wrapper element** uses `com:` namespace with PascalCase: `<com:MiscellaneousReceipt>`
3. **Data elements** use `com:` namespace with PascalCase: `<com:Amount>`, `<com:CurrencyCode>`, etc.
4. Both `typ` and `com` namespaces are declared and used appropriately per Oracle Fusion standards

## Testing
All tests passed after the fix:
```
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

## Related Fixes
This document has been updated to reflect the final correct implementation. The fix involved multiple iterations:
1. **SOAP_NAMESPACE_FIX.md** - Corrected operation namespace from `com:` to `typ:`
2. **SOAP_PASCALCASE_FIX.md** - Corrected wrapper element from `miscellaneousReceipt` to `MiscellaneousReceipt`
3. Both fixes were necessary to achieve full Oracle Fusion SOAP compliance

Updated test expectations in `backend/src/__tests__/miscReceipt.test.js` to reflect the corrected SOAP structure.

## Files Modified
- `backend/src/controllers/miscReceiptController.js` (lines 119-137)
- `backend/src/__tests__/miscReceipt.test.js` (test expectations updated)

## Impact
This fix resolves the HTTP 500 error and allows miscellaneous receipts to be successfully created in Oracle Cloud. Users can now upload CSV files containing miscellaneous receipt data without encountering the "Unknown method" error.

## Related Issues
This fix follows the pattern established in previous commits:
- Commit `a541cd8`: Fixed undeclared namespace prefix 'typ' (added namespace declarations)
- This commit: Fixed incorrect namespace usage (corrected which prefix to use for the method)

Both fixes were necessary to achieve full compliance with Oracle's SOAP service requirements.
