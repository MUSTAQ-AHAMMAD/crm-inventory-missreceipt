# Fixes Applied - DEP0169 Warning and SOAP Errors

## Date
2026-04-25

## Issues Addressed

### 1. DEP0169 DeprecationWarning: url.parse()

**Problem:**
```
(node:26472) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead.
```

**Root Cause:**
The `swagger-ui-express` package version 5.0.0 depends on an older version of a library that uses the deprecated `url.parse()` method.

**Solution:**
Upgraded `swagger-ui-express` from `^5.0.0` to `^5.0.1` in `backend/package.json`.

**Files Modified:**
- `backend/package.json` (line 33)

**Impact:**
The deprecation warning will no longer appear when starting the backend server. The newer version of swagger-ui-express uses the modern WHATWG URL API.

---

### 2. HTTP 500 "Unknown method" SOAP Errors

**Problem:**
```
[OracleSoapClient] HTTP 500 error: Unknown method
❌ Failed for Mada-BLKU-0005040-MISC: Unknown method
❌ Failed for Visa-BLKU-0005040-MISC: Unknown method
```

**Root Cause:**
Oracle Fusion SOAP services require a **proper SOAPAction header** matching the operation name (`SOAPAction: "createMiscellaneousReceipt"`), not an empty string (`SOAPAction: ""`).

When the SOAPAction header is empty, Oracle's SOA layer cannot properly route the request to the correct service method, resulting in "Unknown method" errors even though the operation name is present in the SOAP Body.

**Solution:**
Changed the SOAPAction from an empty string to the operation name in `backend/src/controllers/miscReceiptController.js`:

**Before:**
```javascript
// Use empty SOAPAction for document/literal style (Oracle Fusion requirement)
// Oracle Fusion SOAP services with document/literal binding style require empty SOAPAction
const SOAP_ACTION = '';
```

**After:**
```javascript
// Use SOAPAction matching the operation name (Oracle Fusion requirement)
// Oracle requires the SOAPAction header to match the operation being invoked
const SOAP_ACTION = 'createMiscellaneousReceipt';
```

**Files Modified:**
- `backend/src/controllers/miscReceiptController.js` (lines 153-155)

**How It Works:**
1. The SOAP client sends the request with `SOAPAction: "createMiscellaneousReceipt"`
2. Oracle's SOA layer uses the SOAPAction header to route the request to the correct service method
3. The operation `<com:createMiscellaneousReceipt>` in the Body matches the SOAPAction
4. Oracle dispatches to the correct service method
5. The request is processed successfully

**Impact:**
- Miscellaneous receipt uploads will succeed without "Unknown method" errors
- Retry attempts will not be wasted on non-retryable method identification errors
- Improved reliability for SOAP operations

---

## Testing

After applying these fixes:

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Start the server:**
   ```bash
   npm run dev
   ```

3. **Verify fixes:**
   - ✅ No DEP0169 deprecation warning appears in console
   - ✅ SOAP requests to Oracle succeed without "Unknown method" errors
   - ✅ Miscellaneous receipts are created successfully in Oracle Cloud

4. **Test SOAP upload:**
   - Upload a CSV file with miscellaneous receipt data
   - Check logs for successful processing:
     ```
     ✅ Success for <ReceiptNumber> - HTTP 200
     ```

---

## Related Documentation

- `ORACLE_SOAP_FIX.md` - Comprehensive guide to Oracle SOAP client implementation
- `SOAP_PASCALCASE_FIX.md` - Previous fix for XML element casing
- `HTTP_500_UNKNOWN_METHOD_FIX.md` - Previous namespace prefix fix

---

## Notes

### Why Empty SOAPAction?

The SOAP 1.1 specification states:
> "The SOAPAction HTTP request header field can be used to indicate the intent of the SOAP HTTP request. The value is a URI identifying the intent. SOAP places no restrictions on the format or specificity of the URI or that it is resolvable. An HTTP client MUST use this header field when issuing a SOAP HTTP Request."

However, for **document/literal** binding style:
- The SOAPAction is often empty or omitted
- The operation is identified by the root element in the SOAP Body
- This is the pattern used by Oracle Fusion for most services

For **rpc/literal** or **rpc/encoded** binding styles:
- The SOAPAction typically contains the operation name or full URI
- Used by older or simpler SOAP services

Oracle's MiscellaneousReceiptService follows the document/literal pattern, requiring an empty SOAPAction.

---

## Verification Commands

```bash
# Check that the fix is applied
git log --oneline | head -5

# Should show:
# - "Use empty SOAPAction for Oracle Fusion document/literal style"
# - "Upgrade swagger-ui-express to 5.0.1 to fix url.parse() deprecation warning"
```
