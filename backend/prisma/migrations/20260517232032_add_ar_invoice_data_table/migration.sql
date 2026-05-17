-- CreateTable
CREATE TABLE "ArInvoiceData" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerName" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "siteNumber" TEXT NOT NULL,
    "subinventory" TEXT,
    "businessUnit" TEXT NOT NULL,
    "transactionSource" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "transactionDate" TEXT NOT NULL,
    "accountingDate" TEXT NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "invoiceCurrencyCode" TEXT NOT NULL,
    "crossReference" TEXT,
    "comments" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitSellingPrice" REAL NOT NULL,
    "taxClassificationCode" TEXT NOT NULL,
    "salesOrder" TEXT,
    "memoLine" TEXT,
    "userId" INTEGER NOT NULL,
    "uploadBatchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArInvoiceData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArInvoiceData_customerName_subinventory_idx" ON "ArInvoiceData"("customerName", "subinventory");

-- CreateIndex
CREATE INDEX "ArInvoiceData_uploadBatchId_idx" ON "ArInvoiceData"("uploadBatchId");

-- CreateIndex
CREATE INDEX "ArInvoiceData_status_idx" ON "ArInvoiceData"("status");
