# SOAP API Fix Verification Guide

## Quick Verification Checklist

Use this guide to verify that all SOAP API fixes are working correctly.

---

## ✅ Pre-Verification Checklist

Before testing, ensure:

- [ ] Node.js 18+ is installed
- [ ] Backend dependencies installed (`cd backend && npm install`)
- [ ] `.env` file configured with valid Oracle credentials
- [ ] Database is set up (`npm run prisma:migrate`)
- [ ] You have test CSV files ready

---

## 🔍 Verification Tests

### Test 1: Basic SOAP Connection

**Objective**: Verify SOAP client can connect to Oracle

```bash
cd backend
node scripts/test-wsdl.js
```

**Expected Output**:
```
✅ WSDL loaded successfully
✅ ALL TESTS PASSED
Your Oracle SOAP endpoint is properly configured!
```

**If this fails**:
- Check ORACLE_USERNAME and ORACLE_PASSWORD in `.env`
- Verify ORACLE_SOAP_URL is correct
- Check network connectivity to Oracle Cloud

---

### Test 2: Request Tracking

**Objective**: Verify unique request IDs are generated

**Steps**:
1. Start backend: `npm run dev`
2. Upload a misc receipt CSV file
3. Check logs

**Expected in Logs**:
```
[OracleSoapClient] REQ-1735123456789-1 Starting SOAP call
[OracleSoapClient] REQ-1735123456789-1 SOAPAction: createMiscellaneousReceipt
[OracleSoapClient] REQ-1735123456789-1 Response received in 1234ms - HTTP 200
[OracleSoapClient] REQ-1735123456789-1 ✅ Success - HTTP 200 in 1234ms
```

**Verification Points**:
- ✅ Each request has unique ID with format `REQ-{timestamp}-{counter}`
- ✅ Same ID appears throughout request lifecycle
- ✅ Timing information is logged (in milliseconds)

---

### Test 3: Debug Mode

**Objective**: Verify debug logging works

**Steps**:
1. Add to `backend/.env`: `SOAP_DEBUG=true`
2. Restart backend
3. Upload a misc receipt CSV file
4. Check logs

**Expected in Logs**:
```
[OracleSoapClient DEBUG] REQ-... Request XML:
<soapenv:Envelope ...>
[OracleSoapClient DEBUG] REQ-... Request Headers:
{
  "Content-Type": "text/xml; charset=utf-8",
  "SOAPAction": "\"createMiscellaneousReceipt\"",
  ...
}
[OracleSoapClient DEBUG] REQ-... Response Headers:
{
  "content-type": "text/xml;charset=UTF-8",
  ...
}
[OracleSoapClient DEBUG] REQ-... Response XML:
<?xml version="1.0" encoding="UTF-8"?>
```

**Verification Points**:
- ✅ Full request XML logged
- ✅ Request headers logged
- ✅ Response headers logged
- ✅ Full response XML logged

**Note**: Disable `SOAP_DEBUG` in production!

---

### Test 4: Error Handling - Authentication Failure

**Objective**: Verify auth errors are handled correctly (non-retryable)

**Steps**:
1. Temporarily change credentials in `.env` to invalid values
2. Restart backend
3. Attempt to upload CSV
4. Check logs

**Expected in Logs**:
```
[OracleSoapClient] REQ-... HTTP 500 error: ...
[OracleSoapClient] REQ-... Authentication failed - not retrying
❌ Failed for REC001: Authentication failed: ...
```

**Verification Points**:
- ✅ Error detected on first attempt
- ✅ NO retries attempted (should not see "Retry 1/3")
- ✅ Clear error message mentioning authentication
- ✅ Request fails immediately

**After Test**: Restore correct credentials!

---

### Test 5: Error Handling - Timeout

**Objective**: Verify timeouts are retried

**Steps**:
1. Set in `.env`: `REQUEST_TIMEOUT=1`
2. Restart backend
3. Attempt to upload CSV
4. Check logs

**Expected in Logs**:
```
[OracleSoapClient] REQ-... Request timeout after 1ms
[OracleSoapClient] REQ-... Retry 1/4: Request timeout after 1ms
[OracleSoapClient] REQ-... Waiting before retry...
[OracleSoapClient] REQ-... Retry 2/4: Request timeout after 1ms
...
[OracleSoapClient] REQ-... All retries exhausted
```

