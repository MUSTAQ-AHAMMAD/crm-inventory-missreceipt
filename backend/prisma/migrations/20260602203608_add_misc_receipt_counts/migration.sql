-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MiscReceiptUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "xmlPayload" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" TEXT,
    "responseMessage" TEXT,
    "responseLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MiscReceiptUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MiscReceiptUpload" ("createdAt", "filename", "id", "responseLog", "responseMessage", "responseStatus", "userId", "xmlPayload") SELECT "createdAt", "filename", "id", "responseLog", "responseMessage", "responseStatus", "userId", "xmlPayload" FROM "MiscReceiptUpload";
DROP TABLE "MiscReceiptUpload";
ALTER TABLE "new_MiscReceiptUpload" RENAME TO "MiscReceiptUpload";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
