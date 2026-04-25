# SOAP Issue Troubleshooting Guide

## Quick Fix Steps

### Step 1: Run the diagnostic test from your local machine

```bash
cd backend
npm run test:receipt
```

This will:
- ✅ Show you the exact SOAP XML being sent
- ✅ Display the full error response from Oracle (not truncated)
- ✅ Capture all SOAP fault details
- ✅ Help identify the exact issue

### Step 2: Capture the full error output

When you run the test, you'll see output like:

```
═══════════════════════════════════════════════════════════════════
❌ FAILED
═══════════════════════════════════════════════════════════════════
Error: [Exact error message from Oracle]

[OracleSoapClient] REQ-xxx Full Response XML:
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope...>
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>THE ACTUAL ERROR MESSAGE</faultstring>
      ...
    </soap:Fault>
  </soap:Body>
</soap:Envelope>
```

**Copy and share the FULL output, especially the `faultstring` value.**

### Step 3: Common Issues and Fixes

#### Issue 1: "Unknown method" Error

**Faultstring contains:** `Unknown method` or `method not found`

**Causes:**
1. Wrong operation name in SOAPAction header
2. Wrong namespace prefix for operation element
3. Operation element name doesn't match WSDL

**Fix:**
Run the discovery script to see available methods:
```bash
npm run discover:methods
```

Then update the controller to use the correct operation name.

#### Issue 2: "Invalid Parameter" or "Missing Required Field"

**Faultstring contains:** `missing required`, `invalid parameter`, `required field`

**Causes:**
1. Missing required fields in request
2. Field names don't match Oracle's expectations (case-sensitive!)
3. Field order might matter for some Oracle services

**Fix:**
1. Check Oracle documentation for required fields
2. Verify field names are **exactly** PascalCase (e.g., `ReceiptNumber` not `receiptNumber`)
3. Try reordering fields to match WSDL schema order

#### Issue 3: Authentication/Authorization Errors

**Faultstring contains:** `authentication`, `unauthorized`, `invalid credentials`, `permission denied`

**Causes:**
1. Wrong username/password
2. User doesn't have required permissions
3. Password has special characters causing encoding issues

**Fix:**
1. Test credentials by logging into Oracle Cloud portal
2. Verify user has "Receivables Manager" or appropriate role
3. If password has special characters, try changing it temporarily

#### Issue 4: Namespace/Schema Validation Errors

**Faultstring contains:** `unexpected element`, `invalid namespace`, `schema validation`

**Causes:**
1. Wrong namespace URIs
2. Elements in wrong order
3. Extra/missing wrapper elements

**Fix:**
Check the WSDL for exact namespace URIs and schema structure:
```bash
# View WSDL in browser (will prompt for credentials)
https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService?WSDL
```

## Improved Error Logging

I've updated the code to:

1. ✅ **Log full request XML** - See exactly what's being sent
2. ✅ **Log full response XML for errors** - No more truncation on errors
3. ✅ **Extract and display SOAP fault details** - Code, Message, and Detail
4. ✅ **Show request ID for correlation** - Track requests through logs

## How to Enable Enhanced Debugging

In your `.env` file:

```env
# Enable full SOAP debugging
SOAP_DEBUG=true
```

This will log:
- Complete request XML (no truncation)
- All request headers
- Complete response XML
- All response headers
- Timing information

## Testing Workflow

1. **Enable debug mode** in `.env`:
   ```env
   SOAP_DEBUG=true
   ```

2. **Run the test script**:
   ```bash
   npm run test:receipt
   ```

3. **Capture the output** - especially:
   - The full SOAP request XML
   - The full SOAP response XML
   - The SOAP Fault details (code, message, detail)

4. **Share the output with me** - With the fault details, I can identify the exact issue and fix it

## What Changed

### OracleSoapClient.js

**Before:**
```javascript
// Truncated error logging
console.error(`HTTP 500 error:`, this.truncateXml(xmlResponse, 500));
```

**After:**
```javascript
// Full error logging
console.error(`Full Response XML:`, xmlResponse); // NO TRUNCATION

if (fault) {
  console.error(`SOAP Fault Details:`);
  console.error(`  Code: ${fault.code}`);
  console.error(`  Message: ${fault.message}`);
  console.error(`  Detail: ${fault.detail}`);
}
```

**Impact:** You now see the COMPLETE error message from Oracle, not just the first 500 characters.

## Next Steps

1. Run `npm run test:receipt` from your local machine
2. Copy the ENTIRE output (including the SOAP fault)
3. Share it with me
4. I'll identify the exact issue and provide the fix

## Alternative: Test via UI with Enhanced Logging

If you prefer to test via the UI:

1. Enable SOAP_DEBUG in `.env`
2. Start the backend: `npm start`
3. Upload a CSV through the UI
4. Check the backend console output
5. Look for `[OracleSoapClient] REQ-xxx Full Response XML:`
6. Copy the complete output

## Common Oracle Fusion SOAP Patterns

### Correct Pattern (Document/Literal):
```xml
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://xmlns.oracle.com/.../types/"
  xmlns:com="http://xmlns.oracle.com/.../commonService/">
  <soapenv:Body>
    <typ:operationName>          <!-- Operation uses 'typ:' -->
      <com:ObjectType>            <!-- Data uses 'com:' -->
        <com:Field>value</com:Field>
      </com:ObjectType>
    </typ:operationName>
  </soapenv:Body>
</soapenv:Envelope>
```

### Key Points:
- Operation element: `typ:` namespace
- Data structures: `com:` namespace
- Field names: **PascalCase** (ReceiptNumber, not receiptNumber)
- SOAPAction: Must match operation name exactly

---

**With these improvements, we can now see the exact error from Oracle and fix it immediately.**
