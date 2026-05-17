-- CreateTable
CREATE TABLE "ArInvoiceUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "responseStatus" TEXT,
    "responseMessage" TEXT,
    "responseBody" TEXT,
    "httpStatus" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArInvoiceUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
