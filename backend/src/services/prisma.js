/**
 * Database client – Oracle edition.
 *
 * Previously used Prisma + SQLite; now backed by oracledb via the
 * Prisma-compatible Oracle adapter (services/oracleAdapter.js).
 *
 * All callers use the same API as before (prisma.model.method(...)) so no
 * changes are required in controllers or middleware.
 */

const oracleAdapter = require('./oracleAdapter');

module.exports = oracleAdapter;
