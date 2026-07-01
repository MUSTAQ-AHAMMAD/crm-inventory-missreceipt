/**
 * Oracle Bulk REST API Client
 * 
 * Handles communication with Oracle Fusion Bulk Invoice API:
 * - Chunked invoice submission
 * - GZIP compression support
 * - HTTP/2 support for faster requests
 * - Authentication and retry logic
 * - Error handling and recovery
 * 
 * @module oracleBulkApiClient
 */

const axios = require('axios');
const https = require('https');
const http2 = require('http2');
const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

// Configuration from environment variables
const BULK_INVOICE_URL = process.env.ORACLE_BULK_INVOICE_URL || 
  'https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/receivablesInvoices';
const USERNAME = process.env.ORACLE_USERNAME;
const PASSWORD = process.env.ORACLE_PASSWORD;
const TIMEOUT = parseInt(process.env.ORACLE_AR_INVOICE_TIMEOUT || process.env.ORACLE_SOAP_TIMEOUT || '300000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

/**
 * HTTP/2 client session cache
 */
let http2Session = null;

/**
 * Create HTTPS agent with optimal settings
 */
function createHttpsAgent() {
  return new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 20,
    maxFreeSockets: 10,
    timeout: 30000,
  });
}

const httpsAgent = createHttpsAgent();

/**
 * Submit a chunk to Oracle Bulk API
 * 
 * @param {Buffer|string} payload - Chunk payload (JSON or compressed)
 * @param {Object} options - Request options
 * @param {Object} options.headers - Additional headers
 * @param {boolean} options.useHttp2 - Use HTTP/2 if available
 * @returns {Promise<Object>} Submission result
 */
async function submitChunk(payload, options = {}) {
  const { headers = {}, useHttp2 = false } = options;
  
  // Determine if this is a compressed payload
  const isCompressed = headers['Content-Encoding'] === 'gzip';
  
  console.log(`[OracleBulkApiClient] Submitting chunk | compressed=${isCompressed} | useHttp2=${useHttp2}`);
  
  // Try HTTP/2 first if enabled
  if (useHttp2 && !isCompressed) {
    // Note: HTTP/2 with compressed body requires special handling
    try {
      return await submitViaHttp2(payload, headers);
    } catch (error) {
      console.warn(`[OracleBulkApiClient] HTTP/2 failed, falling back to HTTP/1.1: ${error.message}`);
      // Fall through to HTTP/1.1
    }
  }
  
  // Use standard HTTP/1.1 with axios
  return await submitViaHttp1(payload, headers);
}

/**
 * Submit chunk via HTTP/1.1 using axios
 * 
 * @param {Buffer|string} payload - Chunk payload
 * @param {Object} headers - Request headers
 * @returns {Promise<Object>} Submission result
 */
