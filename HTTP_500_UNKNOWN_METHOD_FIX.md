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
The SOAP XML request was using the incorrect namespace prefix for the method element. The code was generating:

```xml
<soapenv:Body>
  <typ:createMiscellaneousReceipt>
    <typ:miscellaneousReceipt>
      <!-- receipt data -->
    </typ:miscellaneousReceipt>
  </typ:createMiscellaneousReceipt>
</soapenv:Body>
```

However, Oracle's MiscellaneousReceiptService expects the method to use the **common service namespace** (`com:`) instead of the types namespace (`typ:`):

```xml
<soapenv:Body>
  <com:createMiscellaneousReceipt>
    <com:miscellaneousReceipt>
      <!-- receipt data -->
    </com:miscellaneousReceipt>
  </com:createMiscellaneousReceipt>
</soapenv:Body>
```

## Why This Matters
Oracle Fusion's SOAP services are strict about namespace usage:
- The **types namespace** (`typ:`) is used for operation parameters and request/response structures
- The **common/service namespace** (`com:`) is used for the actual SOAP operation method itself

Using the wrong namespace causes Oracle's SOA layer to fail to dispatch the method, resulting in the "Unknown method" SOAP fault with HTTP 500 status.

This pattern is consistent with other Oracle SOAP services in the codebase. For example, in `applyReceiptController.js`, the `applyReceipt` method correctly uses the `typ:` namespace because that service's structure differs from the MiscellaneousReceiptService.

## Solution
Updated `backend/src/controllers/miscReceiptController.js` to use the correct namespace prefix:

**Changed:**
- Method element: `<typ:createMiscellaneousReceipt>` → `<com:createMiscellaneousReceipt>`
- Wrapper element: `<typ:miscellaneousReceipt>` → `<com:miscellaneousReceipt>`

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
    <com:createMiscellaneousReceipt>
      <com:miscellaneousReceipt>
        <com:Amount>-100.00</com:Amount>
        <com:CurrencyCode>SAR</com:CurrencyCode>
        <com:ReceiptNumber>REC001</com:ReceiptNumber>
        <com:ReceiptDate>2024-01-20</com:ReceiptDate>
        <com:DepositDate>2024-01-20</com:DepositDate>
        <com:GlDate>2024-01-20</com:GlDate>
        <com:ReceivableActivityName>Misc Activity</com:ReceivableActivityName>
        <com:BankAccountNumber>123456789</com:BankAccountNumber>
        <com:OrgId>101</com:OrgId>
      </com:miscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

### Key Points:
1. **Method element** uses `com:` namespace: `<com:createMiscellaneousReceipt>`
2. **Wrapper element** uses `com:` namespace: `<com:miscellaneousReceipt>`
3. **Data elements** use `com:` namespace: `<com:Amount>`, `<com:CurrencyCode>`, etc.
4. Both `typ` and `com` namespaces are declared in the envelope but only `com` is actively used in the body

## Testing
All tests passed after the fix:
```
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

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
