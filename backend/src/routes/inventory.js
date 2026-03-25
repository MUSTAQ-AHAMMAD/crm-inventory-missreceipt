/**
 * Inventory Upload routes.
 * All routes require authentication.
 * File uploads use multer with memory storage (no disk writes).
 *
 * @swagger
 * tags:
 *   name: Inventory
 *   description: Bulk inventory CSV upload endpoints
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  bulkUpload,
  listUploads,
  getFailures,
  retryUpload,
  downloadTemplate,
} = require('../controllers/inventoryController');

const router = express.Router();

// Store uploaded files in memory (no temporary disk files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted.'));
    }
  },
});

// Apply JWT auth and activity logging to all routes
router.use(authenticate, activityLogger);

/**
 * @swagger
 * /inventory/bulk-upload:
 *   post:
 *     tags: [Inventory]
 *     summary: Upload a CSV file for bulk inventory processing
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload summary with success/failure counts
 */
router.post('/bulk-upload', upload.single('file'), bulkUpload);

/**
 * @swagger
 * /inventory/uploads:
 *   get:
 *     tags: [Inventory]
 *     summary: List all inventory uploads (paginated)
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
 *         description: Paginated list of uploads
 */
router.get('/uploads', listUploads);

/**
 * @swagger
 * /inventory/uploads/{id}/failures:
 *   get:
 *     tags: [Inventory]
 *     summary: Get failure records for a specific upload
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Upload details with failure records
 */
router.get('/uploads/:id/failures', getFailures);

/**
 * @swagger
 * /inventory/uploads/{id}/retry:
 *   post:
 *     tags: [Inventory]
 *     summary: Retry failed records for a specific upload
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Retry results
 */
router.post('/uploads/:id/retry', retryUpload);

/**
 * @swagger
 * /inventory/template:
 *   get:
 *     tags: [Inventory]
 *     summary: Download the CSV template for inventory uploads
 *     security: []
 *     responses:
 *       200:
 *         description: CSV file download
 */
router.get('/template', downloadTemplate);

module.exports = router;
