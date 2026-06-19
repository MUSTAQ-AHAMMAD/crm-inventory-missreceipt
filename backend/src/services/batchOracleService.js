'use strict';

/**
 * batchOracleService.js
 *
 * Centralised Oracle API service for large-data batch processing.
 *
 * Mirrors the patterns found in integration-Oracle:
 *   • oracle-crm/src/oracleDbClient.js  – connection retry, timeout, thick-mode config
 *   • oracle-db/jdbc-config.properties  – pool sizes, validation, transaction settings
 *   • oracle-crm/src/scheduler.js       – incremental checkpoint, lookback, retry config
 *   • IntegrationJobs/FusionSOAPClient  – transient-error classification, SOAP auth
 *
 * Key configuration (all env-var driven, matching jdbc-config.properties names):
 *   ORACLE_POOL_MAX_ACTIVE=20         (jdbc.pool.maxActive)
 *   ORACLE_POOL_INITIAL_SIZE=5        (jdbc.pool.initialSize)
 *   ORACLE_POOL_MAX_WAIT_MS=10000     (jdbc.pool.maxWait)
 *   ORACLE_CONNECT_TIMEOUT_S=60       (jdbc.pool.minEvictableIdleTimeMillis /60)
 *   ORACLE_MAX_RETRIES=3              (createConnection retries)
 *   ORACLE_FETCH_SIZE=200             (ResultSet.setFetchSize equivalent – chunk size)
 *   ORACLE_TRANSACTION_TIMEOUT_S=300  (transaction.timeout)
 *   ORACLE_SOAP_TIMEOUT=120000        (SOAP request timeout ms)
 *   ORACLE_AR_INVOICE_TIMEOUT=300000  (REST invoice timeout ms)
 *   ORACLE_INVOICE_LINE_CHUNK_SIZE=100 (batch chunk size)
 *   ORACLE_INVOICE_CONCURRENCY=1      (parallel workers; default 1 = sequential)
 */

const axios  = require('axios');
const pRetry = require('p-retry');
const pLimit = require('p-limit');

// ─── Pool / connection configuration (mirrors jdbc-config.properties) ─────────

/**
 * Returns the canonical batch-processing configuration object.
 * All values can be overridden via environment variables.
 *
 * Corresponds to:
 *   jdbc.pool.initialSize, maxActive, maxWait
 *   transaction.timeout, transaction.isolation
 *   ResultSet fetchSize (fetch_size = chunk_size)
 */
function getBatchConfig() {
  return {
    // Connection pool (jdbc.pool.*)
    pool: {
      initialSize  : parseInt(process.env.ORACLE_POOL_INITIAL_SIZE, 10)  || 5,
      maxActive    : parseInt(process.env.ORACLE_POOL_MAX_ACTIVE,   10)  || 20,
      maxWait      : parseInt(process.env.ORACLE_POOL_MAX_WAIT_MS,  10)  || 10000,
      connectTimeout: parseInt(process.env.ORACLE_CONNECT_TIMEOUT_S, 10) || 60, // seconds
    },

    // Retry (mirrors createConnection retries in oracleDbClient.js)
    retry: {
      maxRetries  : parseInt(process.env.ORACLE_MAX_RETRIES,        10)  || 3,
      minTimeout  : parseInt(process.env.ORACLE_RETRY_MIN_MS,       10)  || 500,
      maxTimeout  : parseInt(process.env.ORACLE_RETRY_MAX_MS,       10)  || 10000,
    },

    // Transaction (transaction.timeout + transaction.isolation = READ_COMMITTED)
    transaction: {
      timeoutMs  : (parseInt(process.env.ORACLE_TRANSACTION_TIMEOUT_S, 10) || 300) * 1000,
      isolation  : process.env.ORACLE_TRANSACTION_ISOLATION || 'READ_COMMITTED',
    },

    // Fetch / chunk size
    // Mirrors ResultSet.setFetchSize() — controls how many rows are processed per round-trip.
    // Also used as the AR invoice line chunk size.
    fetchSize : parseInt(process.env.ORACLE_FETCH_SIZE,              10)  ||
                parseInt(process.env.ORACLE_INVOICE_LINE_CHUNK_SIZE,  10) || 100,

    // Hard cap: Oracle REST gateway returns HTTP 504 above this line count.
    hardMaxChunkSize: 100,

    // Timeouts
    soapTimeout   : parseInt(process.env.ORACLE_SOAP_TIMEOUT,         10)  || 120000,
    invoiceTimeout: parseInt(process.env.ORACLE_AR_INVOICE_TIMEOUT,   10)  ||
                    parseInt(process.env.ORACLE_SOAP_TIMEOUT,          10)  || 300000,

    // Concurrency (parallel workers per batch run)
    // Default 5 = process up to 5 invoices in parallel.
    // Increase via ORACLE_INVOICE_CONCURRENCY env var; lower to 1 if Oracle throttles.
    concurrency   : parseInt(process.env.ORACLE_INVOICE_CONCURRENCY,  10)  || 5,
  };
}

