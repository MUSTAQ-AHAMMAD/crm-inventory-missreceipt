'use strict';

/**
 * syncSchedulerService.js
 *
 * Cron-based batch job scheduler for Oracle Fusion integration.
 *
 * Mirrors oracle-crm/src/scheduler.js patterns:
 *   • In-memory schedule tracking (Map<scheduleId, {task, config}>)
 *   • Incremental sync via last_sync_timestamp checkpoint
 *   • lookback_days fallback when no checkpoint exists
 *   • Per-schedule retry_enabled / max_retries configuration
 *   • Execution tracking via SyncSchedule / ScheduleExecution Prisma models
 *   • notify_on_failure hook
 *
 * Schedule types (mirrors oracle-crm FETCH_AND_PUSH / FETCH_ONLY / PUSH_ONLY):
 *   AR_INVOICE_BATCH   – submit pending ArInvoiceData rows as AR invoices
 *   STANDARD_RECEIPT   – submit pending FusionStandardReceipt rows
 *   MISC_RECEIPT       – submit pending FusionMiscReceipt rows
 *   APPLY_RECEIPT      – submit pending FusionApplyReceipt rows
 *   FULL_PIPELINE      – AR_INVOICE_BATCH → STANDARD_RECEIPT → MISC_RECEIPT → APPLY_RECEIPT
 *
 * Usage:
 *   const scheduler = require('./syncSchedulerService');
 *   await scheduler.start();   // start all enabled schedules from DB
 *   await scheduler.stop();    // stop all running schedules
 */

const { randomUUID } = require('crypto');
let nodeCron;
try {
  nodeCron = require('node-cron');
} catch (_) {
  // node-cron is optional; scheduled execution is disabled without it
  nodeCron = null;
}
const prisma = require('./prisma');

// ── In-memory schedule tracking (mirrors oracle-crm activeSchedules Map) ──────
const activeSchedules = new Map(); // scheduleId → { task, config }

// ── Schedule type constants ──────────────────────────────────────────────────
const SCHEDULE_TYPES = {
  AR_INVOICE_BATCH : 'AR_INVOICE_BATCH',
  STANDARD_RECEIPT : 'STANDARD_RECEIPT',
  MISC_RECEIPT     : 'MISC_RECEIPT',
  APPLY_RECEIPT    : 'APPLY_RECEIPT',
  FULL_PIPELINE    : 'FULL_PIPELINE',
};

// ── Execution status constants ────────────────────────────────────────────────
const EXEC_STATUS = {
  RUNNING : 'RUNNING',
  SUCCESS : 'SUCCESS',
  FAILED  : 'FAILED',
};

// ─── Schedule CRUD ────────────────────────────────────────────────────────────

/**
 * Creates a new schedule record in the database.
 *
 * Mirrors createSchedule() in oracle-crm/src/scheduler.js, including
 * cron expression validation and per-schedule retry / notification config.
 *
 * @param {object} config
 * @param {string} config.name
 * @param {string} config.scheduleType  - one of SCHEDULE_TYPES
 * @param {string} config.cronExpression
 * @param {string} [config.region]
 * @param {boolean} [config.enabled]        default true
 * @param {boolean} [config.incremental]    default true
 * @param {number}  [config.lookbackDays]   default 1
 * @param {string}  [config.dateFrom]       used when incremental=false
 * @param {string}  [config.dateTo]         used when incremental=false
 * @param {boolean} [config.retryEnabled]   default true
 * @param {number}  [config.maxRetries]     default 3
 * @param {boolean} [config.notifyOnFailure] default true
 * @param {object}  [config.notificationConfig]  JSON – email / webhook settings
 * @returns {Promise<string>} scheduleId UUID
 */
