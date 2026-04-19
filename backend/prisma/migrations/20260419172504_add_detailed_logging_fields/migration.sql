-- AlterTable
ALTER TABLE "MiscReceiptFailure" ADD COLUMN "requestPayload" TEXT;
ALTER TABLE "MiscReceiptFailure" ADD COLUMN "responseBody" TEXT;
ALTER TABLE "MiscReceiptFailure" ADD COLUMN "responseStatus" INTEGER;

-- AlterTable
ALTER TABLE "StandardReceiptFailure" ADD COLUMN "requestPayload" TEXT;
ALTER TABLE "StandardReceiptFailure" ADD COLUMN "responseBody" TEXT;
ALTER TABLE "StandardReceiptFailure" ADD COLUMN "responseStatus" INTEGER;