// ─── Transient-error classification ──────────────────────────────────────────
// Mirrors isTransientError() in arPipelineController.js and the retry guard in
// oracle-crm/src/oracleDbClient.js (attempt-loop on ETIMEDOUT / ORA-03135).

/**
 * Returns true when the given error is recoverable (worth retrying).
 *
 * Covers:
 *   • Network-layer failures (ECONNABORTED, ECONNRESET, ETIMEDOUT, EPIPE)
 *   • HTTP 429 / 503 / 504 responses from Oracle
 *   • Oracle ORA-03135 (connection lost)
 *   • Oracle ORA-12170 (TNS connect timeout)
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isTransientError(err) {
  if (!err) return false;
  const msg  = String(err.message || '').toLowerCase();
  const code = String(err.code    || '');

  if (
    code === 'ECONNABORTED' ||
    code === 'ECONNRESET'   ||
    code === 'ETIMEDOUT'    ||
    code === 'ENOTFOUND'    ||
    code === 'EPIPE'        ||
    code === 'ECONNREFUSED'
  ) return true;

  if (/timeout/i.test(msg))           return true;
  if (/connection lost/i.test(msg))   return true;
  if (/ora-03135/i.test(msg))         return true;  // connection lost contact
  if (/ora-12170/i.test(msg))         return true;  // TNS connect timeout
  if (/ora-12541/i.test(msg))         return true;  // TNS no listener
  if (/retry/i.test(msg))             return true;

  // HTTP-level: 429 Too Many Requests, 503 Service Unavailable, 504 Gateway Timeout
  const status = err.response?.status;
  if (status === 429 || status === 503 || status === 504) return true;

  return false;
}

// ─── Axios instance factory ───────────────────────────────────────────────────
// Mirrors oracleDbClient.js createConnection() – builds a pre-configured client.
// Corresponds to jdbc.pool.maxWait and connectTimeout.

/**
 * Creates an axios instance pre-configured for Oracle Fusion REST/SOAP calls.
 *
 * Mirrors the pattern in integration-Oracle/oracle-crm/src/oracleDbClient.js
 * where createConnection() builds a connection with:
 *   - connectTimeout  (maps to socket timeout)
 *   - connectString   (maps to baseURL)
 *   - user/password   (maps to auth)
 *
 * @param {object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {number} [options.timeoutMs]  - request timeout in ms
 * @param {'json'|'soap'} [options.mode] - 'json' (REST) or 'soap'
 * @returns {import('axios').AxiosInstance}
 */
