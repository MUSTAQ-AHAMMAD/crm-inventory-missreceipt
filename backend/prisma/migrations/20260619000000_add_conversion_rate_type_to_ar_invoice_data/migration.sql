-- Add conversionRateType to ArInvoiceData
-- Defaults to 'Corporate' for existing rows (matches Oracle Fusion KSA setup)
ALTER TABLE "ArInvoiceData" ADD COLUMN "conversionRateType" TEXT NOT NULL DEFAULT 'Corporate';
