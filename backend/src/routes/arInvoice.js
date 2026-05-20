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
  previewPayload,
  createInvoice,
  listUploads,
  getUpload,
  getMetadata,
  listMetadata,
  listResponseHeaders,
  getResponseHeader,
  listResponseLines,
} = require('../controllers/arInvoiceController');

const router = express.Router();

// ── Protected routes (JWT auth + activity logging) ──────────────────────
router.use(authenticate, activityLogger);

/**
 * @swagger
 * /ar-invoice/preview:
 *   post:
 *     tags: [ARInvoice]
 *     summary: Preview and validate an AR Invoice payload without sending to Oracle
 *     description: Validates the payload structure, auto-populates metadata if customerName and subinventory are provided, and returns the complete payload that would be sent to Oracle
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerName:
 *                 type: string
 *                 description: Customer name for metadata lookup (optional if full header provided)
 *               subinventory:
 *                 type: string
 *                 description: Subinventory code for metadata lookup (optional if full header provided)
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
 *                   properties:
 *                     LineNumber:
 *                       type: integer
 *                     ItemNumber:
 *                       type: string
 *                     Description:
 *                       type: string
 *                     Quantity:
 *                       type: number
 *                     UnitSellingPrice:
 *                       type: number
 *                     TaxClassificationCode:
 *                       type: string
 *     responses:
 *       200:
 *         description: Payload is valid and ready to send
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 payload:
 *                   type: object
 *                 endpoint:
 *                   type: string
 *       400:
 *         description: Validation errors in the payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 payload:
 *                   type: object
 */
router.post('/preview', previewPayload);

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

/**
 * @swagger
 * /ar-invoice/metadata:
 *   get:
 *     tags: [ARInvoice]
 *     summary: Get sales header metadata for a customer and subinventory
 *     parameters:
 *       - in: query
 *         name: customerName
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: subinventory
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Metadata and AR invoice header mapping
 *       404:
 *         description: No metadata found
 */
router.get('/metadata', getMetadata);

/**
 * @swagger
 * /ar-invoice/metadata/list:
 *   get:
 *     tags: [ARInvoice]
 *     summary: List all available sales metadata (paginated)
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
 *         description: Paginated list of metadata records
 */
router.get('/metadata/list', listMetadata);

/**
 * @swagger
 * /ar-invoice/response-headers:
 *   get:
 *     tags: [ARInvoice]
 *     summary: List AR Invoice response headers (FusionInvoiceHeader)
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
 *     responses:
 *       200:
 *         description: Paginated list of invoice response headers
 */
router.get('/response-headers', listResponseHeaders);

/**
 * @swagger
 * /ar-invoice/response-headers/{id}:
 *   get:
 *     tags: [ARInvoice]
 *     summary: Get a single AR Invoice response header with its line items
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Header with nested lines
 *       404:
 *         description: Header not found
 */
router.get('/response-headers/:id', getResponseHeader);

/**
 * @swagger
 * /ar-invoice/response-lines:
 *   get:
 *     tags: [ARInvoice]
 *     summary: List AR Invoice response lines (FusionInvoiceLine)
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
 *         name: headerId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of invoice response lines
 */
router.get('/response-lines', listResponseLines);

module.exports = router;
