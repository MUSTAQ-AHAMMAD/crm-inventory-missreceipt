-- CreateTable
CREATE TABLE "FusionInvoiceHeader" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "requestId" INTEGER,
    "status" TEXT,
    "message" TEXT,
    "requestDate" DATETIME,
    "billToCustName" TEXT,
    "billToLocation" TEXT,
    "billToAccNumber" INTEGER,
    "businessUnit" TEXT,
    "paymentTermsName" TEXT,
    "txnSource" TEXT,
    "txnType" TEXT,
    "txnDate" DATETIME,
    "glDate" DATETIME,
    "currencyCode" TEXT,
    "txnNumber" INTEGER,
    "customerTxnId" INTEGER,
    "region" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FusionInvoiceLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "requestId" INTEGER,
    "status" TEXT,
    "message" TEXT,
    "requestDate" DATETIME,
    "invoiceNumber" TEXT,
    "lineNumber" INTEGER,
    "itemNumber" TEXT,
    "description" TEXT,
    "uom" TEXT,
    "quantity" REAL,
    "unitSellingPrice" REAL,
    "currencyCode" TEXT,
    "taxCode" TEXT,
    "version" INTEGER,
    "salesOrder" TEXT,
    "salesOrderLine" INTEGER,
    "region" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "headerId" INTEGER,
    CONSTRAINT "FusionInvoiceLine_headerId_fkey" FOREIGN KEY ("headerId") REFERENCES "FusionInvoiceHeader" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FusionInvoiceHeader_status_idx" ON "FusionInvoiceHeader"("status");

-- CreateIndex
CREATE INDEX "FusionInvoiceHeader_requestId_idx" ON "FusionInvoiceHeader"("requestId");

-- CreateIndex
CREATE INDEX "FusionInvoiceHeader_txnNumber_idx" ON "FusionInvoiceHeader"("txnNumber");

-- CreateIndex
CREATE INDEX "FusionInvoiceLine_status_idx" ON "FusionInvoiceLine"("status");

-- CreateIndex
CREATE INDEX "FusionInvoiceLine_requestId_idx" ON "FusionInvoiceLine"("requestId");

-- CreateIndex
CREATE INDEX "FusionInvoiceLine_invoiceNumber_idx" ON "FusionInvoiceLine"("invoiceNumber");

-- CreateIndex
CREATE INDEX "FusionInvoiceLine_salesOrder_idx" ON "FusionInvoiceLine"("salesOrder");
