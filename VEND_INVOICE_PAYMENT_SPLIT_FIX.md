# Vend Invoice Payment Method Split Fix

## Problem Statement

The AR Invoice generation from Vend data had two issues:
1. **Duplicating sales lines**: All sales lines were being added across all payment type invoices (NORMAL/TABBY/TAMARA), leading to incorrect invoicing where the same sales were invoiced multiple times.
2. **Incorrect store matching**: The code was using the wrong column (`Payment Method Details`) from payment lines instead of the `Store` column, causing store code mismatches.

## Solution

Updated `vendInvoiceController.js` to properly split sales lines by payment method and fix store code matching:

### Changes Made

1. **Store Code Matching Fix (Lines 159-193)**
   - **OLD**: Used `Payment Method Details` column from payment lines as the key
   - **NEW**: Uses `Store` column from payment lines as the key
   - Store code from sales lines (extracted from `Order Lines/Order Ref` like "AZIZMALL/64181") now correctly matches the `Store` column
   - Added fallback: if `Subinventory code` is not present, uses `Store` column value
   - Added debug logging to show all available store codes in the payment map

2. **Payment Method Mapping**
   - Changed from array-based mapping to Set-based tracking of payment types per store
   - Now stores: `{ subinventoryCode, branch, paymentTypes: Set<'NORMAL'|'TABBY'|'TAMARA'> }`
   - Only creates invoices for payment types that actually exist for each store
   - **Payment Method Classification:**
     - Payment methods containing "TABBY" → TABBY type
     - Payment methods containing "TAMARA" → TAMARA type
     - **All other payment methods** (Cash, Mada, Visa, Master, Bank, Card, etc.) → NORMAL type

2. **Sales Line Payment Method Detection (Lines 239-250)**
   - Added support for reading payment method from sales lines
   - Checks multiple possible column names: `Payment Method`, `Order Lines/Payment Method`, `Payment Type`
   - Maps payment methods to types:
     - Contains "TABBY" → TABBY
     - Contains "TAMARA" → TAMARA
     - **Any other value** (Cash, Mada, Visa, Master, Bank, Card, etc.) → NORMAL

3. **Conditional Invoice Assignment (Lines 244-253)**
   - If sales line has a payment method → adds ONLY to matching invoice
   - If no payment method → adds to ALL available payment type invoices (backward compatibility)
   - Validates that target payment type exists for the store before adding

4. **BillTo Field Mapping**
   - Correctly fetches metadata from `FusionSalesMetadata` table based on:
     - `subinventory` (e.g., "YASMEEN")
     - `customerType` (e.g., "NORMAL", "TABBY", "TAMARA")
   - Maps to correct `BillToCustomerNumber` and `BillToSite` for each payment type

## Example

For YASMEEN subinventory with all 3 payment types:

### Input Files

**Payment Lines:**
- Must have a `Store` column (e.g., "YASMEEN", "AZIZMALL") - this is the store code
- Optionally has `Subinventory code` column (if not present, `Store` value is used)
- Has `Payment Method` column indicating payment type
- Examples of payment method mapping:
  - Payment Method: "Cash" → NORMAL type
  - Payment Method: "Mada" → NORMAL type
  - Payment Method: "Visa" → NORMAL type
  - Payment Method: "Master" → NORMAL type
  - Payment Method: "Tabby" → TABBY type
  - Payment Method: "Tamara" → TAMARA type

**Sales Lines:**
- Has `Order Lines/Order Ref` column with values like "AZIZMALL/64181"
- Store code is extracted by splitting on "/" and taking the first part: "AZIZMALL"
- This extracted store code matches the `Store` column in payment lines
- Line 1: Product A, $100, Order Ref: "YASMEEN/12345", Payment Method: Cash
- Line 2: Product B, $200, Order Ref: "YASMEEN/12346", Payment Method: Tabby
- Line 3: Product C, $150, Order Ref: "YASMEEN/12347", Payment Method: Tamara

### Output (3 separate invoices)

**Invoice 1 - NORMAL (Cash/Bank)**
- BillToCustomerNumber: 14
- BillToSite: 14
- Lines: Product A ($100)

**Invoice 2 - TABBY**
- BillToCustomerNumber: 50011
- BillToSite: 51100
- Lines: Product B ($200)

**Invoice 3 - TAMARA**
- BillToCustomerNumber: 69011
- BillToSite: 51050
- Lines: Product C ($150)

## Backward Compatibility

If sales lines don't have payment method information:
- All sales lines will be added to ALL available payment type invoices
- This maintains existing behavior for files without payment method data
- Warning logged: sales lines should ideally include payment method for proper splitting

## Database Requirements

The `FusionSalesMetadata` table must have entries for:
- Each subinventory (YASMEEN, EXBSA, etc.)
- Each customer type (NORMAL, TABBY, TAMARA)

Example records:
```sql
-- YASMEEN / NORMAL
subinventory: 'YASMEEN'
customerType: 'NORMAL'
billToAccount: 14
siteNumber: '14'
billToName: 'Yasmeen Mall'

-- YASMEEN / TABBY
subinventory: 'YASMEEN'
customerType: 'TABBY'
billToAccount: 50011
siteNumber: '51100'
billToName: 'Tabby Saudi For communication and IT'

-- YASMEEN / TAMARA
subinventory: 'YASMEEN'
customerType: 'TAMARA'
billToAccount: 69011
siteNumber: '51050'
billToName: 'Nakhla IT Systems (LLC) Tamara'
```

## Files Modified

- `backend/src/controllers/vendInvoiceController.js`

## Testing

To test the fix:
1. Ensure `FusionSalesMetadata` table has correct mappings
2. Upload Payment Lines Excel with multiple payment types per store
3. Upload Sales Lines Excel with payment method column populated
4. Verify 3 separate invoices generated with correct BillTo information
5. Verify sales lines distributed correctly by payment type