async function submitViaHttp1(payload, headers = {}) {
  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  
  let attempt = 0;
  let lastError = null;
  
  while (attempt < MAX_RETRIES) {
    attempt++;
    
    try {
      const response = await axios.post(BULK_INVOICE_URL, payload, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...headers,
        },
        httpsAgent,
        timeout: TIMEOUT,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: (status) => status >= 200 && status < 500,
      });
      
      // Check response status
      if (response.status >= 400) {
        throw new Error(`Oracle returned HTTP ${response.status}: ${JSON.stringify(response.data)}`);
      }
      
      // Extract relevant data from response
      return {
        success: true,
        status: response.status,
        chunkId: response.data?.ChunkId || response.data?.chunkId,
        transactionNumber: response.data?.TransactionNumber || response.data?.transactionNumber,
        data: response.data,
      };
      
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(`[OracleBulkApiClient] Attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);
        await sleep(delay);
        continue;
      }
      
      // Non-retryable error or max retries reached
      throw error;
    }
  }
  
  // All retries exhausted
  throw lastError || new Error('All retry attempts failed');
}

/**
 * Submit chunk via HTTP/2
 * 
 * @param {string} payload - Chunk payload (must be uncompressed for HTTP/2)
 * @param {Object} headers - Request headers
 * @returns {Promise<Object>} Submission result
 */
async function submitViaHttp2(payload, headers = {}) {
  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  
  // Ensure HTTP/2 session is created
  if (!http2Session || http2Session.closed || http2Session.destroyed) {
    const url = new URL(BULK_INVOICE_URL);
    http2Session = http2.connect(`${url.protocol}//${url.host}`);
    
    http2Session.on('error', (err) => {
      console.error(`[OracleBulkApiClient] HTTP/2 session error: ${err.message}`);
      http2Session = null;
    });
  }
  
  return new Promise((resolve, reject) => {
    const url = new URL(BULK_INVOICE_URL);
    
    const req = http2Session.request({
      ':method': 'POST',
      ':path': url.pathname + url.search,
      'authorization': `Basic ${auth}`,
      'content-type': 'application/json',
      'accept': 'application/json',
      ...headers,
    });
    
    let responseData = '';
    let responseHeaders = {};
    
    req.on('response', (resHeaders) => {
      responseHeaders = resHeaders;
    });
    
    req.on('data', (chunk) => {
      responseData += chunk.toString();
    });
    
    req.on('end', () => {
      const status = responseHeaders[':status'];
      
      if (status >= 400) {
        reject(new Error(`Oracle returned HTTP ${status}: ${responseData}`));
        return;
      }
      
      try {
        const data = JSON.parse(responseData);
        resolve({
          success: true,
          status,
          chunkId: data?.ChunkId || data?.chunkId,
          transactionNumber: data?.TransactionNumber || data?.transactionNumber,
          data,
        });
      } catch (error) {
        reject(new Error(`Failed to parse response: ${error.message}`));
      }
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * Trigger Oracle to process and merge all chunks for a group
 * 
 * @param {string} groupId - Unique group ID
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Processing result
 */
async function processGroup(groupId, metadata = {}) {
  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  
  // Call Oracle's bulk processing endpoint to merge chunks
  const processUrl = `${BULK_INVOICE_URL}/bulk/process`;
  
  console.log(`[OracleBulkApiClient] Triggering processing for groupId: ${groupId}`);
  
  try {
    const response = await axios.post(
      processUrl,
      {
        groupId,
        action: 'MERGE_AND_CREATE',
        ...metadata,
      },
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        httpsAgent,
        timeout: TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 500,
      }
    );
    
    if (response.status >= 400) {
      throw new Error(`Oracle returned HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    }
    
    // Extract invoice details from response
    const invoiceData = response.data;
    
    return {
      success: true,
      transactionNumber: invoiceData?.TransactionNumber || invoiceData?.transactionNumber,
      invoiceId: invoiceData?.InvoiceId || invoiceData?.invoiceId,
      customerTrxId: invoiceData?.CustomerTrxId || invoiceData?.customerTrxId,
      data: invoiceData,
    };
    
  } catch (error) {
    console.error(`[OracleBulkApiClient] Processing failed for groupId ${groupId}: ${error.message}`);
    throw error;
  }
}

/**
 * Check if an error is retryable
 * 
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(error) {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
    return true;
  }
  
  // HTTP 5xx errors
  if (error.response && error.response.status >= 500) {
    return true;
  }
  
  // HTTP 429 (too many requests)
  if (error.response && error.response.status === 429) {
    return true;
  }
  
  return false;
}

/**
 * Sleep for specified milliseconds
 * 
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Close HTTP/2 session
 */
function closeHttp2Session() {
  if (http2Session) {
    http2Session.close();
    http2Session = null;
  }
}

/**
 * Health check for Oracle Bulk API
 * 
 * @returns {Promise<boolean>} True if API is accessible
 */
async function healthCheck() {
  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  
  try {
    const response = await axios.get(BULK_INVOICE_URL, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      httpsAgent,
      timeout: 10000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    
    return response.status < 400;
  } catch (error) {
    console.error(`[OracleBulkApiClient] Health check failed: ${error.message}`);
    return false;
  }
}

module.exports = {
  submitChunk,
  processGroup,
  healthCheck,
  closeHttp2Session,
};
