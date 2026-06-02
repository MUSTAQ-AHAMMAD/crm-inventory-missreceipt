/**
 * Vend Receipt routes.
 * Generates Standard Receipt and Misc Receipt payloads from Vend Payment Lines
 * and submits them to Oracle Fusion.  All routes require authentication.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  generateReceipts,
  submitStandardReceipts,
  submitMiscReceipts,
  listBatches,
  getBatch,
  listStandardReceipts,
  listMiscReceipts,
  listApplyReceipts,
} = require('../controllers/vendReceiptController');

const router = express.Router();

router.use(authenticate, activityLogger);

/**
 * POST /api/vend-receipt/generate
 * Upload Payment Lines Excel and generate Standard + Misc receipt payloads.
 * Body: multipart/form-data { paymentLines: <xlsx file>, region?: 'SA' }
 */
router.post('/generate', generateReceipts);

/**
 * POST /api/vend-receipt/submit-standard
 * Submit generated standard receipt payloads to Oracle REST API.
 * Body: { batchId?, payloads: [...] }
 */
router.post('/submit-standard', submitStandardReceipts);

/**
 * POST /api/vend-receipt/submit-misc
 * Submit generated misc receipt payloads to Oracle SOAP API.
 * Body: { batchId?, payloads: [...] }
 */
router.post('/submit-misc', submitMiscReceipts);

/**
 * GET /api/vend-receipt/batches
 * List all Vend Receipt generation batches.
 */
router.get('/batches', listBatches);

/**
 * GET /api/vend-receipt/batches/:id
 * Get details of a specific batch including generated payloads.
 */
router.get('/batches/:id', getBatch);

/**
 * GET /api/vend-receipt/standard-receipts
 * List Oracle Standard Receipt response records (FusionStandardReceipt table).
 */
router.get('/standard-receipts', listStandardReceipts);

/**
 * GET /api/vend-receipt/misc-receipts
 * List Oracle Misc Receipt response records (FusionMiscReceipt table).
 */
router.get('/misc-receipts', listMiscReceipts);

/**
 * GET /api/vend-receipt/apply-receipts
 * List Oracle Apply Receipt response records (FusionApplyReceipt table).
 */
router.get('/apply-receipts', listApplyReceipts);

module.exports = router;
