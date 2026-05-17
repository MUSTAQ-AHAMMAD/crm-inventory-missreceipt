/**
 * AR Invoice routes.
 * All routes require authentication.
 *
 * @swagger
 * tags:
 *   name: ARInvoice
 *   description: AR Invoice creation endpoints for Oracle Fusion
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  createInvoice,
  listUploads,
  getUpload,
} = require('../controllers/arInvoiceController');

const router = express.Router();

// ── Protected routes (JWT auth + activity logging) ──────────────────────
router.use(authenticate, activityLogger);

/**
 * @swagger
 * /ar-invoice/create:
 *   post:
 *     tags: [ARInvoice]
 *     summary: Create an AR Invoice in Oracle Fusion
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               BusinessUnit:
 *                 type: string
 *               TransactionSource:
 *                 type: string
 *               TransactionType:
 *                 type: string
 *               TransactionDate:
 *                 type: string
 *                 format: date
 *               AccountingDate:
 *                 type: string
 *                 format: date
 *               BillToCustomerName:
 *                 type: string
 *               BillToCustomerNumber:
 *                 type: string
 *               BillToSite:
 *                 type: string
 *               PaymentTerms:
 *                 type: string
 *               InvoiceCurrencyCode:
 *                 type: string
 *               CrossReference:
 *                 type: string
 *               Comments:
 *                 type: string
 *               receivablesInvoiceLines:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Invoice created successfully
 *       400:
 *         description: Invalid request payload
 *       500:
 *         description: Server error or Oracle API failure
 */
router.post('/create', createInvoice);

/**
 * @swagger
 * /ar-invoice/uploads:
 *   get:
 *     tags: [ARInvoice]
 *     summary: List all AR Invoice uploads (paginated)
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
 * /ar-invoice/uploads/{id}:
 *   get:
 *     tags: [ARInvoice]
 *     summary: Get details of a specific AR Invoice upload
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Upload details with request payload and response
 *       404:
 *         description: Upload not found
 */
router.get('/uploads/:id', getUpload);

module.exports = router;