async function createSchedule(config) {
  if (nodeCron && !nodeCron.validate(config.cronExpression)) {
    throw new Error(`Invalid cron expression: ${config.cronExpression}`);
  }

  const scheduleId = randomUUID();
  await prisma.syncSchedule.create({
    data: {
      scheduleId,
      name                : config.name,
      enabled             : config.enabled             !== false,
      scheduleType        : config.scheduleType        || SCHEDULE_TYPES.FULL_PIPELINE,
      cronExpression      : config.cronExpression,
      region              : config.region              || null,
      incremental         : config.incremental         !== false,
      dateFrom            : config.dateFrom            || null,
      dateTo              : config.dateTo              || null,
      lookbackDays        : config.lookbackDays        ?? 1,
      retryEnabled        : config.retryEnabled        !== false,
      maxRetries          : config.maxRetries          ?? 3,
      notifyOnFailure     : config.notifyOnFailure     !== false,
      notificationConfig  : config.notificationConfig
        ? JSON.stringify(config.notificationConfig) : null,
    },
  });

  console.log(`[Scheduler] Created schedule ${scheduleId} (${config.name})`);
  return scheduleId;
}

/**
 * Lists all schedules with optional filters.
 * Mirrors listSchedules() in oracle-crm/src/scheduler.js.
 *
 * @param {object} [filters]
 * @param {boolean} [filters.enabled]
 * @param {string}  [filters.region]
 * @returns {Promise<object[]>}
 */
