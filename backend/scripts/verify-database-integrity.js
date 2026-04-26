/**
 * Database Integrity Verification Script
 *
 * This script checks the database for corrupted data that could cause
 * "Failed to convert rust String into napi string" errors.
 *
 * Usage:
 *   node scripts/verify-database-integrity.js [--fix]
 *
 * Options:
 *   --fix    Attempt to clean/fix corrupted records
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const shouldFix = process.argv.includes('--fix');

/**
 * Check if a string is valid UTF-8 and doesn't contain problematic characters
 */
function checkDataIntegrity(data, fieldName, recordId) {
  const issues = [];

  if (data === null || data === undefined) {
    return issues;
  }

  const dataStr = String(data);

  // Check for null bytes
  if (dataStr.includes('\0')) {
    issues.push({
      recordId,
      fieldName,
      issue: 'Contains null bytes',
      severity: 'high',
    });
  }

  // Check for excessive length (>1MB)
  if (dataStr.length > 1024 * 1024) {
    issues.push({
      recordId,
      fieldName,
      issue: `Excessive length: ${dataStr.length} bytes`,
      severity: 'high',
    });
  }

  // Check for invalid UTF-8
  try {
    const buffer = Buffer.from(dataStr, 'utf8');
    const decoded = buffer.toString('utf8');
    if (decoded !== dataStr) {
      issues.push({
        recordId,
        fieldName,
        issue: 'Invalid UTF-8 encoding',
        severity: 'high',
      });
    }
  } catch (err) {
    issues.push({
      recordId,
      fieldName,
      issue: 'Cannot encode/decode as UTF-8',
      severity: 'critical',
    });
  }

  return issues;
}

/**
 * Sanitize corrupted data
 */
function sanitizeData(data) {
  if (!data) return '';

  let sanitized = String(data);

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove problematic control characters
  sanitized = sanitized.replace(/[\x01-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // Truncate if too long
  if (sanitized.length > 1024 * 1024) {
    sanitized = sanitized.substring(0, 1024 * 1024);
  }

  // Ensure valid UTF-8
  try {
    const buffer = Buffer.from(sanitized, 'utf8');
    sanitized = buffer.toString('utf8');
  } catch (err) {
    sanitized = '[Corrupted data removed]';
  }

  return sanitized;
}

async function verifyInventorySuccessRecords() {
  console.log('\n=== Checking InventorySuccessRecord table ===');

  let count = 0;
  let totalIssues = 0;
  let fixed = 0;

  try {
    const records = await prisma.inventorySuccessRecord.findMany({
      select: {
        id: true,
        rawData: true,
        responseBody: true,
      },
    });

    console.log(`Found ${records.length} records to check...`);

    for (const record of records) {
      count++;

      const rawDataIssues = checkDataIntegrity(record.rawData, 'rawData', record.id);
      const responseBodyIssues = checkDataIntegrity(record.responseBody, 'responseBody', record.id);

      const allIssues = [...rawDataIssues, ...responseBodyIssues];

      if (allIssues.length > 0) {
        totalIssues += allIssues.length;
        console.log(`\n⚠️  Record ID ${record.id}:`);
        for (const issue of allIssues) {
          console.log(`   - ${issue.fieldName}: ${issue.issue} [${issue.severity}]`);
        }

        if (shouldFix) {
          try {
            await prisma.inventorySuccessRecord.update({
              where: { id: record.id },
              data: {
                rawData: sanitizeData(record.rawData),
                responseBody: sanitizeData(record.responseBody),
              },
            });
            console.log(`   ✓ Fixed record ${record.id}`);
            fixed++;
          } catch (err) {
            console.error(`   ✗ Failed to fix record ${record.id}: ${err.message}`);
          }
        }
      }

      if (count % 100 === 0) {
        process.stdout.write(`\rChecked ${count} records...`);
      }
    }

    console.log(`\n✓ Checked ${count} InventorySuccessRecord records`);
    console.log(`  Issues found: ${totalIssues}`);
    if (shouldFix) {
      console.log(`  Records fixed: ${fixed}`);
    }
  } catch (err) {
    console.error(`\n✗ Error checking InventorySuccessRecord: ${err.message}`);
    console.error('This error might indicate database corruption.');
  }
}

async function verifyInventoryFailureRecords() {
  console.log('\n=== Checking InventoryFailureRecord table ===');

  let count = 0;
  let totalIssues = 0;
  let fixed = 0;

  try {
    const records = await prisma.inventoryFailureRecord.findMany({
      select: {
        id: true,
        rawData: true,
        errorMessage: true,
        responseBody: true,
      },
    });

    console.log(`Found ${records.length} records to check...`);

    for (const record of records) {
      count++;

      const rawDataIssues = checkDataIntegrity(record.rawData, 'rawData', record.id);
      const errorMessageIssues = checkDataIntegrity(record.errorMessage, 'errorMessage', record.id);
      const responseBodyIssues = checkDataIntegrity(record.responseBody, 'responseBody', record.id);

      const allIssues = [...rawDataIssues, ...errorMessageIssues, ...responseBodyIssues];

      if (allIssues.length > 0) {
        totalIssues += allIssues.length;
        console.log(`\n⚠️  Record ID ${record.id}:`);
        for (const issue of allIssues) {
          console.log(`   - ${issue.fieldName}: ${issue.issue} [${issue.severity}]`);
        }

        if (shouldFix) {
          try {
            await prisma.inventoryFailureRecord.update({
              where: { id: record.id },
              data: {
                rawData: sanitizeData(record.rawData),
                errorMessage: sanitizeData(record.errorMessage),
                responseBody: sanitizeData(record.responseBody),
              },
            });
            console.log(`   ✓ Fixed record ${record.id}`);
            fixed++;
          } catch (err) {
            console.error(`   ✗ Failed to fix record ${record.id}: ${err.message}`);
          }
        }
      }

      if (count % 100 === 0) {
        process.stdout.write(`\rChecked ${count} records...`);
      }
    }

    console.log(`\n✓ Checked ${count} InventoryFailureRecord records`);
    console.log(`  Issues found: ${totalIssues}`);
    if (shouldFix) {
      console.log(`  Records fixed: ${fixed}`);
    }
  } catch (err) {
    console.error(`\n✗ Error checking InventoryFailureRecord: ${err.message}`);
    console.error('This error might indicate database corruption.');
  }
}

async function main() {
  console.log('=================================================');
  console.log('   Database Integrity Verification Tool');
  console.log('=================================================');

  if (shouldFix) {
    console.log('\n⚠️  FIX MODE ENABLED - Corrupted data will be cleaned');
    console.log('Press Ctrl+C within 3 seconds to cancel...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  } else {
    console.log('\n📋 READ-ONLY MODE - No changes will be made');
    console.log('Use --fix flag to clean corrupted records');
  }

  await verifyInventorySuccessRecords();
  await verifyInventoryFailureRecords();

  console.log('\n=================================================');
  console.log('✓ Verification complete');
  console.log('=================================================\n');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
