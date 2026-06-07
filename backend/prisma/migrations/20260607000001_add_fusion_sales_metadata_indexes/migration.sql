-- CreateIndex: speed up findBySalesHeader lookup (billToName + subinventory)
CREATE INDEX "FusionSalesMetadata_billToName_subinventory_idx" ON "FusionSalesMetadata"("billToName", "subinventory");

-- CreateIndex: speed up findByCustomerType lookup (customerType + subinventory)
CREATE INDEX "FusionSalesMetadata_customerType_subinventory_idx" ON "FusionSalesMetadata"("customerType", "subinventory");
