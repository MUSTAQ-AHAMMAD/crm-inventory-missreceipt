# AR Invoice Preview Feature

## Overview

The AR Invoice Preview endpoint allows you to validate and preview your invoice payload before submitting it to Oracle Fusion. This is useful for:

- **Validating payload structure** before making actual API calls
- **Testing metadata auto-population** from FusionSalesMetadata
- **Debugging payload issues** without creating records in Oracle
- **Previewing the exact JSON** that would be sent to Oracle

## Endpoint

```
POST /api/ar-invoice/preview
```

**Authentication Required**: Yes (JWT token)

## Request Body

The preview endpoint accepts the same payload format as the `/create` endpoint. You can send either:

### Option 1: Full Payload

Provide all required fields directly:

```json
{
  "BusinessUnit": "AlQurashi-KSA",
  "TransactionSource": "Vend",
  "TransactionType": "Vend Invoice",
  "TransactionDate": "2026-05-17",
  "AccountingDate": "2026-05-17",
  "BillToCustomerName": "Hungerstation",
  "BillToCustomerNumber": "45014",
  "BillToSite": "31074",
  "PaymentTerms": "NET 30",
  "InvoiceCurrencyCode": "SAR",
  "CrossReference": "REF123",
  "Comments": "Test invoice",
  "receivablesInvoiceLines": [
    {
      "LineNumber": 1,
      "ItemNumber": "6281074736314",
      "Description": "Product A",
      "Quantity": 10,
      "UnitSellingPrice": 100.50,
      "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
    }
  ]
}
```

### Option 2: Minimal Payload with Metadata Lookup

Provide `customerName` and `subinventory` to auto-populate header fields from FusionSalesMetadata:

```json
{
  "customerName": "Hungerstation",
  "subinventory": "EXBSA",
  "TransactionDate": "2026-05-17",
  "AccountingDate": "2026-05-17",
  "PaymentTerms": "NET 30",
  "InvoiceCurrencyCode": "SAR",
  "receivablesInvoiceLines": [
    {
      "LineNumber": 1,
      "ItemNumber": "6281074736314",
      "Description": "Product A",
      "Quantity": 10,
      "UnitSellingPrice": 100.50,
      "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
    }
  ]
}
```

The system will automatically populate:
- `BusinessUnit`
- `TransactionSource`
- `TransactionType`
- `BillToCustomerName`
- `BillToCustomerNumber`
- `BillToSite`

## Response Format

### Success Response (HTTP 200)

When the payload is valid:

```json
{
  "valid": true,
  "message": "Payload is valid and ready to send to Oracle",
  "payload": {
    "BusinessUnit": "AlQurashi-KSA",
    "TransactionSource": "Vend",
    "TransactionType": "Vend Invoice",
    "TransactionDate": "2026-05-17",
    "AccountingDate": "2026-05-17",
    "BillToCustomerName": "Hungerstation",
    "BillToCustomerNumber": "45014",
    "BillToSite": "31074",
    "PaymentTerms": "NET 30",
    "InvoiceCurrencyCode": "SAR",
    "receivablesInvoiceLines": [
      {
        "LineNumber": 1,
        "ItemNumber": "6281074736314",
        "Description": "Product A",
        "Quantity": 10,
        "UnitSellingPrice": 100.50,
        "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
      }
    ]
  },
  "endpoint": "https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/receivablesInvoices"
}
```

### Error Response (HTTP 400)

When there are validation errors:

```json
{
  "valid": false,
  "errors": [
    "Missing required fields: BusinessUnit, TransactionSource, or TransactionType",
    "Line 1: Missing required fields: Quantity, UnitSellingPrice, or TaxClassificationCode"
  ],
  "payload": {
    "TransactionDate": "2026-05-17",
    "AccountingDate": "2026-05-17",
    "receivablesInvoiceLines": [
      {
        "LineNumber": 1,
        "ItemNumber": "6281074736314",
        "Description": "Product A"
      }
    ]
  }
}
```

## Validation Rules

The preview endpoint validates:

### Header Fields (Required)
- `BusinessUnit`
- `TransactionSource`
- `TransactionType`
- `TransactionDate`
- `AccountingDate`
- `BillToCustomerName`
- `BillToCustomerNumber`
- `BillToSite`
- `PaymentTerms`
- `InvoiceCurrencyCode`

### Line Items (Required)
- `receivablesInvoiceLines` must be a non-empty array
- Each line must have:
  - `LineNumber`
  - `ItemNumber`
  - `Description`
  - `Quantity`
  - `UnitSellingPrice`
  - `TaxClassificationCode`

## Usage Examples

### Example 1: Using cURL

