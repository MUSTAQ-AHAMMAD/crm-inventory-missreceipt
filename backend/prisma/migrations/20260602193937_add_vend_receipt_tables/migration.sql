-- CreateTable
CREATE TABLE "FusionReceiptMethod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "receiptMethodId" TEXT NOT NULL,
    "receiptMethodName" TEXT NOT NULL,
    "receiptIsCash" BOOLEAN NOT NULL DEFAULT false,
    "receiptBankCharge" REAL NOT NULL DEFAULT 0,
    "receiptMethodTax" REAL NOT NULL DEFAULT 0,
    "region" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VendhqRegister" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "registerId" TEXT NOT NULL,
    "outletId" TEXT,
    "registerName" TEXT NOT NULL,
    "cashAccount" TEXT,
    "cashAccountId" TEXT,
    "bankAccount" TEXT,
    "bankAccountId" TEXT,
    "version" TEXT,
    "deletedAt" TEXT,
    "region" TEXT,
    "giftAccount" TEXT,
    "giftAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FusionStandardReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "requestId" INTEGER,
    "status" TEXT,
    "message" TEXT,
    "requestDate" DATETIME,
    "currencyCode" TEXT,
    "receiptDate" DATETIME,
    "glDate" DATETIME,
    "exchangeDate" DATETIME,
    "exchangeRateType" TEXT,
    "receiptMethodId" TEXT,
    "receiptNumber" TEXT,
    "remittanceBankAccId" TEXT,
    "depositDate" DATETIME,
    "customerId" TEXT,
    "orgId" TEXT,
    "amount" REAL,
    "region" TEXT,
    "integMode" TEXT,
    "batchId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FusionMiscReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "requestId" INTEGER,
    "status" TEXT,
    "message" TEXT,
    "requestDate" DATETIME,
    "currencyCode" TEXT,
    "glDate" DATETIME,
    "exchangeDate" DATETIME,
    "exchangeRateType" TEXT,
    "receiptMethodName" TEXT,
    "receiptNumber" TEXT,
    "bankAccNumber" TEXT,
    "recActivityName" TEXT,
    "amount" REAL,
    "receiptDate" DATETIME,
    "region" TEXT,
    "integMode" TEXT,
    "batchId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FusionApplyReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rowId" INTEGER,
    "requestId" INTEGER,
    "status" TEXT,
    "message" TEXT,
    "requestDate" DATETIME,
    "accountingDate" DATETIME,
    "applicationDate" DATETIME,
    "txnNumber" TEXT,
    "receiptNumber" TEXT,
    "amountApplied" REAL,
    "currencyCode" TEXT,
    "region" TEXT,
    "integMode" TEXT,
    "txnSource" TEXT,
    "batchId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VendReceiptBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'SA',
    "totalStandard" INTEGER NOT NULL DEFAULT 0,
    "totalMisc" INTEGER NOT NULL DEFAULT 0,
    "successStandard" INTEGER NOT NULL DEFAULT 0,
    "failureStandard" INTEGER NOT NULL DEFAULT 0,
    "successMisc" INTEGER NOT NULL DEFAULT 0,
    "failureMisc" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "payloadsJson" TEXT NOT NULL,
    "responseLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendReceiptBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FusionReceiptMethod_receiptMethodName_region_idx" ON "FusionReceiptMethod"("receiptMethodName", "region");

-- CreateIndex
CREATE INDEX "FusionReceiptMethod_region_idx" ON "FusionReceiptMethod"("region");

-- CreateIndex
CREATE UNIQUE INDEX "VendhqRegister_registerId_key" ON "VendhqRegister"("registerId");

-- CreateIndex
CREATE INDEX "VendhqRegister_registerName_idx" ON "VendhqRegister"("registerName");

-- CreateIndex
CREATE INDEX "VendhqRegister_region_idx" ON "VendhqRegister"("region");

-- CreateIndex
CREATE INDEX "FusionStandardReceipt_receiptNumber_idx" ON "FusionStandardReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "FusionStandardReceipt_status_idx" ON "FusionStandardReceipt"("status");

-- CreateIndex
CREATE INDEX "FusionStandardReceipt_requestId_idx" ON "FusionStandardReceipt"("requestId");

-- CreateIndex
CREATE INDEX "FusionStandardReceipt_batchId_idx" ON "FusionStandardReceipt"("batchId");

-- CreateIndex
CREATE INDEX "FusionMiscReceipt_receiptNumber_idx" ON "FusionMiscReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "FusionMiscReceipt_status_idx" ON "FusionMiscReceipt"("status");

-- CreateIndex
CREATE INDEX "FusionMiscReceipt_requestId_idx" ON "FusionMiscReceipt"("requestId");

-- CreateIndex
CREATE INDEX "FusionMiscReceipt_batchId_idx" ON "FusionMiscReceipt"("batchId");

-- CreateIndex
CREATE INDEX "FusionApplyReceipt_receiptNumber_idx" ON "FusionApplyReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "FusionApplyReceipt_txnNumber_idx" ON "FusionApplyReceipt"("txnNumber");

-- CreateIndex
CREATE INDEX "FusionApplyReceipt_status_idx" ON "FusionApplyReceipt"("status");

-- CreateIndex
CREATE INDEX "FusionApplyReceipt_requestId_idx" ON "FusionApplyReceipt"("requestId");

-- CreateIndex
CREATE INDEX "FusionApplyReceipt_batchId_idx" ON "FusionApplyReceipt"("batchId");

-- CreateIndex
CREATE INDEX "VendReceiptBatch_status_idx" ON "VendReceiptBatch"("status");

-- CreateIndex
CREATE INDEX "VendReceiptBatch_userId_idx" ON "VendReceiptBatch"("userId");
