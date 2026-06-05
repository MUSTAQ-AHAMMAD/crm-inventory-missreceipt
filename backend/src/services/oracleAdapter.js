/**
 * Oracle Prisma-compatible adapter.
 *
 * Provides the same model-method API as Prisma Client so that all existing
 * controllers work without modification.  Internally every call is translated
 * to Oracle SQL via the `oracledb` driver (see services/db.js).
 *
 * Supported methods per model:
 *   findUnique, findFirst, findMany, create, update, delete,
 *   deleteMany, count, createMany, upsert, groupBy, aggregate
 *
 * Plus top-level helpers:
 *   $queryRaw(sql, ...binds) – execute a raw template-tag SQL
 *   $disconnect()            – close the connection pool
 */

'use strict';

const db = require('./db');

// ─── Schema metadata ──────────────────────────────────────────────────────────

/** Maps Prisma model names (camelCase) → Oracle table names (UPPER_SNAKE_CASE) */
const TABLE = {
  user:                    'USERS',
  inventoryUpload:         'INVENTORY_UPLOADS',
  inventorySuccessRecord:  'INVENTORY_SUCCESS_RECORDS',
  inventoryFailureRecord:  'INVENTORY_FAILURE_RECORDS',
  miscReceiptUpload:       'MISC_RECEIPT_UPLOADS',
  miscReceiptFailure:      'MISC_RECEIPT_FAILURES',
  standardReceiptUpload:   'STANDARD_RECEIPT_UPLOADS',
  standardReceiptFailure:  'STANDARD_RECEIPT_FAILURES',
  applyReceiptUpload:      'APPLY_RECEIPT_UPLOADS',
  applyReceiptFailure:     'APPLY_RECEIPT_FAILURES',
  arInvoiceUpload:         'AR_INVOICE_UPLOADS',
  activityLog:             'ACTIVITY_LOGS',
  fusionSalesMetadata:     'FUSION_SALES_METADATA',
  arInvoiceData:           'AR_INVOICE_DATA',
  fusionInvoiceHeader:     'FUSION_INVOICE_HEADERS',
  fusionInvoiceLine:       'FUSION_INVOICE_LINES',
  fusionReceiptMethod:     'FUSION_RECEIPT_METHODS',
  vendhqRegister:          'VENDHQ_REGISTERS',
  fusionStandardReceipt:   'FUSION_STANDARD_RECEIPTS',
  fusionMiscReceipt:       'FUSION_MISC_RECEIPTS',
  fusionApplyReceipt:      'FUSION_APPLY_RECEIPTS',
  vendReceiptBatch:        'VEND_RECEIPT_BATCHES',
};

/**
 * Fields that are stored as NUMBER(1) in Oracle but should be returned
 * as JavaScript booleans.
 */
const BOOLEAN_FIELDS = new Set(['isActive', 'receiptIsCash']);

/**
 * Fields that are stored as NUMBER in Oracle but are returned as strings
 * (e.g. large IDs that exceed safe integer range).
 * These are left as-is because oracledb returns NUMBERs as JS numbers by
 * default; if you need string IDs extend this set.
 */

/**
 * Defines parent-child relations used by Prisma `include`.
 * Format:
 *   childModel: { fkField: 'parentField', parentModel: 'parentModelName' }
 *   OR for "has-many":
 *   parentModel: { childRelationName: { model: 'childModel', fk: 'foreignKeyField' } }
 */
