# FUSION_SALES_METADATA Mapping for AR Invoice

## Overview

This implementation provides automatic mapping of sales header data from the FUSION_SALES_METADATA table to AR invoice payloads. The metadata table contains customer, business unit, and transaction source information that can be used to auto-populate AR invoice headers.

## Database Setup

### 1. Table Structure

The `FusionSalesMetadata` table has been added to the Prisma schema with the following fields:

- `id` - Auto-incrementing primary key
- `rowId` - Unique identifier from source data
- `billToName` - Customer name
- `billToAccount` - Customer account number
- `siteNumber` - Site/location number
- `businessUnit` - Business unit code
- `txnSource` - Transaction source
- `txnType` - Transaction type
- `rateIsCorporate` - Corporate rate flag
- `recActivityNameBank` - Bank activity name
- `subinventory` - Subinventory/location code
- `integrationSource` - Integration source
- `distributionAccId` - Distribution account ID (optional)
- `recActivityNameCash` - Cash activity name
- `region` - Region code
- `customerType` - Customer type (e.g., HUNGERSTATION, MRSOOL, NORMAL, TABBY, TAMARA)
- `costCenterCode` - Cost center code (optional)

### 2. Loading Data

To populate the table from the SQL file:

```bash
cd backend
node prisma/seedFusionMetadata.js
```

This will read the `FUSION_SALES_METADATA_202605180144.sql` file and insert/update all 2100+ records.

## API Endpoints

### 1. Create AR Invoice with Auto-Mapping

**Endpoint**: `POST /api/ar-invoice/create`

**Traditional Usage** (providing all fields):
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
  "receivablesInvoiceLines": [...]
}
```

**New Usage with Auto-Mapping** (minimal payload):
```json
{
  "customerName": "Hungerstation",
  "subinventory": "EXBSA",
  "TransactionDate": "2026-05-17",
  "AccountingDate": "2026-05-17",
  "PaymentTerms": "NET 30",
  "InvoiceCurrencyCode": "SAR",
  "receivablesInvoiceLines": [...]
}
```

When `customerName` and `subinventory` are provided, the system will automatically look up and populate:
- `BusinessUnit`
- `TransactionSource`
- `TransactionType`
- `BillToCustomerName`
- `BillToCustomerNumber`
- `BillToSite`

### 2. Get Metadata for a Customer/Location

**Endpoint**: `GET /api/ar-invoice/metadata`

**Query Parameters**:
- `customerName` - Customer name (required)
- `subinventory` - Subinventory code (required)

**Example Request**:
```
GET /api/ar-invoice/metadata?customerName=Hungerstation&subinventory=EXBSA
```

**Example Response**:
```json
{
  "metadata": {
    "id": 1,
    "rowId": 677,
    "billToName": "Hungerstation",
    "billToAccount": 45014,
    "siteNumber": "31074",
    "businessUnit": "AlQurashi-KSA",
    "txnSource": "Vend",
    "txnType": "Vend Invoice",
    "rateIsCorporate": "1",
    "recActivityNameBank": "Bank Charge",
    "subinventory": "EXBSA",
    "integrationSource": "Vend HQ",
    "distributionAccId": null,
    "recActivityNameCash": "Cash Rounding",
    "region": "SA",
    "customerType": "HUNGERSTATION",
    "costCenterCode": "0113",
    "createdAt": "2026-05-17T22:51:36.000Z",
    "updatedAt": "2026-05-17T22:51:36.000Z"
  },
  "headerMapping": {
    "BusinessUnit": "AlQurashi-KSA",
    "TransactionSource": "Vend",
    "TransactionType": "Vend Invoice",
    "BillToCustomerName": "Hungerstation",
    "BillToCustomerNumber": "45014",
    "BillToSite": "31074"
  }
}
```

### 3. List All Metadata Records

**Endpoint**: `GET /api/ar-invoice/metadata/list`

**Query Parameters**:
- `page` - Page number (default: 1)
- `limit` - Records per page (default: 50, max: 100)

**Example Request**:
```
GET /api/ar-invoice/metadata/list?page=1&limit=20
```

**Example Response**:
```json
{
  "records": [...],
  "total": 2100,
  "page": 1,
  "limit": 20
}
```

## Service Functions

The `fusionSalesMetadataService` provides the following functions:

### `findBySalesHeader(customerName, subinventory)`
Find metadata by customer name and subinventory location.

### `findByCustomerType(customerType, subinventory)`
Find metadata by customer type (e.g., HUNGERSTATION, MRSOOL) and subinventory.

### `mapToArInvoiceHeader(metadata)`
Convert a metadata record to AR invoice header fields.

### `getArInvoiceHeaderMapping(customerName, subinventory)`
Find and map metadata in one call - convenience method.

### `getAllMetadata(options)`
Retrieve all metadata records with pagination.

## Usage Examples

### Example 1: Creating an invoice with auto-mapping

```javascript
const response = await axios.post('/api/ar-invoice/create', {
  customerName: 'Hungerstation',
  subinventory: 'EXBSA',
  TransactionDate: '2026-05-17',
  AccountingDate: '2026-05-17',
  PaymentTerms: 'NET 30',
  InvoiceCurrencyCode: 'SAR',
  receivablesInvoiceLines: [
    {
      LineNumber: 1,
      ItemNumber: 'ITEM001',
      Description: 'Product A',
      Quantity: 10,
      UnitSellingPrice: 100,
      TaxClassificationCode: 'STANDARD'
    }
  ]
});
```

### Example 2: Looking up metadata before creating invoice

```javascript
// First, lookup metadata
const metadataResponse = await axios.get('/api/ar-invoice/metadata', {
  params: {
    customerName: 'Hungerstation',
    subinventory: 'EXBSA'
  }
});

console.log('Using business unit:', metadataResponse.data.headerMapping.BusinessUnit);

// Then create invoice with full control
const invoiceResponse = await axios.post('/api/ar-invoice/create', {
  ...metadataResponse.data.headerMapping,
  TransactionDate: '2026-05-17',
  AccountingDate: '2026-05-17',
  // ... rest of the fields
});
```

## Benefits

1. **Reduced Errors**: Automatically populate complex header fields from a centralized metadata table
2. **Simplified Payloads**: Clients can provide just customer name and location instead of all header fields
3. **Consistency**: Ensures all invoices for a customer/location use the same header data
4. **Flexibility**: Traditional full-payload mode still works - metadata is optional
5. **Maintainability**: Update metadata in one place to affect all future invoices

## Data Model Mapping

| Metadata Field | AR Invoice Field |
|----------------|------------------|
| businessUnit | BusinessUnit |
| txnSource | TransactionSource |
| txnType | TransactionType |
| billToName | BillToCustomerName |
| billToAccount | BillToCustomerNumber |
| siteNumber | BillToSite |

## Notes

- If metadata is not found for a given customer/location, the system will proceed with whatever data is provided in the payload
- Explicitly provided fields in the payload take precedence over metadata values
- The metadata table currently contains 2100+ records covering various customer types, locations, and business units
