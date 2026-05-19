# Fusion Invoice Response Tables

## Overview

This document describes the `FusionInvoiceHeader` and `FusionInvoiceLine` tables that store responses from the Oracle Fusion AR Invoice API.

These tables correspond to the Oracle ODOO_INTEGRATION schema tables:
- `ODOO_INTEGRATION.FUSION_INVOICE_HEADER`
- `ODOO_INTEGRATION.FUSION_INVOICE_LINE`

## Database Tables

### FusionInvoiceHeader

Stores header-level response data from AR Invoice API calls.

| Field | Type | Description |
|-------|------|-------------|
| id | Integer | Primary key (auto-increment) |
| rowId | Integer | ROW_ID from Oracle response |
| requestId | Integer | REQUEST_ID from Oracle response |
| status | String | Status from Oracle (e.g., "Success", "Failed") |
| message | String | MESSAGE from Oracle (error/success message) |
| requestDate | DateTime | REQUEST_DATE from Oracle |
| billToCustName | String | BILL_TO_CUST_NAME |
| billToLocation | String | BILL_TO_LOCATION |
| billToAccNumber | Integer | BILL_TO_ACC_NUMBER |
| businessUnit | String | BUSINESS_UNIT |
| paymentTermsName | String | PAYMENT_TERMS_NAME |
| txnSource | String | TXN_SOURCE (Transaction Source) |
| txnType | String | TXN_TYPE (Transaction Type) |
| txnDate | DateTime | TXN_DATE (Transaction Date) |
| glDate | DateTime | GL_DATE (General Ledger Date) |
| currencyCode | String | CURRENCY_CODE |
| txnNumber | Integer | TXN_NUMBER (Transaction Number) |
| customerTxnId | Integer | CUSTOMER_TXN_ID |
| region | String | REGION |
| createdAt | DateTime | Record creation timestamp |
| updatedAt | DateTime | Record update timestamp |

**Indexes:**
- `status` - for filtering by status
- `requestId` - for grouping by request
- `txnNumber` - for looking up by transaction number

### FusionInvoiceLine

Stores line-level response data from AR Invoice API calls.

| Field | Type | Description |
|-------|------|-------------|
| id | Integer | Primary key (auto-increment) |
| rowId | Integer | ROW_ID from Oracle response |
| requestId | Integer | REQUEST_ID from Oracle response |
| status | String | Status from Oracle (e.g., "Success", "Failed") |
| message | String | MESSAGE from Oracle (error/success message) |
| requestDate | DateTime | REQUEST_DATE from Oracle |
| invoiceNumber | String | INVOICE_NUMBER |
| lineNumber | Integer | LINE_NUMBER |
| itemNumber | String | ITEM_NUMBER |
| description | String | DESCRIPTION |
| uom | String | UOM (Unit of Measure) |
| quantity | Float | QUANTITY |
| unitSellingPrice | Float | UNIT_SELLING_PRICE |
| currencyCode | String | CURRENCY_CODE |
| taxCode | String | TAX_CODE |
| version | Integer | VERSION |
| salesOrder | String | SALES_ORDER |
| salesOrderLine | Integer | SALES_ORDER_LINE |
| region | String | REGION |
| headerId | Integer | Foreign key to FusionInvoiceHeader |
| createdAt | DateTime | Record creation timestamp |
| updatedAt | DateTime | Record update timestamp |

**Indexes:**
- `status` - for filtering by status
- `requestId` - for grouping by request
- `invoiceNumber` - for looking up by invoice
- `salesOrder` - for looking up by sales order

## Relationships

- One `FusionInvoiceHeader` can have many `FusionInvoiceLine` records
- Each `FusionInvoiceLine` can optionally reference a `FusionInvoiceHeader` via `headerId`

## Usage Examples

### Storing Response Data with Prisma

