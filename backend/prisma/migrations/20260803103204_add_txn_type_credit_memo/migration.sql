-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FusionInvoiceHeader" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "requestId" INTEGER,
    "status" TEXT,
    "message" TEXT,
    "requestDate" DATETIME,
    "billToCustName" TEXT,
    "billToLocation" TEXT,
    "billToAccNumber" BIGINT,
    "businessUnit" TEXT,
    "paymentTermsName" TEXT,
    "txnSource" TEXT,
    "txnType" TEXT,
    "txnDate" DATETIME,
    "glDate" DATETIME,
    "currencyCode" TEXT,
    "txnNumber" BIGINT,
    "customerTxnId" BIGINT,
    "region" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FusionInvoiceHeader" ("billToAccNumber", "billToCustName", "billToLocation", "businessUnit", "createdAt", "currencyCode", "customerTxnId", "glDate", "id", "message", "paymentTermsName", "region", "requestDate", "requestId", "rowId", "status", "txnDate", "txnNumber", "txnSource", "txnType", "updatedAt") SELECT "billToAccNumber", "billToCustName", "billToLocation", "businessUnit", "createdAt", "currencyCode", "customerTxnId", "glDate", "id", "message", "paymentTermsName", "region", "requestDate", "requestId", "rowId", "status", "txnDate", "txnNumber", "txnSource", "txnType", "updatedAt" FROM "FusionInvoiceHeader";
DROP TABLE "FusionInvoiceHeader";
ALTER TABLE "new_FusionInvoiceHeader" RENAME TO "FusionInvoiceHeader";
CREATE INDEX "FusionInvoiceHeader_status_idx" ON "FusionInvoiceHeader"("status");
CREATE INDEX "FusionInvoiceHeader_requestId_idx" ON "FusionInvoiceHeader"("requestId");
CREATE INDEX "FusionInvoiceHeader_txnNumber_idx" ON "FusionInvoiceHeader"("txnNumber");
CREATE TABLE "new_FusionSalesMetadata" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER NOT NULL,
    "billToName" TEXT NOT NULL,
    "billToAccount" BIGINT NOT NULL,
    "siteNumber" TEXT NOT NULL,
    "businessUnit" TEXT NOT NULL,
    "txnSource" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
    "txnTypeCreditMemo" TEXT,
    "rateIsCorporate" TEXT NOT NULL,
    "recActivityNameBank" TEXT NOT NULL,
    "subinventory" TEXT NOT NULL,
    "integrationSource" TEXT NOT NULL,
    "distributionAccId" TEXT,
    "recActivityNameCash" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "customerType" TEXT NOT NULL,
    "costCenterCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FusionSalesMetadata" ("billToAccount", "billToName", "businessUnit", "costCenterCode", "createdAt", "customerType", "distributionAccId", "id", "integrationSource", "rateIsCorporate", "recActivityNameBank", "recActivityNameCash", "region", "rowId", "siteNumber", "subinventory", "txnSource", "txnType", "updatedAt") SELECT "billToAccount", "billToName", "businessUnit", "costCenterCode", "createdAt", "customerType", "distributionAccId", "id", "integrationSource", "rateIsCorporate", "recActivityNameBank", "recActivityNameCash", "region", "rowId", "siteNumber", "subinventory", "txnSource", "txnType", "updatedAt" FROM "FusionSalesMetadata";
DROP TABLE "FusionSalesMetadata";
ALTER TABLE "new_FusionSalesMetadata" RENAME TO "FusionSalesMetadata";
CREATE UNIQUE INDEX "FusionSalesMetadata_rowId_key" ON "FusionSalesMetadata"("rowId");
CREATE INDEX "FusionSalesMetadata_billToName_subinventory_idx" ON "FusionSalesMetadata"("billToName", "subinventory");
CREATE INDEX "FusionSalesMetadata_customerType_subinventory_idx" ON "FusionSalesMetadata"("customerType", "subinventory");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