**Verification Points**:
- ✅ Timeout detected
- ✅ Retries attempted (should see 3 retries by default)
- ✅ Exponential backoff between retries
- ✅ Clear message when retries exhausted

**After Test**: Remove REQUEST_TIMEOUT or set to reasonable value (30000)

---

### Test 6: Input Validation

**Objective**: Verify missing fields are caught early

**Steps**:
1. Create CSV with missing required field (e.g., remove Amount column)
2. Upload to misc receipt endpoint
3. Check response

**Expected Response**:
```json
{
  "error": "CSV is missing required columns: Amount"
}
```

**OR** if Amount exists but is empty in a row:
```json
{
  "error": "Row 2 is missing values for: Amount"
}
```

**Verification Points**:
- ✅ Error returned before SOAP call is made
- ✅ Clear error message indicating which field is missing
- ✅ Row number included in error message
- ✅ No SOAP requests in logs (failed before SOAP call)

---

### Test 7: XML Escaping

**Objective**: Verify special characters are escaped

**Steps**:
1. Create CSV with special characters in fields:
   - ReceiptNumber: `TEST<123>&"abc"'`
2. Enable debug mode: `SOAP_DEBUG=true`
3. Upload CSV
4. Check logs for request XML

**Expected in Request XML**:
```xml
<com:ReceiptNumber>TEST&lt;123&gt;&amp;&quot;abc&quot;&apos;</com:ReceiptNumber>
```

**Verification Points**:
- ✅ `<` escaped to `&lt;`
- ✅ `>` escaped to `&gt;`
- ✅ `&` escaped to `&amp;`
- ✅ `"` escaped to `&quot;`
- ✅ `'` escaped to `&apos;`

---

### Test 8: Concurrent Processing

**Objective**: Verify multiple requests are processed in parallel

**Steps**:
1. Set in `.env`: `CONCURRENT_REQUESTS=5`
2. Restart backend
3. Upload CSV with 10+ rows
4. Check logs for timing

**Expected in Logs**:
```
[MiscReceipt] Sending SOAP request for REC001
[MiscReceipt] Sending SOAP request for REC002
[MiscReceipt] Sending SOAP request for REC003
[MiscReceipt] Sending SOAP request for REC004
[MiscReceipt] Sending SOAP request for REC005
[OracleSoapClient] REQ-...-1 Starting SOAP call
[OracleSoapClient] REQ-...-2 Starting SOAP call
[OracleSoapClient] REQ-...-3 Starting SOAP call
...
```

**Verification Points**:
- ✅ Multiple requests start before others complete
- ✅ Request counter increments (shows parallel processing)
- ✅ Total time < (number of rows × average time per request)

---

### Test 9: Successful Misc Receipt Upload

**Objective**: End-to-end test of misc receipt

**Steps**:
1. Prepare valid CSV file with 2-3 rows
2. Upload via API or frontend
3. Check logs and response

**Sample CSV**:
```csv
Amount,CurrencyCode,DepositDate,ReceiptDate,GlDate,OrgId,ReceiptNumber,ReceivableActivityName,BankAccountNumber
-100.00,SAR,2024-01-20,2024-01-20,2024-01-20,101,TEST-001,Bank Charge,123456789
-50.00,SAR,2024-01-20,2024-01-20,2024-01-20,101,TEST-002,Bank Charge,123456789
```

**Expected Response**:
```json
{
  "uploadId": 123,
  "totalRecords": 2,
  "successCount": 2,
  "failureCount": 0,
  "status": "SUCCESS",
  "processingTimeSeconds": 2.5
}
```

**Expected in Logs**:
```
[MiscReceipt] Sending SOAP request for TEST-001
[OracleSoapClient] REQ-...-1 Starting SOAP call
[OracleSoapClient] REQ-...-1 ✅ Success - HTTP 200 in 1234ms
✅ Success for TEST-001 - HTTP 200

[MiscReceipt] Sending SOAP request for TEST-002
[OracleSoapClient] REQ-...-2 Starting SOAP call
[OracleSoapClient] REQ-...-2 ✅ Success - HTTP 200 in 987ms
✅ Success for TEST-002 - HTTP 200
```

