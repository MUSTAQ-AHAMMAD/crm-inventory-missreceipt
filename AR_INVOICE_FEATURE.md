# AR Invoice Feature

This document describes the AR Invoice creation feature added to the CRM Inventory & Receipt Management system.

## Overview

The AR Invoice feature allows users to create Accounts Receivable (AR) invoices in Oracle Fusion using a REST API. Users can submit a JSON payload through a web interface, and the system stores both the request and Oracle's response in the database.

## Architecture

### Backend Components

1. **Database Schema** (`backend/prisma/schema.prisma`)
   - `ArInvoiceUpload` model stores:
     - Request payload (JSON)
     - Response status (SUCCESS, FAILED, PROCESSING)
     - Response message
     - Full Oracle API response
     - HTTP status code
     - User ID and creation timestamp

2. **Controller** (`backend/src/controllers/arInvoiceController.js`)
   - `createInvoice()`: Validates payload, sends to Oracle, stores response
   - `listUploads()`: Returns paginated list of all AR Invoice uploads
   - `getUpload()`: Returns detailed information about a specific upload

3. **Routes** (`backend/src/routes/arInvoice.js`)
   - `POST /api/ar-invoice/create` - Create new AR Invoice
   - `GET /api/ar-invoice/uploads` - List all uploads
   - `GET /api/ar-invoice/uploads/:id` - Get upload details

### Frontend Components

1. **AR Invoice Page** (`frontend/src/pages/ArInvoicePage.jsx`)
   - JSON payload editor with syntax highlighting
   - Sample payload loader
   - JSON formatter
   - Real-time submission and result display
   - Upload history table

2. **AR Invoice Detail Page** (`frontend/src/pages/ArInvoiceDetailPage.jsx`)
   - Displays full request payload
   - Shows Oracle API response
   - Status and metadata display

3. **Navigation**
   - Added to sidebar menu with 📄 icon
   - Route: `/ar-invoice`

## Configuration

Add the following to your `backend/.env` file:

```env
# Oracle REST API endpoint for AR Invoice creation
ORACLE_AR_INVOICE_URL=https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/receivablesInvoices

# Oracle credentials (shared with other features)
ORACLE_USERNAME=your-username
ORACLE_PASSWORD=your-password
```

## API Request Format

### Required Fields

```json
{
  "BusinessUnit": "string",
  "TransactionSource": "string",
  "TransactionType": "string",
  "TransactionDate": "YYYY-MM-DD",
  "AccountingDate": "YYYY-MM-DD",
  "BillToCustomerName": "string",
  "BillToCustomerNumber": "string",
  "BillToSite": "string",
  "PaymentTerms": "string",
  "InvoiceCurrencyCode": "string",
  "receivablesInvoiceLines": [
    {
      "LineNumber": number,
      "ItemNumber": "string",
      "Description": "string",
      "Quantity": number,
      "UnitSellingPrice": number,
      "TaxClassificationCode": "string"
    }
  ]
}
```

### Optional Fields

- `CrossReference`: External reference ID
- `Comments`: Invoice comments
- `SalesOrder`: Sales order reference (per line)
- `MemoLine`: Memo line text (per line)

## Sample Payload

```json
{
  "BusinessUnit": "AlQurashi-KSA",
  "TransactionSource": "Vend",
  "TransactionType": "Vend Invoice",
  "TransactionDate": "2025-10-01",
  "AccountingDate": "2025-10-01",
  "BillToCustomerName": "Aziz Mall",
  "BillToCustomerNumber": "13",
  "BillToSite": "13",
  "PaymentTerms": "IMMEDIATE",
  "InvoiceCurrencyCode": "SAR",
  "CrossReference": "32886",
  "Comments": "Invoice generated from request ID 32886",
  "receivablesInvoiceLines": [
    {
      "LineNumber": 1,
      "ItemNumber": "6281074736314",
      "Description": "DOSE COLLECTION-HAPPINESS DOSE ROSE TOBACCO (PINK)/ Each",
      "Quantity": 2,
      "UnitSellingPrice": 94.79,
      "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%",
      "SalesOrder": "AZIZMALL/64181",
      "MemoLine": null
    }
  ]
}
```

## Usage

1. Navigate to **AR Invoice** in the sidebar
2. Edit the JSON payload or click "Load Sample" to use the default template
3. Click "Format JSON" to auto-format your payload
4. Click "Create AR Invoice" to submit to Oracle
5. View the result including Oracle's response
6. Access upload history at the bottom of the page
7. Click "View Details" on any upload to see full request/response

## Error Handling

The system validates:
- Required fields presence
- JSON syntax
- Line item completeness
- Oracle API connectivity

Errors are displayed with:
- HTTP status code
- Error message from Oracle
- Full response body for debugging

## Database Migration

The feature was added with migration `20260517223447_add_ar_invoice_upload` which creates the `ArInvoiceUpload` table.

## Testing

To test the API directly:

```bash
curl -X POST http://localhost:4000/api/ar-invoice/create \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @sample-ar-invoice.json
```

## Future Enhancements

Potential improvements:
- CSV bulk upload for multiple invoices
- Invoice template management
- Scheduled invoice creation
- Invoice cancellation/reversal
- Integration with inventory system for automatic item lookup
