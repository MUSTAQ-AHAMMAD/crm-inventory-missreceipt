-- AlterTable
ALTER TABLE "InventoryFailureRecord" ADD COLUMN "responseBody" TEXT;
ALTER TABLE "InventoryFailureRecord" ADD COLUMN "responseStatus" INTEGER;

-- AlterTable
ALTER TABLE "InventorySuccessRecord" ADD COLUMN "responseBody" TEXT;
ALTER TABLE "InventorySuccessRecord" ADD COLUMN "responseStatus" INTEGER;
