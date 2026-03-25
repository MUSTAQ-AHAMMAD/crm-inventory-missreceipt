/**
 * Miscellaneous Receipt routes.
 * All routes require authentication.
 *
 * @swagger
 * tags:
 *   name: MiscReceipt
 *   description: Miscellaneous Receipt SOAP upload endpoints
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  previewXml,
  upload,
  listUploads,
  getUpload,
  downloadTemplate,
} = require('../controllers/miscReceiptController');

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

router.use(authenticate, activityLogger);

/**
 * @swagger
 * /misc-receipt/preview:
 *   post:
 *     tags: [MiscReceipt]
 *     summary: Preview the generated SOAP XML without sending to Oracle
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
 *         description: Array of SOAP XML previews per row
 */
router.post('/preview', csvUpload.single('file'), previewXml);

/**
 * @swagger
 * /misc-receipt/upload:
 *   post:
 *     tags: [MiscReceipt]
 *     summary: Upload CSV and send each row as SOAP request to Oracle
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
 *         description: Upload summary
 */
router.post('/upload', csvUpload.single('file'), upload);

/**
 * @swagger
 * /misc-receipt/uploads:
 *   get:
 *     tags: [MiscReceipt]
 *     summary: List all misc receipt uploads (paginated)
 *     responses:
 *       200:
 *         description: Paginated list of uploads
 */
router.get('/uploads', listUploads);

/**
 * @swagger
 * /misc-receipt/uploads/{id}:
 *   get:
 *     tags: [MiscReceipt]
 *     summary: Get details of a specific misc receipt upload
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Upload details with XML payload and failures
 */
router.get('/uploads/:id', getUpload);

/**
 * @swagger
 * /misc-receipt/template:
 *   get:
 *     tags: [MiscReceipt]
 *     summary: Download the CSV template for misc receipt uploads
 *     security: []
 *     responses:
 *       200:
 *         description: CSV file download
 */
router.get('/template', downloadTemplate);

module.exports = router;
