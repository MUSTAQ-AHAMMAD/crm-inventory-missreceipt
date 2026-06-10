-- CreateTable: VendInvoiceCrossRef
-- Persists the stable CrossReference number for each unique
-- (subinventory, date, paymentType) combination so that re-uploading
-- the same day's Vend invoice data always produces the same CrossReference.
CREATE TABLE "VendInvoiceCrossRef" (
    "id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subinventory"   TEXT    NOT NULL,
    "date"           TEXT    NOT NULL,
    "paymentType"    TEXT    NOT NULL,
    "crossReference" INTEGER NOT NULL,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex: unique CrossReference value
CREATE UNIQUE INDEX "VendInvoiceCrossRef_crossReference_key"
    ON "VendInvoiceCrossRef"("crossReference");

-- CreateIndex: unique per (subinventory, date, paymentType)
CREATE UNIQUE INDEX "VendInvoiceCrossRef_subinventory_date_paymentType_key"
    ON "VendInvoiceCrossRef"("subinventory", "date", "paymentType");

-- CreateIndex: lookup by subinventory + date
CREATE INDEX "VendInvoiceCrossRef_subinventory_date_idx"
    ON "VendInvoiceCrossRef"("subinventory", "date");
