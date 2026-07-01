# AR Invoice SOAP Structure Fix

## Summary

Fixed the AR Invoice SOAP envelope builder to match the **proven working payload** that successfully created Oracle invoice #2678575.

## Problem

The previous implementation used an **incorrect SOAP structure**:
- ❌ Root: `inv:createSimpleInvoice` with `inv:invoiceHeader` wrapper
- ❌ Line fields used nested structures for Quantity and UnitSellingPrice
- ❌ ConversionRateType was conditionally omitted for SAR currency
- ❌ Multiple redundant namespace declarations

This structure was **rejected by Oracle** and failed to create invoices.

## Solution

Updated to use the **correct SOAP structure** verified in production:
- ✅ Root: `typ:createSimpleInvoice` with `typ:invoiceHeaderInformation` wrapper
- ✅ Quantity uses `unitCode` attribute: `<typ:Quantity unitCode="Ea">1</typ:Quantity>`
- ✅ UnitSellingPrice uses `currencyCode` attribute: `<typ:UnitSellingPrice currencyCode="SAR">300.00</typ:UnitSellingPrice>`
- ✅ ConversionRateType **always included** (defaults to "Corporate")
- ✅ Clean namespace declarations (only `typ` namespace needed)

## Working Payload Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://xmlns.oracle.com/apps/financials/receivables/transactions/invoices/invoiceService/types/">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createSimpleInvoice>
      <typ:invoiceHeaderInformation>
        <typ:BillToCustomerName>Red Sea Mall</typ:BillToCustomerName>
        <typ:BillToAccountNumber>9</typ:BillToAccountNumber>
        <typ:BillToLocation>9</typ:BillToLocation>
        <typ:BusinessUnit>AlQurashi-KSA</typ:BusinessUnit>
        <typ:TransactionSource>Vend</typ:TransactionSource>
        <typ:TransactionType>Vend Invoice</typ:TransactionType>
        <typ:InvoiceCurrencyCode>SAR</typ:InvoiceCurrencyCode>
        <typ:ConversionRateType>Corporate</typ:ConversionRateType>
        <typ:PaymentTermsName>IMMEDIATE</typ:PaymentTermsName>
        <typ:TrxDate>2026-06-01</typ:TrxDate>
        <typ:GlDate>2026-06-01</typ:GlDate>
        
        <!-- Regular line item with ItemNumber -->
        <typ:InvoiceLine>
          <typ:LineNumber>1</typ:LineNumber>
          <typ:ItemNumber>6287020283765</typ:ItemNumber>
          <typ:Description>Product description</typ:Description>
          <typ:Quantity unitCode="Ea">1</typ:Quantity>
          <typ:UnitSellingPrice currencyCode="SAR">300.00</typ:UnitSellingPrice>
          <typ:SalesOrder>REDSEA/60822</typ:SalesOrder>
          <typ:SalesOrderLine>1</typ:SalesOrderLine>
          <typ:TaxClassificationCode>OUTPUT-GOODS-DOM-15%</typ:TaxClassificationCode>
        </typ:InvoiceLine>
        
        <!-- Discount line item with MemoLineName -->
        <typ:InvoiceLine>
          <typ:LineNumber>2</typ:LineNumber>
          <typ:MemoLineName>Discount Item</typ:MemoLineName>
          <typ:Description>Discount applied</typ:Description>
          <typ:Quantity unitCode="Ea">1</typ:Quantity>
          <typ:UnitSellingPrice currencyCode="SAR">-50.00</typ:UnitSellingPrice>
          <typ:SalesOrder>REDSEA/60822</typ:SalesOrder>
          <typ:SalesOrderLine>2</typ:SalesOrderLine>
          <typ:TaxClassificationCode>OUTPUT-GOODS-DOM-15%</typ:TaxClassificationCode>
        </typ:InvoiceLine>
      </typ:invoiceHeaderInformation>
    </typ:createSimpleInvoice>
  </soapenv:Body>
</soapenv:Envelope>
```

## Field Mappings

| Payload Field | SOAP Element | Notes |
|--------------|--------------|-------|
| `TransactionDate` | `TrxDate` | Different name |
| `AccountingDate` | `GlDate` | Different name |
| `BillToCustomerNumber` | `BillToAccountNumber` | Different name |
| `BillToSite` | `BillToLocation` | Different name |
| `PaymentTerms` | `PaymentTermsName` | Different name, UPPERCASE recommended |
| `InvoiceCurrencyCode` | `InvoiceCurrencyCode` | Same name |
| `ConversionRateType` | `ConversionRateType` | Always included, defaults to "Corporate" |
| `receivablesInvoiceLines` | `InvoiceLine` | Array of line items |

## Line Item Fields

### Regular Items (with ItemNumber)
```xml
<typ:InvoiceLine>
  <typ:LineNumber>1</typ:LineNumber>
  <typ:ItemNumber>6287020283765</typ:ItemNumber>
  <typ:Description>Product description</typ:Description>
  <typ:Quantity unitCode="Ea">1</typ:Quantity>
  <typ:UnitSellingPrice currencyCode="SAR">300.00</typ:UnitSellingPrice>
  <typ:SalesOrder>REDSEA/60822</typ:SalesOrder>
  <typ:SalesOrderLine>1</typ:SalesOrderLine>
  <typ:TaxClassificationCode>OUTPUT-GOODS-DOM-15%</typ:TaxClassificationCode>
