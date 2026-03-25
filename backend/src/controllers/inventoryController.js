/**
 * Inventory Upload controller.
 * Handles CSV parsing, Oracle REST API calls, and result persistence.
 */

const { parse } = require('csv-parse/sync');
const axios = require('axios');
const prisma = require('../services/prisma');

// Required CSV column names mapped to Oracle REST API fields
// OrganizationName is now provided via a form field, not the CSV
const REQUIRED_FIELDS = [
  'TransactionTypeName',
  'ItemNumber',
  'SubinventoryCode',
  'TransactionDate',
  'TransactionQuantity',
  'TransactionReference',
  'TransactionUnitOfMeasure',
];

/**
 * Validates a parsed CSV row and returns an error message if invalid.
 * Returns null when the row is valid.
 *
 * Skips rows with:
 *  - Empty item number (barcode)
 *  - Empty transaction type
 *  - Zero or invalid transaction quantity
 *  - Missing subinventory (tries to extract from TransactionReference)
 */
function validateRow(row) {
  if (!row.ItemNumber || row.ItemNumber.trim() === '') {
    return 'Empty item number (barcode)';
  }
  if (!row.TransactionTypeName || row.TransactionTypeName.trim() === '') {
    return 'Empty transaction type';
  }
  const qty = parseFloat(row.TransactionQuantity);
  if (isNaN(qty) || qty === 0) {
    return 'Zero or invalid transaction quantity';
  }
  return null;
}

/**
 * Extracts branch/subinventory code from a reference string.
 * Format: "BRANCHNAME/OrderNumber"
 */
function extractBranchFromRef(ref) {
  if (!ref) return null;
  const parts = ref.split('/');
  return parts.length >= 2 ? parts[0].trim() : null;
}

/**
 * Maps a CSV row to the Oracle REST API payload format.
 * @param {object} row – parsed CSV row
 * @param {string} organizationName – provided via the upload form field
 */
function mapRowToPayload(row, organizationName) {
  // If SubinventoryCode is empty, try to extract it from TransactionReference
  let subinventory = row.SubinventoryCode?.trim();
  if (!subinventory && row.TransactionReference) {
    subinventory = extractBranchFromRef(row.TransactionReference) || '';
  }

  // Parse date (supports YYYY-MM-DD HH:MM:SS or YYYY-MM-DD)
  let txDate = row.TransactionDate?.trim();
  if (txDate && txDate.includes(' ')) {
    txDate = txDate.split(' ')[0]; // keep only date part
  }

  return {
    OrganizationName: organizationName,
    TransactionTypeName: row.TransactionTypeName?.trim(),
    ItemNumber: row.ItemNumber?.trim(),
    SubinventoryCode: subinventory,
    TransactionDate: txDate,
    TransactionQuantity: parseFloat(row.TransactionQuantity),
    TransactionReference: row.TransactionReference?.trim(),
    TransactionUnitOfMeasure: row.TransactionUnitOfMeasure?.trim(),
  };
}

/**
 * POST /api/inventory/bulk-upload
 * Accepts a multipart CSV file, validates rows, sends each valid row to
 * the Oracle inventory staged transactions REST API, and stores results.
 */