```javascript
const prisma = require('./services/prisma');

// After creating an AR invoice and receiving a response from Oracle
async function storeInvoiceResponse(responseData) {
  // Create header record
  const header = await prisma.fusionInvoiceHeader.create({
    data: {
      requestId: responseData.requestId,
      status: 'Success',
      message: 'Invoice created successfully',
      requestDate: new Date(),
      billToCustName: responseData.BillToCustomerName,
      billToAccNumber: parseInt(responseData.BillToCustomerNumber),
      businessUnit: responseData.BusinessUnit,
      txnSource: responseData.TransactionSource,
      txnType: responseData.TransactionType,
      txnDate: new Date(responseData.TransactionDate),
      glDate: new Date(responseData.AccountingDate),
      currencyCode: responseData.InvoiceCurrencyCode,
      txnNumber: responseData.TransactionNumber,
      region: 'SA',
    },
  });

  // Create line records
  for (const line of responseData.receivablesInvoiceLines) {
    await prisma.fusionInvoiceLine.create({
      data: {
        requestId: responseData.requestId,
        status: 'Success',
        requestDate: new Date(),
        headerId: header.id,
        invoiceNumber: responseData.TransactionNumber?.toString(),
        lineNumber: line.LineNumber,
        itemNumber: line.ItemNumber,
        description: line.Description,
        quantity: line.Quantity,
        unitSellingPrice: line.UnitSellingPrice,
        currencyCode: line.InvoiceCurrencyCode || responseData.InvoiceCurrencyCode,
        taxCode: line.TaxClassificationCode,
        salesOrder: line.SalesOrder,
        region: 'SA',
      },
    });
  }

  return header;
}
```

### Querying Response Data

```javascript
// Get all successful invoice headers
const successfulHeaders = await prisma.fusionInvoiceHeader.findMany({
  where: { status: 'Success' },
  include: { lines: true },
  orderBy: { createdAt: 'desc' },
});

// Get invoice lines for a specific sales order
const orderLines = await prisma.fusionInvoiceLine.findMany({
  where: { salesOrder: 'ORDER123' },
  include: { header: true },
});

// Get failed invoices
const failedHeaders = await prisma.fusionInvoiceHeader.findMany({
  where: { status: { not: 'Success' } },
  select: {
    id: true,
    requestId: true,
    status: true,
    message: true,
    billToCustName: true,
    createdAt: true,
  },
});
```

## Oracle Trigger Note

The problem statement mentions a trigger `BACKUP_VENDHQ_LINE_ITEMS_TRG` that updates the `BACKUP_VENDHQ_LINE_ITEMS` table when invoice line status changes to 'Success'.

This trigger logic should be implemented in your application code when storing responses:

```javascript
// After storing a successful FusionInvoiceLine record
if (lineStatus === 'Success') {
  // Update the backup table or flag
  await prisma.$executeRaw`
    UPDATE BACKUP_VENDHQ_LINE_ITEMS
    SET INV_UPLOAD_QNT_FLAG = 'Y'
    WHERE invoice_number = ${salesOrder}
    AND LINE_NUMBER = ${salesOrderLine}
  `;
}
```

## Migration

The tables were created using Prisma migration:

```bash
npx prisma migrate dev --name add_fusion_invoice_response_tables
```

Migration file: `backend/prisma/migrations/20260519103155_add_fusion_invoice_response_tables/migration.sql`

## Related Files

- **Prisma Schema**: `backend/prisma/schema.prisma` (lines 275-341)
- **Migration**: `backend/prisma/migrations/20260519103155_add_fusion_invoice_response_tables/migration.sql`
- **AR Invoice Controller**: `backend/src/controllers/arInvoiceController.js`
- **AR Invoice Data Controller**: `backend/src/controllers/arInvoiceDataController.js`

## Future Enhancements

Consider adding:
1. Controller endpoints to query these response tables
2. Frontend views to display invoice creation history
3. Retry logic for failed invoices based on stored data
4. Analytics dashboard showing success/failure rates
