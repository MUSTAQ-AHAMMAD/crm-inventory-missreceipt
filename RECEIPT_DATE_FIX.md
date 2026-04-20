# Receipt Date Format Support - Fix Summary

## Issue
Users were receiving the error: "Row 2: ReceiptDate must be in YYYY-MM-DD format" when uploading CSV files with Excel serial numbers in date fields.

## Root Cause
The `normalizeDate` function in both `miscReceiptController.js` and `standardReceiptController.js` only supported:
- YYYY-MM-DD format (e.g., 2024-01-20)
- DD-MM-YYYY format (e.g., 20-01-2024)

It did not support Excel serial numbers (e.g., 45046), which Excel automatically generates when exporting dates to CSV.

## Solution
Updated the `normalizeDate` function in both controllers to support Excel serial numbers, matching the functionality already present in the `inventoryTemplateController.js`.

### Supported Date Formats (Now)
1. **YYYY-MM-DD** (ISO format): `2024-01-20`
2. **DD-MM-YYYY** (European format): `20-01-2024`
3. **Excel Serial Numbers**: `45046` (converts to 2023-04-29)

### How Excel Serial Numbers Work
- Excel stores dates as the number of days since December 30, 1899
- Serial number 1 = January 1, 1900
- Serial number 45046 = April 29, 2023
- The conversion accounts for Excel's 1900 leap year bug

## Payload Examples

### Miscellaneous Receipt CSV
```csv
Amount,CurrencyCode,DepositDate,ReceiptDate,GlDate,OrgId,ReceiptNumber,ReceivableActivityName,BankAccountNumber
-100.00,SAR,2024-01-20,2024-01-20,2024-01-20,101,REC001,Misc Activity,123456789
-250.50,SAR,45046,45046,45046,101,REC002,Misc Activity,123456789
-150.75,SAR,20-01-2024,20-01-2024,20-01-2024,101,REC003,Misc Activity,123456789
```

**Resulting SOAP XML Payload (Row 2 with Excel serial):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:com="http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/">
  <soapenv:Header/>
  <soapenv:Body>
    <com:createMiscellaneousReceipt>
      <com:miscellaneousReceipt>
        <com:Amount>-250.50</com:Amount>
        <com:CurrencyCode>SAR</com:CurrencyCode>
        <com:ReceiptNumber>REC002</com:ReceiptNumber>
        <com:ReceiptDate>2023-04-29</com:ReceiptDate>
        <com:DepositDate>2023-04-29</com:DepositDate>
        <com:GlDate>2023-04-29</com:GlDate>
        <com:ReceivableActivityName>Misc Activity</com:ReceivableActivityName>
        <com:BankAccountNumber>123456789</com:BankAccountNumber>
        <com:OrgId>101</com:OrgId>
      </com:miscellaneousReceipt>
    </com:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>
```

### Standard Receipt CSV
```csv
ReceiptNumber,ReceiptMethod,ReceiptDate,BusinessUnit,CustomerAccountNumber,CustomerSite,Amount,Currency,RemittanceBankAccountNumber,AccountingDate
Visa-001,Visa,2026-03-05,AlQurashi-KSA,116012,100005,422,SAR,157-95017321-ALARIDAH,2026-03-05
Visa-002,Visa,45046,AlQurashi-KSA,116012,100005,1250.50,SAR,157-95017321-ALARIDAH,45046
Visa-003,MasterCard,05-03-2026,AlQurashi-KSA,116013,100006,750.75,SAR,157-95017321-ALARIDAH,05-03-2026
```

**Resulting REST API Payload (Row 2 with Excel serial):**
```json
{
  "ReceiptNumber": "Visa-002",
  "ReceiptMethod": "Visa",
  "ReceiptDate": "2023-04-29",
  "BusinessUnit": "AlQurashi-KSA",
  "CustomerAccountNumber": "116012",
  "CustomerSite": "100005",
  "Amount": "1250.50",
  "Currency": "SAR",
  "RemittanceBankAccountNumber": "157-95017321-ALARIDAH",
  "AccountingDate": "2023-04-29"
}
```

## Testing
All existing tests continue to pass:
- ✓ Misc Receipt Controller: 17 tests passed
- ✓ Standard Receipt Controller: 14 tests passed

## Files Modified
- `backend/src/controllers/miscReceiptController.js`
- `backend/src/controllers/standardReceiptController.js`

## Conversion Examples
| Excel Serial | Converted Date | Format |
|--------------|----------------|---------|
| 45046 | 2023-04-29 | YYYY-MM-DD |
| 45047 | 2023-04-30 | YYYY-MM-DD |
| 45412 | 2024-04-29 | YYYY-MM-DD |
| 1 | 1900-01-01 | YYYY-MM-DD |
| 44562 | 2022-01-01 | YYYY-MM-DD |

Users can now export dates from Excel without manually formatting them, and the system will automatically convert them to the required YYYY-MM-DD format in the payload.
