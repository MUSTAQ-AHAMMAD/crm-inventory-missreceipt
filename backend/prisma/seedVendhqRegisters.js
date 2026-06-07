/**
 * Seed script to populate VendhqRegister from VENDHQ_REGISTERS SQL file
 * Usage: node prisma/seedVendhqRegisters.js
 *
 * Parses Oracle-format INSERT statements from VENDHQ_REGISTERS_202606062047.sql
 * and upserts each register row into the local SQLite VendhqRegister table.
 * The table is used for bank account mapping in standard and misc receipt payloads.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Parse a SQL value tuple string such as:
 *   ('382','223','WADILABAN',NULL,300000035114611,'AL Jazeerah Bank WADILABAN',300000035114647,NULL,NULL,'SA',NULL,NULL)
 * into an ordered array of string-or-null values.
 */
function parseSqlTuple(tupleStr) {
  // Strip surrounding parentheses
  const inner = tupleStr.replace(/^\s*\(/, '').replace(/\)\s*,?\s*$/, '');
  const fields = [];
  let i = 0;

  while (i < inner.length) {
    // Skip leading whitespace
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length) break;

    if (inner[i] === "'") {
      // Quoted string value – handle escaped single quotes ('') inside
      i++; // skip opening quote
      let val = '';
      while (i < inner.length) {
        if (inner[i] === "'" && inner[i + 1] === "'") {
          val += "'";
          i += 2;
        } else if (inner[i] === "'") {
          i++; // skip closing quote
          break;
        } else {
          val += inner[i++];
        }
      }
      fields.push(val);
    } else {
      // Unquoted value: numeric literal or NULL
      let val = '';
      while (i < inner.length && inner[i] !== ',') val += inner[i++];
      const trimmed = val.trim();
      fields.push(trimmed.toUpperCase() === 'NULL' ? null : trimmed);
    }

    // Advance past the comma separator between fields
    while (i < inner.length && inner[i] !== ',') i++;
    if (i < inner.length && inner[i] === ',') i++;
  }

  return fields;
}

async function seedRegisters() {
  const sqlPath = path.join(__dirname, '../../VENDHQ_REGISTERS_202606062047.sql');

  if (!fs.existsSync(sqlPath)) {
    console.error('[Seed] File not found:', sqlPath);
    process.exit(1);
  }

  console.log('[Seed] Reading SQL file:', sqlPath);
  const content = fs.readFileSync(sqlPath, 'utf-8');

  // Collect all value tuples across every INSERT statement in the file.
  // Each INSERT block ends at a semicolon; tuples are separated by commas.
  const tuples = [];
  // Match the VALUES block for each INSERT statement
  const insertPattern = /INSERT INTO\s+ODOO_INTEGRATION\.VENDHQ_REGISTERS\s*\([^)]+\)\s*VALUES\s*([\s\S]*?);/gi;
  let insertMatch;
  while ((insertMatch = insertPattern.exec(content)) !== null) {
    const valuesBlock = insertMatch[1];
    // Each tuple is delimited by ( ... )
    const tuplePattern = /\(([^)]*)\)/g;
    let tupleMatch;
    while ((tupleMatch = tuplePattern.exec(valuesBlock)) !== null) {
      tuples.push(tupleMatch[0]);
    }
  }

  console.log(`[Seed] Found ${tuples.length} register rows`);

  let upserted = 0;
  let skipped = 0;

  for (const tupleStr of tuples) {
    // Column order per SQL header:
    // REGISTER_ID, OUTLET_ID, REGISTER_NAME, CASH_ACCOUNT, CASH_ACCOUNT_ID,
    // BANK_ACCOUNT, BANK_ACCOUNT_ID, VERSION, DELETED_AT, REGION,
    // GIFT_ACCOUNT, GIFT_ACCOUNT_ID
    const [
      registerId, outletId, registerName,
      cashAccount, cashAccountId,
      bankAccount, bankAccountId,
      version, deletedAt, region,
      giftAccount, giftAccountId,
    ] = parseSqlTuple(tupleStr);

    if (!registerId) { skipped++; continue; }

    const data = {
      outletId:      outletId      || null,
      registerName:  registerName  || '',
      cashAccount:   cashAccount   || null,
      cashAccountId: cashAccountId || null,
      bankAccount:   bankAccount   || null,
      bankAccountId: bankAccountId || null,
      version:       version       || null,
      deletedAt:     deletedAt     || null,
      region:        region        || null,
      giftAccount:   giftAccount   || null,
      giftAccountId: giftAccountId || null,
    };

    try {
      await prisma.vendhqRegister.upsert({
        where:  { registerId: String(registerId) },
        update: data,
        create: { registerId: String(registerId), ...data },
      });
      upserted++;
    } catch (err) {
      console.warn(`[Seed] Skipped register ${registerId}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`[Seed] VendhqRegister: ${upserted} upserted, ${skipped} skipped`);
}

seedRegisters()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
