/**
 * Seed script to import historical Oracle response data from CSVs into:
 *   - FusionStandardReceipt (from FUSION_STANDARD_RECEIPT_*.csv)
 *   - FusionMiscReceipt     (from FUSION_MISC_RECEIPT_*.csv)
 *   - FusionApplyReceipt    (from FUSION_APPLY_RECEIPT_*.csv)
 *
 * Usage: node prisma/seedFusionReceiptData.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const prisma = require('../src/services/prisma');

const ROOT = path.join(__dirname, '../..');

function parseOptionalDate(value) {
  if (!value || String(value).trim() === '') return null;
  const d = new Date(String(value).trim());
  return isNaN(d.getTime()) ? null : d;
}

function parseOptionalFloat(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = parseFloat(String(value).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseOptionalInt(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = parseInt(String(value).trim(), 10);
  return isNaN(n) ? null : n;
}

// ─── Standard Receipt ─────────────────────────────────────────────────────────
async function seedStandardReceipts() {
  const files = fs.readdirSync(ROOT).filter(
    (f) => f.startsWith('FUSION_STANDARD_RECEIPT_') && f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.warn('[Seed] No FUSION_STANDARD_RECEIPT CSV files found');
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    console.log(`[Seed] ${file}: ${records.length} rows`);

    for (const row of records) {
      try {
        await prisma.fusionStandardReceipt.create({
          data: {
            rowId:               parseOptionalInt(row.ROW_ID),
            requestId:           parseOptionalInt(row.REQUEST_ID),
            status:              row.STATUS    ? String(row.STATUS).trim()    : null,
            message:             row.MESSAGE   ? String(row.MESSAGE).trim()   : null,
            requestDate:         parseOptionalDate(row.REQUEST_DATE),
            currencyCode:        row.CURRENCY_CODE   ? String(row.CURRENCY_CODE).trim()   : null,
            receiptDate:         parseOptionalDate(row.RECEIPT_DATE),
            glDate:              parseOptionalDate(row.GL_DATE),
            exchangeDate:        parseOptionalDate(row.EXCHANGE_DATE),
            exchangeRateType:    row.EXCHANGE_RATE_TYPE ? String(row.EXCHANGE_RATE_TYPE).trim() : null,
            receiptMethodId:     row.RECEIPT_METHOD_ID ? String(row.RECEIPT_METHOD_ID).trim() : null,
            receiptNumber:       row.RECEIPT_NUMBER    ? String(row.RECEIPT_NUMBER).trim()    : null,
            remittanceBankAccId: row.REMITTANCE_BACK_ACC_ID ? String(row.REMITTANCE_BACK_ACC_ID).trim() : null,
            depositDate:         parseOptionalDate(row.DEPOSIT_DATE),
            customerId:          row.CUSTOMER_ID ? String(row.CUSTOMER_ID).trim() : null,
            orgId:               row.ORG_ID     ? String(row.ORG_ID).trim()     : null,
            amount:              parseOptionalFloat(row.AMOUNT),
            region:              row.REGION     ? String(row.REGION).trim()     : null,
            integMode:           row.INTEG_MODE ? String(row.INTEG_MODE).trim() : null,
          },
        });
        inserted++;
      } catch (err) {
        console.warn(`[Seed] StandardReceipt row skipped: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`[Seed] FusionStandardReceipt: ${inserted} inserted, ${skipped} skipped`);
}

// ─── Misc Receipt ─────────────────────────────────────────────────────────────
async function seedMiscReceipts() {
  const files = fs.readdirSync(ROOT).filter(
    (f) => f.startsWith('FUSION_MISC_RECEIPT_') && f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.warn('[Seed] No FUSION_MISC_RECEIPT CSV files found');
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    console.log(`[Seed] ${file}: ${records.length} rows`);

    for (const row of records) {
      try {
        await prisma.fusionMiscReceipt.create({
          data: {
            rowId:            parseOptionalInt(row.ROW_ID),
            requestId:        parseOptionalInt(row.REQUEST_ID),
            status:           row.STATUS    ? String(row.STATUS).trim()    : null,
            message:          row.MESSAGE   ? String(row.MESSAGE).trim()   : null,
            requestDate:      parseOptionalDate(row.REQUEST_DATE),
            currencyCode:     row.CURRENCY_CODE       ? String(row.CURRENCY_CODE).trim()       : null,
            glDate:           parseOptionalDate(row.GL_DATE),
            exchangeDate:     parseOptionalDate(row.EXCHANGE_DATE),
            exchangeRateType: row.EXCHANGE_RATE_TYPE ? String(row.EXCHANGE_RATE_TYPE).trim() : null,
            receiptMethodName: row.RECEIPT_METHOD_NAME ? String(row.RECEIPT_METHOD_NAME).trim() : null,
            receiptNumber:     row.RECEIPT_NUMBER      ? String(row.RECEIPT_NUMBER).trim()      : null,
            bankAccNumber:     row.BANK_ACC_NUMBER     ? String(row.BANK_ACC_NUMBER).trim()     : null,
            recActivityName:   row.REC_ACTIVITY_NAME   ? String(row.REC_ACTIVITY_NAME).trim()   : null,
            amount:            parseOptionalFloat(row.AMOUNT),
            receiptDate:       parseOptionalDate(row.RECEIPT_DATE),
            region:            row.REGION     ? String(row.REGION).trim()     : null,
            integMode:         row.INTEG_MODE ? String(row.INTEG_MODE).trim() : null,
          },
        });
        inserted++;
      } catch (err) {
        console.warn(`[Seed] MiscReceipt row skipped: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`[Seed] FusionMiscReceipt: ${inserted} inserted, ${skipped} skipped`);
}

// ─── Apply Receipt ────────────────────────────────────────────────────────────
async function seedApplyReceipts() {
  const files = fs.readdirSync(ROOT).filter(
    (f) => f.startsWith('FUSION_APPLY_RECEIPT_') && f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.warn('[Seed] No FUSION_APPLY_RECEIPT CSV files found');
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    console.log(`[Seed] ${file}: ${records.length} rows`);

    for (const row of records) {
      try {
        await prisma.fusionApplyReceipt.create({
          data: {
            rowId:           parseOptionalInt(row.ROW_ID),
            requestId:       parseOptionalInt(row.REQUEST_ID),
            status:          row.STATUS    ? String(row.STATUS).trim()    : null,
            message:         row.MESSAGE   ? String(row.MESSAGE).trim()   : null,
            requestDate:     parseOptionalDate(row.REQUEST_DATE),
            accountingDate:  parseOptionalDate(row.ACCOUNTING_DATE),
            applicationDate: parseOptionalDate(row.APPLICATION_DATE),
            txnNumber:       row.TXN_NUMBER     ? String(row.TXN_NUMBER).trim()     : null,
            receiptNumber:   row.RECEIPT_NUMBER ? String(row.RECEIPT_NUMBER).trim() : null,
            amountApplied:   parseOptionalFloat(row.AMOUNT_APPLIED),
            currencyCode:    row.CURRENCY_CODE  ? String(row.CURRENCY_CODE).trim()  : null,
            region:          row.REGION         ? String(row.REGION).trim()         : null,
            integMode:       row.INTEG_MODE     ? String(row.INTEG_MODE).trim()     : null,
            txnSource:       row.TXN_SOURCE     ? String(row.TXN_SOURCE).trim()     : null,
          },
        });
        inserted++;
      } catch (err) {
        console.warn(`[Seed] ApplyReceipt row skipped: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`[Seed] FusionApplyReceipt: ${inserted} inserted, ${skipped} skipped`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[Seed] Starting historical receipt data import...');
  await seedStandardReceipts();
  await seedMiscReceipts();
  await seedApplyReceipts();
  console.log('[Seed] Done.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
