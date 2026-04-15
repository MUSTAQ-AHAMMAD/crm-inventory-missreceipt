/**
 * Inventory Template Generation routes.
 * Protected endpoints that convert Amro inventory CSV exports into the
 * inventory transaction template format for download/preview.
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const { previewTemplate, downloadTemplate } = require('../controllers/inventoryTemplateController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted.'));
    }
  },
});

router.use(authenticate, activityLogger);

router.post('/preview', upload.single('file'), previewTemplate);
router.post('/download', upload.single('file'), downloadTemplate);

module.exports = router;
