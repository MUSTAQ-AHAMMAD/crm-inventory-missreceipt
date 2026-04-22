-- CreateTable
CREATE TABLE "ApplyReceiptUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "totalReceipts" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "responseMessage" TEXT,
    "responseLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplyReceiptUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplyReceiptFailure" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uploadId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStep" TEXT NOT NULL,
    "requestPayload" TEXT,
    "responseBody" TEXT,
    "responseStatus" INTEGER,
    "customerTrxId" TEXT,
    "receiptId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplyReceiptFailure_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ApplyReceiptUpload" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
