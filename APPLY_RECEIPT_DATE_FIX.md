# Apply Receipt TransactionDate Fix

## Issue
The Apply Receipt feature was not properly reading the `TransactionDate` from the Oracle Invoice API and was not adding it correctly to the final SOAP API payload. The date "2025-05-02" from the API response was being passed as a full ISO 8601 timestamp instead of just the date portion.

## Root Cause
The Oracle REST API returns dates in ISO 8601 format with timestamps (e.g., `"2025-05-02T00:00:00.000+00:00"`), but the SOAP API expects dates in simple YYYY-MM-DD format (e.g., `"2025-05-02"`).

The `lookupInvoice` function in `applyReceiptController.js` was converting the TransactionDate to a string without normalizing it:

```javascript
// Before (line 139)
transactionDate: items[0].TransactionDate ? String(items[0].TransactionDate) : null,
```

This resulted in the full timestamp being passed to the SOAP XML payload, which could cause the SOAP API to reject the request or not properly process the receipt application.

## Solution
Added a `normalizeOracleDate()` function that:
1. Extracts just the date portion from ISO 8601 timestamps
2. Handles various date formats:
   - ISO 8601 with timezone: `2025-05-02T00:00:00.000+00:00`
   - ISO 8601 with Z: `2025-05-02T00:00:00Z`
   - ISO format with space: `2025-05-02 00:00:00`
   - Already normalized: `2025-05-02`
3. Returns `null` for invalid dates
4. Falls back to JavaScript Date parsing if needed

Updated the `lookupInvoice` function to normalize the TransactionDate before returning it:

```javascript
// After (lines 172-180)
// Normalize TransactionDate from ISO 8601 timestamp to YYYY-MM-DD format
const rawTransactionDate = items[0].TransactionDate;
const normalizedDate = normalizeOracleDate(rawTransactionDate);

console.log(`[ApplyReceipt] Invoice ${invoiceNumber} TransactionDate: ${rawTransactionDate} -> ${normalizedDate}`);

return {
  customerTrxId: String(items[0].CustomerTransactionId),
  transactionDate: normalizedDate,
  data: items[0],
};
```

## SOAP XML Payload
The normalized date is now correctly used in the SOAP XML for both `ApplicationDate` and `AccountingDate`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://xmlns.oracle.com/apps/financials/receivables/receipts/standardReceiptService/types/">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:applyReceipt>
      <typ:ReceiptId>{receiptId}</typ:ReceiptId>
      <typ:CustomerTrxId>{customerTrxId}</typ:CustomerTrxId>
      <typ:AmountApplied>{amount}</typ:AmountApplied>
      <typ:ApplicationDate>2025-05-02</typ:ApplicationDate>
      <typ:AccountingDate>2025-05-02</typ:AccountingDate>
    </typ:applyReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

## Testing
Created comprehensive unit tests for the `normalizeOracleDate()` function:

```
✓ PASS | Already YYYY-MM-DD
✓ PASS | ISO 8601 with timezone
✓ PASS | ISO 8601 with Z
✓ PASS | ISO 8601 with non-zero timezone
✓ PASS | ISO format with space separator
✓ PASS | Null input
✓ PASS | Empty string
✓ PASS | Invalid date

Results: 8 passed, 0 failed
```

## Files Modified
- `backend/src/controllers/applyReceiptController.js`
  - Added `normalizeOracleDate()` function (lines 58-91)
  - Updated `lookupInvoice()` to normalize TransactionDate (lines 172-180)
  - Enhanced logging to show date normalization (line 176, 265)

## Example Flow

### 1. Invoice Lookup API Response
```json
{
  "items": [
    {
      "CustomerTransactionId": "12345",
      "TransactionDate": "2025-05-02T00:00:00.000+00:00"
    }
  ]
}
```

### 2. Date Normalization
```
Input:  "2025-05-02T00:00:00.000+00:00"
Output: "2025-05-02"
```

### 3. SOAP Request
```
[ApplyReceipt] Sending SOAP request to {url}
[ApplyReceipt] CustomerTrxId: 12345, ReceiptId: 67890, Amount: 100.00, TransactionDate: 2025-05-02
```

### 4. SOAP XML Payload (ApplicationDate & AccountingDate)
```xml
<typ:ApplicationDate>2025-05-02</typ:ApplicationDate>
<typ:AccountingDate>2025-05-02</typ:AccountingDate>
```

## Impact
- ✅ Fixes issue where TransactionDate from Oracle Invoice API wasn't being properly formatted
- ✅ Ensures SOAP payload contains correctly formatted dates
- ✅ Adds comprehensive logging for debugging date normalization
- ✅ Handles multiple ISO 8601 date format variations
- ✅ Prevents SOAP API errors due to incorrect date format

## Commit
- Commit: 8b4fc3c
- Branch: claude/fix-apply-receipt-date-issue
- Message: "Add date normalization for TransactionDate in apply receipt controller"
