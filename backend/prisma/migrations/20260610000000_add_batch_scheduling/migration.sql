-- Migration: 20260610000000_add_batch_scheduling
--
-- Adds three tables that mirror oracle-crm/src/scheduler.js and
-- oracle-db/init-scripts/02-create-schema.sql patterns:
--
--   SyncSchedule       → sync_schedules     (schedule config + checkpoint)
--   ScheduleExecution  → schedule_executions (execution tracking)
--   BatchCheckpoint    → batch_checkpoints   (fine-grained cursor/checkpoint)
--
-- These tables enable:
--   • Cron-based incremental batch processing (mirrors oracle-crm scheduler.js)
--   • lastSyncTimestamp checkpoint (mirrors JDBC cursor / ResultSet position)
--   • Job execution history (mirrors oracle-crm schedule_executions table)
--   • Resumable batches (mirrors SALES_INTEGRATION_STATUS pattern)

-- CreateTable: SyncSchedule
CREATE TABLE "SyncSchedule" (
    "id"                 INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scheduleId"         TEXT    NOT NULL,
    "name"               TEXT    NOT NULL,
    "enabled"            BOOLEAN NOT NULL DEFAULT 1,
    "scheduleType"       TEXT    NOT NULL,
    "cronExpression"     TEXT    NOT NULL,
    "region"             TEXT,
    "incremental"        BOOLEAN NOT NULL DEFAULT 1,
    "dateFrom"           TEXT,
    "dateTo"             TEXT,
    "lookbackDays"       INTEGER NOT NULL DEFAULT 1,
    "retryEnabled"       BOOLEAN NOT NULL DEFAULT 1,
    "maxRetries"         INTEGER NOT NULL DEFAULT 3,
    "notifyOnFailure"    BOOLEAN NOT NULL DEFAULT 1,
    "notificationConfig" TEXT,
    "lastRunAt"          DATETIME,
    "lastSyncTimestamp"  TEXT,
    "lastRunStatus"      TEXT,
    "runCount"           INTEGER NOT NULL DEFAULT 0,
    "failureCount"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SyncSchedule_scheduleId_key" ON "SyncSchedule"("scheduleId");
CREATE INDEX "SyncSchedule_enabled_idx"      ON "SyncSchedule"("enabled");
CREATE INDEX "SyncSchedule_scheduleType_idx" ON "SyncSchedule"("scheduleType");
CREATE INDEX "SyncSchedule_region_idx"       ON "SyncSchedule"("region");

-- CreateTable: ScheduleExecution
CREATE TABLE "ScheduleExecution" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scheduleId"    TEXT    NOT NULL,
    "executionId"   TEXT    NOT NULL,
    "status"        TEXT    NOT NULL DEFAULT 'RUNNING',
    "errorMessage"  TEXT,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"    DATETIME,
    "durationMs"    INTEGER,
    CONSTRAINT "ScheduleExecution_scheduleId_fkey"
        FOREIGN KEY ("scheduleId")
        REFERENCES "SyncSchedule" ("scheduleId")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScheduleExecution_executionId_key" ON "ScheduleExecution"("executionId");
CREATE INDEX "ScheduleExecution_scheduleId_idx" ON "ScheduleExecution"("scheduleId");
CREATE INDEX "ScheduleExecution_startedAt_idx"  ON "ScheduleExecution"("startedAt");
CREATE INDEX "ScheduleExecution_status_idx"     ON "ScheduleExecution"("status");

-- CreateTable: BatchCheckpoint
CREATE TABLE "BatchCheckpoint" (
    "id"               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scheduleId"       TEXT,
    "batchType"        TEXT    NOT NULL,
    "checkpointKey"    TEXT    NOT NULL,
    "checkpointValue"  TEXT    NOT NULL,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "BatchCheckpoint_scheduleId_batchType_checkpointKey_key"
    ON "BatchCheckpoint"("scheduleId", "batchType", "checkpointKey");
CREATE INDEX "BatchCheckpoint_batchType_checkpointKey_idx"
    ON "BatchCheckpoint"("batchType", "checkpointKey");
