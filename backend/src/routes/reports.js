/**
 * Reports routes.
 * Requires authentication; some sub-routes are admin/manager only.
 *
 * @swagger
 * tags:
 *   name: Reports
 *   description: Dashboard metrics, failure reports, and exports
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { dashboard, failures, activity, exportReport, getUploadDetail, getAllUploads } = require('../controllers/reportsController');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /reports/dashboard:
 *   get:
 *     tags: [Reports]
 *     summary: Get dashboard metrics
 *     responses:
 *       200:
 *         description: Aggregated metrics and trends
 */
router.get('/dashboard', dashboard);

/**
 * @swagger
 * /reports/failures:
 *   get:
 *     tags: [Reports]
 *     summary: Get failure records with optional filters
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [inventory, misc, standard]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Failure records
 */
router.get('/failures', failures);

/**
 * @swagger
 * /reports/activity:
 *   get:
 *     tags: [Reports]
 *     summary: Get user activity logs
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Activity log entries
 */
router.get('/activity', requireRole('ADMIN', 'MANAGER'), activity);

/**
 * @swagger
 * /reports/export:
 *   get:
 *     tags: [Reports]
 *     summary: Export reports as CSV
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [failures, activity, standard-failures, misc-failures]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: CSV file download
 */
router.get('/export', requireRole('ADMIN', 'MANAGER'), exportReport);

/**
 * @swagger
 * /reports/upload-detail/{type}/{id}:
 *   get:
 *     tags: [Reports]
 *     summary: Get detailed upload information including request/response logs
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [standard, misc]
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detailed upload information
 */
router.get('/upload-detail/:type/:id', getUploadDetail);

/**
 * @swagger
 * /reports/all-uploads:
 *   get:
 *     tags: [Reports]
 *     summary: Get all uploads (inventory, standard, misc) combined
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Combined list of all uploads
 */
router.get('/all-uploads', getAllUploads);

module.exports = router;
