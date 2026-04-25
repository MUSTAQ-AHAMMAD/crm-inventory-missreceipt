# Database Corruption Prevention & Recovery

This document describes the database corruption prevention measures implemented in the CRM Inventory system.

## Problem

The application was experiencing `PrismaClientKnownRequestError` with the error message:
```
Failed to convert rust `String` into napi `string`
```

This error occurs when Prisma's Rust engine cannot properly convert database TEXT fields to JavaScript strings, typically caused by:
- Invalid UTF-8 sequences in the data
- Null bytes (`\0`) in string fields
- Excessively large strings (>1MB)
- Other problematic control characters

## Solutions Implemented

### 1. Error Handling for Database Queries (inventoryController.js:404, 768)

Added try-catch blocks around `prisma.inventorySuccessRecord.findMany()` queries that were failing:

```javascript
try {
  const previousSuccesses = await prisma.inventorySuccessRecord.findMany({...});
  // Process results
} catch (error) {
  console.error(`WARNING: Could not load previous success records: ${error.message}`);
  // Continue processing without deduplication cache
}
```

**Impact**: The system now continues processing uploads even if it cannot read previous success records, preventing complete upload failures.

### 2. Data Sanitization Function

Added a comprehensive `sanitizeForDatabase()` function that:
- Removes null bytes (`\0`) that corrupt SQLite
- Removes problematic control characters
- Truncates data exceeding 1MB limit
- Validates and fixes UTF-8 encoding issues
- Provides clear logging when data is modified

**Applied to all fields**:
- `rawData` (payload JSON)
- `responseBody` (API responses)
- `errorMessage` (error descriptions)

### 3. Enhanced Database Write Error Handling

Modified `flushRecords()` function to:
- Wrap `createMany()` operations in try-catch blocks
- Fall back to individual record insertion if batch fails
- Log specific row numbers that fail to save
- Continue processing even if some records can't be saved

### 4. Database Integrity Verification Tool

Created `scripts/verify-database-integrity.js` to:
- Scan all database records for corruption
- Identify problematic data (null bytes, invalid UTF-8, excessive size)
- Report issues with severity levels
- Optionally clean/fix corrupted records

**Usage**:
```bash
# Check database integrity (read-only)
npm run db:verify

# Check and fix corrupted records
npm run db:verify:fix
```

## Data Size Limits

To prevent database bloat and corruption:
- `rawData`: 1MB maximum (full payload)
- `responseBody`: 50KB maximum (API responses)
- `errorMessage`: 10KB maximum (error messages)

## Prevention Best Practices

1. **Always sanitize data before database insertion**
   - All user input and API responses are now sanitized
   - Applied at the point where data is prepared for insertion

2. **Graceful error handling**
   - Database operations wrapped in try-catch
   - Fallback strategies when batch operations fail
   - Detailed logging for troubleshooting

3. **Regular integrity checks**
   - Run `npm run db:verify` periodically
   - Especially after bulk uploads or system issues

4. **Monitor logs**
   - Watch for `[Data Sanitization]` warnings
   - Investigate repeated sanitization of same data source

## Recovery Steps

If you encounter database corruption errors:

1. **Check logs** for specific error messages and affected upload IDs

2. **Run integrity verification**:
   ```bash
   npm run db:verify
   ```

3. **If corruption is found, fix it**:
   ```bash
   npm run db:verify:fix
   ```

4. **Restart the application** after fixing corruption

5. **If issues persist**, the database may need manual repair:
   ```bash
   # Backup first
   cp backend/prisma/crm.db backend/prisma/crm.db.backup

   # Run SQLite integrity check
   sqlite3 backend/prisma/crm.db "PRAGMA integrity_check;"
   ```

## Technical Details

### Why Null Bytes Cause Issues
SQLite stores TEXT as UTF-8, but null bytes (`\0`) are string terminators in C. Prisma's Rust engine cannot properly handle these, causing conversion failures.

### Why Length Matters
Extremely large strings can:
- Exceed internal buffer limits in Prisma/SQLite
- Cause memory pressure
- Slow down queries significantly

### UTF-8 Validation
Invalid UTF-8 sequences can occur from:
- Binary data incorrectly stored as text
- Corrupted file uploads
- API responses with wrong encoding
- Database migrations or imports

## Files Modified

- `backend/src/controllers/inventoryController.js` - Main fixes
- `backend/scripts/verify-database-integrity.js` - New verification tool
- `backend/package.json` - Added npm scripts

## Future Improvements

Consider:
1. Adding database migrations to validate existing data
2. Implementing automated integrity checks on startup
3. Adding metrics/alerts for sanitization frequency
4. Considering BLOB storage for very large payloads
