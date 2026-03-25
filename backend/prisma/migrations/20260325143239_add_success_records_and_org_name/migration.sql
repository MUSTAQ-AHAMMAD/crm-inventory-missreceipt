-- CreateTable
CREATE TABLE "InventorySuccessRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uploadId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventorySuccessRecord_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "InventoryUpload" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InventoryUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL DEFAULT '',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InventoryUpload" ("createdAt", "failureCount", "filename", "id", "status", "successCount", "totalRecords", "userId") SELECT "createdAt", "failureCount", "filename", "id", "status", "successCount", "totalRecords", "userId" FROM "InventoryUpload";
DROP TABLE "InventoryUpload";
ALTER TABLE "new_InventoryUpload" RENAME TO "InventoryUpload";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
