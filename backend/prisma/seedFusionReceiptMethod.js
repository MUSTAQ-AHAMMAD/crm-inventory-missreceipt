/**
 * Seed script to populate FusionReceiptMethod from FUSION_RECEIPT_METHOD SQL file.
 * Parses Oracle-style INSERT statements and upserts every row into the local
 * SQLite database so the data is available for receipt calculations and mappings.
 *
 * Usage: node prisma/seedFusionReceiptMethod.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Parse all value tuples from the SQL file.
 * Each row has the form:
 *   (RECEIPT_METHOD_ID, 'RECEIPT_METHOD_NAME', 'RECEIPT_IS_CASH', RECEIPT_BANK_CHARGE, RECEIPT_METHOD_TAX, 'REGION', ROW_ID)
 */
function parseReceiptMethodSql(sqlContent) {
  const rows = [];

  // Match every parenthesised value tuple in any INSERT block
  const tuplePattern = /\((\d+),'([^']*?)','([^']*?)',([\d.]+),([\d.]+),'([^']*?)',(\d+)\)/g;

  let match;
  while ((match = tuplePattern.exec(sqlContent)) !== null) {
    const [
      ,
      receiptMethodId,
      receiptMethodName,
      receiptIsCash,
      receiptBankCharge,
      receiptMethodTax,
      region,
      rowId,
    ] = match;

    rows.push({
      // receiptMethodId is stored as String in the Prisma schema (large Oracle IDs
      // exceed safe integer range in JavaScript, so string is the correct type)
      receiptMethodId:   receiptMethodId.trim(),
      receiptMethodName: receiptMethodName.trim(),
      receiptIsCash:     receiptIsCash.trim() === '1',
      receiptBankCharge: parseFloat(receiptBankCharge) || 0,
      receiptMethodTax:  parseFloat(receiptMethodTax) || 0,
      region:            region.trim(),
      rowId:             parseInt(rowId, 10),
    });
  }

  return rows;
}

async function seedReceiptMethods() {
  const sqlPath = path.join(__dirname, '../../FUSION_RECEIPT_METHOD_202606030400.sql');

  console.log('[Seed] Reading SQL file:', sqlPath);

  if (!fs.existsSync(sqlPath)) {
    console.error('[Seed] SQL file not found at:', sqlPath);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
  const rows = parseReceiptMethodSql(sqlContent);

  console.log(`[Seed] Parsed ${rows.length} receipt method rows`);

  // Intentionally wipe existing rows so every run of this script produces a
  // clean, authoritative dataset that exactly mirrors the SQL source file.
  // Use seed.js (npm run prisma:seed) for first-run-only setup.
  const deleted = await prisma.fusionReceiptMethod.deleteMany();
  console.log(`[Seed] Cleared ${deleted.count} existing FusionReceiptMethod rows`);

  let inserted = 0;
  let errorCount = 0;

  for (const row of rows) {
    try {
      await prisma.fusionReceiptMethod.create({ data: row });
      inserted++;
    } catch (err) {
      errorCount++;
      console.warn(
        `[Seed] Failed to insert (${row.receiptMethodName}/${row.region}): ${err.message}`,
      );
    }
  }

  console.log('\n[Seed] Complete!');
  console.log(`Total rows:  ${rows.length}`);
  console.log(`Inserted:    ${inserted}`);
  console.log(`Errors:      ${errorCount}`);
}

module.exports = { seedReceiptMethods };

// Run directly when called as a standalone script
if (require.main === module) {
  seedReceiptMethods()
    .catch((err) => { console.error('[Seed] Fatal error:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
