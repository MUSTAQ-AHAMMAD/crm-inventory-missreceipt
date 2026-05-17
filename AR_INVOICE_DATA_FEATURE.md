# AR Invoice Data Upload Feature

This document describes the AR Invoice Data upload feature that allows users to upload CSV files containing invoice line items, store them in the database, and auto-generate payloads for Oracle submission.

## Overview

The AR Invoice Data feature provides a complete workflow for managing AR invoice line items:

1. **Upload CSV**: Upload invoice line items from CSV files
2. **Auto-populate Headers**: Automatically fetch customer/business unit data from FusionSalesMetadata
3. **Store Data**: Save all line items in the database for future use
4. **Generate Payloads**: Create Oracle-ready JSON payloads from stored data
5. **Submit to Oracle**: Send generated payloads directly to Oracle Fusion

## Database Schema

### ArInvoiceData Table

The `ArInvoiceData` table stores individual AR invoice line items with the following structure:

**Header Information:**
- `customerName` - Customer name
- `customerNumber` - Customer account number
- `siteNumber` - Site/location number
- `subinventory` - Subinventory code (optional)
- `businessUnit` - Business unit
- `transactionSource` - Transaction source
- `transactionType` - Transaction type
- `transactionDate` - Transaction date (YYYY-MM-DD)
- `accountingDate` - Accounting date (YYYY-MM-DD)
- `paymentTerms` - Payment terms
- `invoiceCurrencyCode` - Currency code
- `crossReference` - External reference (optional)
- `comments` - Invoice comments (optional)

**Line Item Information:**
- `lineNumber` - Line number
- `itemNumber` - Item/SKU number
- `description` - Item description
- `quantity` - Quantity
- `unitSellingPrice` - Unit price
- `taxClassificationCode` - Tax classification
- `salesOrder` - Sales order reference (optional)
- `memoLine` - Memo line text (optional)

**Metadata:**
- `userId` - User who uploaded the data
- `uploadBatchId` - Batch ID (groups lines from same upload)
- `status` - PENDING, PROCESSED, or FAILED
- `processedAt` - Timestamp when processed
- `createdAt` / `updatedAt` - Audit timestamps

## API Endpoints

### 1. Upload CSV

**Endpoint:** `POST /api/ar-invoice-data/upload`

**Content-Type:** `multipart/form-data`

**Request:**
```bash
curl -X POST http://localhost:4000/api/ar-invoice-data/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@ar_invoice_data.csv"
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully uploaded 25 invoice line items",
  "uploadBatchId": "550e8400-e29b-41d4-a716-446655440000",
  "totalRecords": 25
}
```

### 2. List Records

**Endpoint:** `GET /api/ar-invoice-data/list`

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Records per page (default: 50, max: 100)
- `status` - Filter by status (PENDING, PROCESSED, FAILED)
- `uploadBatchId` - Filter by batch ID