async function listSchedules(filters = {}) {
  const where = {};
  if (filters.enabled !== undefined) where.enabled = filters.enabled;
  if (filters.region  !== undefined) where.region  = filters.region;

  return prisma.syncSchedule.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Retrieves a single schedule by its UUID.
 * @param {string} scheduleId
 * @returns {Promise<object|null>}
 */
async function getSchedule(scheduleId) {
  return prisma.syncSchedule.findUnique({ where: { scheduleId } });
}

/**
 * Updates mutable schedule fields.
 * If enabled/cronExpression changes, the active cron task is restarted.
 *
 * Mirrors updateSchedule() in oracle-crm/src/scheduler.js.
 *
 * @param {string} scheduleId
 * @param {object} updates
 * @returns {Promise<void>}
 */
async function updateSchedule(scheduleId, updates) {
  if (updates.cronExpression && nodeCron && !nodeCron.validate(updates.cronExpression)) {
    throw new Error(`Invalid cron expression: ${updates.cronExpression}`);
  }

  await prisma.syncSchedule.update({ where: { scheduleId }, data: updates });

  // Restart running task if scheduling-relevant fields changed
  if (updates.enabled !== undefined || updates.cronExpression) {
    if (activeSchedules.has(scheduleId)) {
      stopSchedule(scheduleId);
    }
    const cfg = await getSchedule(scheduleId);
    if (cfg && cfg.enabled) {
      await startSchedule(cfg);
    }
  }

  console.log(`[Scheduler] Updated schedule ${scheduleId}`);
}

/**
 * Deletes a schedule and stops its cron task.
 * @param {string} scheduleId
 * @returns {Promise<void>}
 */
async function deleteSchedule(scheduleId) {
  stopSchedule(scheduleId);
  await prisma.syncSchedule.delete({ where: { scheduleId } });
  console.log(`[Scheduler] Deleted schedule ${scheduleId}`);
}

// ─── Checkpoint tracking ──────────────────────────────────────────────────────
// Mirrors updateLastSyncTimestamp() in oracle-crm/src/scheduler.js.
// The checkpoint is the "cursor" that enables incremental processing –
// equivalent to a ResultSet cursor position in JDBC batch processing.

/**
 * Updates the last successful sync timestamp for a schedule.
 * Next run will only process records created after this timestamp.
 *
 * @param {string} scheduleId
 * @param {string|Date} [timestamp]  defaults to now()
 * @returns {Promise<void>}
 */
async function updateCheckpoint(scheduleId, timestamp) {
  const ts = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  await prisma.syncSchedule.update({
    where: { scheduleId },
    data : { lastSyncTimestamp: ts, lastRunStatus: EXEC_STATUS.SUCCESS },
  });
}

/**
 * Computes the date range for the next incremental sync run.
 *
 * Mirrors the incremental date-range logic in oracle-crm/src/scheduler.js
 * executeSchedule():
 *   if incremental → dateFrom = last_sync_timestamp ?? (now - lookback_days)
 *   else           → use manually configured dateFrom / dateTo
 *
 * @param {object} schedule  SyncSchedule DB row
 * @returns {{ dateFrom: string, dateTo: string }}
 */
function computeDateRange(schedule) {
  if (!schedule.incremental) {
    return { dateFrom: schedule.dateFrom, dateTo: schedule.dateTo };
  }

  const lookbackMs = (schedule.lookbackDays || 1) * 24 * 60 * 60 * 1000;
  const startDate  = schedule.lastSyncTimestamp
    ? new Date(schedule.lastSyncTimestamp)
    : new Date(Date.now() - lookbackMs);

  return {
    dateFrom: startDate.toISOString().split('T')[0],
    dateTo  : new Date().toISOString().split('T')[0],
  };
}

// ─── Execution tracking ───────────────────────────────────────────────────────
// Mirrors schedule_executions table in oracle-crm/src/scheduler.js.

/**
 * Starts an execution record.
 * @param {string} scheduleId
 * @returns {Promise<object>} ScheduleExecution row
 */
async function startExecution(scheduleId) {
  const executionId = randomUUID();
  return prisma.scheduleExecution.create({
    data: {
      executionId,
      scheduleId,
      status   : EXEC_STATUS.RUNNING,
      startedAt: new Date(),
    },
  });
}

/**
 * Finalises an execution record.
 * @param {string} executionId
 * @param {object} outcome
 * @param {'SUCCESS'|'FAILED'} outcome.status
 * @param {number}  [outcome.recordsSynced]
 * @param {number}  [outcome.recordsFailed]
 * @param {string}  [outcome.errorMessage]
 * @returns {Promise<void>}
 */
async function finishExecution(executionId, outcome) {
  const finishedAt = new Date();
  const execution  = await prisma.scheduleExecution.findUnique({ where: { executionId } });
  const durationMs = execution ? (finishedAt - new Date(execution.startedAt)) : 0;

  await prisma.scheduleExecution.update({
    where: { executionId },
    data : {
      status       : outcome.status,
      recordsSynced: outcome.recordsSynced || 0,
      recordsFailed: outcome.recordsFailed || 0,
      errorMessage : outcome.errorMessage  || null,
      finishedAt,
      durationMs,
    },
  });

  // Update parent schedule counters
  await prisma.syncSchedule.update({
    where: { scheduleId: execution?.scheduleId },
    data : {
      lastRunAt    : finishedAt,
      lastRunStatus: outcome.status,
      runCount     : { increment: 1 },
      failureCount : outcome.status === EXEC_STATUS.FAILED ? { increment: 1 } : undefined,
    },
  }).catch(() => { /* ignore if schedule was deleted */ });
}

// ─── Job dispatcher ───────────────────────────────────────────────────────────
// Routes each scheduleType to its domain controller function.
// Mirrors oracle-crm/src/scheduler.js executeSchedule() dispatch logic.

const jobHandlers = {};  // populated via registerJobHandler()

/**
 * Registers a handler function for a given schedule type.
 * Called from app startup or controller modules.
 *
 * @param {string} scheduleType  - one of SCHEDULE_TYPES
 * @param {(dateFrom: string, dateTo: string, schedule: object) => Promise<{recordsSynced:number, recordsFailed:number}>} fn
 */
function registerJobHandler(scheduleType, fn) {
  jobHandlers[scheduleType] = fn;
  console.log(`[Scheduler] Registered handler for scheduleType=${scheduleType}`);
}

/**
 * Executes a single scheduled job run.
 * Creates execution record → dispatch → update checkpoint → finish execution.
 *
 * Mirrors executeSchedule() in oracle-crm/src/scheduler.js.
 *
 * @param {object} schedule  SyncSchedule DB row
 * @returns {Promise<void>}
 */
async function executeSchedule(schedule) {
  const execution = await startExecution(schedule.scheduleId);
  console.log(
    `[Scheduler] Executing schedule ${schedule.scheduleId} ` +
    `(type=${schedule.scheduleType}, execution=${execution.executionId})`
  );

  try {
    const { dateFrom, dateTo } = computeDateRange(schedule);
    console.log(`[Scheduler] Date range: ${dateFrom} → ${dateTo}`);

    const handler = jobHandlers[schedule.scheduleType];
    if (!handler) {
      throw new Error(`No handler registered for scheduleType=${schedule.scheduleType}`);
    }

    const result = await handler(dateFrom, dateTo, schedule);

    await finishExecution(execution.executionId, {
      status       : EXEC_STATUS.SUCCESS,
      recordsSynced: result.recordsSynced || 0,
      recordsFailed: result.recordsFailed || 0,
    });

    // Advance checkpoint so next run only processes newer records
    if (schedule.incremental) {
      await updateCheckpoint(schedule.scheduleId);
    }

    console.log(
      `[Scheduler] Schedule ${schedule.scheduleId} completed. ` +
      `synced=${result.recordsSynced} failed=${result.recordsFailed}`
    );
  } catch (err) {
    console.error(`[Scheduler] Schedule ${schedule.scheduleId} failed: ${err.message}`);

    await finishExecution(execution.executionId, {
      status      : EXEC_STATUS.FAILED,
      errorMessage: err.message,
    });

    // Optional notification hook
    if (schedule.notifyOnFailure && schedule.notificationConfig) {
      const cfg = (() => {
        try { return JSON.parse(schedule.notificationConfig); } catch (_) { return null; }
      })();
      if (cfg) {
        console.warn(`[Scheduler] Failure notification would be sent to: ${JSON.stringify(cfg)}`);
        // TODO: integrate with email/webhook notifier (mirrors oracle-crm/src/notifier.js)
      }
    }
  }
}

// ─── Cron task management ─────────────────────────────────────────────────────

/**
 * Starts the cron task for a single schedule.
 * Mirrors startSchedule() in oracle-crm/src/scheduler.js.
 *
 * @param {object} schedule  SyncSchedule DB row
 * @returns {Promise<void>}
 */
async function startSchedule(schedule) {
  if (!nodeCron) {
    console.warn('[Scheduler] node-cron not installed; skipping cron start for', schedule.scheduleId);
    return;
  }
  if (activeSchedules.has(schedule.scheduleId)) {
    stopSchedule(schedule.scheduleId);
  }

  const task = nodeCron.schedule(
    schedule.cronExpression,
    () => {
      executeSchedule(schedule).catch((err) =>
        console.error(`[Scheduler] Unhandled error in schedule ${schedule.scheduleId}: ${err.message}`)
      );
    },
    { scheduled: true, timezone: 'UTC' }
  );

  activeSchedules.set(schedule.scheduleId, { task, config: schedule });
  console.log(`[Scheduler] Started schedule ${schedule.scheduleId} (${schedule.cronExpression})`);
}

/**
 * Stops and removes the cron task for a schedule.
 * @param {string} scheduleId
 */
function stopSchedule(scheduleId) {
  const entry = activeSchedules.get(scheduleId);
  if (entry?.task) {
    entry.task.stop();
    console.log(`[Scheduler] Stopped schedule ${scheduleId}`);
  }
  activeSchedules.delete(scheduleId);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Loads all enabled schedules from the DB and starts their cron tasks.
 * Call once at server startup (mirrors scheduler.start() in oracle-crm).
 * @returns {Promise<void>}
 */
async function start() {
  const schedules = await listSchedules({ enabled: true });
  for (const s of schedules) {
    await startSchedule(s);
  }
  console.log(`[Scheduler] Started ${schedules.length} enabled schedule(s)`);
}

/**
 * Stops all active cron tasks.
 * Call on graceful shutdown (mirrors scheduler.stop() in oracle-crm).
 */
function stop() {
  for (const scheduleId of activeSchedules.keys()) {
    stopSchedule(scheduleId);
  }
  console.log('[Scheduler] All schedules stopped');
}

/**
 * Manually triggers a schedule run immediately (ignoring cron timing).
 * Useful for on-demand batch submission from the API.
 *
 * @param {string} scheduleId
 * @returns {Promise<void>}
 */
async function triggerNow(scheduleId) {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
  await executeSchedule(schedule);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  SCHEDULE_TYPES,
  EXEC_STATUS,

  // CRUD
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,

  // Checkpoint
  updateCheckpoint,
  computeDateRange,

  // Execution
  startExecution,
  finishExecution,
  triggerNow,

  // Handler registry
  registerJobHandler,

  // Lifecycle
  start,
  stop,
};
