#!/usr/bin/env node

/**
 * Performance Test Script
 * 
 * Tests database query performance after BigInt migration
 * 
 * Usage:
 *   npm run db:performance-test
 */

const { PrismaClient } = require('@prisma/client');
const { performanceMonitor } = require('../src/services/performanceMonitor');

const prisma = new PrismaClient();

/**
 * Format milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Test 1: Query large invoice headers
 */
async function testLargeInvoiceQuery() {
  console.log('\n📊 Test 1: Query FusionInvoiceHeader with BigInt fields');
  console.log('─'.repeat(70));
  
  const timer = performanceMonitor.startQuery('findManyInvoices', {
    take: 100,
    orderBy: { txnDate: 'desc' },
  });
  
  try {
    const invoices = await prisma.fusionInvoiceHeader.findMany({
      take: 100,
      orderBy: { txnDate: 'desc' },
    });
    
    const metric = timer.end();
    
    console.log(`✅ Query executed successfully`);
    console.log(`   Records found: ${invoices.length}`);
    console.log(`   Duration: ${formatDuration(metric.duration)}`);
    console.log(`   Memory delta: ${performanceMonitor.formatBytes(metric.memoryDelta)}`);
    
    // Check for BigInt values
    const bigIntInvoices = invoices.filter(inv => 
      (inv.customerTxnId && inv.customerTxnId > 2147483647) ||
      (inv.txnNumber && inv.txnNumber > 2147483647) ||
      (inv.billToAccNumber && inv.billToAccNumber > 2147483647)
    );
    
    if (bigIntInvoices.length > 0) {
      console.log(`   ✅ Found ${bigIntInvoices.length} invoice(s) with BigInt values > INT_MAX`);
      console.log(`   Sample: customerTxnId=${bigIntInvoices[0].customerTxnId}`);
    } else {
      console.log(`   ℹ️  No invoices with BigInt values > INT_MAX found (this is OK if data is small)`);
    }
    
    return { success: true, duration: metric.duration, count: invoices.length };
  } catch (err) {
    timer.end();
    console.error(`❌ Query failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Test 2: Query with indexed BigInt field
 */
async function testIndexedQuery() {
  console.log('\n📊 Test 2: Query by indexed txnNumber (BigInt)');
  console.log('─'.repeat(70));
  
  const timer = performanceMonitor.startQuery('findByTxnNumber');
  
  try {
    // Get a sample txnNumber first
    const sample = await prisma.fusionInvoiceHeader.findFirst({
      where: { txnNumber: { not: null } },
      select: { txnNumber: true },
    });
    
    if (!sample || !sample.txnNumber) {
      console.log('ℹ️  No invoices with txnNumber found - skipping test');
      timer.end();
      return { success: true, skipped: true };
    }
    
    const invoice = await prisma.fusionInvoiceHeader.findFirst({
      where: { txnNumber: sample.txnNumber },
    });
    
    const metric = timer.end();
    
    console.log(`✅ Indexed query executed successfully`);
    console.log(`   txnNumber searched: ${sample.txnNumber}`);
    console.log(`   Record found: ${invoice ? 'Yes' : 'No'}`);
    console.log(`   Duration: ${formatDuration(metric.duration)}`);
    console.log(`   Memory delta: ${performanceMonitor.formatBytes(metric.memoryDelta)}`);
    
    return { success: true, duration: metric.duration };
  } catch (err) {
    timer.end();
    console.error(`❌ Query failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Test 3: Query FusionSalesMetadata with BigInt billToAccount
 */
async function testSalesMetadataQuery() {
  console.log('\n📊 Test 3: Query FusionSalesMetadata with BigInt billToAccount');
  console.log('─'.repeat(70));
  
  const timer = performanceMonitor.startQuery('findManySalesMetadata', {
    take: 50,
  });
  
  try {
    const metadata = await prisma.fusionSalesMetadata.findMany({
      take: 50,
    });
    
    const metric = timer.end();
    
    console.log(`✅ Query executed successfully`);
    console.log(`   Records found: ${metadata.length}`);
    console.log(`   Duration: ${formatDuration(metric.duration)}`);
    console.log(`   Memory delta: ${performanceMonitor.formatBytes(metric.memoryDelta)}`);
    
    // Check for BigInt values
    const bigIntMetadata = metadata.filter(m => m.billToAccount > 2147483647);
    
    if (bigIntMetadata.length > 0) {
      console.log(`   ✅ Found ${bigIntMetadata.length} metadata record(s) with BigInt billToAccount > INT_MAX`);
      console.log(`   Sample: billToAccount=${bigIntMetadata[0].billToAccount}`);
    } else {
      console.log(`   ℹ️  No metadata with BigInt billToAccount > INT_MAX found`);
    }
    
    return { success: true, duration: metric.duration, count: metadata.length };
  } catch (err) {
    timer.end();
    console.error(`❌ Query failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Test 4: Memory usage
 */
async function testMemoryUsage() {
  console.log('\n📊 Test 4: Memory Usage Check');
  console.log('─'.repeat(70));
  
  const memory = performanceMonitor.getMemoryUsage();
  
  console.log(`✅ Memory usage:`);
  console.log(`   Heap used: ${memory.heapUsedMB} MB`);
  console.log(`   Heap total: ${memory.heapTotalMB} MB`);
  console.log(`   RSS: ${memory.rssMB} MB`);
  console.log(`   External: ${memory.externalMB} MB`);
  
  const heapUsedMB = parseFloat(memory.heapUsedMB);
  const threshold = parseInt(process.env.MEMORY_WARNING_THRESHOLD_MB || '500', 10);
  
  if (heapUsedMB > threshold) {
    console.log(`   ⚠️  Memory usage exceeds threshold (${threshold} MB)`);
  } else {
    console.log(`   ✅ Memory usage is within threshold (${threshold} MB)`);
  }
  
  return { success: true, memory };
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('🚀 CRM Backend Performance Test Suite');
  console.log('═'.repeat(70));
  console.log(`   Testing BigInt migration and database performance`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  
  const results = {
    test1: null,
    test2: null,
    test3: null,
    test4: null,
  };
  
  try {
    // Run all tests
    results.test1 = await testLargeInvoiceQuery();
    results.test2 = await testIndexedQuery();
    results.test3 = await testSalesMetadataQuery();
    results.test4 = await testMemoryUsage();
    
    // Summary
    console.log('\n');
    console.log('═'.repeat(70));
    console.log('📊 Test Summary');
    console.log('═'.repeat(70));
    
    const allSuccess = Object.values(results).every(r => r && r.success);
    
    if (allSuccess) {
      console.log('✅ All tests passed successfully!');
    } else {
      console.log('❌ Some tests failed');
    }
    
    // Performance summary
    const stats = performanceMonitor.getStats();
    console.log('\n📈 Performance Statistics:');
    console.log(`   Total queries: ${stats.queries.count}`);
    console.log(`   Average query time: ${stats.queries.avgDuration}ms`);
    console.log(`   Max query time: ${stats.queries.maxDuration}ms`);
    console.log(`   Slow queries: ${stats.queries.slowQueries}`);
    
    console.log('\n');
    
    process.exit(allSuccess ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Test suite failed:');
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests
runTests();
