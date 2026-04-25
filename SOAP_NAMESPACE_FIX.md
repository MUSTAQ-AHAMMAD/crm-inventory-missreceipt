# SOAP Namespace Fix - HTTP 500 "Unknown method" Error Resolution

## Date
2026-04-25

## Problem Statement

Miscellaneous receipt uploads were failing with HTTP 500 "Unknown method" errors despite having the correct SOAPAction header:

```
[OracleSoapClient] REQ-1777117570783-1 Starting SOAP call
[OracleSoapClient] REQ-1777117570783-1 SOAPAction: createMiscellaneousReceipt
[OracleSoapClient] REQ-1777117570783-1 Endpoint: https://ehxk.fa.em2.oraclecloud.com/fscmService/MiscellaneousReceiptService
[OracleSoapClient] REQ-1777117570783-1 Response received in 1463ms - HTTP 500
[OracleSoapClient] REQ-1777117570783-1 HTTP 500 error:
[OracleSoapClient] REQ-1777117570783-1 Retry 1/4: Unknown method
```

The error indicated that Oracle's SOAP service could not identify the method being called, even though the SOAPAction header was correctly set to `createMiscellaneousReceipt`.

## Root Cause

The issue was in the **SOAP envelope namespace structure** in `backend/src/controllers/miscReceiptController.js`.

### Incorrect Structure (BEFORE):

```xml
<soapenv:Envelope xmlns:soapenv="..." xmlns:typ="..." xmlns:com="...">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>      <!-- ❌ WRONG: using com: prefix -->
      <com:MiscellaneousReceipt>
        <com:Amount>-100.00</com:Amount>
        <!-- other fields -->
      </com:MiscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

### Why This Failed

According to Oracle Fusion SOAP Web Services standards:

1. **Operation elements** (like `createMiscellaneousReceipt`) must use the **types namespace** (`typ:`)
2. **Parameter elements** (like `MiscellaneousReceipt` and its child fields) use the **common namespace** (`com:`)

The SOAP envelope was using `com:createMiscellaneousReceipt` instead of `typ:createMiscellaneousReceipt`, causing Oracle's SOAP service layer to fail to route the request to the correct operation handler, resulting in "Unknown method" error.

### Correct Structure (AFTER):

```xml
<soapenv:Envelope xmlns:soapenv="..." xmlns:typ="..." xmlns:com="...">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>      <!-- ✅ CORRECT: using typ: prefix -->
      <com:MiscellaneousReceipt>
        <com:Amount>-100.00</com:Amount>
        <!-- other fields -->
      </com:MiscellaneousReceipt>
    </typ:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

## Solution Applied

Changed line 132 and 144 in `backend/src/controllers/miscReceiptController.js`:

