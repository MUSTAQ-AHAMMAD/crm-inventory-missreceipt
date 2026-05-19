/**
 * Vend Invoice routes.
 * Handles Excel uploads (Payment Lines & Sales Lines) for Vend invoice generation.
 * All routes require authentication.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  uploadVendInvoice,
  previewVendInvoice,
  downloadPayloadsAsJson,
  downloadPayloadsAsCsv,
} = require('../controllers/vendInvoiceController');

const router = express.Router();

// ── Protected routes (JWT auth + activity logging) ──────────────────────
router.use(authenticate, activityLogger);

/**
 * @swagger
 * /vend-invoice/upload:
 *   post:
 *     tags: [VendInvoice]
 *     summary: Upload Payment Lines and Sales Lines Excel files and generate AR Invoice payloads
 *     description: Processes two Excel files to generate AR Invoice payloads grouped by store and date
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               paymentLines:
 *                 type: string
 *                 format: binary
 *                 description: Excel file containing payment lines data
 *               salesLines:
 *                 type: string
 *                 format: binary
 *                 description: Excel file containing sales lines data
 *     responses:
 *       200:
 *         description: Successfully generated invoice payloads
 *       400:
 *         description: Invalid files or missing required data
 */
router.post('/upload', uploadVendInvoice);

/**
 * @swagger
 * /vend-invoice/preview:
 *   post:
 *     tags: [VendInvoice]
 *     summary: Preview AR Invoice payloads from Excel files without storing
 *     description: Processes two Excel files and returns generated payloads for preview
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               paymentLines:
 *                 type: string
 *                 format: binary
 *               salesLines:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Generated payloads for preview
 *       400:
 *         description: Invalid files or missing required data
 */
router.post('/preview', previewVendInvoice);

/**
 * @swagger
 * /vend-invoice/download-json:
 *   post:
 *     tags: [VendInvoice]
 *     summary: Download generated payloads as JSON file
 *     description: Takes an array of payloads and returns them as a downloadable JSON file
 *     responses:
 *       200:
 *         description: JSON file with payloads
 *       400:
 *         description: Invalid request
 */
router.post('/download-json', downloadPayloadsAsJson);

/**
 * @swagger
 * /vend-invoice/download-csv:
 *   post:
 *     tags: [VendInvoice]
 *     summary: Download generated payloads as CSV file
 *     description: Takes an array of payloads and converts them to CSV format for download
 *     responses:
 *       200:
 *         description: CSV file with flattened payload data
 *       400:
 *         description: Invalid request
 */
router.post('/download-csv', downloadPayloadsAsCsv);

module.exports = router;
