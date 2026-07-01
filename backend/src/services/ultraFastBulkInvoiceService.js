/**
 * Ultra-Fast Bulk Invoice Service
 * 
 * Processes large AR invoices (4000+ lines) using advanced optimization techniques:
 * - Intelligent line chunking (400 lines per chunk by default)
 * - Parallel chunk processing (8 concurrent requests)
 * - GZIP compression (70-80% payload size reduction)
 * - HTTP/2 support for faster requests
 * - Single invoice creation in Oracle (all chunks merged)
 * 
 * Performance target: Process 4000+ lines in under 10 seconds
 * 
 * @module ultraFastBulkInvoiceService
 */

const pLimit = require('p-limit');
const zlib = require('zlib');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const oracleBulkApiClient = require('./oracleBulkApiClient');

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

// Configuration from environment variables
const BULK_CHUNK_SIZE = parseInt(process.env.ORACLE_BULK_CHUNK_SIZE || '400', 10);
const BULK_CONCURRENCY = parseInt(process.env.ORACLE_BULK_CONCURRENCY || '8', 10);
const BULK_COMPRESSION = process.env.ORACLE_BULK_COMPRESSION !== 'false';
const BULK_USE_HTTP2 = process.env.ORACLE_BULK_USE_HTTP2 !== 'false';

/**
 * Main entry point for bulk invoice processing
 * 
 * @param {Object} payload - Complete invoice payload with 4000+ lines
 * @param {Object} options - Processing options
 * @param {string} options.userId - User ID for tracking
 * @param {number} options.batchId - Batch ID for tracking
 * @param {Function} options.onProgress - Progress callback function
 * @returns {Promise<Object>} Processing result with transaction details
 */