function createOracleClient({ username, password, timeoutMs, mode = 'json' }) {
  const cfg = getBatchConfig();
  const timeout = timeoutMs || (mode === 'soap' ? cfg.soapTimeout : cfg.invoiceTimeout);

  return axios.create({
    auth   : { username, password },
    timeout,
    headers: mode === 'soap'
      ? { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml' }
      : { 'Content-Type': 'application/json',        Accept: 'application/json' },
    validateStatus: () => true,   // let callers inspect the status
  });
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────
// Mirrors the retry loop in oracleDbClient.js createConnection()
// and the pRetry usage in arPipelineController.js processOne().

/**
 * Executes `fn` with retry-on-transient-error, using exponential backoff.
 *
 * Configuration mirrors integration-Oracle:
 *   maxRetries    = ORACLE_MAX_RETRIES (default 3)
 *   minTimeout    = ORACLE_RETRY_MIN_MS (default 500 ms)
 *   maxTimeout    = ORACLE_RETRY_MAX_MS (default 10 000 ms)
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [options]
 * @param {string} [options.label]    - logging label
 * @param {number} [options.retries]  - override default maxRetries
 * @returns {Promise<T>}
 */
async function withRetry(fn, { label = 'oracle-call', retries } = {}) {
  const cfg = getBatchConfig().retry;
  const maxAttempts = (retries ?? cfg.maxRetries) + 1; // pRetry counts re-tries, not total attempts

  return pRetry(
    async (attempt) => {
      try {
        return await fn();
      } catch (err) {
        if (!isTransientError(err)) {
          // Abort retry for non-transient (business / auth) failures
          throw new pRetry.AbortError(err);
        }
        console.warn(`[BatchOracle] ${label} attempt ${attempt} failed (transient): ${err.message}`);
        throw err;
      }
    },
    {
      retries   : maxAttempts - 1,
      minTimeout: cfg.minTimeout,
      maxTimeout: cfg.maxTimeout,
      factor    : 2,
      onFailedAttempt: (err) => {
        console.warn(
          `[BatchOracle] ${label} – attempt ${err.attemptNumber}/${maxAttempts} failed. ` +
          `Retries left: ${err.retriesLeft}. Error: ${err.message}`
        );
      },
    }
  );
}

// ─── Chunked batch submission ─────────────────────────────────────────────────
// Mirrors the chunking pattern in arPipelineController.js (LINE_CHUNK_SIZE)
// and the integration-Oracle oracle-crm/src/odooSync.js batchPush logic.
//
// Also mirrors JDBC ResultSet.setFetchSize() semantics: process `fetchSize` rows
// per round-trip to avoid overwhelming the Oracle gateway.

/**
 * Splits `items` into chunks of at most `chunkSize` items and processes each
 * chunk in parallel (up to `concurrency` chunks at a time).
 *
 * Pattern:
 *   1. Chunk the dataset (mirrors ResultSet cursor fetch with setFetchSize)
 *   2. Run chunks concurrently (mirrors EJB async pool / INVOICE_CONCURRENCY)
 *   3. Retry transient failures per chunk (mirrors oracleDbClient retry loop)
 *   4. Collect results (success / failure / transient-pending)
 *
 * @param {object[]} items
 * @param {(chunk: object[], chunkIndex: number) => Promise<object>} processFn
 * @param {object} [options]
 * @param {number}  [options.chunkSize]   - lines per chunk (defaults to fetchSize)
 * @param {number}  [options.concurrency] - parallel chunks
 * @param {string}  [options.label]       - logging label
 * @param {(progress: {done:number, total:number, successCount:number, failureCount:number}) => void} [options.onProgress]
 * @returns {Promise<{successCount:number, failureCount:number, results:object[]}>}
 */
async function processBatchChunked(items, processFn, options = {}) {
  const cfg = getBatchConfig();
  const rawChunkSize  = options.chunkSize   || cfg.fetchSize;
  const chunkSize     = Math.min(rawChunkSize, cfg.hardMaxChunkSize);
  const concurrency   = options.concurrency || cfg.concurrency;
  const label         = options.label       || 'batch';
  const onProgress    = options.onProgress  || (() => {});

  // Build chunk array
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  console.log(
    `[BatchOracle] ${label}: ${items.length} items → ${chunks.length} chunks ` +
    `(chunkSize=${chunkSize}, concurrency=${concurrency})`
  );

  const limit = pLimit(concurrency);
  let successCount = 0;
  let failureCount = 0;
  const results = [];
  let done = 0;

  const promises = chunks.map((chunk, chunkIndex) =>
    limit(() =>
      withRetry(
        () => processFn(chunk, chunkIndex),
        { label: `${label}[chunk-${chunkIndex}]` }
      )
        .then((result) => {
          successCount++;
          results.push({ chunkIndex, status: 'SUCCESS', result });
        })
        .catch((err) => {
          failureCount++;
          results.push({ chunkIndex, status: 'FAILED', error: err.message });
          console.error(`[BatchOracle] ${label} chunk ${chunkIndex} failed: ${err.message}`);
        })
        .finally(() => {
          done++;
          onProgress({ done, total: chunks.length, successCount, failureCount });
        })
    )
  );

  await Promise.all(promises);

  console.log(
    `[BatchOracle] ${label}: completed. ` +
    `success=${successCount} failure=${failureCount} / ${chunks.length} chunks`
  );

  return { successCount, failureCount, results };
}

// ─── Single-item batch submission (pass 1 + pass 2 retry) ────────────────────
// Mirrors arPipelineController.js processOne() + transientItems pass-2 pattern
// and oracle-crm/src/odooSync.js startPushJob() two-pass retry logic.

/**
 * Processes a flat list of individual items with concurrency, retry, and a
 * two-pass pattern (pass 2 = retry transient failures from pass 1).
 *
 * Mirrors:
 *   arPipelineController.js workItems / transientItems pattern
 *   oracle-crm/src/odooSync.js startPushJob retry loop
 *
 * @param {object[]} items
 * @param {(item: object, isRetry: boolean) => Promise<{success:boolean, isTransient:boolean, data?:any}>} processFn
 * @param {object} [options]
 * @param {number} [options.concurrency]
 * @param {string} [options.label]
 * @param {(p: {done:number, total:number, successCount:number, failureCount:number}) => void} [options.onProgress]
 * @returns {Promise<{successCount:number, failureCount:number, transientCount:number}>}
 */
async function processBatchItems(items, processFn, options = {}) {
  const cfg         = getBatchConfig();
  const concurrency = options.concurrency || cfg.concurrency;
  const label       = options.label       || 'batch-items';
  const onProgress  = options.onProgress  || (() => {});

  const limit = pLimit(concurrency);
  let successCount  = 0;
  let failureCount  = 0;
  const transient   = [];   // items to retry in pass 2
  let done          = 0;

  // ── Pass 1 ────────────────────────────────────────────────────────────────
  await Promise.all(
    items.map((item) =>
      limit(async () => {
        const r = await processFn(item, false);
        if (r.success) {
          successCount++;
        } else if (r.isTransient) {
          transient.push(item);
        } else {
          failureCount++;
        }
        done++;
        onProgress({ done, total: items.length, successCount, failureCount });
      })
    )
  );

  // ── Pass 2: retry transient failures ─────────────────────────────────────
  if (transient.length > 0) {
    console.log(`[BatchOracle] ${label}: pass 2 – retrying ${transient.length} transient failures`);
    done = 0;
    const total2 = transient.length;

    await Promise.all(
      transient.map((item) =>
        limit(async () => {
          const r = await processFn(item, true);
          if (r.success) {
            successCount++;
          } else {
            failureCount++;
          }
          done++;
          onProgress({ done, total: total2, successCount, failureCount });
        })
      )
    );
  }

  return { successCount, failureCount, transientCount: transient.length };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getBatchConfig,
  isTransientError,
  createOracleClient,
  withRetry,
  processBatchChunked,
  processBatchItems,
};
