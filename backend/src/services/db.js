/**
 * Oracle database connection pool.
 * Uses the official `oracledb` Node.js driver.
 *
 * Environment variables required (set in backend/.env):
 *   ORACLE_DB_USER       – schema/user name (e.g. CRM_APP)
 *   ORACLE_DB_PASSWORD   – schema password
 *   ORACLE_DB_CONNECT    – Easy Connect string or TNS alias
 *                          e.g. "hostname:1521/servicename"
 *                          or   "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=...)))"
 *
 * Install the driver:   npm install oracledb
 * Oracle Instant Client must be present on the host (or use Thick mode if available).
 * See: https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html
 */

'use strict';

const oracledb = require('oracledb');

// Automatically convert all CLOB columns to JavaScript strings
oracledb.fetchAsString = [oracledb.CLOB];

// Return rows as plain objects keyed by column name
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

// Pool singleton – created once on first call to getPool()
let _pool = null;

/**
 * Initialise (or return the existing) connection pool.
 * Called automatically by getConnection(); you can also call it explicitly
 * during application startup.
 */
async function initPool() {
  if (_pool) return _pool;

  const user     = process.env.ORACLE_DB_USER;
  const password = process.env.ORACLE_DB_PASSWORD;
  const connectString = process.env.ORACLE_DB_CONNECT;

  if (!user || !password || !connectString) {
    throw new Error(
      'Oracle DB connection variables are not set. ' +
      'Please define ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT in your .env file.'
    );
  }

  _pool = await oracledb.createPool({
    user,
    password,
    connectString,
    poolMin:       2,
    poolMax:       10,
    poolIncrement: 1,
    poolTimeout:   60,
  });

  console.log('[DB] Oracle connection pool created');
  return _pool;
}

/**
 * Acquire a connection from the pool.
 * Always release the connection when done (use try/finally).
 */
async function getConnection() {
  if (!_pool) await initPool();
  return _pool.getConnection();
}

/**
 * Execute a single SQL statement.
 * @param {string} sql     – Oracle SQL with named bind variables (:name)
 * @param {object} binds   – Bind variable values { name: value, ... }
 * @param {object} options – Additional oracledb execute options
 * @returns {Promise<object>} oracledb result object
 */
async function execute(sql, binds = {}, options = {}) {
  const conn = await getConnection();
  try {
    const result = await conn.execute(sql, binds, {
      autoCommit: true,
      ...options,
    });
    return result;
  } finally {
    await conn.close();
  }
}

/**
 * Execute multiple statements in a single transaction.
 * @param {Array<{sql, binds}>} statements
 * @returns {Promise<Array>} array of results
 */
async function executeTransaction(statements) {
  const conn = await getConnection();
  try {
    const results = [];
    for (const { sql, binds = {} } of statements) {
      results.push(await conn.execute(sql, binds, { autoCommit: false }));
    }
    await conn.commit();
    return results;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.close();
  }
}

/** Seconds to wait for in-flight queries to finish before forcibly closing the pool */
const POOL_DRAIN_TIMEOUT = 10;

/**
 * Close the pool gracefully (call on application shutdown).
 */
async function closePool() {
  if (_pool) {
    await _pool.close(POOL_DRAIN_TIMEOUT);
    _pool = null;
    console.log('[DB] Oracle connection pool closed');
  }
}

module.exports = { initPool, getConnection, execute, executeTransaction, closePool,
  // Re-export oracledb constants so callers don't need to require oracledb directly
  BIND_OUT: oracledb.BIND_OUT,
  NUMBER:   oracledb.NUMBER,
  STRING:   oracledb.STRING,
  DATE:     oracledb.DATE,
  CLOB:     oracledb.CLOB,
};
