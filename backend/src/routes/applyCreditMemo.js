/**
 * Apply Credit Memo routes.
 * Applies on-account credit memos to invoices via Oracle's CreditMemoService
 * SOAP operation (createApplyOnAccountCreditMemo). Bulk CSV upload → one call
 * per row. All routes require authentication except the template download.
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  previewPayload,
  upload,
  downloadTemplate,
} = require('../controllers/applyCreditMemoController');

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

// Public template download
router.get('/template', downloadTemplate);

// Protected routes
router.use(authenticate, activityLogger);

/**
 * @swagger
 * /apply-credit-memo/preview:
 *   post:
 *     tags: [ApplyCreditMemo]
 *     summary: Preview createApplyOnAccountCreditMemo SOAP payloads from a CSV
 *     responses:
 *       200:
 *         description: SOAP payloads that would be sent
 *       400:
 *         description: Invalid or empty CSV
 */
router.post('/preview', csvUpload.single('file'), previewPayload);

/**
 * @swagger
 * /apply-credit-memo/upload:
 *   post:
 *     tags: [ApplyCreditMemo]
 *     summary: Apply on-account credit memos to invoices in bulk (one SOAP call per CSV row)
 *     responses:
 *       200:
 *         description: Per-row apply results
 *       400:
 *         description: Invalid or empty CSV
 *       500:
 *         description: SOAP endpoint not configured or server error
 */
router.post('/upload', csvUpload.single('file'), upload);

module.exports = router;
