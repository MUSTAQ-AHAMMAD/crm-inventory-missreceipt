# Apply Receipt HTTP 401 Error - Fix Documentation

## Problem Description

When uploading CSV files for Apply Receipt functionality, the system was experiencing HTTP 401 authentication errors during the Apply Receipt operation:

```
[ApplyReceipt] Upload #6 Row 2 Invoice lookup SUCCESS | Invoice: 225261 | CustomerTrxId: 300000092548786
[ApplyReceipt] Upload #6 Row 2 Receipt lookup SUCCESS | Receipt: Mada-3004 | ReceiptId: 4001 | Amount: 590
[ApplyReceipt] Upload #6 Row 2 FAILED (Apply) | Receipt: Mada-3004 | HTTP 401
```

## Root Cause

The issue was an **environment mismatch** in the Oracle Cloud API endpoints:

1. **Invoice Lookup API** (`ORACLE_RECEIVABLES_INVOICES_API_URL`): Pointed to **test environment** (`ehxk-test.fa.em2.oraclecloud.com`) ✓
2. **Receipt Lookup API** (`ORACLE_STANDARD_RECEIPTS_LOOKUP_API_URL`): Pointed to **test environment** (`ehxk-test.fa.em2.oraclecloud.com`) ✓
3. **Apply Receipt SOAP API** (`ORACLE_APPLY_RECEIPT_SOAP_URL`): Pointed to **production environment** (`ehxk.fa.em2.oraclecloud.com`) ✗

The Oracle credentials configured in the `.env` file were for the **test environment**, but the Apply Receipt SOAP endpoint was trying to authenticate against the **production environment**, causing the 401 authentication failure.

## Solution

Changed the `ORACLE_APPLY_RECEIPT_SOAP_URL` endpoint in `backend/.env.example` from:

```diff
- ORACLE_APPLY_RECEIPT_SOAP_URL=https://ehxk.fa.em2.oraclecloud.com/fscmService/StandardReceiptService
+ ORACLE_APPLY_RECEIPT_SOAP_URL=https://ehxk-test.fa.em2.oraclecloud.com/fscmService/StandardReceiptService
```

**Changed:** `ehxk.fa.em2.oraclecloud.com` → `ehxk-test.fa.em2.oraclecloud.com`

Now all three APIs (invoice lookup, receipt lookup, and apply receipt) are pointing to the same **test environment**, ensuring consistent authentication.

## Action Required for Existing Users

If you have an existing `.env` file, you need to update it manually:

1. Open `backend/.env` in a text editor
2. Find the line with `ORACLE_APPLY_RECEIPT_SOAP_URL`
3. Change it from:
   ```
   ORACLE_APPLY_RECEIPT_SOAP_URL=https://ehxk.fa.em2.oraclecloud.com/fscmService/StandardReceiptService
   ```
   To:
   ```
   ORACLE_APPLY_RECEIPT_SOAP_URL=https://ehxk-test.fa.em2.oraclecloud.com/fscmService/StandardReceiptService
   ```
4. Save the file and restart your backend server

## Verification

After applying this fix:
- Invoice lookup: SUCCESS ✓
- Receipt lookup: SUCCESS ✓
- Apply receipt: SUCCESS ✓ (no more HTTP 401 errors)

## Technical Details

### File Modified
- `backend/.env.example` (line 31)

### Affected Functionality
- Apply Receipt bulk upload feature
- File: `backend/src/controllers/applyReceiptController.js`

### Environment Endpoints

**Test Environment** (ehxk-test):
- Inventory: `https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions`
- Misc Receipt SOAP: `https://ehxk-test.fa.em2.oraclecloud.com/fscmService/MiscellaneousReceiptService`
- Receivables Invoices: `https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/receivablesInvoices`
- Standard Receipts Lookup: `https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/standardReceipts`
- **Apply Receipt SOAP: `https://ehxk-test.fa.em2.oraclecloud.com/fscmService/StandardReceiptService`** (FIXED)

**Production Environment** (ehxk):
- Standard Receipt API: `https://ehxk.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/standardReceipts`

## Notes

- The Standard Receipt API (`ORACLE_STANDARD_RECEIPT_API_URL`) on line 19 is still pointing to production (`ehxk.fa.em2.oraclecloud.com`). This is intentional and used for the Standard Receipt upload feature (different from Apply Receipt).
- If you need to use production environment for Apply Receipt, ensure your `ORACLE_USERNAME` and `ORACLE_PASSWORD` are production credentials, and update all three Apply Receipt endpoints accordingly.

## Date Fixed
April 22, 2026