async function processBulk(payload, options = {}) {
  const startTime = Date.now();
  const { userId, batchId, onProgress } = options;
  
  console.log(`[UltraFastBulk] Starting bulk processing | lines=${payload.receivablesInvoiceLines?.length || 0}`);
  
  try {
    // Validate payload
    if (!payload || !payload.receivablesInvoiceLines || !Array.isArray(payload.receivablesInvoiceLines)) {
      throw new Error('Invalid payload: receivablesInvoiceLines must be an array');
    }
    
    const totalLines = payload.receivablesInvoiceLines.length;
    if (totalLines === 0) {
      throw new Error('Invalid payload: receivablesInvoiceLines cannot be empty');
    }
    
    // Generate unique group ID for this bulk operation
    const groupId = generateGroupId(payload);
    console.log(`[UltraFastBulk] Generated groupId: ${groupId}`);
    
    // Report initial progress
    if (onProgress) {
      onProgress({
        stage: 'CHUNKING',
        progress: 0,
        totalLines,
        message: 'Splitting invoice into chunks...',
      });
    }
    
    // Calculate optimal chunk size based on total lines
    const chunkSize = calculateOptimalChunkSize(totalLines, BULK_CHUNK_SIZE);
    console.log(`[UltraFastBulk] Using chunk size: ${chunkSize} | estimated chunks: ${Math.ceil(totalLines / chunkSize)}`);
    
    // Split lines into chunks
    const lineChunks = splitIntoChunks(payload.receivablesInvoiceLines, chunkSize);
    console.log(`[UltraFastBulk] Created ${lineChunks.length} chunks`);
    
    // Report chunking complete
    if (onProgress) {
      onProgress({
        stage: 'SUBMITTING',
        progress: 10,
        totalLines,
        totalChunks: lineChunks.length,
        message: `Submitting ${lineChunks.length} chunks in parallel...`,
      });
    }
    
    // Submit all chunks in parallel
    const chunkResults = await submitChunksInParallel(payload, lineChunks, groupId, {
      onProgress: (chunkIndex, total) => {
        if (onProgress) {
          const progress = 10 + Math.floor((chunkIndex / total) * 70);
          onProgress({
            stage: 'SUBMITTING',
            progress,
            totalLines,
            totalChunks: total,
            chunksProcessed: chunkIndex,
            message: `Processed ${chunkIndex}/${total} chunks...`,
          });
        }
      },
    });
    
    console.log(`[UltraFastBulk] All ${chunkResults.length} chunks submitted successfully`);
    
    // Report merging stage
    if (onProgress) {
      onProgress({
        stage: 'MERGING',
        progress: 85,
        totalLines,
        totalChunks: lineChunks.length,
        chunksProcessed: lineChunks.length,
        message: 'Merging chunks into one invoice in Oracle...',
      });
    }
    
    // Trigger Oracle to process and merge all chunks into one invoice
    const mergeResult = await triggerProcessing(groupId, {
      totalChunks: lineChunks.length,
      totalLines,
      customerNumber: payload.BillToCustomerNumber,
      customerName: payload.BillToCustomerName,
      transactionDate: payload.TransactionDate,
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[UltraFastBulk] Processing complete | duration=${duration}s | transactionNumber=${mergeResult.transactionNumber}`);
    
    // Report completion
    if (onProgress) {
      onProgress({
        stage: 'COMPLETE',
        progress: 100,
        totalLines,
        totalChunks: lineChunks.length,
        chunksProcessed: lineChunks.length,
        message: 'Invoice created successfully',
      });
    }
    
    // Return success result
    return {
      success: true,
      groupId,
      totalLines,
      chunksProcessed: lineChunks.length,
      duration: `${duration}s`,
      transactionNumber: mergeResult.transactionNumber,
      invoiceId: mergeResult.invoiceId,
      customerTrxId: mergeResult.customerTrxId,
      status: 'SUCCESS',
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[UltraFastBulk] Processing failed | duration=${duration}s | error=${error.message}`);
    
    // Report failure
    if (onProgress) {
      onProgress({
        stage: 'FAILED',
        progress: 0,
        message: `Processing failed: ${error.message}`,
      });
    }
    
    throw error;
  }
}

/**
 * Submit all chunks in parallel with controlled concurrency
 * 
 * @param {Object} payload - Original invoice payload (header data)
 * @param {Array<Array>} chunks - Array of line chunks
 * @param {string} groupId - Unique group ID for this bulk operation
 * @param {Object} options - Options including progress callback
 * @returns {Promise<Array>} Array of chunk submission results
 */
async function submitChunksInParallel(payload, chunks, groupId, options = {}) {
  const { onProgress } = options;
  const limit = pLimit(BULK_CONCURRENCY);
  
  console.log(`[UltraFastBulk] Submitting ${chunks.length} chunks | concurrency=${BULK_CONCURRENCY}`);
  
  let completedCount = 0;
  
  const submissions = chunks.map((chunkLines, index) =>
    limit(async () => {
      const chunkNumber = index + 1;
      const chunkPayload = {
        ...payload,
        receivablesInvoiceLines: chunkLines,
        // Add bulk metadata
        _bulkMetadata: {
          groupId,
          chunkNumber,
          totalChunks: chunks.length,
          chunkSize: chunkLines.length,
        },
      };
      
      console.log(`[UltraFastBulk] Chunk ${chunkNumber}/${chunks.length} | lines=${chunkLines.length} | starting...`);
      
      const result = await submitChunkWithCompression(chunkPayload);
      
      completedCount++;
      console.log(`[UltraFastBulk] Chunk ${chunkNumber}/${chunks.length} | completed | total progress: ${completedCount}/${chunks.length}`);
      
      if (onProgress) {
        onProgress(completedCount, chunks.length);
      }
      
      return result;
    })
  );
  
  return Promise.all(submissions);
}

/**
 * Submit a single chunk with GZIP compression
 * 
 * @param {Object} payload - Chunk payload to submit
 * @returns {Promise<Object>} Submission result
 */
async function submitChunkWithCompression(payload) {
  const chunkNumber = payload._bulkMetadata?.chunkNumber || 0;
  const startTime = Date.now();
  
  try {
    // Serialize payload to JSON
    const jsonPayload = JSON.stringify(payload);
    const originalSize = Buffer.byteLength(jsonPayload);
    
    let requestPayload = jsonPayload;
    let headers = {
      'Content-Type': 'application/json',
    };
    
    // Apply GZIP compression if enabled
    if (BULK_COMPRESSION) {
      const compressed = await gzipAsync(jsonPayload);
      const compressedSize = compressed.length;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      
      console.log(
        `[UltraFastBulk] Chunk ${chunkNumber} | compression: ${originalSize}B → ${compressedSize}B (${compressionRatio}% reduction)`
      );
      
      requestPayload = compressed;
      headers['Content-Encoding'] = 'gzip';
    }
    
    // Submit to Oracle Bulk API
    const result = await oracleBulkApiClient.submitChunk(requestPayload, {
      headers,
      useHttp2: BULK_USE_HTTP2,
    });
    
    const duration = Date.now() - startTime;
    console.log(`[UltraFastBulk] Chunk ${chunkNumber} | submitted successfully | duration=${duration}ms`);
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[UltraFastBulk] Chunk ${chunkNumber} | submission failed | duration=${duration}ms | error=${error.message}`);
    throw error;
  }
}

/**
 * Trigger Oracle to process and merge all chunks into one invoice
 * 
 * @param {string} groupId - Unique group ID for this bulk operation
 * @param {Object} metadata - Additional metadata about the bulk operation
 * @returns {Promise<Object>} Processing result with transaction details
 */
async function triggerProcessing(groupId, metadata = {}) {
  console.log(`[UltraFastBulk] Triggering processing for groupId: ${groupId}`);
  
  const startTime = Date.now();
  
  try {
    // Call Oracle Bulk API to merge chunks and create final invoice
    const result = await oracleBulkApiClient.processGroup(groupId, metadata);
    
    const duration = Date.now() - startTime;
    console.log(
      `[UltraFastBulk] Processing triggered successfully | duration=${duration}ms | transactionNumber=${result.transactionNumber}`
    );
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[UltraFastBulk] Processing trigger failed | duration=${duration}ms | error=${error.message}`);
    throw error;
  }
}