const HAS_MANY = {
  user: {
    inventoryUploads:          { model: 'inventoryUpload',        fk: 'userId' },
    miscReceiptUploads:        { model: 'miscReceiptUpload',      fk: 'userId' },
    standardReceiptUploads:    { model: 'standardReceiptUpload',  fk: 'userId' },
    applyReceiptUploads:       { model: 'applyReceiptUpload',     fk: 'userId' },
    arInvoiceUploads:          { model: 'arInvoiceUpload',        fk: 'userId' },
    arInvoiceData:             { model: 'arInvoiceData',          fk: 'userId' },
    activityLogs:              { model: 'activityLog',            fk: 'userId' },
    vendReceiptBatches:        { model: 'vendReceiptBatch',       fk: 'userId' },
  },
  inventoryUpload: {
    failures:  { model: 'inventoryFailureRecord', fk: 'uploadId' },
    successes: { model: 'inventorySuccessRecord', fk: 'uploadId' },
  },
  miscReceiptUpload: {
    failures: { model: 'miscReceiptFailure',  fk: 'uploadId' },
  },
  standardReceiptUpload: {
    failures: { model: 'standardReceiptFailure', fk: 'uploadId' },
  },
  applyReceiptUpload: {
    failures: { model: 'applyReceiptFailure', fk: 'uploadId' },
  },
  fusionInvoiceHeader: {
    lines: { model: 'fusionInvoiceLine', fk: 'headerId' },
  },
};

const BELONGS_TO = {
  inventoryUpload:        { user:   { model: 'user', fk: 'userId' } },
  miscReceiptUpload:      { user:   { model: 'user', fk: 'userId' } },
  standardReceiptUpload:  { user:   { model: 'user', fk: 'userId' } },
  applyReceiptUpload:     { user:   { model: 'user', fk: 'userId' } },
  arInvoiceUpload:        { user:   { model: 'user', fk: 'userId' } },
  arInvoiceData:          { user:   { model: 'user', fk: 'userId' } },
  activityLog:            { user:   { model: 'user', fk: 'userId' } },
  vendReceiptBatch:       { user:   { model: 'user', fk: 'userId' } },
  inventoryFailureRecord: { upload: { model: 'inventoryUpload', fk: 'uploadId' } },
  inventorySuccessRecord: { upload: { model: 'inventoryUpload', fk: 'uploadId' } },
  miscReceiptFailure:     { upload: { model: 'miscReceiptUpload', fk: 'uploadId' } },
  standardReceiptFailure: { upload: { model: 'standardReceiptUpload', fk: 'uploadId' } },
  applyReceiptFailure:    { upload: { model: 'applyReceiptUpload', fk: 'uploadId' } },
  fusionInvoiceLine:      { header: { model: 'fusionInvoiceHeader', fk: 'headerId' } },
};

// ─── Naming helpers ────────────────────────────────────────────────────────────

