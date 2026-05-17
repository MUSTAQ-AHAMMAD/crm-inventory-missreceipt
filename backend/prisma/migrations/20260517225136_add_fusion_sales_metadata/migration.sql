-- CreateTable
CREATE TABLE "FusionSalesMetadata" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER NOT NULL,
    "billToName" TEXT NOT NULL,
    "billToAccount" INTEGER NOT NULL,
    "siteNumber" TEXT NOT NULL,
    "businessUnit" TEXT NOT NULL,
    "txnSource" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "FusionSalesMetadata_rowId_key" ON "FusionSalesMetadata"("rowId");
