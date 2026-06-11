-- =============================================================================
-- PKG_BATCH_PROCESSOR  –  Oracle Staging Database Batch Processing Package
-- =============================================================================
--
-- PURPOSE
--   Provides chunked, resumable batch processing for Oracle Fusion integration.
--   Designed to be called from the Node.js service layer (batchOracleService.js),
--   mirroring how integration-Oracle/IntegrationJobs calls EJB session beans that
--   in turn call the Oracle DB.
--
-- HOW THE NODE.JS LAYER CALLS THIS PACKAGE
--   Connection config (mirrors jdbc-config.properties):
--     connectString   = host:port/serviceName
--     connectTimeout  = 60 seconds  (ORACLE_CONNECT_TIMEOUT_S)
--     maxRetries      = 3           (ORACLE_MAX_RETRIES)
--     fetchSize       = 100 rows    (ORACLE_FETCH_SIZE / ORACLE_INVOICE_LINE_CHUNK_SIZE)
--     transaction.isolation = READ_COMMITTED (default Oracle isolation)
--
--   Procedure call pattern (mirrors FusionInvDataLoader.runTxnReconciliation):
--     1. Node.js opens connection (withRetry loop)
--     2. Calls PKG_BATCH_PROCESSOR.INIT_BATCH(p_batch_type, p_region, p_date_from, p_date_to)
--        → returns p_batch_id (OUT)
--     3. Repeatedly calls PROCESS_NEXT_CHUNK(p_batch_id, p_chunk_size, p_processed, p_done)
--        until p_done = 'Y'   (mirrors ResultSet.fetchSize loop)
--     4. On error: calls LOG_BATCH_ERROR(p_batch_id, p_error_msg)
--     5. On success: calls COMPLETE_BATCH(p_batch_id)
--     6. Node.js commits or rolls back based on return status
--
--   Transaction boundary:
--     PROCESS_NEXT_CHUNK issues autonomous COMMIT after each chunk
--     (mirrors jdbc transaction.timeout=300s + READ_COMMITTED isolation)
--
-- TABLES USED (mirrors integration-Oracle oracle-db/init-scripts/02-create-schema.sql)
--   BATCH_JOB_CONTROL   – tracks batch runs (= sync_schedules equivalent)
--   BATCH_CHECKPOINT    – per-chunk cursor (= lastSyncTimestamp equivalent)
--   BATCH_ERROR_LOG     – error rows per chunk
--   FUSION_INVOICE_HEADER, FUSION_INVOICE_LINE  – staging data
--   FUSION_STANDARD_RECEIPT, FUSION_MISC_RECEIPT, FUSION_APPLY_RECEIPT
--
-- =============================================================================

-- ── Supporting tables ─────────────────────────────────────────────────────────

CREATE TABLE BATCH_JOB_CONTROL (
    BATCH_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    BATCH_TYPE     VARCHAR2(30)  NOT NULL,  -- AR_INVOICE_BATCH | STANDARD_RECEIPT | ...
    REGION         VARCHAR2(5),
    DATE_FROM      DATE,
    DATE_TO        DATE,
    STATUS         VARCHAR2(20)  NOT NULL DEFAULT 'RUNNING', -- RUNNING|SUCCESS|FAILED
    TOTAL_RECORDS  NUMBER        DEFAULT 0,
    PROCESSED      NUMBER        DEFAULT 0,
    FAILED         NUMBER        DEFAULT 0,
    START_TIME     DATE          DEFAULT SYSDATE,
    END_TIME       DATE,
    ERROR_MESSAGE  VARCHAR2(4000)
);

CREATE INDEX IX_BJC_TYPE_STATUS ON BATCH_JOB_CONTROL(BATCH_TYPE, STATUS);
CREATE INDEX IX_BJC_REGION       ON BATCH_JOB_CONTROL(REGION, BATCH_TYPE, START_TIME DESC);

-- Fine-grained cursor checkpoint (mirrors lastSyncTimestamp + BatchCheckpoint in Node.js)
CREATE TABLE BATCH_CHECKPOINT (
    BATCH_ID         NUMBER        NOT NULL REFERENCES BATCH_JOB_CONTROL(BATCH_ID),
    CHUNK_SEQ        NUMBER        NOT NULL,
    CURSOR_VALUE     VARCHAR2(100),   -- last processed row identifier (e.g. ROW_ID)
    RECORDS_IN_CHUNK NUMBER        DEFAULT 0,
    CHUNK_STATUS     VARCHAR2(10)  DEFAULT 'DONE',
    COMMITTED_AT     DATE          DEFAULT SYSDATE,
    PRIMARY KEY (BATCH_ID, CHUNK_SEQ)
);

