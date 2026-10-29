/**
 * Import per-brand Credit Memo transaction types into FusionSalesMetadata.
 *
 * Populates the `txnTypeCreditMemo` column so the Vend Invoice generator can route
 * negative-/zero-total groups to a Credit Memo transaction type (Creation Sign =
 * Negative/Any) instead of an invoice type — which Oracle rejects with AR-855286.
 *
 * Usage:
 *   node scripts/importCreditMemoTypes.js <path-to-mapping.xlsx|.csv> [--dry-run]
 *
 * The mapping file needs a header row with (case/spacing-insensitive) columns:
 *   - Subinventory        (required)  e.g. "HASALMMAL"          — matched to metadata.subinventory
 *   - Credit Memo Type    (required)  e.g. "HA Vend Credit Memo" — written to txnTypeCreditMemo
 *   - Customer Type       (optional)  e.g. "NORMAL"             — narrows the update to one metadata row
 *
 * When Customer Type is omitted, every metadata row for that subinventory is updated.
 * Rows with a blank Credit Memo Type are skipped (they never clear an existing value).
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function normalizeCell(value) {
  return String(value ?? '')
    .replace(/[​-‍﻿]/g, '')
    .trim();
}

function normalizeUpper(value) {
  return normalizeCell(value).toUpperCase();
}

function normalizeHeaderKey(value) {
  return normalizeUpper(value)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,\-_]+$/g, '')
    .trim();
}

/** Look up a cell by any of several header spellings. */
function getFirstNonEmpty(row, aliases) {
  const map = new Map();
  for (const [key, val] of Object.entries(row)) {
    map.set(normalizeHeaderKey(key), normalizeCell(val));
  }
  for (const alias of aliases) {
    const v = map.get(normalizeHeaderKey(alias));
    if (v) return v;
  }
  return '';
}

const SUBINVENTORY_ALIASES = ['Subinventory', 'Subinventory Code', 'SubinventoryCode', 'Store', 'Store Code', 'Branch'];
const CM_TYPE_ALIASES = ['Credit Memo Type', 'CreditMemoType', 'Txn Type Credit Memo', 'TransactionTypeCreditMemo', 'CM Type', 'Credit Memo Transaction Type'];
const CUSTOMER_TYPE_ALIASES = ['Customer Type', 'CustomerType', 'Payment Type', 'PaymentType'];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: node scripts/importCreditMemoTypes.js <path-to-mapping.xlsx|.csv> [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`[CM Import] File not found: ${path.resolve(filePath)}`);
    process.exit(1);
  }

  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.error('[CM Import] No sheets found in the mapping file.');
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  console.log(`[CM Import] Read ${rows.length} row(s) from ${path.basename(filePath)}${dryRun ? ' (dry run)' : ''}`);

  let updated = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const [i, row] of rows.entries()) {
    const subinventory = normalizeUpper(getFirstNonEmpty(row, SUBINVENTORY_ALIASES));
    const creditMemoType = normalizeCell(getFirstNonEmpty(row, CM_TYPE_ALIASES));
    const customerType = normalizeUpper(getFirstNonEmpty(row, CUSTOMER_TYPE_ALIASES));

    if (!subinventory || !creditMemoType) {
      skipped++;
      continue;
    }

    const where = customerType ? { subinventory, customerType } : { subinventory };
    const matches = await prisma.fusionSalesMetadata.findMany({ where, select: { id: true } });

    if (matches.length === 0) {
      unmatched++;
      console.warn(`[CM Import] Row ${i + 2}: no metadata for subinventory="${subinventory}"${customerType ? `, customerType="${customerType}"` : ''}`);
      continue;
    }

    if (!dryRun) {
      await prisma.fusionSalesMetadata.updateMany({ where, data: { txnTypeCreditMemo: creditMemoType } });
    }
    updated += matches.length;
    console.log(`[CM Import] Row ${i + 2}: ${matches.length} row(s) ← "${creditMemoType}" (subinventory=${subinventory}${customerType ? `, customerType=${customerType}` : ''})`);
  }

  console.log(`\n[CM Import] Done. Updated ${updated} metadata row(s), skipped ${skipped} blank row(s), ${unmatched} unmatched.`);
}

main()
  .catch((err) => {
    console.error('[CM Import] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
