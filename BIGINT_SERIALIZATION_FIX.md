# BigInt Serialization Fix

## Problem

AR invoice creation was failing with errors because `billToAccNumber` was being passed as `9n` instead of `"9"` in JSON payloads sent to Oracle Fusion.

### Example Error
```
billToCustName: "Red Sea Mall"
billToLocation: "9"
billToAccNumber: 9n  ← WRONG: includes 'n' suffix
```

The `n` suffix indicates a JavaScript BigInt literal. When BigInt values are serialized to JSON by default, they throw an error or include the `n` suffix (depending on the serialization method), which Oracle cannot parse.

## Root Cause

Two Prisma schema fields were defined as `BigInt`:

1. **FusionSalesMetadata.billToAccount** (line 235 in schema.prisma)
   ```prisma
   billToAccount BigInt  // Changed to BigInt for large Oracle account numbers
   ```

2. **FusionInvoiceHeader.billToAccNumber** (line 244 in schema.prisma)
   ```prisma
   billToAccNumber BigInt?  // BILL_TO_ACC_NUMBER - Changed to BigInt for large Oracle IDs
   ```

When Prisma queries return these BigInt fields, JavaScript's native JSON.stringify() cannot serialize them properly because BigInt doesn't have a default JSON representation.

## Solution

### Global BigInt Serialization Override

Added a global BigInt prototype override in `backend/src/index.js`:

```javascript
// ─── BigInt JSON Serialization Fix ───────────────────────────────────────────
// Fix for BigInt values being serialized as "9n" instead of "9" in JSON payloads
// This affects FusionSalesMetadata.billToAccount and FusionInvoiceHeader.billToAccNumber
BigInt.prototype.toJSON = function() {
  return this.toString();
};
```

This ensures that **all BigInt values** across the application are automatically converted to strings during JSON serialization.

### Explicit String Conversion (Belt & Suspenders)

The `fusionSalesMetadataService.js` also includes explicit `.toString()` conversion:

```javascript
BillToCustomerNumber: metadata.billToAccount.toString(),
```

This provides redundancy even though the global toJSON() method should handle it automatically.

## Impact

### Fixed
- ✅ AR invoice payloads now correctly send `billToAccNumber: "9"` instead of `9n`
- ✅ Oracle Fusion accepts the payloads without errors
- ✅ All JSON API responses properly serialize BigInt fields

### Affected Fields
- `FusionSalesMetadata.billToAccount` → serialized as string
- `FusionInvoiceHeader.billToAccNumber` → serialized as string  
- `FusionInvoiceHeader.txnNumber` → serialized as string
- `FusionInvoiceHeader.customerTxnId` → serialized as string

## Testing

### Manual Test
1. Create an AR invoice with a customer that has a single-digit account number (e.g., "9")
2. Check the payload JSON logged in the console
3. Verify `billToAccNumber` appears as `"9"` not `9n`

### Expected Behavior
```json
{
  "BillToCustomerName": "Red Sea Mall",
  "BillToCustomerNumber": "9",
  "BillToSite": "9"
}
```

### Previously Broken Behavior
```json
{
  "BillToCustomerName": "Red Sea Mall",
  "BillToCustomerNumber": 9n,  ← Causes Oracle API error
  "BillToSite": "9"
}
```

## Future Considerations

### Adding New BigInt Fields
If you add new BigInt fields to the Prisma schema in the future:

1. They will **automatically** be serialized correctly due to the global `BigInt.prototype.toJSON` override
2. No additional code changes are needed
3. Consider adding explicit `.toString()` calls in critical paths for extra safety

### Alternative Approaches (Not Recommended)
- ❌ Converting schema to use `String` instead of `BigInt` - would lose numeric precision
- ❌ Manual string conversion at every usage point - error-prone and easy to miss
- ✅ Global toJSON override - clean, automatic, and comprehensive

## References

- **Prisma Schema**: `backend/prisma/schema.prisma` (lines 235, 244)
- **Global Fix**: `backend/src/index.js` (lines 9-12)
- **Service Layer**: `backend/src/services/fusionSalesMetadataService.js` (line 78)
- **Controller Usage**: 
  - `backend/src/controllers/arPipelineController.js` (line 1184)
  - `backend/src/controllers/vendReceiptController.js` (lines 313, 322, 430)

## Related Issues

- Oracle AR-856150 (different issue related to ConversionRateType)
- Large Oracle ID support (original reason for using BigInt type)