CREATE TABLE BATCH_ERROR_LOG (
    ERROR_ID     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    BATCH_ID     NUMBER  NOT NULL,
    CHUNK_SEQ    NUMBER,
    ROW_REF      VARCHAR2(100),
    ERROR_CODE   VARCHAR2(30),
    ERROR_MSG    VARCHAR2(4000),
    LOGGED_AT    DATE DEFAULT SYSDATE
);

CREATE INDEX IX_BEL_BATCH ON BATCH_ERROR_LOG(BATCH_ID, CHUNK_SEQ);


-- ── Package specification ─────────────────────────────────────────────────────

CREATE OR REPLACE PACKAGE PKG_BATCH_PROCESSOR AS

    -- ──────────────────────────────────────────────────────────────────────────
    -- INIT_BATCH
    --   Creates a new batch job control record.
    --   Called by Node.js once per batch run before PROCESS_NEXT_CHUNK.
    --
    --   Mirrors: integration-Oracle FusionInvDataLoader.runTxnReconciliation
    --            first step: establishing session, loading credentials.
    --
    -- Parameters:
    --   p_batch_type   IN  – 'AR_INVOICE_BATCH' | 'STANDARD_RECEIPT' | ...
    --   p_region       IN  – 'SA', 'AE', 'KW', etc.
    --   p_date_from    IN  – inclusive start date
    --   p_date_to      IN  – inclusive end date
    --   p_batch_id     OUT – generated batch ID for subsequent calls
    -- ──────────────────────────────────────────────────────────────────────────
    PROCEDURE INIT_BATCH(
        p_batch_type IN  VARCHAR2,
        p_region     IN  VARCHAR2,
        p_date_from  IN  DATE,
        p_date_to    IN  DATE,
        p_batch_id   OUT NUMBER
    );

    -- ──────────────────────────────────────────────────────────────────────────
    -- PROCESS_NEXT_CHUNK
    --   Fetches and processes the next p_chunk_size rows for the given batch.
    --   Issues an autonomous COMMIT after each successful chunk so that
    --   progress is preserved even if the Node.js session is interrupted.
    --
    --   Mirrors:
    --     JDBC ResultSet.setFetchSize(p_chunk_size) – row-by-row fetch
    --     arPipelineController.js LINE_CHUNK_SIZE   – chunk boundaries
    --     jdbc-config.properties transaction.timeout=300 + READ_COMMITTED
    --
    --   The cursor advances using ROW_ID > last checkpoint, which is the
    --   PL/SQL equivalent of JDBC ResultSet cursor position.
    --
    -- Parameters:
    --   p_batch_id    IN  – batch ID from INIT_BATCH
    --   p_chunk_size  IN  – rows per chunk (matches ORACLE_FETCH_SIZE, max 100)
    --   p_processed   OUT – rows successfully processed in this chunk
    --   p_failed      OUT – rows that failed in this chunk
    --   p_done        OUT – 'Y' when no more rows to process, 'N' otherwise
    -- ──────────────────────────────────────────────────────────────────────────
    PROCEDURE PROCESS_NEXT_CHUNK(
        p_batch_id   IN  NUMBER,
        p_chunk_size IN  NUMBER DEFAULT 100,
        p_processed  OUT NUMBER,
        p_failed     OUT NUMBER,
        p_done       OUT VARCHAR2
    );

    -- ──────────────────────────────────────────────────────────────────────────
    -- COMPLETE_BATCH
    --   Marks a batch as SUCCESS and records end time.
    --   Called by Node.js after all chunks are done (p_done = 'Y').
    --
    -- Parameters:
    --   p_batch_id IN – batch ID from INIT_BATCH
    -- ──────────────────────────────────────────────────────────────────────────
    PROCEDURE COMPLETE_BATCH(
        p_batch_id IN NUMBER
    );

    -- ──────────────────────────────────────────────────────────────────────────
    -- LOG_BATCH_ERROR
    --   Records an error for a given row within a batch chunk.
    --   Node.js calls this when processFn() returns {success:false}.
    --
    --   Mirrors oracle-crm/src/scheduler.js failure recording +
    --   oracle-db FUSION_INVOICE_LINE STATUS/MESSAGE columns.
    --
    -- Parameters:
    --   p_batch_id  IN – batch ID
    --   p_chunk_seq IN – chunk sequence number
    --   p_row_ref   IN – row identifier (ROW_ID or invoice number)
    --   p_error_msg IN – error text
    -- ──────────────────────────────────────────────────────────────────────────
    PROCEDURE LOG_BATCH_ERROR(
        p_batch_id  IN NUMBER,
        p_chunk_seq IN NUMBER,
        p_row_ref   IN VARCHAR2,
        p_error_msg IN VARCHAR2
    );

    -- ──────────────────────────────────────────────────────────────────────────
    -- GET_BATCH_STATUS
    --   Returns summary status for a batch run.
    --   Called by Node.js to report progress back to the UI.
    --
    --   Returns the same fields as ScheduleExecution in the Node.js layer:
    --     status, total_records, processed, failed, start_time, end_time
    -- ──────────────────────────────────────────────────────────────────────────
    PROCEDURE GET_BATCH_STATUS(
        p_batch_id     IN  NUMBER,
        p_status       OUT VARCHAR2,
        p_total        OUT NUMBER,
        p_processed    OUT NUMBER,
        p_failed       OUT NUMBER,
        p_start_time   OUT DATE,
        p_end_time     OUT DATE,
        p_error_msg    OUT VARCHAR2
    );

    -- ──────────────────────────────────────────────────────────────────────────
    -- ABORT_BATCH
    --   Marks a batch as FAILED and records an error message.
    --   Called by Node.js error handler (mirrors pRetry AbortError path).
    -- ──────────────────────────────────────────────────────────────────────────
    PROCEDURE ABORT_BATCH(
        p_batch_id  IN NUMBER,
        p_error_msg IN VARCHAR2
    );

