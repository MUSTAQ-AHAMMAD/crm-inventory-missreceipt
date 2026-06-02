/**
 * Seed script to populate FusionReceiptMethod from FUSION_RECEIPT_METHOD CSV
 * Usage: node prisma/seedFusionReceiptMethod.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedReceiptMethods() {
  const csvPath = path.join(__dirname, '../../FUSION_RECEIPT_METHOD_202606021342.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('[Seed] File not found:', csvPath);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });

  console.log(`[Seed] Found ${records.length} receipt method rows`);

  let inserted = 0;
  let skipped = 0;

  for (const row of records) {
    try {
      await prisma.fusionReceiptMethod.create({
        data: {
          rowId:             row.ROW_ID ? parseInt(row.ROW_ID, 10) : null,
          receiptMethodId:   String(row.RECEIPT_METHOD_ID ?? '').trim(),
          receiptMethodName: String(row.RECEIPT_METHOD_NAME ?? '').trim(),
          receiptIsCash:     String(row.RECEIPT_IS_CASH ?? '0').trim() === '1',
          receiptBankCharge: parseFloat(row.RECEIPT_BANK_CHARGE ?? 0) || 0,
          receiptMethodTax:  parseFloat(row.RECEIPT_METHOD_TAX ?? 0) || 0,
          region:            String(row.REGION ?? '').trim(),
        },
      });
      inserted++;
    } catch (err) {
      console.warn(`[Seed] Skipped row (${row.RECEIPT_METHOD_NAME}/${row.REGION}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`[Seed] FusionReceiptMethod: ${inserted} inserted, ${skipped} skipped`);
}

seedReceiptMethods()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
