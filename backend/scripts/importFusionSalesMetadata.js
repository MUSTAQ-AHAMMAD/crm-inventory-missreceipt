/**
 * Import FusionSalesMetadata from a CSV export (e.g. FUSION_SALES_METADATA_YYYYMMDDHHMM.csv).
 *
 * Oracle exports the metadata as CSV with the header:
 *   ROW_ID,BILL_TO_NAME,BILL_TO_ACCOUNT,SITE_NUMBER,SUBINVENTORY,CUSTOMER_TYPE,
 *   COST_CENTER_CODE,BUSINESS_UNIT,TXN_SOURCE,TXN_TYPE,RATE_IS_CORPORATE,
 *   REC_ACTIVITY_NAME_BANK,INTEGRATION_SOURCE,DISTRIBUTION_ACC_ID,REC_ACTIVITY_NAME_CASH,REGION
 *
 * Upserts by ROW_ID (the unique key), so it is safe to re-run: existing stores are
 * updated in place and new stores are created. The CSV has no TXN_TYPE_CREDIT_MEMO
 * column, so txnTypeCreditMemo is left untouched (managed separately by
 * importCreditMemoTypes.js).
 *
 * Usage:
 *   node scripts/importFusionSalesMetadata.js "C:/path/to/FUSION_SALES_METADATA.csv"          # apply
 *   node scripts/importFusionSalesMetadata.js "C:/path/to/FUSION_SALES_METADATA.csv" --dry-run # preview
 */

'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function clean(v) {
  return String(v ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}
function nullIf(v) {
  const s = clean(v);
  return s === '' || s.toUpperCase() === 'NULL' ? null : s;
}

function mapRow(row) {
  return {
    rowId: parseInt(clean(row.ROW_ID), 10),
    billToName: clean(row.BILL_TO_NAME),
    billToAccount: BigInt(clean(row.BILL_TO_ACCOUNT) || '0'),
    siteNumber: clean(row.SITE_NUMBER),
    subinventory: clean(row.SUBINVENTORY),
    customerType: clean(row.CUSTOMER_TYPE),
    costCenterCode: nullIf(row.COST_CENTER_CODE),
    businessUnit: clean(row.BUSINESS_UNIT),
    txnSource: clean(row.TXN_SOURCE),
    txnType: clean(row.TXN_TYPE),
    rateIsCorporate: clean(row.RATE_IS_CORPORATE),
    recActivityNameBank: clean(row.REC_ACTIVITY_NAME_BANK),
    integrationSource: clean(row.INTEGRATION_SOURCE),
    distributionAccId: nullIf(row.DISTRIBUTION_ACC_ID),
    recActivityNameCash: clean(row.REC_ACTIVITY_NAME_CASH),
    region: clean(row.REGION),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((a) => !a.startsWith('--'));

  if (!csvPath) {
    console.error('Usage: node scripts/importFusionSalesMetadata.js <csvPath> [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error('[Import] CSV not found at:', csvPath);
    process.exit(1);
  }

  console.log('[Import] Reading CSV:', csvPath, dryRun ? '(DRY RUN)' : '');
  const wb = XLSX.readFile(csvPath, { raw: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  console.log(`[Import] Parsed ${rows.length} CSV rows`);

  const mapped = [];
  const badRows = [];
  for (let i = 0; i < rows.length; i++) {
    const m = mapRow(rows[i]);
    if (!Number.isFinite(m.rowId)) { badRows.push(i + 2); continue; }
    mapped.push(m);
  }
  if (badRows.length) console.warn(`[Import] Skipping ${badRows.length} row(s) with invalid ROW_ID (CSV lines: ${badRows.slice(0, 10).join(', ')}${badRows.length > 10 ? '…' : ''})`);

  // Determine which rowIds already exist to report new vs updated
  const existing = await prisma.fusionSalesMetadata.findMany({ select: { rowId: true } });
  const existingIds = new Set(existing.map((e) => e.rowId));
  const newOnes = mapped.filter((m) => !existingIds.has(m.rowId));
  const updates = mapped.filter((m) => existingIds.has(m.rowId));

  console.log(`\n[Import] DB currently has ${existingIds.size} metadata rows.`);
  console.log(`[Import] CSV → ${newOnes.length} NEW, ${updates.length} existing (will update).`);

  if (newOnes.length) {
    console.log('\n=== NEW store/customer-type rows to be added ===');
    for (const m of newOnes) {
      console.log(`  rowId=${m.rowId}  ${m.subinventory}/${m.customerType}  acct=${m.billToAccount} site=${m.siteNumber} name="${m.billToName}"`);
    }
  }

  if (dryRun) {
    console.log('\n[Import] DRY RUN — no changes written.');
    return;
  }

  let ok = 0, err = 0;
  for (const m of mapped) {
    try {
      const { rowId, ...rest } = m;
      await prisma.fusionSalesMetadata.upsert({
        where: { rowId },
        update: rest,
        create: { rowId, ...rest },
      });
      ok++;
    } catch (e) {
      err++;
      console.error(`[Import] Error on rowId=${m.rowId} (${m.subinventory}/${m.customerType}): ${e.message}`);
    }
  }

  console.log(`\n[Import] Complete. Upserted ${ok} row(s) (${newOnes.length} new, ${updates.length} updated), ${err} error(s).`);
  const total = await prisma.fusionSalesMetadata.count();
  console.log(`[Import] DB now has ${total} metadata rows.`);
}

main()
  .catch((e) => { console.error('[Import] Fatal:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