END PKG_BATCH_PROCESSOR;
/


-- ── Package body ──────────────────────────────────────────────────────────────

CREATE OR REPLACE PACKAGE BODY PKG_BATCH_PROCESSOR AS

    -- ── INIT_BATCH ────────────────────────────────────────────────────────────
    PROCEDURE INIT_BATCH(
        p_batch_type IN  VARCHAR2,
        p_region     IN  VARCHAR2,
        p_date_from  IN  DATE,
        p_date_to    IN  DATE,
        p_batch_id   OUT NUMBER
    ) IS
        v_total NUMBER := 0;
    BEGIN
        -- Count eligible rows (type-specific query can be extended per batch_type)
        SELECT COUNT(*)
          INTO v_total
          FROM FUSION_INVOICE_HEADER
         WHERE STATUS    IS NULL          -- unprocessed rows
           AND (p_region IS NULL OR REGION = p_region)
           AND (p_date_from IS NULL OR TXN_DATE >= p_date_from)
           AND (p_date_to   IS NULL OR TXN_DATE <= p_date_to);

        INSERT INTO BATCH_JOB_CONTROL (
            BATCH_TYPE, REGION, DATE_FROM, DATE_TO, STATUS, TOTAL_RECORDS
        ) VALUES (
            p_batch_type, p_region, p_date_from, p_date_to, 'RUNNING', v_total
        ) RETURNING BATCH_ID INTO p_batch_id;

        COMMIT;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END INIT_BATCH;

    -- ── PROCESS_NEXT_CHUNK ────────────────────────────────────────────────────
    --
    -- Implements the JDBC ResultSet.setFetchSize() pattern in PL/SQL:
    --   1. Find the last committed checkpoint (cursor position)
    --   2. Fetch the next p_chunk_size rows after that cursor
    --   3. Process each row (mark as PROCESSING)
    --   4. Commit after chunk  (mirrors jdbc transaction.timeout=300 boundary)
    --   5. Record checkpoint for resumability
    --
    PROCEDURE PROCESS_NEXT_CHUNK(
        p_batch_id   IN  NUMBER,
        p_chunk_size IN  NUMBER DEFAULT 100,
        p_processed  OUT NUMBER,
        p_failed     OUT NUMBER,
        p_done       OUT VARCHAR2
    ) IS
        PRAGMA AUTONOMOUS_TRANSACTION;  -- chunk commits independently

        v_chunk_size     NUMBER  := LEAST(NVL(p_chunk_size, 100), 100); -- hard cap = 100
        v_last_cursor    VARCHAR2(100);
        v_chunk_seq      NUMBER  := 0;
        v_rows_in_chunk  NUMBER  := 0;
        v_batch_type     VARCHAR2(30);
        v_region         VARCHAR2(5);
        v_date_from      DATE;
        v_date_to        DATE;

        -- Cursor over next chunk using ROW_ID as the scroll cursor.
        -- This is the PL/SQL equivalent of JDBC ResultSet with setFetchSize.
        CURSOR c_chunk (cp_last_cursor VARCHAR2, cp_size NUMBER,
                        cp_region VARCHAR2, cp_date_from DATE, cp_date_to DATE) IS
            SELECT H.ROW_ID, H.REGION, H.TXN_DATE, H.BILL_TO_CUST_NAME,
                   H.TXN_NUMBER, H.CURRENCY_CODE, H.BUSINESS_UNIT
              FROM FUSION_INVOICE_HEADER H
             WHERE H.STATUS IS NULL
               AND (cp_region    IS NULL OR H.REGION    = cp_region)
               AND (cp_date_from IS NULL OR H.TXN_DATE >= cp_date_from)
               AND (cp_date_to   IS NULL OR H.TXN_DATE <= cp_date_to)
               AND (cp_last_cursor IS NULL OR TO_CHAR(H.ROW_ID) > cp_last_cursor)
             ORDER BY H.ROW_ID
             FETCH FIRST cp_size ROWS ONLY;

    BEGIN
        p_processed := 0;
        p_failed    := 0;
        p_done      := 'N';

        -- Load batch metadata
        SELECT BATCH_TYPE, REGION, DATE_FROM, DATE_TO
          INTO v_batch_type, v_region, v_date_from, v_date_to
          FROM BATCH_JOB_CONTROL
         WHERE BATCH_ID = p_batch_id;

        -- Get last committed cursor from checkpoint table
        SELECT NVL(MAX(TO_CHAR(CHUNK_SEQ)), '0'), NVL(MAX(CURSOR_VALUE), NULL)
          INTO v_chunk_seq, v_last_cursor
          FROM BATCH_CHECKPOINT
         WHERE BATCH_ID = p_batch_id
           AND CHUNK_STATUS = 'DONE';

        v_chunk_seq := NVL(v_chunk_seq, 0) + 1;

        -- Process the chunk
        FOR rec IN c_chunk(v_last_cursor, v_chunk_size, v_region, v_date_from, v_date_to) LOOP
            BEGIN
                -- Mark row as being processed (staging update)
                UPDATE FUSION_INVOICE_HEADER
                   SET STATUS  = 'PROCESSING',
                       MESSAGE = 'Batch ' || p_batch_id || ' chunk ' || v_chunk_seq
                 WHERE ROW_ID  = rec.ROW_ID;

                v_last_cursor := TO_CHAR(rec.ROW_ID);
                v_rows_in_chunk := v_rows_in_chunk + 1;
                p_processed     := p_processed     + 1;
            EXCEPTION
                WHEN OTHERS THEN
                    p_failed := p_failed + 1;
                    INSERT INTO BATCH_ERROR_LOG(BATCH_ID, CHUNK_SEQ, ROW_REF, ERROR_CODE, ERROR_MSG)
                    VALUES (p_batch_id, v_chunk_seq, TO_CHAR(rec.ROW_ID), SQLCODE, SQLERRM);
            END;
        END LOOP;

        -- Record checkpoint for this chunk
        IF v_rows_in_chunk > 0 THEN
            INSERT INTO BATCH_CHECKPOINT(BATCH_ID, CHUNK_SEQ, CURSOR_VALUE,
                                         RECORDS_IN_CHUNK, CHUNK_STATUS)
            VALUES (p_batch_id, v_chunk_seq, v_last_cursor, v_rows_in_chunk, 'DONE');

            -- Update running totals on parent batch record
            UPDATE BATCH_JOB_CONTROL
               SET PROCESSED = PROCESSED + p_processed,
                   FAILED    = FAILED    + p_failed
             WHERE BATCH_ID  = p_batch_id;

            COMMIT;  -- autonomous transaction commit: progress preserved
        ELSE
            -- No more rows to process
            p_done := 'Y';
            COMMIT;
        END IF;

        -- Signal completion when chunk was smaller than requested
        IF v_rows_in_chunk < v_chunk_size THEN
            p_done := 'Y';
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_failed := p_failed + 1;
            INSERT INTO BATCH_ERROR_LOG(BATCH_ID, CHUNK_SEQ, ROW_REF, ERROR_CODE, ERROR_MSG)
            VALUES (p_batch_id, v_chunk_seq, 'CHUNK_LEVEL', SQLCODE, SQLERRM);
            COMMIT;
            RAISE;
    END PROCESS_NEXT_CHUNK;

    -- ── COMPLETE_BATCH ────────────────────────────────────────────────────────
    PROCEDURE COMPLETE_BATCH(
        p_batch_id IN NUMBER
    ) IS
    BEGIN
        UPDATE BATCH_JOB_CONTROL
           SET STATUS   = 'SUCCESS',
               END_TIME = SYSDATE
         WHERE BATCH_ID = p_batch_id;
        COMMIT;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END COMPLETE_BATCH;

    -- ── LOG_BATCH_ERROR ───────────────────────────────────────────────────────
    PROCEDURE LOG_BATCH_ERROR(
        p_batch_id  IN NUMBER,
        p_chunk_seq IN NUMBER,
        p_row_ref   IN VARCHAR2,
        p_error_msg IN VARCHAR2
    ) IS
        PRAGMA AUTONOMOUS_TRANSACTION;
    BEGIN
        INSERT INTO BATCH_ERROR_LOG(BATCH_ID, CHUNK_SEQ, ROW_REF, ERROR_MSG)
        VALUES (p_batch_id, p_chunk_seq, p_row_ref, SUBSTR(p_error_msg, 1, 4000));
        COMMIT;
    END LOG_BATCH_ERROR;

    -- ── GET_BATCH_STATUS ──────────────────────────────────────────────────────
    PROCEDURE GET_BATCH_STATUS(
        p_batch_id     IN  NUMBER,
        p_status       OUT VARCHAR2,
        p_total        OUT NUMBER,
        p_processed    OUT NUMBER,
        p_failed       OUT NUMBER,
        p_start_time   OUT DATE,
        p_end_time     OUT DATE,
        p_error_msg    OUT VARCHAR2
    ) IS
    BEGIN
        SELECT STATUS, TOTAL_RECORDS, PROCESSED, FAILED,
               START_TIME, END_TIME, ERROR_MESSAGE
          INTO p_status, p_total, p_processed, p_failed,
               p_start_time, p_end_time, p_error_msg
          FROM BATCH_JOB_CONTROL
         WHERE BATCH_ID = p_batch_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status := 'NOT_FOUND';
    END GET_BATCH_STATUS;

    -- ── ABORT_BATCH ───────────────────────────────────────────────────────────
    PROCEDURE ABORT_BATCH(
        p_batch_id  IN NUMBER,
        p_error_msg IN VARCHAR2
    ) IS
    BEGIN
        UPDATE BATCH_JOB_CONTROL
           SET STATUS        = 'FAILED',
               END_TIME      = SYSDATE,
               ERROR_MESSAGE = SUBSTR(p_error_msg, 1, 4000)
         WHERE BATCH_ID = p_batch_id;
        COMMIT;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END ABORT_BATCH;

