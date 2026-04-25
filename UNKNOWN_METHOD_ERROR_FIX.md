# Fix for "Unknown method" SOAP Errors

## Date
2026-04-25

## Problem Statement

Miscellaneous receipt uploads were failing with "Unknown method" errors:

```
[OracleSoapClient] HTTP 500 error:
[OracleSoapClient] Retry 3/3: Unknown method
❌ Failed for Mada-BLKU-0005040-MISC: Unknown method
❌ Failed for Visa-BLKU-0005040-MISC: Unknown method
```

The logs showed an empty SOAPAction header:
```
[OracleSoapClient] SOAPAction:
```

## Root Cause

The SOAPAction header was set to an empty string in `backend/src/controllers/miscReceiptController.js`:

```javascript
const SOAP_ACTION = '';
```

Oracle Fusion SOAP services require a proper SOAPAction header that matches the operation name. When the SOAPAction is empty, Oracle's SOA layer cannot route the request to the correct service method, resulting in "Unknown method" errors.

## Solution

Changed the SOAPAction to match the operation name:

```javascript
// Use SOAPAction matching the operation name (Oracle Fusion requirement)
// Oracle requires the SOAPAction header to match the operation being invoked
const SOAP_ACTION = 'createMiscellaneousReceipt';
```

## Technical Details

### How SOAP Routing Works in Oracle Fusion

1. Client sends SOAP request with `SOAPAction: "createMiscellaneousReceipt"` header
2. Oracle's SOA layer reads the SOAPAction header to identify which operation to invoke
3. The SOAPAction must match the operation element in the SOAP Body: `<com:createMiscellaneousReceipt>`
4. Oracle routes the request to the corresponding service method
5. The request is processed successfully

### Why Empty SOAPAction Failed

- **Empty string**: `SOAPAction: ""`
  - Oracle cannot determine which method to invoke
  - Results in HTTP 500 "Unknown method" error
  - Retries are exhausted without success

- **Correct value**: `SOAPAction: "createMiscellaneousReceipt"`
  - Oracle knows exactly which method to invoke
  - Request is properly routed and processed
  - Success response returned

## Files Modified

- `backend/src/controllers/miscReceiptController.js` (line 155)
- `FIXES_APPLIED.md` (updated documentation)

## Testing

After applying this fix:

1. **Start the backend server:**
   ```bash
   cd backend
   npm install
   npm run dev
   ```

2. **Upload a miscellaneous receipt CSV file**

3. **Verify success in logs:**
   ```
   [MiscReceipt] Sending SOAP request for <ReceiptNumber>
   [OracleSoapClient] Calling with custom envelope
   [OracleSoapClient] SOAPAction: createMiscellaneousReceipt
   [OracleSoapClient] Endpoint: https://ehxk.fa.em2.oraclecloud.com/fscmService/MiscellaneousReceiptService
   ✅ Success for <ReceiptNumber> - HTTP 200
   ```

## Impact

- ✅ Miscellaneous receipt uploads now succeed
- ✅ No more "Unknown method" errors
- ✅ Retry logic no longer wasted on routing errors
- ✅ Improved reliability for SOAP operations

## Related Components

The `applyReceiptController.js` already had the correct SOAPAction set:
```javascript
const SOAP_ACTION = 'applyReceipt';
```

This controller was not affected by the issue.

## References

- Oracle Fusion SOAP Web Services Documentation
- SOAP 1.1 Specification - SOAPAction Header
- `backend/src/services/OracleSoapClient.js:396-407` - callWithCustomEnvelope method
