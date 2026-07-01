# Database BigInt Migration & Performance Fixes

## 🔴 CRITICAL: Issue Summary

Oracle Fusion returns `customerTxnId`, `txnNumber`, and `billToAccNumber` values larger than `2,147,483,647` (INT max), causing this error:

```
Invalid prisma.fusionInvoiceHeader.findMany() invocation
Inconsistent column data: Conversion failed: Value 300000101000750 does not fit in an INT column
```

This blocks ALL API endpoints (`/summary`, `/pending-apply`, etc.) from working.

## ✅ Solution Implemented

### 1. Database Schema Changes

**Updated Models:**
- `FusionInvoiceHeader`: Changed `customerTxnId`, `txnNumber`, `billToAccNumber` from `Int` to `BigInt`
- `FusionSalesMetadata`: Changed `billToAccount` from `Int` to `BigInt`

**Files Modified:**
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260701_fix_bigint/migration.sql`

### 2. Controller Updates

**Updated to use `BigInt()` instead of `parseInt()`:**
- `backend/src/controllers/arInvoiceController.js`
- `backend/src/controllers/arPipelineController.js`
- `backend/src/controllers/vendReceiptController.js`

### 3. Performance Monitoring

**New Service:**
- `backend/src/services/performanceMonitor.js` - Tracks query times, API response times, and memory usage

**Configuration:**
- Added performance settings to `.env.example`
- Added `db:performance-test` npm script

## 📋 Migration Steps

### Step 1: Update Prisma Schema

The schema has already been updated. Review changes:

```bash
cd backend
git diff prisma/schema.prisma
```

### Step 2: Apply Migration

Run the migration to convert INT to BIGINT:

```bash
cd backend
npm run prisma:migrate:bigint
```

This runs:
1. `prisma migrate deploy` - Applies the migration
2. `prisma generate` - Regenerates Prisma client with BigInt types

### Step 3: Verify Migration

Run the performance test to verify BigInt handling:

```bash
cd backend
npm run db:performance-test
```

Expected output:
```
✅ Query executed successfully
✅ Found X invoice(s) with BigInt values > INT_MAX
```

### Step 4: Restart Backend

```bash
cd backend
npm run dev
```

## 🧪 Testing

### 1. Manual Database Query Test

```javascript
// Test in Node.js REPL
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Query invoices with large IDs
prisma.fusionInvoiceHeader.findMany({
  where: { customerTxnId: { gt: 2147483647 } },
  take: 10,
}).then(console.log);
```

### 2. API Endpoint Tests

```bash
# Test summary endpoint
curl http://localhost:4000/api/ar-pipeline/summary

# Test pending pairs endpoint
curl http://localhost:4000/api/ar-pipeline/pending-apply
```

### 3. Performance Test

```bash
npm run db:performance-test
```

## 🛠️ Performance Monitoring

### Enable Performance Logging

Add to `.env`:

```env
PERFORMANCE_LOGGING=true
PERFORMANCE_WARNING_THRESHOLD_MS=1000
MEMORY_WARNING_THRESHOLD_MB=500
```

### View Performance Stats

The performance monitor automatically logs:
- Slow queries (>1000ms)
- API calls with response times
- Memory usage warnings

### Middleware Integration

To add performance monitoring to Express routes:

```javascript
const { performanceMonitor } = require('./services/performanceMonitor');

// Add middleware to router
router.use(performanceMonitor.middleware());
```

## 🔧 Configuration

### Environment Variables

```env
# Performance Monitoring
PERFORMANCE_LOGGING=false
PERFORMANCE_WARNING_THRESHOLD_MS=1000
MEMORY_WARNING_THRESHOLD_MB=500
MEMORY_CHECK_INTERVAL_MS=60000

# Database Performance
DATABASE_POOL_MIN=1
DATABASE_POOL_MAX=5
DATABASE_QUERY_TIMEOUT=30000
DATABASE_QUERY_LOGGING=false

# API Performance
API_CACHE_TTL=300
API_PAGE_SIZE=100
API_MAX_RESULTS=10000
```

## 📊 Performance Improvements

### Query Optimization

1. **Indexed BigInt Fields**: All BigInt fields maintain their indexes for fast lookups
2. **Efficient Pagination**: Use `take` and `skip` for large result sets
3. **Selective Fields**: Use `select` to fetch only needed columns

Example:

```javascript
// Optimized query
const invoices = await prisma.fusionInvoiceHeader.findMany({
  where: { status: 'SUCCESS' },
  select: { txnNumber: true, customerTxnId: true, billToCustName: true },
  take: 100,
  skip: page * 100,
  orderBy: { txnDate: 'desc' },
});
```

### Memory Management

The performance monitor tracks:
- Heap usage
- Memory deltas per operation
- Automatic warnings when memory exceeds threshold

## 🚨 Common Issues

### Issue: Migration fails with "table locked"

**Solution:**
```bash
# Stop all backend processes
pkill -f "node.*index.js"

# Run migration again
npm run prisma:migrate:bigint
```

### Issue: JavaScript Number type doesn't support BigInt

**Solution:**
Always use `BigInt()` constructor for large IDs:

```javascript
// ❌ Wrong
const id = parseInt(largeNumber, 10);  // Loses precision

// ✅ Correct
const id = BigInt(largeNumber);
```

### Issue: JSON.stringify() fails with BigInt

**Solution:**
Convert BigInt to string for JSON:

```javascript
// Custom serializer
JSON.stringify(data, (key, value) =>
  typeof value === 'bigint' ? value.toString() : value
);
```

## 📚 References

- [Prisma BigInt Documentation](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#bigint)
- [JavaScript BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)
- [SQLite INTEGER types](https://www.sqlite.org/datatype3.html)

## ✅ Verification Checklist

- [ ] Prisma schema updated with BigInt types
- [ ] Migration SQL script created
- [ ] Migration applied successfully
- [ ] Prisma client regenerated
- [ ] Controllers updated to use BigInt()
- [ ] Performance test passes
- [ ] API endpoints return data without errors
- [ ] No "Conversion failed" errors in logs
- [ ] Performance monitoring enabled (optional)
- [ ] Backend restarted

## 🎯 Next Steps

After migration is successful:

1. **Monitor Performance**: Watch logs for slow queries
2. **Optimize Queries**: Use performance monitor to identify bottlenecks
3. **Add Caching**: Implement Redis caching for frequently accessed data
4. **Database Indexes**: Review and optimize indexes based on query patterns

## 🆘 Support

If you encounter issues:

1. Check backend logs: `tail -f backend/logs/combined.log`
2. Run performance test: `npm run db:performance-test`
3. Verify Prisma client: `npm run prisma:generate`
4. Check database integrity: `npm run db:verify`