**Verification Points**:
- ✅ All receipts processed successfully
- ✅ Clear success messages in logs
- ✅ Response includes timing information
- ✅ Status is "SUCCESS"

---

### Test 10: Successful Apply Receipt Upload

**Objective**: End-to-end test of apply receipt

**Steps**:
1. Prepare valid CSV file with 1-2 rows
2. Upload via API or frontend
3. Check logs and response

**Sample CSV**:
```csv
InvoiceNumber,ReceiptNumber1,ReceiptNumber2,ReceiptNumber3,ReceiptNumber4
BLK-ALAR-00000008,mada-12244,visa-12244,,
BLK-ALAR-00000009,amex-12245,,,
```

**Expected Response**:
```json
{
  "uploadId": 456,
  "totalRecords": 2,
  "totalReceipts": 3,
  "successCount": 3,
  "failureCount": 0,
  "status": "SUCCESS",
  "processingTimeSeconds": 5.2
}
```

**Expected in Logs**:
```
[ApplyReceipt] Invoice lookup SUCCESS | Invoice: BLK-ALAR-00000008 | CustomerTrxId: 123
[ApplyReceipt] Receipt lookup SUCCESS | Receipt: mada-12244 | ReceiptId: 456
[ApplyReceipt] Sending SOAP request to https://...
[OracleSoapClient] REQ-...-1 ✅ Success - HTTP 200 in 1234ms
[ApplyReceipt] SOAP request successful - HTTP 200
[ApplyReceipt] SUCCESS | Invoice: BLK-ALAR-00000008 | Receipt: mada-12244
```

**Verification Points**:
- ✅ Invoice lookup successful
- ✅ Receipt lookup successful
- ✅ SOAP apply receipt successful
- ✅ Clear success messages throughout
- ✅ All steps logged

---

## 📊 Performance Benchmarks

After verification, measure performance:

### Single Receipt Processing

**Test**: Upload 1 receipt

**Expected**:
- Time: 1-3 seconds
- Includes: validation, SOAP call, database write

### Bulk Processing (10 receipts)

**Test**: Upload 10 receipts with CONCURRENT_REQUESTS=5

**Expected**:
- Time: 3-6 seconds
- Throughput: ~2-3 receipts/second

### Large Batch (100 receipts)

**Test**: Upload 100 receipts with CONCURRENT_REQUESTS=5

**Expected**:
- Time: 30-60 seconds
- No memory leaks
- No connection pool exhaustion

---

## 🐛 Troubleshooting

### Debug Mode Not Working

**Symptom**: No debug logs appearing

**Solutions**:
- Verify `.env` has `SOAP_DEBUG=true` (not false, not commented out)
- Restart backend after changing `.env`
- Check that logs are not being filtered

### Request IDs Not Unique

**Symptom**: Multiple requests have same ID

**Solution**:
- This should not happen
- Report as bug with log sample

### Retries Not Working

**Symptom**: No retries on timeout

**Solutions**:
- Check `MAX_RETRIES` in `.env` (should be ≥ 1)
- Verify error is retryable (timeouts, 5xx errors)
- Check logs for "All retries exhausted" message

### No Timing Information

**Symptom**: Logs don't show elapsed time

**Solution**:
- Verify using latest code version
- Check logs for `in {elapsed}ms` pattern
- May need to update OracleSoapClient.js

---

## ✅ Final Verification

After completing all tests, verify:

- [ ] WSDL test passes
- [ ] Request tracking works (unique IDs)
- [ ] Debug mode works
- [ ] Auth failures handled correctly (no retry)
- [ ] Timeouts handled correctly (with retry)
- [ ] Input validation works
- [ ] XML escaping works
- [ ] Concurrent processing works
- [ ] Misc receipt upload succeeds
- [ ] Apply receipt upload succeeds
- [ ] No memory leaks in large batches
- [ ] Error messages are clear and actionable

---

## 📝 Sign-Off

Once all verification tests pass:

**Tested By**: ________________

**Date**: ________________

**Environment**:
- Node.js Version: ________________
- Backend Version: ________________
- Oracle Instance: ________________

**Test Results**:
- [ ] All tests passed
- [ ] Some tests failed (list below)
- [ ] Ready for production

**Notes**:
_____________________________________________
_____________________________________________
_____________________________________________

---

**Status**: Ready for production deployment ✅
