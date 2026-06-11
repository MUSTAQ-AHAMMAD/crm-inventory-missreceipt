'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/batchSchedulerController');

const router = express.Router();

// All batch-scheduler routes require authentication
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: BatchScheduler
 *   description: Manage recurring Oracle Fusion batch sync schedules
 */

/**
 * @swagger
 * /api/batch-scheduler/config:
 *   get:
 *     summary: Get current batch processing configuration
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Batch configuration (pool, retry, timeout, chunk size)
 */
router.get('/config', ctrl.getBatchConfigEndpoint);

/**
 * @swagger
 * /api/batch-scheduler/schedules:
 *   get:
 *     summary: List all sync schedules
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: enabled
 *         schema: { type: boolean }
 *       - in: query
 *         name: region
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of SyncSchedule objects
 */
router.get('/schedules', ctrl.listSchedules);

/**
 * @swagger
 * /api/batch-scheduler/schedules:
 *   post:
 *     summary: Create a new sync schedule
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, scheduleType, cronExpression]
 *             properties:
 *               name:            { type: string }
 *               scheduleType:
 *                 type: string
 *                 enum: [AR_INVOICE_BATCH, STANDARD_RECEIPT, MISC_RECEIPT, APPLY_RECEIPT, FULL_PIPELINE]
 *               cronExpression:  { type: string, example: "0 2 * * *" }
 *               region:          { type: string, example: "SA" }
 *               enabled:         { type: boolean, default: true }
 *               incremental:     { type: boolean, default: true }
 *               lookbackDays:    { type: integer, default: 1 }
 *               retryEnabled:    { type: boolean, default: true }
 *               maxRetries:      { type: integer, default: 3 }
 *               notifyOnFailure: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Created schedule with scheduleId
 *       400:
 *         description: Validation error
 */
router.post('/schedules', ctrl.createSchedule);

/**
 * @swagger
 * /api/batch-scheduler/schedules/{id}:
 *   get:
 *     summary: Get a single schedule by UUID
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SyncSchedule object
 *       404:
 *         description: Schedule not found
 */
router.get('/schedules/:id', ctrl.getSchedule);

/**
 * @swagger
 * /api/batch-scheduler/schedules/{id}:
 *   patch:
 *     summary: Update a schedule
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated successfully
 *       404:
 *         description: Schedule not found
 */
router.patch('/schedules/:id', ctrl.updateSchedule);

/**
 * @swagger
 * /api/batch-scheduler/schedules/{id}:
 *   delete:
 *     summary: Delete a schedule
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted successfully
 *       404:
 *         description: Schedule not found
 */
router.delete('/schedules/:id', ctrl.deleteSchedule);

/**
 * @swagger
 * /api/batch-scheduler/schedules/{id}/trigger:
 *   post:
 *     summary: Trigger a schedule run immediately (ignores cron timing)
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trigger accepted (runs asynchronously)
 *       404:
 *         description: Schedule not found
 */
router.post('/schedules/:id/trigger', ctrl.triggerSchedule);

/**
 * @swagger
 * /api/batch-scheduler/schedules/{id}/executions:
 *   get:
 *     summary: Get recent execution history for a schedule
 *     tags: [BatchScheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of ScheduleExecution objects
 *       404:
 *         description: Schedule not found
 */
router.get('/schedules/:id/executions', ctrl.getExecutions);

module.exports = router;
