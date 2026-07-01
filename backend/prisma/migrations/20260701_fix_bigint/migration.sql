-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Fix BigInt for customerTxnId, txnNumber, billToAccNumber
-- Date: 2026-07-01
-- Issue: Oracle returns values larger than INT max (2,147,483,647)
-- Solution: Convert INT columns to BIGINT
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Fix FusionInvoiceHeader table
-- ──────────────────────────────────────────────────────────────────────────

-- SQLite doesn't support ALTER COLUMN directly, so we need to:
-- 1. Create a new table with the correct schema
-- 2. Copy data from the old table
-- 3. Drop the old table
-- 4. Rename the new table

-- Step 1: Create backup table
CREATE TABLE "FusionInvoiceHeader_backup" AS SELECT * FROM "FusionInvoiceHeader";

-- Step 2: Drop the old table
DROP TABLE "FusionInvoiceHeader";

-- Step 3: Create new table with BigInt columns
CREATE TABLE "FusionInvoiceHeader" (
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 4: Copy data back from backup
INSERT INTO "FusionInvoiceHeader" (
    "id", "rowId", "requestId", "status", "message", "requestDate",
    "billToCustName", "billToLocation", "billToAccNumber", "businessUnit",
    "paymentTermsName", "txnSource", "txnType", "txnDate", "glDate",
    "currencyCode", "txnNumber", "customerTxnId", "region",
    "createdAt", "updatedAt"
)
SELECT 
    "id", "rowId", "requestId", "status", "message", "requestDate",
    "billToCustName", "billToLocation", "billToAccNumber", "businessUnit",
    "paymentTermsName", "txnSource", "txnType", "txnDate", "glDate",
    "currencyCode", "txnNumber", "customerTxnId", "region",
    "createdAt", "updatedAt"
FROM "FusionInvoiceHeader_backup";

-- Step 5: Recreate indexes
CREATE INDEX "FusionInvoiceHeader_status_idx" ON "FusionInvoiceHeader"("status");
CREATE INDEX "FusionInvoiceHeader_requestId_idx" ON "FusionInvoiceHeader"("requestId");
CREATE INDEX "FusionInvoiceHeader_txnNumber_idx" ON "FusionInvoiceHeader"("txnNumber");

-- Step 6: Drop backup table
DROP TABLE "FusionInvoiceHeader_backup";

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Fix FusionSalesMetadata table
-- ──────────────────────────────────────────────────────────────────────────

-- Step 1: Create backup table
CREATE TABLE "FusionSalesMetadata_backup" AS SELECT * FROM "FusionSalesMetadata";

-- Step 2: Drop the old table
DROP TABLE "FusionSalesMetadata";

-- Step 3: Create new table with BigInt column
CREATE TABLE "FusionSalesMetadata" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER NOT NULL,
    "billToName" TEXT NOT NULL,
    "billToAccount" BIGINT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 4: Copy data back from backup
INSERT INTO "FusionSalesMetadata" (
    "id", "rowId", "billToName", "billToAccount", "siteNumber",
    "businessUnit", "txnSource", "txnType", "rateIsCorporate",
    "recActivityNameBank", "subinventory", "integrationSource",
    "distributionAccId", "recActivityNameCash", "region",
    "customerType", "costCenterCode", "createdAt", "updatedAt"
)
SELECT 
    "id", "rowId", "billToName", "billToAccount", "siteNumber",
    "businessUnit", "txnSource", "txnType", "rateIsCorporate",
    "recActivityNameBank", "subinventory", "integrationSource",
    "distributionAccId", "recActivityNameCash", "region",
    "customerType", "costCenterCode", "createdAt", "updatedAt"
FROM "FusionSalesMetadata_backup";

-- Step 5: Recreate indexes and unique constraint
CREATE UNIQUE INDEX "FusionSalesMetadata_rowId_key" ON "FusionSalesMetadata"("rowId");
CREATE INDEX "FusionSalesMetadata_billToName_subinventory_idx" ON "FusionSalesMetadata"("billToName", "subinventory");
CREATE INDEX "FusionSalesMetadata_customerType_subinventory_idx" ON "FusionSalesMetadata"("customerType", "subinventory");

-- Step 6: Drop backup table
DROP TABLE "FusionSalesMetadata_backup";

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration Complete
-- ═══════════════════════════════════════════════════════════════════════════
