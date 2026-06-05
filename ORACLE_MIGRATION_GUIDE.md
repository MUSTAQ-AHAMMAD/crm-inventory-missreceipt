# Oracle Database Migration Guide

This document explains how to move the CRM application from its previous
SQLite/Prisma database to **Oracle Database** (12c Release 2 or higher).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Oracle Database 12.2+ | On-premise, Oracle ATP, or Oracle Cloud |
| Oracle Instant Client | Required by the `oracledb` Node.js driver |
| Node.js 18+ | Already used by the project |
| DBA access | To create the schema user and run DDL |

---

## Step 1 – Create the application schema user

Log in as DBA (SYSDBA) and run:

```sql
CREATE USER crm_app IDENTIFIED BY "YourSecurePassword";
GRANT CONNECT, RESOURCE TO crm_app;
GRANT CREATE SESSION TO crm_app;
GRANT UNLIMITED TABLESPACE TO crm_app;
```

> You can choose any schema name; just update `ORACLE_DB_USER` in `.env`.

---

## Step 2 – Create the tables, triggers, and indexes

Connect as the `crm_app` user and run the provided DDL script:

```bash
# Using SQL*Plus
sqlplus crm_app/YourSecurePassword@//hostname:1521/servicename @ORACLE_DDL_SCHEMA.sql

# Using SQLcl
sql crm_app/YourSecurePassword@//hostname:1521/servicename @ORACLE_DDL_SCHEMA.sql
```

The script creates all 22 tables plus their constraints, triggers, and indexes.

---

## Step 3 – Install Oracle Instant Client on the server

`oracledb` requires Oracle Instant Client libraries on the machine that runs
Node.js.  Follow the official guide for your OS:

- Linux: https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html#linux
- macOS: https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html#macos
- Windows: https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html#windows

The minimum required package is **Oracle Instant Client Basic** or
**Basic Light** (version ≥ 12.2).

---

## Step 4 – Install Node.js dependencies

```bash
cd backend
npm install
```

`oracledb` is now listed in `package.json`; `npm install` will fetch it
automatically.

---

## Step 5 – Configure environment variables

Copy `backend/.env.example` to `backend/.env` and fill in your Oracle
connection details:

```dotenv
ORACLE_DB_USER=crm_app
ORACLE_DB_PASSWORD=YourSecurePassword

# Easy Connect string:  host:port/service_name
ORACLE_DB_CONNECT=your-oracle-host:1521/ORCLPDB1
```

> **Connection string formats**
>
> - Easy Connect: `hostname:1521/service_name`
> - Easy Connect Plus: `hostname:1521/service_name?connect_timeout=15`
> - Full TNS descriptor: paste the entry from `tnsnames.ora`
> - Oracle ATP (Cloud wallet): use `wallet_location` or `tnsnames.ora` alias

---

## Step 6 – Seed the reference data

Run the seed scripts to populate the lookup tables:

```bash
cd backend

# Creates the default admin user + seeds Fusion Sales Metadata
npm run seed

# Seed receipt methods from the SQL file
npm run seed:receipt-methods

# Seed VendHQ registers from CSV
npm run seed:vend-registers

# Seed historical Oracle response data from CSVs
npm run seed:receipt-data
```

---

## Step 7 – Migrate existing SQLite data (optional)

If you have existing data in the SQLite file (`backend/prisma/crm.db`) that you
want to preserve, export it from SQLite and import it into Oracle.

### Export from SQLite

```bash
# Install sqlite3 CLI if needed
sqlite3 backend/prisma/crm.db .dump > sqlite_dump.sql
```

### Transform and import

The SQLite dump uses different syntax from Oracle:
- Replace `AUTOINCREMENT` primary keys with Oracle sequence values
- Replace `1`/`0` boolean literals (already compatible)
- Replace `DATETIME` string literals with `TO_TIMESTAMP(...)` calls
- Convert `LIMIT x OFFSET y` to Oracle pagination syntax

A simple approach for smaller datasets is to:
1. Export each table from SQLite as CSV
2. Import into Oracle using SQL*Loader or Oracle Data Pump External Tables

For large datasets, consider using a migration tool such as
[ora2pg](https://ora2pg.darold.net/) (with the source reversed) or Oracle
GoldenGate.

---

## Architecture overview

```
controllers / middleware
        │
        │  require('../services/prisma')
        ▼
 services/prisma.js        ← thin re-export shim
        │
        │  require('./oracleAdapter')
        ▼
 services/oracleAdapter.js ← Prisma-compatible proxy
        │
        │  require('./db')
        ▼
 services/db.js            ← oracledb connection pool
        │
        ▼
 Oracle Database
```

All controllers continue to use the same `prisma.model.method()` API as
before — no changes were needed in any controller file.

---

## Supported Prisma methods

The Oracle adapter implements the full set of methods used by the application:

| Method | Supported |
|---|---|
| `findUnique` | ✅ |
| `findFirst` | ✅ |
| `findMany` (with `where`, `select`, `include`, `orderBy`, `skip`, `take`) | ✅ |
| `create` | ✅ |
| `update` | ✅ |
| `delete` | ✅ |
| `deleteMany` | ✅ |
| `count` | ✅ |
| `createMany` | ✅ |
| `upsert` | ✅ |
| `groupBy` (with `_count`, `_sum`, `_min`, `_max`) | ✅ |
| `aggregate` (with `_sum`, `_avg`, `_count`, `_min`, `_max`) | ✅ |
| `$queryRaw` (tagged template) | ✅ |
| `$disconnect` | ✅ |

---

## Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `DPI-1047: Cannot locate a 64-bit Oracle Client library` | Instant Client not installed or not on `LD_LIBRARY_PATH` | Follow Step 3 |
| `ORA-01017: invalid username/password` | Wrong `ORACLE_DB_USER` or `ORACLE_DB_PASSWORD` | Check `.env` |
| `ORA-12541: TNS: no listener` | Wrong host or port | Check `ORACLE_DB_CONNECT` |
| `ORA-00942: table or view does not exist` | DDL script not run | Run Step 2 |
| `ORA-00001: unique constraint violated` | Duplicate data during seed | Use `skipDuplicates` or truncate before re-seeding |

---

## Notes on Oracle-specific behaviour

- **Auto-increment IDs**: implemented with `GENERATED ALWAYS AS IDENTITY`
  (Oracle 12c+).  You cannot insert explicit ID values.
- **Booleans**: stored as `NUMBER(1)` — `1` = true, `0` = false.  The adapter
  converts automatically.
- **Large text** (JSON payloads, XML, logs): stored as `CLOB`.  The
  `oracledb.fetchAsString = [oracledb.CLOB]` setting converts them to JS
  strings transparently.
- **Timestamps**: stored as `TIMESTAMP`.  `UPDATED_AT` columns are maintained
  by `BEFORE UPDATE` triggers.
- **Pagination**: Oracle uses `OFFSET n ROWS FETCH NEXT m ROWS ONLY` instead
  of MySQL/SQLite `LIMIT m OFFSET n`.