END PKG_BATCH_PROCESSOR;
/

-- =============================================================================
-- HOW NODE.JS CALLS THIS PACKAGE
-- =============================================================================
--
-- The following pseudo-code shows the end-to-end pattern used by
-- batchOracleService.js when it drives this package.
-- (Mirrors the flow in oracle-crm/src/oracleDbClient.js + oracleSync.js)
--
--   const cfg     = getBatchConfig();
--   const client  = createOracleClient({ username, password, mode: 'json' });
--   const conn    = await withRetry(() => oracledb.getConnection({...}));
--
--   // Step 1: Init batch (mirrors INIT_BATCH)
--   const initResult = await conn.execute(
--     `BEGIN PKG_BATCH_PROCESSOR.INIT_BATCH(
--        :batchType, :region, TO_DATE(:dateFrom,'YYYY-MM-DD'),
--        TO_DATE(:dateTo,'YYYY-MM-DD'), :batchId
--      ); END;`,
--     { batchType: 'AR_INVOICE_BATCH', region: 'SA',
--       dateFrom: '2026-06-01', dateTo: '2026-06-10',
--       batchId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
--     }
--   );
--   const batchId = initResult.outBinds.batchId;
--
--   // Step 2: Chunk loop (mirrors ResultSet.setFetchSize / processBatchChunked)
--   let done = false;
--   while (!done) {
--     const chunkResult = await withRetry(() => conn.execute(
--       `BEGIN PKG_BATCH_PROCESSOR.PROCESS_NEXT_CHUNK(
--          :batchId, :chunkSize, :processed, :failed, :done
--        ); END;`,
--       { batchId, chunkSize: cfg.fetchSize,
--         processed: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
--         failed:    { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
--         done:      { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 1 }
--       }
--     ));
--     done = chunkResult.outBinds.done === 'Y';
--   }
--
--   // Step 3: Complete batch
--   await conn.execute(`BEGIN PKG_BATCH_PROCESSOR.COMPLETE_BATCH(:batchId); END;`, { batchId });
--   await conn.close();
-- =============================================================================