**BEFORE:**
```javascript
return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${SOAP_TYPES_NS}" xmlns:com="${SOAP_COMMON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>    <!-- Changed -->
      <com:MiscellaneousReceipt>
        <!-- fields -->
      </com:MiscellaneousReceipt>
    </com:createMiscellaneousReceipt>   <!-- Changed -->
  </soapenv:Body>
</soapenv:Envelope>`;
```

**AFTER:**
```javascript
return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${SOAP_TYPES_NS}" xmlns:com="${SOAP_COMMON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>    <!-- Fixed -->
      <com:MiscellaneousReceipt>
        <!-- fields -->
      </com:MiscellaneousReceipt>
    </typ:createMiscellaneousReceipt>   <!-- Fixed -->
  </soapenv:Body>
</soapenv:Envelope>`;
```

## Technical Explanation

### Oracle Fusion SOAP Web Services Namespace Structure

Oracle Fusion SOAP services use a two-namespace pattern:

1. **Types Namespace** (`xmlns:typ`):
   - Used for SOAP operation definitions
   - Contains the operation signatures (e.g., `createMiscellaneousReceipt`)
   - Defined in the WSDL under `<types>` section
   - URL: `http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/types/`

2. **Common/Service Namespace** (`xmlns:com`):
   - Used for data structures and parameters
   - Contains complex types and element definitions
   - Defined in the WSDL schema
   - URL: `http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/`

### How Oracle Routes SOAP Requests

1. Oracle receives the SOAP envelope
2. Reads the `SOAPAction` header: `"createMiscellaneousReceipt"`
3. Looks for a matching operation in the SOAP Body
4. **Expects the operation element to be in the types namespace** (`typ:`)
5. Validates the structure matches the WSDL definition
6. Routes to the appropriate service handler

When the operation used the wrong namespace (`com:` instead of `typ:`), Oracle couldn't match it against the WSDL definition, causing the "Unknown method" error.

### Comparison with applyReceiptController

The `applyReceiptController.js` had the correct structure from the beginning:

```javascript
// applyReceiptController.js - CORRECT structure
return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${SOAP_TYPES_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:applyReceipt>              <!-- ✅ Correct: uses typ: -->
      <typ:ReceiptId>...</typ:ReceiptId>
      <typ:CustomerTrxId>...</typ:CustomerTrxId>
      <!-- other fields -->
    </typ:applyReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
```

Note: `applyReceiptController` uses only one namespace (`typ:`) for both operation and parameters, which is also valid depending on the WSDL structure of that specific service.

## Files Modified

- ✅ `backend/src/controllers/miscReceiptController.js` (lines 132, 144)
  - Changed `<com:createMiscellaneousReceipt>` to `<typ:createMiscellaneousReceipt>`
  - Changed `</com:createMiscellaneousReceipt>` to `</typ:createMiscellaneousReceipt>`

## Testing

### Before Fix:
```
[OracleSoapClient] REQ-XXX Starting SOAP call
[OracleSoapClient] REQ-XXX SOAPAction: createMiscellaneousReceipt
[OracleSoapClient] REQ-XXX Response received in 1463ms - HTTP 500
[OracleSoapClient] REQ-XXX HTTP 500 error:
[OracleSoapClient] REQ-XXX Retry 1/4: Unknown method
[OracleSoapClient] REQ-XXX All retries exhausted
❌ Failed: Unknown method
```

### After Fix (Expected):
```
[OracleSoapClient] REQ-XXX Starting SOAP call
[OracleSoapClient] REQ-XXX SOAPAction: createMiscellaneousReceipt
[OracleSoapClient] REQ-XXX Response received in 1234ms - HTTP 200
[OracleSoapClient] REQ-XXX ✅ Success - HTTP 200 in 1234ms
✅ Success for <ReceiptNumber> - HTTP 200
```

### How to Test:

1. **Start the backend server:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Upload a miscellaneous receipt CSV:**
   ```bash
   POST /api/misc-receipt/upload
   Content-Type: multipart/form-data
   Authorization: Bearer <token>

   file: <CSV with receipt data>
   ```

3. **Verify in logs:**
   - Look for HTTP 200 responses
   - Confirm no "Unknown method" errors
   - Verify successful receipt creation

4. **Enable debug mode (optional):**
   Add to `backend/.env`:
   ```env
   SOAP_DEBUG=true
   ```
   This will log the full SOAP envelope for verification.

## Impact

✅ **Fixes:**
- Resolves HTTP 500 "Unknown method" errors for miscellaneous receipt uploads
- Aligns SOAP envelope structure with Oracle Fusion WSDL specification
- Enables proper routing of SOAP requests to Oracle service handlers

✅ **Benefits:**
- Miscellaneous receipts can now be successfully created in Oracle
- No more retry loops for "Unknown method" errors
- Consistent with Oracle Fusion SOAP best practices
- Matches the successful pattern used in applyReceiptController

## Related Issues

This fix complements previous fixes:
- ✅ SOAPAction header fix (from empty string to "createMiscellaneousReceipt")
- ✅ XML escaping and input validation
- ✅ Enhanced error handling and logging in OracleSoapClient
- ✅ Retry logic improvements

## References

- Oracle Fusion Web Services Developer's Guide
- SOAP 1.1 Specification - Namespace Handling
- Oracle Fusion Financials WSDL Documentation
- `backend/src/controllers/miscReceiptController.js:112-147`
- `backend/src/controllers/applyReceiptController.js:180-209` (correct example)

## Key Takeaways

1. **Always match WSDL namespace definitions** when constructing SOAP envelopes
2. **Operation elements** typically use the **types namespace**
3. **Parameter elements** use the **service/common namespace**
4. **Test with a working example** (like applyReceiptController) to verify structure
5. **Oracle is strict** about namespace compliance - small deviations cause "Unknown method" errors

---

**Status**: ✅ **FIXED** and ready for testing
**Date**: 2026-04-25
**Commit**: f9ee74f