</typ:InvoiceLine>
```

### Discount/Memo Items (with MemoLineName)
```xml
<typ:InvoiceLine>
  <typ:LineNumber>2</typ:LineNumber>
  <typ:MemoLineName>Discount Item</typ:MemoLineName>
  <typ:Description>Discount applied</typ:Description>
  <typ:Quantity unitCode="Ea">1</typ:Quantity>
  <typ:UnitSellingPrice currencyCode="SAR">-50.00</typ:UnitSellingPrice>
  <typ:SalesOrder>REDSEA/60822</typ:SalesOrder>
  <typ:SalesOrderLine>2</typ:SalesOrderLine>
  <typ:TaxClassificationCode>OUTPUT-GOODS-DOM-15%</typ:TaxClassificationCode>
</typ:InvoiceLine>
```

## Payload Example (JavaScript)

```javascript
const payload = {
  BusinessUnit: "AlQurashi-KSA",
  TransactionSource: "Vend",
  TransactionType: "Vend Invoice",
  TransactionDate: "2026-06-01",          // Maps to TrxDate
  AccountingDate: "2026-06-01",            // Maps to GlDate
  BillToCustomerName: "Red Sea Mall",
  BillToCustomerNumber: "9",               // Maps to BillToAccountNumber
  BillToSite: "9",                         // Maps to BillToLocation
  PaymentTerms: "IMMEDIATE",               // Maps to PaymentTermsName (UPPERCASE)
  InvoiceCurrencyCode: "SAR",
  ConversionRateType: "Corporate",         // Optional, defaults to "Corporate"
  receivablesInvoiceLines: [
    {
      LineNumber: 1,
      ItemNumber: "6287020283765",         // For regular items
      Description: "Product description",
      Quantity: 1,
      UnitSellingPrice: 300,
      TaxClassificationCode: "OUTPUT-GOODS-DOM-15%",
      SalesOrder: "REDSEA/60822",
      SalesOrderLine: 1
    },
    {
      LineNumber: 2,
      MemoLine: "Discount Item",           // For discount lines (use MemoLineName)
      Description: "Discount applied",
      Quantity: 1,
      UnitSellingPrice: -50,
      TaxClassificationCode: "OUTPUT-GOODS-DOM-15%",
      SalesOrder: "REDSEA/60822",
      SalesOrderLine: 2
    }
  ]
};
```

## Key Changes Made

1. **Root Structure**: Changed from `inv:createSimpleInvoice` to `typ:createSimpleInvoice`
2. **Wrapper Element**: Changed from `inv:invoiceHeader` to `typ:invoiceHeaderInformation`
3. **Namespace**: All field tags now use `typ:` prefix instead of `inv:`
4. **Quantity Format**: Now uses attribute `unitCode="Ea"` instead of nested structure
5. **UnitSellingPrice Format**: Now uses attribute `currencyCode="SAR"` instead of nested structure
6. **ConversionRateType**: Always included (defaults to "Corporate"), not conditionally omitted
7. **UOM Default**: Changed from 'EA' to 'Ea' (capitalized)
8. **Namespace Cleanup**: Removed unused `adf` and `inv` namespace declarations

## Files Changed

- `backend/src/services/soapEnvelopeBuilder.js` - Updated `buildArInvoiceSoapEnvelope()` function

## Verification

Created invoice #2678575 successfully in Oracle Fusion using this structure via SOAP UI.

## Testing

Test script available at `/tmp/test-invoice-envelope.js`:

```bash
node /tmp/test-invoice-envelope.js
```

## Response Parsing

The response parsing already handles `typ:createSimpleInvoiceResponse` format:
- `backend/src/controllers/arInvoiceController.js` - `extractInvoiceDataFromSoap()`
- `backend/src/controllers/arPipelineController.js` - `extractInvoiceDataFromSoap()`

Both functions check for multiple response formats including `typ:createSimpleInvoiceResponse`.

## Memory Updates

- ✅ Downvoted incorrect memory about `inv:createSimpleInvoice` structure
- ✅ Stored new memory with correct `typ:createSimpleInvoice` structure

## Migration Notes

All future AR invoice payloads will now be generated with the correct structure. Existing code using `buildArInvoiceSoapEnvelope()` will automatically use the new structure without any changes required.