**Example:**
```bash
curl -X GET "http://localhost:4000/api/ar-invoice-data/list?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. List Batches

**Endpoint:** `GET /api/ar-invoice-data/batches`

**Response:**
```json
{
  "batches": [
    {
      "uploadBatchId": "550e8400-e29b-41d4-a716-446655440000",
      "recordCount": 25,
      "createdAt": "2026-05-17T23:20:00.000Z"
    }
  ]
}
```

### 4. Generate Payload

**Endpoint:** `POST /api/ar-invoice-data/generate-payload`

**Request Body:**
```json
{
  "uploadBatchId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Or specify specific record IDs:
```json
{
  "recordIds": [1, 2, 3, 4, 5]
}
```

**Response:**
```json
{
  "success": true,
  "invoiceCount": 2,
  "totalLines": 25,
  "payloads": [
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
      "Comments": "Generated from batch upload",
      "receivablesInvoiceLines": [
        {
          "LineNumber": 1,
          "ItemNumber": "6281074736314",
          "Description": "Product A",
          "Quantity": 10,
          "UnitSellingPrice": 100.50,
          "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%",
          "SalesOrder": "ORDER123",
          "MemoLine": null
        }
      ]
    }
  ]
}
```

### 5. Delete Batch

**Endpoint:** `DELETE /api/ar-invoice-data/batch/:uploadBatchId`

**Example:**
```bash
curl -X DELETE http://localhost:4000/api/ar-invoice-data/batch/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 6. Download Template

**Endpoint:** `GET /api/ar-invoice-data/template`

Downloads a CSV template with example data.

## CSV File Format

### Required Columns

1. `customerName` - Customer name
2. `itemNumber` - Item/SKU number
3. `description` - Item description
4. `quantity` - Quantity (numeric)
5. `unitSellingPrice` - Unit price (numeric)
6. `taxClassificationCode` - Tax classification code
7. `transactionDate` - Transaction date (YYYY-MM-DD, DD-MM-YYYY, Excel serial)
8. `accountingDate` - Accounting date (same formats)
9. `paymentTerms` - Payment terms
10. `invoiceCurrencyCode` - Currency code (e.g., SAR, USD)

### Optional Columns

- `customerNumber` - Customer account number
- `siteNumber` - Site number
- `subinventory` - Subinventory code
- `businessUnit` - Business unit
- `transactionSource` - Transaction source
- `transactionType` - Transaction type
- `crossReference` - External reference
- `comments` - Invoice comments
- `lineNumber` - Line number (auto-generated if not provided)
- `salesOrder` - Sales order reference
- `memoLine` - Memo line text

### Auto-Population from Metadata

If you provide `customerName` and `subinventory`, the system will automatically look up and populate these fields from the `FusionSalesMetadata` table:

- `customerNumber` (BillToCustomerNumber)
- `siteNumber` (BillToSite)
- `businessUnit` (BusinessUnit)
- `transactionSource` (TransactionSource)
- `transactionType` (TransactionType)

This reduces manual data entry and ensures consistency.

### Sample CSV

```csv
customerName,itemNumber,description,quantity,unitSellingPrice,taxClassificationCode,transactionDate,accountingDate,paymentTerms,invoiceCurrencyCode,subinventory
Hungerstation,6281074736314,Product A,10,100.50,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,NET 30,SAR,EXBSA
Hungerstation,6281074736315,Product B,5,200.00,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,NET 30,SAR,EXBSA
Aziz Mall,6281074736316,Product C,20,50.00,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,IMMEDIATE,SAR,EXBSA
```

## Frontend Usage

### 1. Upload CSV

1. Navigate to **AR Invoice Data** in the sidebar (📋 icon)
2. Click **Download Template** to get a sample CSV file
3. Fill in your invoice line items
4. Drag & drop the CSV file or click to browse
5. Click **Upload CSV**
6. View the upload result with batch ID

### 2. View Batches

The "Uploaded Batches" section shows:
- Batch ID (shortened for display)
- Number of records in batch
- Creation timestamp
- Action buttons

### 3. View Records

Click **View Records** on any batch to see all line items:
- Line number
- Customer name
- Item number
- Description
- Quantity and price
- Transaction date
- Status (PENDING/PROCESSED/FAILED)

### 4. Generate Payload

Click **Generate Payload** on any batch to:
- Group line items by customer and transaction date
- Create Oracle-ready JSON payloads
- Display formatted JSON for review
- Copy to clipboard
- Navigate directly to AR Invoice creation page

### 5. Delete Batch

Click **Delete** to remove all records in a batch (with confirmation).

## Workflow Examples

### Example 1: Simple CSV Upload and Submit

1. Download the CSV template
2. Add your invoice line items with `customerName` and `subinventory`
3. Upload the CSV file
4. Click **Generate Payload** on the uploaded batch
5. Review the auto-generated payload
6. Click "→ Use this payload in AR Invoice Creation"
7. Submit to Oracle Fusion

### Example 2: Multiple Customers in One CSV

```csv
customerName,itemNumber,description,quantity,unitSellingPrice,taxClassificationCode,transactionDate,accountingDate,paymentTerms,invoiceCurrencyCode,subinventory
Hungerstation,ITEM001,Product A,10,100,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,NET 30,SAR,EXBSA
Hungerstation,ITEM002,Product B,5,200,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,NET 30,SAR,EXBSA
Aziz Mall,ITEM003,Product C,20,50,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,IMMEDIATE,SAR,EXBSA
Aziz Mall,ITEM004,Product D,15,75,OUTPUT-GOODS-DOM-15%,2026-05-17,2026-05-17,IMMEDIATE,SAR,EXBSA
```

When you generate the payload, the system will create **2 invoices**:
- Invoice 1 for Hungerstation (2 lines)
- Invoice 2 for Aziz Mall (2 lines)

## Data Validation

The system validates:

1. **CSV Structure**: All required columns must be present
2. **Required Fields**: All required values must be provided
3. **Data Types**: Numeric fields must be valid numbers
4. **Date Formats**: Dates must be in supported formats
5. **Header Data**: If metadata lookup fails, validation ensures manual fields are complete

## Error Handling

### Upload Errors

If validation fails, you'll see:
- Error message indicating the issue
- Row number where the error occurred
- Missing or invalid field names

### Example Error

```json
{
  "error": "Some rows have validation errors",
  "errors": [
    {
      "row": 3,
      "error": "quantity must be a valid number"
    },
    {
      "row": 5,
      "error": "transactionDate must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format"
    }
  ],
  "totalErrors": 2
}
```

## Benefits

1. **Bulk Operations**: Upload hundreds of line items at once
2. **Data Reusability**: Store data for future reference or reprocessing
3. **Auto-Population**: Reduce manual entry with metadata lookup
4. **Batch Management**: Organize uploads by batch for easy tracking
5. **Payload Preview**: Review generated payloads before submission
6. **Seamless Integration**: Direct integration with AR Invoice creation
7. **Error Prevention**: Validation ensures data quality before storage

## Technical Notes

- CSV files are processed server-side with the `csv-parse` library
- Date normalization supports multiple formats including Excel serial numbers
- Batch IDs are UUIDs generated with the `uuid` library
- File uploads use `express-fileupload` middleware (50MB limit)
- Auto-population uses the existing `fusionSalesMetadataService`
- Payloads are grouped by `customerName_transactionDate_crossReference`

## Future Enhancements

Potential improvements:
- Scheduled batch processing
- Email notifications on upload completion
- Export batches back to CSV
- Bulk status updates (mark as processed)
- Duplicate detection
- Invoice splitting strategies
- Integration with inventory system
