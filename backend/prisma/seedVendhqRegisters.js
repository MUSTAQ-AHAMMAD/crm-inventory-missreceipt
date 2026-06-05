/**
 * Seed script to populate VendhqRegister from VENDHQ_REGISTERS CSV
 * Usage: node prisma/seedVendhqRegisters.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const prisma = require('../src/services/prisma');

async function seedRegisters() {
  const csvPath = path.join(__dirname, '../../VENDHQ_REGISTERS_202606021344.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('[Seed] File not found:', csvPath);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });

  console.log(`[Seed] Found ${records.length} register rows`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of records) {
    const registerId = String(row.REGISTER_ID ?? '').trim();
    if (!registerId) { skipped++; continue; }

    try {
      await prisma.vendhqRegister.upsert({
        where: { registerId },
        update: {
          outletId:      row.OUTLET_ID   ? String(row.OUTLET_ID).trim()   : null,
          registerName:  String(row.REGISTER_NAME ?? '').trim(),
          cashAccount:   row.CASH_ACCOUNT   ? String(row.CASH_ACCOUNT).trim()   : null,
          cashAccountId: row.CASH_ACCOUNT_ID ? String(row.CASH_ACCOUNT_ID).trim() : null,
          bankAccount:   row.BANK_ACCOUNT   ? String(row.BANK_ACCOUNT).trim()   : null,
          bankAccountId: row.BANK_ACCOUNT_ID ? String(row.BANK_ACCOUNT_ID).trim() : null,
          version:       row.VERSION      ? String(row.VERSION).trim()      : null,
          deletedAt:     row.DELETED_AT   ? String(row.DELETED_AT).trim()   : null,
          region:        row.REGION       ? String(row.REGION).trim()       : null,
          giftAccount:   row.GIFT_ACCOUNT  ? String(row.GIFT_ACCOUNT).trim()  : null,
          giftAccountId: row.GIFT_ACCOUNT_ID ? String(row.GIFT_ACCOUNT_ID).trim() : null,
        },
        create: {
          registerId,
          outletId:      row.OUTLET_ID   ? String(row.OUTLET_ID).trim()   : null,
          registerName:  String(row.REGISTER_NAME ?? '').trim(),
          cashAccount:   row.CASH_ACCOUNT   ? String(row.CASH_ACCOUNT).trim()   : null,
          cashAccountId: row.CASH_ACCOUNT_ID ? String(row.CASH_ACCOUNT_ID).trim() : null,
          bankAccount:   row.BANK_ACCOUNT   ? String(row.BANK_ACCOUNT).trim()   : null,
          bankAccountId: row.BANK_ACCOUNT_ID ? String(row.BANK_ACCOUNT_ID).trim() : null,
          version:       row.VERSION      ? String(row.VERSION).trim()      : null,
          deletedAt:     row.DELETED_AT   ? String(row.DELETED_AT).trim()   : null,
          region:        row.REGION       ? String(row.REGION).trim()       : null,
          giftAccount:   row.GIFT_ACCOUNT  ? String(row.GIFT_ACCOUNT).trim()  : null,
          giftAccountId: row.GIFT_ACCOUNT_ID ? String(row.GIFT_ACCOUNT_ID).trim() : null,
        },
      });
      inserted++;
    } catch (err) {
      console.warn(`[Seed] Skipped register ${registerId}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`[Seed] VendhqRegister: ${inserted} upserted, ${skipped} skipped`);
}

seedRegisters()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
