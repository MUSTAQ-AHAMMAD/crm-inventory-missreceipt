/**
 * AR Invoice Data routes.
 * All routes require authentication.
 * Handles CSV uploads and data management for AR invoices.
 *
 * @swagger
 * tags:
 *   name: ARInvoiceData
 *   description: AR Invoice data management and CSV upload endpoints
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  previewCsvPayload,
  uploadCsv,
  listRecords,
  listBatches,
  generatePayload,
  deleteBatch,
  downloadTemplate,
} = require('../controllers/arInvoiceDataController');

const router = express.Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted.'));
    }
  },
});

// ── Protected routes (JWT auth + activity logging) ──────────────────────
router.use(authenticate, activityLogger);

/**
 * @swagger
 * /ar-invoice-data/preview:
 *   post:
 *     tags: [ARInvoiceData]
 *     summary: Preview AR Invoice payloads from CSV without uploading to database
 *     description: Parses CSV file and generates invoice payloads grouped by customer/date/reference with constant BusinessUnit, TransactionSource, and TransactionType values
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
 *         description: Array of invoice payloads that would be generated
 *       400:
 *         description: Invalid CSV format or missing required fields
 */
router.post('/preview', csvUpload.single('file'), previewCsvPayload);

/**
 * @swagger
 * /ar-invoice-data/upload:
 *   post:
 *     tags: [ARInvoiceData]
 *     summary: Upload CSV file containing AR invoice line items
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
 *         description: CSV uploaded and processed successfully
 *       400:
 *         description: Invalid CSV format or missing required fields
 */
router.post('/upload', csvUpload.single('file'), uploadCsv);

/**
 * @swagger
 * /ar-invoice-data/list:
 *   get:
 *     tags: [ARInvoiceData]
 *     summary: List all AR invoice data records (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: uploadBatchId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of records
 */
router.get('/list', listRecords);

/**
 * @swagger
 * /ar-invoice-data/batches:
 *   get:
 *     tags: [ARInvoiceData]
 *     summary: List all upload batches
 *     responses:
 *       200:
 *         description: List of upload batches with record counts
 */
router.get('/batches', listBatches);

/**
 * @swagger
 * /ar-invoice-data/generate-payload:
 *   post:
 *     tags: [ARInvoiceData]
 *     summary: Generate AR Invoice payload from stored data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               uploadBatchId:
 *                 type: string
 *               recordIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Generated payloads for invoices
 *       404:
 *         description: No records found
 */
router.post('/generate-payload', generatePayload);

/**
 * @swagger
 * /ar-invoice-data/batch/{uploadBatchId}:
 *   delete:
 *     tags: [ARInvoiceData]
 *     summary: Delete all records in a batch
 *     parameters:
 *       - in: path
 *         name: uploadBatchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Batch deleted successfully
 */
router.delete('/batch/:uploadBatchId', deleteBatch);

/**
 * @swagger
 * /ar-invoice-data/template:
 *   get:
 *     tags: [ARInvoiceData]
 *     summary: Download CSV template for AR invoice data
 *     responses:
 *       200:
 *         description: CSV template file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/template', downloadTemplate);

module.exports = router;