/** camelCase  →  UPPER_SNAKE_CASE  (e.g. "createdAt" → "CREATED_AT") */
function col(name) {
  return name.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/** UPPER_SNAKE_CASE  →  camelCase  (e.g. "CREATED_AT" → "createdAt") */
function camel(name) {
  return name.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Convert an Oracle result row (UPPER keys) to a plain camelCase JS object */
function rowToObj(row) {
  if (!row) return null;
  const obj = {};
  for (const [k, v] of Object.entries(row)) {
    const field = camel(k);
    if (BOOLEAN_FIELDS.has(field)) {
      obj[field] = v === 1 || v === '1';
    } else {
      obj[field] = v;
    }
  }
  return obj;
}

/** Convert a JS value before binding into Oracle (booleans → 0/1) */
function toBindValue(field, value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value;
  return value;
}

// ─── WHERE clause builder ──────────────────────────────────────────────────────

class WhereBuilder {
  constructor() {
    this.binds = {};
    this.n = 0;
  }

  _next() {
    this.n++;
    return `w${this.n}`;
  }

  addBind(value) {
    const name = this._next();
    this.binds[name] = toBindValue(null, value);
    return `:${name}`;
  }

  buildClause(where) {
    if (!where || Object.keys(where).length === 0) return '';
    const conds = this._buildConds(where);
    return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  }

  _buildConds(where) {
    const conds = [];
    for (const [field, value] of Object.entries(where)) {
      const column = col(field);
      if (value === null || value === undefined) {
        conds.push(`${column} IS NULL`);
      } else if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        conds.push(...this._buildOps(column, value));
      } else {
        conds.push(`${column} = ${this.addBind(value)}`);
      }
    }
    return conds;
  }

  _buildOps(column, ops) {
    const conds = [];
    for (const [op, val] of Object.entries(ops)) {
      if (op === 'not') {
        if (val === null) conds.push(`${column} IS NOT NULL`);
        else conds.push(`${column} != ${this.addBind(val)}`);
      } else if (op === 'gte') {
        conds.push(`${column} >= ${this.addBind(val)}`);
      } else if (op === 'lte') {
        conds.push(`${column} <= ${this.addBind(val)}`);
      } else if (op === 'gt') {
        conds.push(`${column} > ${this.addBind(val)}`);
      } else if (op === 'lt') {
        conds.push(`${column} < ${this.addBind(val)}`);
      } else if (op === 'contains') {
        conds.push(`${column} LIKE ${this.addBind(`%${val}%`)}`);
      } else if (op === 'startsWith') {
        conds.push(`${column} LIKE ${this.addBind(`${val}%`)}`);
      } else if (op === 'endsWith') {
        conds.push(`${column} LIKE ${this.addBind(`%${val}`)}`);
      } else if (op === 'in') {
        if (!val || val.length === 0) {
          conds.push('1=0');
        } else {
          const placeholders = val.map(v => this.addBind(v));
          conds.push(`${column} IN (${placeholders.join(', ')})`);
        }
      } else if (op === 'notIn') {
        if (!val || val.length === 0) {
          // no-op
        } else {
          const placeholders = val.map(v => this.addBind(v));
          conds.push(`${column} NOT IN (${placeholders.join(', ')})`);
        }
      }
    }
    return conds;
  }
}

// ─── SELECT column list builder ───────────────────────────────────────────────

/** Build SELECT column list from a Prisma `select` object or return '*' */
function buildSelect(selectObj) {
  if (!selectObj) return '*';
  return Object.entries(selectObj)
    .filter(([, v]) => v === true)
    .map(([f]) => col(f))
    .join(', ') || '*';
}

// ─── ORDER BY builder ─────────────────────────────────────────────────────────

function buildOrderBy(orderBy) {
  if (!orderBy) return '';
  const arr = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = arr.flatMap(obj =>
    Object.entries(obj).map(([f, dir]) => `${col(f)} ${String(dir).toUpperCase()}`)
  );
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

// ─── Core query helper ────────────────────────────────────────────────────────

async function query(sql, binds = {}) {
  const result = await db.execute(sql, binds);
  return (result.rows || []).map(rowToObj);
}

async function queryOne(sql, binds = {}) {
  const rows = await query(sql, binds);
  return rows[0] || null;
}

// ─── Model proxy factory ──────────────────────────────────────────────────────

function makeModel(modelName) {
  const tableName = TABLE[modelName];
  if (!tableName) throw new Error(`Unknown model: ${modelName}`);

  return {
    // ── findUnique ────────────────────────────────────────────────────────────
    async findUnique({ where, select, include } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      const cols = buildSelect(select);
      const sql = `SELECT ${cols} FROM ${tableName} ${wClause} FETCH FIRST 1 ROWS ONLY`;
      let row = await queryOne(sql, wb.binds);
      if (row && include) row = await applyInclude(modelName, [row], include).then(r => r[0]);
      return row;
    },

    // ── findFirst ─────────────────────────────────────────────────────────────
    async findFirst({ where, select, include, orderBy } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      const cols = buildSelect(select);
      const obClause = buildOrderBy(orderBy);
      const sql = `SELECT ${cols} FROM ${tableName} ${wClause} ${obClause} FETCH FIRST 1 ROWS ONLY`;
      let row = await queryOne(sql, wb.binds);
      if (row && include) row = await applyInclude(modelName, [row], include).then(r => r[0]);
      return row;
    },

    // ── findMany ──────────────────────────────────────────────────────────────
    async findMany({ where, select, include, orderBy, skip, take } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      const cols = buildSelect(select);
      const obClause = buildOrderBy(orderBy);

      let pagination = '';
      if (skip !== undefined || take !== undefined) {
        const offset = skip || 0;
        if (take !== undefined) {
          pagination = `OFFSET ${offset} ROWS FETCH NEXT ${take} ROWS ONLY`;
        } else {
          pagination = `OFFSET ${offset} ROWS`;
        }
      }

      const sql = `SELECT ${cols} FROM ${tableName} ${wClause} ${obClause} ${pagination}`.trim();
      let rows = await query(sql, wb.binds);
      if (include && rows.length) rows = await applyInclude(modelName, rows, include);
      return rows;
    },

    // ── create ────────────────────────────────────────────────────────────────
    async create({ data, include } = {}) {
      const fields = [];
      const placeholders = [];
      const binds = {};
      let n = 0;

      for (const [field, value] of Object.entries(data)) {
        if (field === 'id') continue; // auto-generated
        fields.push(col(field));
        n++;
        const bn = `c${n}`;
        binds[bn] = toBindValue(field, value);
        placeholders.push(`:${bn}`);
      }

      // RETURNING ID captures the generated identity value
      binds.returnId = { dir: db.BIND_OUT, type: db.NUMBER };

      const sql = `INSERT INTO ${tableName} (${fields.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING ID INTO :returnId`;

      const result = await db.execute(sql, binds, { autoCommit: true });

      const outBinds = result.outBinds || {};
      const newId = Array.isArray(outBinds.returnId)
        ? outBinds.returnId[0]
        : outBinds.returnId;

      return this.findUnique({ where: { id: newId }, include });
    },

    // ── update ────────────────────────────────────────────────────────────────
    async update({ where, data, include } = {}) {
      const setParts = [];
      const binds = {};
      let n = 0;

      for (const [field, value] of Object.entries(data)) {
        n++;
        const bn = `u${n}`;
        binds[bn] = toBindValue(field, value);
        setParts.push(`${col(field)} = :${bn}`);
      }

      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      Object.assign(binds, wb.binds);

      const sql = `UPDATE ${tableName} SET ${setParts.join(', ')} ${wClause}`;
      await db.execute(sql, binds);
      return this.findUnique({ where, include });
    },

    // ── delete ────────────────────────────────────────────────────────────────
    async delete({ where } = {}) {
      const row = await this.findUnique({ where });
      if (!row) return null;
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      await db.execute(`DELETE FROM ${tableName} ${wClause}`, wb.binds);
      return row;
    },

    // ── deleteMany ────────────────────────────────────────────────────────────
    async deleteMany({ where } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      const result = await db.execute(`DELETE FROM ${tableName} ${wClause}`, wb.binds);
      return { count: result.rowsAffected || 0 };
    },

    // ── count ─────────────────────────────────────────────────────────────────
    async count({ where } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      const row = await queryOne(
        `SELECT COUNT(*) AS CNT FROM ${tableName} ${wClause}`,
        wb.binds
      );
      return row ? Number(row.cnt) : 0;
    },

    // ── createMany ────────────────────────────────────────────────────────────
    async createMany({ data, skipDuplicates } = {}) {
      if (!data || data.length === 0) return { count: 0 };
      let count = 0;
      for (const item of data) {
        try {
          await this.create({ data: item });
          count++;
        } catch (err) {
          if (skipDuplicates && isUniqueViolation(err)) continue;
          throw err;
        }
      }
      return { count };
    },

    // ── upsert ────────────────────────────────────────────────────────────────
    async upsert({ where, create: createData, update: updateData, include } = {}) {
      const existing = await this.findUnique({ where });
      if (existing) {
        return this.update({ where, data: updateData, include });
      }
      return this.create({ data: { ...createData }, include });
    },

    // ── aggregate ─────────────────────────────────────────────────────────────
    async aggregate({ where, _sum, _avg, _count, _min, _max } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);
      const exprs = [];

      if (_sum) {
        for (const f of Object.keys(_sum)) {
          exprs.push(`SUM(${col(f)}) AS SUM_${col(f)}`);
        }
      }
      if (_avg) {
        for (const f of Object.keys(_avg)) {
          exprs.push(`AVG(${col(f)}) AS AVG_${col(f)}`);
        }
      }
      if (_count) {
        const fields = typeof _count === 'object' ? Object.keys(_count) : ['*'];
        for (const f of fields) {
          exprs.push(f === '*' ? 'COUNT(*) AS COUNT_STAR' : `COUNT(${col(f)}) AS COUNT_${col(f)}`);
        }
      }
      if (_min) {
        for (const f of Object.keys(_min)) {
          exprs.push(`MIN(${col(f)}) AS MIN_${col(f)}`);
        }
      }
      if (_max) {
        for (const f of Object.keys(_max)) {
          exprs.push(`MAX(${col(f)}) AS MAX_${col(f)}`);
        }
      }

      if (!exprs.length) exprs.push('COUNT(*) AS COUNT_STAR');

      const sql = `SELECT ${exprs.join(', ')} FROM ${tableName} ${wClause}`;
      const row = await queryOne(sql, wb.binds);
      if (!row) return {};

      const result = {};
      if (_sum) {
        result._sum = {};
        for (const f of Object.keys(_sum)) {
          const k = `sum_${col(f).toLowerCase()}`;
          result._sum[f] = row[k] !== undefined ? Number(row[k]) : null;
        }
      }
      if (_avg) {
        result._avg = {};
        for (const f of Object.keys(_avg)) {
          const k = `avg_${col(f).toLowerCase()}`;
          result._avg[f] = row[k] !== undefined ? Number(row[k]) : null;
        }
      }
      if (_count) {
        result._count = {};
        const fields = typeof _count === 'object' ? Object.keys(_count) : ['*'];
        for (const f of fields) {
          const k = f === '*' ? 'count_star' : `count_${col(f).toLowerCase()}`;
          result._count[f] = row[k] !== undefined ? Number(row[k]) : 0;
        }
      }
      if (_min) {
        result._min = {};
        for (const f of Object.keys(_min)) {
          const k = `min_${col(f).toLowerCase()}`;
          result._min[f] = row[k] !== undefined ? row[k] : null;
        }
      }
      if (_max) {
        result._max = {};
        for (const f of Object.keys(_max)) {
          const k = `max_${col(f).toLowerCase()}`;
          result._max[f] = row[k] !== undefined ? row[k] : null;
        }
      }
      return result;
    },

    // ── groupBy ───────────────────────────────────────────────────────────────
    async groupBy({ by, where, _count, _sum, _min, _max, orderBy, having } = {}) {
      const wb = new WhereBuilder();
      const wClause = wb.buildClause(where);

      const groupCols = (Array.isArray(by) ? by : [by]).map(col);
      const selectParts = [...groupCols];

      if (_count) {
        const fields = typeof _count === 'object' ? Object.keys(_count) : ['*'];
        for (const f of fields) {
          selectParts.push(
            f === '*' ? 'COUNT(*) AS _COUNT_STAR' : `COUNT(${col(f)}) AS _COUNT_${col(f)}`
          );
        }
      }
      if (_sum) {
        for (const f of Object.keys(_sum)) {
          selectParts.push(`SUM(${col(f)}) AS _SUM_${col(f)}`);
        }
      }
      if (_min) {
        for (const f of Object.keys(_min)) {
          selectParts.push(`MIN(${col(f)}) AS _MIN_${col(f)}`);
        }
      }
      if (_max) {
        for (const f of Object.keys(_max)) {
          selectParts.push(`MAX(${col(f)}) AS _MAX_${col(f)}`);
        }
      }

      const obClause = buildOrderBy(orderBy);
      const sql = `SELECT ${selectParts.join(', ')} FROM ${tableName} ${wClause}
        GROUP BY ${groupCols.join(', ')} ${obClause}`;

      const rows = await query(sql, wb.binds);

      return rows.map(row => {
        const item = {};
        for (const f of (Array.isArray(by) ? by : [by])) {
          item[f] = row[f];
        }
        if (_count) {
          item._count = {};
          const fields = typeof _count === 'object' ? Object.keys(_count) : ['*'];
          for (const f of fields) {
            const k = f === '*' ? '_count_star' : `_count_${camel(col(f))}`;
            item._count[f] = row[k] !== undefined ? Number(row[k]) : 0;
          }
        }
        if (_sum) {
          item._sum = {};
          for (const f of Object.keys(_sum)) {
            const k = `_sum_${camel(col(f))}`;
            item._sum[f] = row[k] !== undefined ? Number(row[k]) : null;
          }
        }
        if (_min) {
          item._min = {};
          for (const f of Object.keys(_min)) {
            const k = `_min_${camel(col(f))}`;
            item._min[f] = row[k] !== undefined ? row[k] : null;
          }
        }
        if (_max) {
          item._max = {};
          for (const f of Object.keys(_max)) {
            const k = `_max_${camel(col(f))}`;
            item._max[f] = row[k] !== undefined ? row[k] : null;
          }
        }
        return item;
      });
    },
  };
}

// ─── Include helper ───────────────────────────────────────────────────────────

/**
 * Resolve `include` relations for an array of parent rows.
 * Supports both has-many and belongs-to relations.
 * Nested `select` inside include is honoured.
 */
async function applyInclude(modelName, rows, include) {
  if (!rows.length || !include) return rows;

  for (const [relName, relSpec] of Object.entries(include)) {
    if (!relSpec) continue;

    // belongs-to (parent lookup)
    const bt = (BELONGS_TO[modelName] || {})[relName];
    if (bt) {
      const parentIds = [...new Set(rows.map(r => r[bt.fk]).filter(v => v != null))];
      if (parentIds.length) {
        const parentModel = makeModel(bt.model);
        const parentRows = await parentModel.findMany({
          where: { id: { in: parentIds } },
          select: typeof relSpec === 'object' && relSpec.select ? relSpec.select : undefined,
        });
        const byId = {};
        for (const p of parentRows) byId[p.id] = p;
        rows = rows.map(r => ({ ...r, [relName]: byId[r[bt.fk]] || null }));
      } else {
        rows = rows.map(r => ({ ...r, [relName]: null }));
      }
      continue;
    }

    // has-many (children lookup)
    const hm = (HAS_MANY[modelName] || {})[relName];
    if (hm) {
      const parentIds = rows.map(r => r.id).filter(v => v != null);
      if (parentIds.length) {
        const childModel = makeModel(hm.model);
        const selectSpec = typeof relSpec === 'object' && relSpec.select ? relSpec.select : undefined;
        const whereSpec = typeof relSpec === 'object' && relSpec.where ? relSpec.where : {};
        const childRows = await childModel.findMany({
          where: { ...whereSpec, [hm.fk]: { in: parentIds } },
          select: selectSpec,
          orderBy: relSpec.orderBy,
        });
        const grouped = {};
        for (const c of childRows) {
          const pid = c[hm.fk];
          if (!grouped[pid]) grouped[pid] = [];
          grouped[pid].push(c);
        }
        rows = rows.map(r => ({ ...r, [relName]: grouped[r.id] || [] }));
      } else {
        rows = rows.map(r => ({ ...r, [relName]: [] }));
      }
      continue;
    }
  }

  return rows;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isUniqueViolation(err) {
  // Oracle ORA-00001: unique constraint violated
  return err && (err.errorNum === 1 || (err.message && err.message.includes('ORA-00001')));
}

// ─── Oracle adapter public API ────────────────────────────────────────────────

/**
 * The adapter is a Proxy that intercepts property access.
 * `adapter.someModel` returns a model object with CRUD methods.
 * `adapter.$queryRaw` and `adapter.$disconnect` are top-level helpers.
 */
const oracleAdapter = new Proxy(
  {
    // Raw SQL via tagged template literal: prisma.$queryRaw`SELECT ...`
    // Oracle version: adapter.$queryRaw`SELECT ... ${val} ...`
    $queryRaw: async function (strings, ...values) {
      // Reconstruct SQL with :p1, :p2, ... bind variables
      let sql = '';
      const binds = {};
      strings.forEach((s, i) => {
        sql += s;
        if (i < values.length) {
          const name = `p${i + 1}`;
          binds[name] = values[i];
          sql += `:${name}`;
        }
      });
      return query(sql, binds);
    },

    // Disconnect (close pool)
    $disconnect: async function () {
      await db.closePool();
    },
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Return model proxy for any unknown property that matches a model name
      if (TABLE[prop]) return makeModel(prop);
      return undefined;
    },
  }
);

module.exports = oracleAdapter;
