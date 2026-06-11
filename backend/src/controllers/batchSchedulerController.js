'use strict';

/**
 * batchSchedulerController.js
 *
 * REST API for managing recurring batch sync schedules.
 *
 * Mirrors the route handlers pattern from oracle-crm/src/routes/ and
 * the schedule management functions in oracle-crm/src/scheduler.js.
 *
 * Endpoints:
 *   GET    /api/batch-scheduler/schedules              – list all schedules
 *   POST   /api/batch-scheduler/schedules              – create new schedule
 *   GET    /api/batch-scheduler/schedules/:id          – get single schedule
 *   PATCH  /api/batch-scheduler/schedules/:id          – update schedule
 *   DELETE /api/batch-scheduler/schedules/:id          – delete schedule
 *   POST   /api/batch-scheduler/schedules/:id/trigger  – run immediately
 *   GET    /api/batch-scheduler/schedules/:id/executions – execution history
 *   GET    /api/batch-scheduler/config                 – current batch config
 */

const scheduler   = require('../services/syncSchedulerService');
const { getBatchConfig } = require('../services/batchOracleService');
const prisma      = require('../services/prisma');

// ─── List schedules ───────────────────────────────────────────────────────────

async function listSchedules(req, res, next) {
  try {
    const filters = {};
    if (req.query.enabled  !== undefined) filters.enabled  = req.query.enabled === 'true';
    if (req.query.region   !== undefined) filters.region   = req.query.region;

    const schedules = await scheduler.listSchedules(filters);
    return res.json({ schedules });
  } catch (err) {
    next(err);
  }
}

// ─── Create schedule ──────────────────────────────────────────────────────────

async function createSchedule(req, res, next) {
  try {
    const {
      name, scheduleType, cronExpression, region,
      enabled, incremental, lookbackDays, dateFrom, dateTo,
      retryEnabled, maxRetries, notifyOnFailure, notificationConfig,
    } = req.body;

    if (!name)            return res.status(400).json({ error: 'name is required' });
    if (!scheduleType)    return res.status(400).json({ error: 'scheduleType is required' });
    if (!cronExpression)  return res.status(400).json({ error: 'cronExpression is required' });

    const validTypes = Object.values(scheduler.SCHEDULE_TYPES);
    if (!validTypes.includes(scheduleType)) {
      return res.status(400).json({
        error: `Invalid scheduleType. Valid values: ${validTypes.join(', ')}`,
      });
    }

    const scheduleId = await scheduler.createSchedule({
      name, scheduleType, cronExpression, region,
      enabled, incremental, lookbackDays, dateFrom, dateTo,
      retryEnabled, maxRetries, notifyOnFailure, notificationConfig,
    });

    // Auto-start the newly created schedule without restarting existing ones
    if (enabled !== false) {
      const created = await scheduler.getSchedule(scheduleId);
      if (created) {
        await scheduler.startSchedule(created).catch((err) =>
          console.warn(`[BatchScheduler] Could not auto-start schedule ${scheduleId}: ${err.message}`)
        );
      }
    }

    return res.status(201).json({ scheduleId, message: 'Schedule created' });
  } catch (err) {
    next(err);
  }
}

// ─── Get schedule ─────────────────────────────────────────────────────────────

async function getSchedule(req, res, next) {
  try {
    const schedule = await scheduler.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    return res.json({ schedule });
  } catch (err) {
    next(err);
  }
}

// ─── Update schedule ──────────────────────────────────────────────────────────

async function updateSchedule(req, res, next) {
  try {
    const schedule = await scheduler.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    const allowed = [
      'name', 'enabled', 'cronExpression', 'region',
      'incremental', 'lookbackDays', 'dateFrom', 'dateTo',
      'retryEnabled', 'maxRetries', 'notifyOnFailure', 'notificationConfig',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.notificationConfig && typeof updates.notificationConfig === 'object') {
      updates.notificationConfig = JSON.stringify(updates.notificationConfig);
    }

    await scheduler.updateSchedule(req.params.id, updates);
    return res.json({ message: 'Schedule updated' });
  } catch (err) {
    next(err);
  }
}

// ─── Delete schedule ──────────────────────────────────────────────────────────

async function deleteScheduleHandler(req, res, next) {
  try {
    const schedule = await scheduler.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    await scheduler.deleteSchedule(req.params.id);
    return res.json({ message: 'Schedule deleted' });
  } catch (err) {
    next(err);
  }
}

// ─── Trigger now ──────────────────────────────────────────────────────────────

async function triggerSchedule(req, res, next) {
  try {
    const schedule = await scheduler.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    // Kick off asynchronously so the HTTP response returns immediately
    setImmediate(() => {
      scheduler.triggerNow(req.params.id).catch((err) =>
        console.error(`[BatchScheduler] Trigger error for ${req.params.id}: ${err.message}`)
      );
    });

    return res.json({ message: 'Schedule triggered', scheduleId: req.params.id });
  } catch (err) {
    next(err);
  }
}

// ─── Execution history ────────────────────────────────────────────────────────

async function getExecutions(req, res, next) {
  try {
    const schedule = await scheduler.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    const executions = await prisma.scheduleExecution.findMany({
      where  : { scheduleId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take   : 50,
    });

    return res.json({ executions });
  } catch (err) {
    next(err);
  }
}

// ─── Batch config ─────────────────────────────────────────────────────────────

function getBatchConfigEndpoint(_req, res) {
  return res.json({ config: getBatchConfig() });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  listSchedules,
  createSchedule,
  getSchedule,
  updateSchedule,
  deleteSchedule: deleteScheduleHandler,
  triggerSchedule,
  getExecutions,
  getBatchConfigEndpoint,
};
