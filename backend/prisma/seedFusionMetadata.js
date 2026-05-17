/**
 * Seed script to populate FusionSalesMetadata from SQL file
 * Usage: node prisma/seedFusionMetadata.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedMetadata() {
  const sqlFilePath = path.join(__dirname, '../../FUSION_SALES_METADATA_202605180144.sql');

  console.log('[Seed] Reading SQL file:', sqlFilePath);

  if (!fs.existsSync(sqlFilePath)) {
    console.error('[Seed] SQL file not found at:', sqlFilePath);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');

  // Parse INSERT statements
  const insertPattern = /INSERT INTO ODOO_INTEGRATION\.FUSION_SALES_METADATA \(ROW_ID,BILL_TO_NAME,BILL_TO_ACCOUNT,SITE_NUMBER,BUSINESS_UNIT,TXN_SOURCE,TXN_TYPE,RATE_IS_CORPORATE,REC_ACTIVITY_NAME_BANK,SUBINVENTORY,INTEGRATION_SOURCE,DISTRIBUTION_ACC_ID,REC_ACTIVITY_NAME_CASH,REGION,CUSTOMER_TYPE,COST_CENTER_CODE\) VALUES\s*/gi;

  const sections = sqlContent.split(insertPattern).filter(s => s.trim());

  console.log(`[Seed] Found ${sections.length} INSERT sections`);

  let totalRecords = 0;
  let successCount = 0;
  let errorCount = 0;

  for (const section of sections) {
    // Extract individual value tuples
    const valuePattern = /\((\d+),'([^']*)',(\d+),'([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)',([^,]*?),'([^']*)','([^']*)','([^']*)',([^)]*)\)/g;

    let match;
    while ((match = valuePattern.exec(section)) !== null) {
      totalRecords++;

      try {
        const [
          _, rowId, billToName, billToAccount, siteNumber, businessUnit,
          txnSource, txnType, rateIsCorporate, recActivityNameBank, subinventory,
          integrationSource, distributionAccId, recActivityNameCash, region,
          customerType, costCenterCode
        ] = match;

        // Clean up NULL values
        const cleanDistAccId = distributionAccId === 'NULL' || distributionAccId.trim() === '' ? null : distributionAccId.replace(/'/g, '');
        const cleanCostCenter = costCenterCode === 'NULL' || costCenterCode.trim() === '' ? null : costCenterCode.replace(/'/g, '');

        await prisma.fusionSalesMetadata.upsert({
          where: { rowId: parseInt(rowId) },
          update: {
            billToName,
            billToAccount: parseInt(billToAccount),
            siteNumber,
            businessUnit,
            txnSource,
            txnType,
            rateIsCorporate,
            recActivityNameBank,
            subinventory,
            integrationSource,
            distributionAccId: cleanDistAccId,
            recActivityNameCash,
            region,
            customerType,
            costCenterCode: cleanCostCenter,
          },
          create: {
            rowId: parseInt(rowId),
            billToName,
            billToAccount: parseInt(billToAccount),
            siteNumber,
            businessUnit,
            txnSource,
            txnType,
            rateIsCorporate,
            recActivityNameBank,
            subinventory,
            integrationSource,
            distributionAccId: cleanDistAccId,
            recActivityNameCash,
            region,
            customerType,
            costCenterCode: cleanCostCenter,
          },
        });

        successCount++;

        if (successCount % 50 === 0) {
          console.log(`[Seed] Processed ${successCount}/${totalRecords} records...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`[Seed] Error inserting record ${totalRecords}:`, error.message);
      }
    }
  }

  console.log('\n[Seed] Complete!');
  console.log(`Total records: ${totalRecords}`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
}

seedMetadata()
  .catch((error) => {
    console.error('[Seed] Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