async function bulkUpload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required.' });
    }

    const organizationName = req.body.organizationName?.trim();
    if (!organizationName) {
      return res.status(400).json({ error: 'Organization name is required.' });
    }

    // Parse the CSV file buffer
    const records = parse(req.file.buffer, {
      columns: true,       // use first row as headers
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    // Create the upload record in PENDING state
    const upload = await prisma.inventoryUpload.create({
      data: {
        userId: req.user.id,
        filename: req.file.originalname,
        totalRecords: records.length,
        status: 'PROCESSING',
      },
    });

    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    // Oracle API configuration from environment variables
    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    // Process each CSV row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2; // +2: 1-based + header row

      // Validate the row
      const validationError = validateRow(row);
      if (validationError) {
        failureCount++;
        failures.push({
          uploadId: upload.id,
          rowNumber,
          rawData: JSON.stringify(row), // SQLite stores JSON as a string
          errorMessage: `Validation: ${validationError}`,
        });
        continue;
      }

      // Map CSV columns to Oracle API payload (OrganizationName from form field)
      const payload = mapRowToPayload(row, organizationName);

      try {
        // Send to Oracle REST API
        await axios.post(process.env.ORACLE_INVENTORY_API_URL, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
        });
        successCount++;
      } catch (apiErr) {
        failureCount++;
        const errMsg =
          apiErr.response?.data?.detail ||
          apiErr.response?.data?.message ||
          apiErr.message ||
          'Oracle API error';
        failures.push({
          uploadId: upload.id,
          rowNumber,
          rawData: JSON.stringify(row), // SQLite stores JSON as a string
          errorMessage: errMsg,
        });
      }
    }

    // Persist failure records in bulk
    if (failures.length > 0) {
      await prisma.inventoryFailureRecord.createMany({ data: failures });
    }

    // Update upload summary
    const updatedUpload = await prisma.inventoryUpload.update({
      where: { id: upload.id },
      data: {
        successCount,
        failureCount,
        status: failureCount === 0 ? 'COMPLETED' : successCount === 0 ? 'FAILED' : 'PARTIAL',
      },
    });

    return res.json({
      uploadId: updatedUpload.id,
      totalRecords: records.length,
      successCount,
      failureCount,
      status: updatedUpload.status,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/uploads
 * Returns a paginated list of inventory uploads for the current user
 * (admins see all uploads).
 */
async function listUploads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    // Admins and managers can see all uploads; regular users see their own
    const where =
      req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [uploads, total] = await Promise.all([
      prisma.inventoryUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.inventoryUpload.count({ where }),
    ]);

    return res.json({ uploads, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/uploads/:id/failures
 * Returns the failure records for a specific inventory upload.
 */
async function getFailures(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    // Verify the upload exists and belongs to the requesting user (or admin)
    const upload = await prisma.inventoryUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const failures = await prisma.inventoryFailureRecord.findMany({
      where: { uploadId },
      orderBy: { rowNumber: 'asc' },
    });

    // Parse rawData JSON strings back to objects for the frontend
    const parsedFailures = failures.map((f) => ({
      ...f,
      rawData: (() => { try { return JSON.parse(f.rawData); } catch { return f.rawData; } })(),
    }));

    return res.json({ upload, failures: parsedFailures });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/inventory/uploads/:id/retry
 * Retries all failed records for a specific upload.
 */
async function retryUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);

    const upload = await prisma.inventoryUpload.findUnique({ where: { id: uploadId } });
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (req.user.role === 'USER' && upload.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const failures = await prisma.inventoryFailureRecord.findMany({ where: { uploadId } });
    if (failures.length === 0) {
      return res.json({ message: 'No failures to retry.' });
    }

    const oracleAuth = Buffer.from(
      `${process.env.ORACLE_USERNAME}:${process.env.ORACLE_PASSWORD}`
    ).toString('base64');

    let retrySuccess = 0;
    let retryFail = 0;
    const stillFailing = [];

    for (const failure of failures) {
      // rawData is stored as a JSON string in SQLite – parse it back to an object
      const rawDataObj = (() => { try { return JSON.parse(failure.rawData); } catch { return failure.rawData; } })();
      try {
        await axios.post(process.env.ORACLE_INVENTORY_API_URL, rawDataObj, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${oracleAuth}`,
          },
          timeout: 30000,
        });
        // Remove the failure record on success
        await prisma.inventoryFailureRecord.delete({ where: { id: failure.id } });
        retrySuccess++;
      } catch (apiErr) {
        retryFail++;
        const errMsg =
          apiErr.response?.data?.detail ||
          apiErr.response?.data?.message ||
          apiErr.message ||
          'Oracle API error';
        stillFailing.push({ ...failure, errorMessage: errMsg });
      }
    }

    // Update upload counters
    await prisma.inventoryUpload.update({
      where: { id: uploadId },
      data: {
        successCount: { increment: retrySuccess },
        failureCount: { decrement: retrySuccess },
        status: retryFail === 0 ? 'COMPLETED' : 'PARTIAL',
      },
    });

    return res.json({ retrySuccess, retryFail, stillFailing });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/inventory/template
 * Returns a sample CSV template for inventory uploads.
 */
function downloadTemplate(_req, res) {
  const header = REQUIRED_FIELDS.join(',');
  const sample = 'Vend RMA,AS54888,AZIZMALL,2024-01-15,10,REF001,Ea';
  const csv = `${header}\n${sample}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
  return res.send(csv);
}

module.exports = { bulkUpload, listUploads, getFailures, retryUpload, downloadTemplate };
