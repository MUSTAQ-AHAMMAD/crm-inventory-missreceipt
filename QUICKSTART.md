# Quick Start Guide - Oracle SOAP Fix

## What Was Fixed

The "Unknown method" error when calling Oracle Fusion's `createMiscellaneousReceipt` SOAP operation has been permanently fixed with a comprehensive SOAP client that:

1. ✅ Auto-discovers namespaces and operations from WSDL
2. ✅ Properly parses Oracle's MTOM/XOP multipart responses
3. ✅ Implements intelligent retry logic with exponential backoff
4. ✅ Extracts meaningful error messages from SOAP faults
5. ✅ Handles authentication and credential failures gracefully

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install
```

This will install the new `fast-xml-parser` dependency required for WSDL parsing.

### 2. Verify Environment Variables

Ensure your `.env` file has these variables set:

```env
ORACLE_SOAP_URL=https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService
ORACLE_USERNAME=your.username@company.com
ORACLE_PASSWORD=your_password
```

### 3. Test WSDL Connectivity

Before running the application, test that the WSDL is accessible:

```bash
npm run test:wsdl
```

This will:
- ✅ Verify environment variables are set
- ✅ Fetch and parse the WSDL
- ✅ Display discovered namespaces and operations
- ✅ Generate a sample SOAP envelope

**Expected Output:**
```
============================================================
Oracle SOAP WSDL Connectivity Test
============================================================

1. Checking environment variables...
✅ All required environment variables are set

2. Configuration:
   Service URL: https://...
   WSDL URL: https://...?WSDL
   Username: your.username@company.com
   Password: **********

3. Creating SOAP client...
✅ SOAP client created

4. Loading and parsing WSDL...
[OracleSoapClient] Fetching WSDL from https://...?WSDL
[OracleSoapClient] WSDL loaded successfully
[OracleSoapClient] Found namespaces: [ 'wsdl', 'soap', 'tns', ... ]
[OracleSoapClient] Found operations: [ 'createMiscellaneousReceipt', ... ]
✅ WSDL loaded successfully

5. WSDL Metadata:
   Namespaces discovered:
     - soapenv: http://schemas.xmlsoap.org/soap/envelope/
     - tns: http://xmlns.oracle.com/...
     ...

   Operations discovered:
     - createMiscellaneousReceipt
       SOAPAction: createMiscellaneousReceipt
       Style: document

6. Testing SOAP envelope generation...
✅ SOAP envelope generated successfully

============================================================
✅ ALL TESTS PASSED
============================================================
```

## Running the Application

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## Testing the Fix

### 1. Run Unit Tests

```bash
# Run all tests
npm test

# Run only SOAP client tests
npm test -- OracleSoapClient.test.js

# Run only misc receipt tests
npm test -- miscReceipt.test.js

# Run with coverage
npm run test:coverage
```

**Expected Result:**
- ✅ 26 tests for OracleSoapClient (all passing)
- ✅ 17 tests for miscReceipt controller (all passing)

### 2. Upload a Test CSV

Create a test CSV file (`test_receipt.csv`):

```csv
Amount,CurrencyCode,DepositDate,ReceiptDate,GlDate,OrgId,ReceiptNumber,ReceivableActivityName,BankAccountNumber
-100.00,SAR,2024-01-20,2024-01-20,2024-01-20,101,TEST001,Misc Activity,123456789
```

Upload via API:

```bash
# First, login to get JWT token
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Extract the token from response, then upload CSV
curl -X POST http://localhost:4000/api/misc-receipt/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test_receipt.csv"
```

### 3. Monitor Logs

Watch the application logs for detailed SOAP request/response information:

```
[OracleSoapClient] Calling operation: createMiscellaneousReceipt
[OracleSoapClient] SOAPAction: createMiscellaneousReceipt
[OracleSoapClient] Endpoint: https://...
[MiscReceipt] Sending SOAP request for Upload #1 Row 2:
  Receipt Number: TEST001
  Endpoint: https://...
  Full SOAP XML:
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope ...>
  ...
</soapenv:Envelope>
[MiscReceipt] Upload #1 Row 2 SUCCESS | Receipt: TEST001 | HTTP 200
```

## Troubleshooting

### Issue: "Failed to load WSDL"

**Possible Causes:**
1. Incorrect credentials
2. Network connectivity issues
3. Wrong ORACLE_SOAP_URL

**Solution:**
```bash
# Test WSDL URL manually
curl -u "username:password" "https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService?WSDL"

# Should return XML starting with <wsdl:definitions>
```

### Issue: "InvalidSecurity" or "Authentication failed"

**Possible Causes:**
1. Wrong ORACLE_USERNAME or ORACLE_PASSWORD
2. Account locked or expired
3. Missing permissions

**Solution:**
- Verify credentials can access Oracle Cloud portal
- Check account status in Oracle Identity Management
- Ensure user has permissions for MiscellaneousReceiptService

### Issue: Still getting "Unknown method"

**Possible Causes:**
1. WSDL parsing failed silently
2. Operation name mismatch
3. Namespace issues

**Solution:**
```bash
# Run WSDL test to see what operations were discovered
npm run test:wsdl

# Check that "createMiscellaneousReceipt" appears in operations list
```

### Issue: Timeout errors

**Possible Causes:**
1. Oracle service is slow
2. Network latency
3. Firewall blocking requests

**Solution:**
Increase timeout in `miscReceiptController.js`:
```javascript
return new OracleSoapClient({
  // ...
  requestTimeout: 60000, // Increase to 60 seconds
});
```

## Verification Checklist

Before deploying to production, verify:

- [ ] `npm run test:wsdl` passes successfully
- [ ] All unit tests pass (`npm test`)
- [ ] Can upload a test CSV file
- [ ] Logs show successful SOAP requests
- [ ] No "Unknown method" errors in logs
- [ ] SOAP responses are being parsed correctly
- [ ] Retry logic works for transient errors
- [ ] Authentication errors are handled properly

## Performance Tuning

### Adjust Concurrency

Edit `.env`:
```env
# Number of parallel SOAP requests (default: 5)
CONCURRENT_REQUESTS=10

# Maximum retry attempts (default: 3)
MAX_RETRIES=5
```

Higher concurrency = faster processing but more load on Oracle.

### Monitor Performance

Check upload logs for performance metrics:
```
[MiscReceipt] Upload #1 COMPLETE | Total: 100 | Success: 100 | Failed: 0 | Status: SUCCESS | Time: 45.23s | Avg: 0.45s/record
```

## Additional Resources

- **Full Documentation**: See `ORACLE_SOAP_FIX.md`
- **SOAP Client Source**: `backend/src/services/OracleSoapClient.js`
- **Unit Tests**: `backend/src/__tests__/OracleSoapClient.test.js`
- **Controller Integration**: `backend/src/controllers/miscReceiptController.js`

## Support

If you encounter issues:

1. Run `npm run test:wsdl` and share the output
2. Check application logs for error details
3. Verify Oracle service is accessible
4. Test WSDL URL manually with curl
5. Review `ORACLE_SOAP_FIX.md` for detailed troubleshooting

## Success Indicators

You'll know the fix is working when you see:

✅ WSDL test passes
✅ No "Unknown method" errors
✅ Successful SOAP responses in logs
✅ CSV uploads complete without errors
✅ Receipts are created in Oracle Fusion

## Next Steps

1. Deploy to staging environment
2. Test with production Oracle instance
3. Monitor for any remaining issues
4. Adjust retry/timeout settings as needed
5. Consider adding monitoring/alerting for SOAP failures
