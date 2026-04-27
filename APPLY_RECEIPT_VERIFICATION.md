# Apply Receipt Payload Verification Feature

## Overview

This feature adds a verification step before sending SOAP payloads to the Oracle Fusion SOAP API. Users can now review the exact payloads with real data before submission, giving them full control over what gets sent to Oracle.

## Problem Solved

Previously, the Apply Receipt flow would:
1. Parse CSV file
2. Look up Invoice and Receipt IDs from Oracle REST APIs
3. Build SOAP payloads
4. **Immediately send to SOAP API** (no user control)

This meant users couldn't verify the final payload before it was sent to production.

## Solution

Now the Apply Receipt flow includes an optional verification step:

1. Parse CSV file
2. **[NEW]** Click "Verify Final Payload" button
3. System looks up all Invoice and Receipt IDs from Oracle REST APIs
4. System builds actual SOAP payloads with real data
5. **[NEW]** User reviews the exact payloads that will be sent
6. User clicks "Upload & Apply to Oracle" to send verified payloads

## Features

### Backend API

#### New Endpoint: `POST /api/apply-receipt/verify`

**Purpose**: Validates CSV and builds actual SOAP payloads with real IDs from Oracle APIs

**Request**:
- Multipart form data with CSV file
- Requires authentication

**Response**:
```json
{
  "totalRows": 10,
  "totalApplications": 15,
  "verifiedPayloadsCount": 13,
  "errorsCount": 2,
  "verifiedPayloads": [
    {
      "rowNumber": 2,
      "invoiceNumber": "BLK-ALAR-00000008",
      "receiptNumber": "mada-12244",
      "customerTrxId": "300000123456789",
      "receiptId": "400000987654321",
      "amount": "150.00",
      "applicationDate": "2025-05-02",
      "soapPayload": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>..."
    }
  ],
  "errors": [
    {
      "rowNumber": 5,
      "invoiceNumber": "BLK-ALAR-00000011",
      "receiptNumber": "visa-12245",
      "error": "Receipt 'visa-12245' not found in Oracle",
      "step": "RECEIPT_LOOKUP"
    }
  ]
}
```

### Frontend UI

#### New "Verify Final Payload" Button

Located between "Preview Payload" and "Upload & Apply to Oracle" buttons on the Apply Receipt page.

**Verification Panel Shows**:
- ✅ Number of verified payloads ready to send
- ❌ Any errors encountered during verification (invoice/receipt not found)
- 📋 Detailed information for each verified payload:
  - Invoice Number
  - Receipt Number
  - CustomerTrxId (from Oracle)
  - ReceiptId (from Oracle)
  - Amount (from Oracle)
  - ApplicationDate (from Oracle)
  - Full SOAP XML payload (expandable)

#### User Workflow

1. Upload CSV file
2. Click **"Verify Final Payload"** (🔍 button)
3. Wait for verification (looks up real IDs from Oracle)
4. Review the verification results:
   - Check all payloads have correct IDs
   - Review any errors
   - Expand SOAP payloads to see exact XML
5. If satisfied, click **"Upload & Apply to Oracle"** (🔗 button)
6. Monitor progress and results

## Technical Details

### Verification Process

The `verifyPayload` controller function:

1. Parses and validates the CSV file
2. For each row:
   - Looks up Invoice by `InvoiceNumber` from Oracle REST API
   - Gets `CustomerTrxId` and `TransactionDate`
   - For each receipt number in the row:
     - Looks up Receipt by `ReceiptNumber` from Oracle REST API
     - Gets `StandardReceiptId`, `Amount`, and `ReceiptDate`
     - Builds the actual SOAP XML payload with real values
3. Returns verified payloads and any errors encountered

### Parallel Processing

Verification uses the same parallel processing as upload:
- Concurrent requests: configured via `CONCURRENT_REQUESTS` env var (default: 5)
- Retries: configured via `MAX_RETRIES` env var (default: 3)
- Ensures fast verification even with large CSV files

### Error Handling

Verification captures two types of errors:
- **INVOICE_LOOKUP**: Invoice not found in Oracle
- **RECEIPT_LOOKUP**: Receipt not found in Oracle

These errors are displayed to the user before any SOAP submission occurs.

## Benefits

1. **Full Visibility**: Users see exact payloads before submission
2. **Error Prevention**: Catch lookup errors before sending to SOAP
3. **Confidence**: Verify IDs, amounts, and dates are correct
4. **Audit Trail**: Know exactly what was sent to Oracle
5. **No Breaking Changes**: Existing "Upload & Apply" flow still works

## Files Modified

- `backend/src/controllers/applyReceiptController.js`: Added `verifyPayload` function
- `backend/src/routes/applyReceipt.js`: Added `/verify` route
- `frontend/src/pages/ApplyReceiptPage.jsx`: Added verification UI and logic

## Testing

To test the verification feature:

1. Start the backend: `npm run dev` in `backend/`
2. Start the frontend: `npm run dev` in `frontend/`
3. Login to the application
4. Navigate to "Apply Receipt Upload" page
5. Upload a sample CSV file
6. Click "Verify Final Payload" button
7. Review the verification results
8. Click "Upload & Apply to Oracle" to proceed with submission

## Notes

- Verification is **optional** - users can still directly click "Upload & Apply to Oracle"
- Verification performs the same ID lookups as upload, so it adds processing time
- The verification step does NOT send anything to the SOAP API - it only builds and shows payloads
- All verified payload data comes from real Oracle REST API responses
