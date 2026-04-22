/**
 * Apply Receipt routes.
 * All routes require authentication except template download.
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  previewPayload,
  upload,
  listUploads,
  getUpload,
  downloadTemplate,
} = require('../controllers/applyReceiptController');

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
router.post('/preview', csvUpload.single('file'), previewPayload);
router.post('/upload', csvUpload.single('file'), upload);
router.get('/uploads', listUploads);
router.get('/uploads/:id', getUpload);

module.exports = router;