/**
 * Split an array into chunks of specified size
 * 
 * @param {Array} array - Array to split
 * @param {number} size - Chunk size
 * @returns {Array<Array>} Array of chunks
 */
function splitIntoChunks(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Calculate optimal chunk size based on total lines
 * Adjusts chunk size dynamically to balance parallelism and overhead
 * 
 * @param {number} totalLines - Total number of invoice lines
 * @param {number} baseSize - Base chunk size from configuration
 * @returns {number} Optimal chunk size
 */
function calculateOptimalChunkSize(totalLines, baseSize) {
  // For very large invoices (10000+ lines), increase chunk size to reduce overhead
  if (totalLines >= 10000) {
    return Math.max(baseSize, 500);
  }
  
  // For medium invoices (5000-10000 lines), use configured base size
  if (totalLines >= 5000) {
    return baseSize;
  }
  
  // For smaller invoices (1000-5000 lines), reduce chunk size for better parallelism
  if (totalLines >= 1000) {
    return Math.max(Math.floor(baseSize * 0.75), 300);
  }
  
  // For small invoices (<1000 lines), use smaller chunks
  return Math.max(Math.floor(baseSize * 0.5), 200);
}

/**
 * Generate a unique group ID for bulk operation
 * 
 * @param {Object} payload - Invoice payload
 * @returns {string} Unique group ID
 */
function generateGroupId(payload) {
  const date = payload.TransactionDate || new Date().toISOString().slice(0, 10);
  const customer = payload.BillToCustomerNumber || 'UNKNOWN';
  const uuid = uuidv4().split('-')[0];
  
  return `BULK-${date}-CUST-${customer}-${uuid}`;
}

/**
 * Check if an invoice should use bulk processing
 * 
 * @param {Object} payload - Invoice payload
 * @returns {boolean} True if bulk processing should be used
 */
function shouldUseBulkProcessing(payload) {
  const threshold = parseInt(process.env.ORACLE_BULK_INVOICE_THRESHOLD || '500', 10);
  const lineCount = payload?.receivablesInvoiceLines?.length || 0;
  
  return lineCount > threshold;
}

module.exports = {
  processBulk,
  submitChunksInParallel,
  submitChunkWithCompression,
  triggerProcessing,
  splitIntoChunks,
  calculateOptimalChunkSize,
  generateGroupId,
  shouldUseBulkProcessing,
};
