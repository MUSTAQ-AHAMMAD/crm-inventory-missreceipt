/**
 * AR Pipeline routes.
 * End-to-end AR processing: Invoice → Standard Receipt → Misc Receipt → Apply Receipt.
 * All routes require authentication.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  getSummary,
  getPendingApply,
  submitApply,
  listInvoices,
  listStandardReceipts,
  listMiscReceipts,
  createInvoiceBatch,
} = require('../controllers/arPipelineController');

const router = express.Router();

router.use(authenticate, activityLogger);

// Dashboard summary: counts per step, grouped by store + date
router.get('/summary', getSummary);

// Pending apply receipt pairs (auto-matched invoice → receipt)
router.get('/pending-apply', getPendingApply);

// Submit auto-matched pairs via Oracle SOAP
router.post('/submit-apply', submitApply);

// Batch AR Invoice creation (pipeline flow)
router.post('/create-invoice-batch', createInvoiceBatch);

// Individual step data lists
router.get('/invoices', listInvoices);
router.get('/standard-receipts', listStandardReceipts);
router.get('/misc-receipts', listMiscReceipts);

module.exports = router;