```bash
curl -X POST https://your-api.com/api/ar-invoice/preview \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Hungerstation",
    "subinventory": "EXBSA",
    "TransactionDate": "2026-05-17",
    "AccountingDate": "2026-05-17",
    "PaymentTerms": "NET 30",
    "InvoiceCurrencyCode": "SAR",
    "receivablesInvoiceLines": [
      {
        "LineNumber": 1,
        "ItemNumber": "6281074736314",
        "Description": "Product A",
        "Quantity": 10,
        "UnitSellingPrice": 100.50,
        "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
      }
    ]
  }'
```

### Example 2: Using JavaScript/Axios

```javascript
const axios = require('axios');

async function previewInvoice() {
  try {
    const response = await axios.post(
      'https://your-api.com/api/ar-invoice/preview',
      {
        customerName: 'Hungerstation',
        subinventory: 'EXBSA',
        TransactionDate: '2026-05-17',
        AccountingDate: '2026-05-17',
        PaymentTerms: 'NET 30',
        InvoiceCurrencyCode: 'SAR',
        receivablesInvoiceLines: [
          {
            LineNumber: 1,
            ItemNumber: '6281074736314',
            Description: 'Product A',
            Quantity: 10,
            UnitSellingPrice: 100.50,
            TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%'
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${YOUR_JWT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.valid) {
      console.log('✅ Payload is valid!');
      console.log('Payload to be sent:', JSON.stringify(response.data.payload, null, 2));

      // Now you can safely call /create with the validated payload
      // await createInvoice(response.data.payload);
    } else {
      console.error('❌ Validation errors:', response.data.errors);
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

previewInvoice();
```

### Example 3: Using Python/Requests

```python
import requests
import json

def preview_invoice():
    url = 'https://your-api.com/api/ar-invoice/preview'
    headers = {
        'Authorization': f'Bearer {YOUR_JWT_TOKEN}',
        'Content-Type': 'application/json'
    }

    payload = {
        'customerName': 'Hungerstation',
        'subinventory': 'EXBSA',
        'TransactionDate': '2026-05-17',
        'AccountingDate': '2026-05-17',
        'PaymentTerms': 'NET 30',
        'InvoiceCurrencyCode': 'SAR',
        'receivablesInvoiceLines': [
            {
                'LineNumber': 1,
                'ItemNumber': '6281074736314',
                'Description': 'Product A',
                'Quantity': 10,
                'UnitSellingPrice': 100.50,
                'TaxClassificationCode': 'OUTPUT-GOODS-DOM-15%'
            }
        ]
    }

    response = requests.post(url, headers=headers, json=payload)
    data = response.json()

    if data.get('valid'):
        print('✅ Payload is valid!')
        print('Payload to be sent:', json.dumps(data['payload'], indent=2))
    else:
        print('❌ Validation errors:', data.get('errors'))

preview_invoice()
```

## Workflow

A typical workflow using the preview feature:

1. **Prepare your invoice data** (from CSV, database, or user input)
2. **Call `/preview`** to validate the payload structure
3. **Review the response** to see the complete payload with auto-populated fields
4. **Fix any validation errors** if needed
5. **Call `/create`** to actually submit the invoice to Oracle

```javascript
// Step 1 & 2: Preview the payload
const previewResponse = await axios.post('/api/ar-invoice/preview', invoiceData);

// Step 3: Check if valid
if (previewResponse.data.valid) {
  console.log('Payload validated successfully');
  console.log('Will send to Oracle:', previewResponse.data.endpoint);

  // Step 5: Create the actual invoice
  const createResponse = await axios.post('/api/ar-invoice/create', previewResponse.data.payload);
  console.log('Invoice created:', createResponse.data);
} else {
  // Step 4: Fix validation errors
  console.error('Please fix these errors:', previewResponse.data.errors);
}
```

## Benefits

- **No side effects**: Preview does not create database records or call Oracle
- **Fast validation**: Get instant feedback on payload structure
- **Metadata transparency**: See exactly what fields will be auto-populated
- **Error prevention**: Catch issues before making actual API calls to Oracle
- **Development aid**: Useful for debugging and testing during development

## Related Endpoints

- **POST /api/ar-invoice/create** - Create actual invoice in Oracle (after validation)
- **GET /api/ar-invoice/metadata** - Lookup metadata for a customer/subinventory
- **GET /api/ar-invoice/uploads** - List previous invoice submissions
- **GET /api/ar-invoice/uploads/:id** - View details of a specific submission

## Notes

- The preview endpoint uses the same validation logic as the `/create` endpoint
- Metadata lookup works the same way - matching `customerName` and `subinventory`
- Preview does not check Oracle credentials or API connectivity
- The returned payload is exactly what would be sent to Oracle via the `/create` endpoint
