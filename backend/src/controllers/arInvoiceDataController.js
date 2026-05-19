/**
 * AR Invoice Data controller - Handles CSV uploads and data management for AR invoices
 * Stores invoice line items in database for later processing/payload generation
 */

const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');

// Required CSV columns for AR invoice data
const REQUIRED_FIELDS = [
  'customerName',
  'itemNumber',
  'description',
  'quantity',
  'unitSellingPrice',
  'taxClassificationCode',
  'transactionDate',
  'accountingDate',
  'paymentTerms',
  'invoiceCurrencyCode',
];

// Optional fields that can be in CSV
const OPTIONAL_FIELDS = [
  'customerNumber',
  'siteNumber',
  'subinventory',
  'businessUnit',
  'transactionSource',
  'transactionType',
  'crossReference',
  'comments',
  'lineNumber',
  'salesOrder',
  'memoLine',
];

const TEMPLATE_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

function asText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf-8');
  if (data?.data && Array.isArray(data.data)) {
    return Buffer.from(data.data).toString('utf-8');
  }
  if (typeof data === 'object' && data.toString) {
    return data.toString();
  }
  return String(data);
}

function normalizeDate(raw, fieldName) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error(`${fieldName} is required`);

  // Check if it's already in YYYY-MM-DD format
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;

  // Check if it's in DD-MM-YYYY format
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  // Check if it's in YYYY/MM/DD format (with forward slashes)
  const isoSlashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (isoSlashMatch) return `${isoSlashMatch[1]}-${isoSlashMatch[2]}-${isoSlashMatch[3]}`;

  // Check if it's in DD/MM/YYYY format (with forward slashes)
  const dmySlashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlashMatch) return `${dmySlashMatch[3]}-${dmySlashMatch[2]}-${dmySlashMatch[1]}`;

  // Check if it's an Excel serial number (numeric value without separators)
  const isNumeric = /^\d+(\.\d+)?$/.test(value);
  if (isNumeric) {
    const excelSerialNumber = parseFloat(value);
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Dec 30, 1899
    const adjustedSerial = excelSerialNumber > 60 ? excelSerialNumber - 1 : excelSerialNumber;
    const dateFromSerial = new Date(excelEpoch.getTime() + adjustedSerial * 24 * 60 * 60 * 1000);

    const year = dateFromSerial.getUTCFullYear();
    const month = dateFromSerial.getUTCMonth() + 1;
    const day = dateFromSerial.getUTCDate();

    const yearStr = String(year).padStart(4, '0');
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');

    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  throw new Error(`${fieldName} must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format, or an Excel serial number`);
}

function validateCsv(records) {
  const headers = Object.keys(records[0] || {}).map((h) => h.trim());
  const missingHeaders = REQUIRED_FIELDS.filter((field) => !headers.includes(field));
  if (missingHeaders.length > 0) {
    return `CSV is missing required columns: ${missingHeaders.join(', ')}`;
  }

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const missingValues = REQUIRED_FIELDS.filter((field) => {
      const value = row[field];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missingValues.length > 0) {
      return `Row ${i + 2} is missing values for: ${missingValues.join(', ')}`;
    }
  }

  return null;
}

async function normalizeRow(row, rowIndex) {
  const customerName = String(row.customerName ?? '').trim();
  const subinventory = String(row.subinventory ?? '').trim();

  // Auto-populate header fields from metadata if customerName and subinventory are provided
  let headerData = {};
  if (customerName && subinventory) {
    try {
      headerData = await fusionMetadataService.getArInvoiceHeaderMapping(customerName, subinventory);
    } catch (err) {
      console.warn(`[AR Invoice Data] Row ${rowIndex}: Could not fetch metadata for ${customerName}/${subinventory}:`, err.message);
    }
  }

  return {
    // Header information - use CSV values if provided, otherwise use metadata
    customerName,
    customerNumber: String(row.customerNumber ?? headerData.BillToCustomerNumber ?? '').trim(),
    siteNumber: String(row.siteNumber ?? headerData.BillToSite ?? '').trim(),
    subinventory: subinventory || null,
    businessUnit: String(row.businessUnit ?? headerData.BusinessUnit ?? '').trim(),
    transactionSource: String(row.transactionSource ?? headerData.TransactionSource ?? '').trim(),
    transactionType: String(row.transactionType ?? headerData.TransactionType ?? '').trim(),
    transactionDate: normalizeDate(row.transactionDate, 'transactionDate'),
    accountingDate: normalizeDate(row.accountingDate, 'accountingDate'),
    paymentTerms: String(row.paymentTerms ?? '').trim(),
    invoiceCurrencyCode: String(row.invoiceCurrencyCode ?? '').trim().toUpperCase(),
    crossReference: String(row.crossReference ?? '').trim() || null,
    comments: String(row.comments ?? '').trim() || null,

    // Line item information
    lineNumber: row.lineNumber ? parseInt(row.lineNumber) : rowIndex + 1,
    itemNumber: String(row.itemNumber ?? '').trim(),
    description: String(row.description ?? '').trim(),
    quantity: parseFloat(row.quantity),
    unitSellingPrice: parseFloat(row.unitSellingPrice),
    taxClassificationCode: String(row.taxClassificationCode ?? '').trim(),
    salesOrder: String(row.salesOrder ?? '').trim() || null,
    memoLine: String(row.memoLine ?? '').trim() || null,
  };
}

/**
 * POST /api/ar-invoice-data/preview
 * Preview AR Invoice payloads from CSV without storing in database
 * Uses constant values for BusinessUnit, TransactionSource, and TransactionType
 */
async function previewCsvPayload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please attach a CSV file.' });
    }

    const csvText = req.file.buffer.toString('utf-8');
    const filename = req.file.originalname || 'unknown.csv';

    console.log(`\n[AR Invoice Data Preview] Processing CSV: ${filename}`);

    // Parse CSV
    let records;
    try {
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
        bom: true,
      });
    } catch (parseError) {
      return res.status(400).json({
        error: 'Failed to parse CSV file. Please ensure it is properly formatted.',
        details: parseError.message,
      });
    }

    if (!records || records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or has no valid rows.' });
    }

    // Validate CSV structure
    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    console.log(`[AR Invoice Data Preview] Parsed ${records.length} records from CSV`);

    // Normalize and validate all rows
    const normalizedRecords = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const normalized = await normalizeRow(records[i], i);
        // Override with constant values
        normalized.businessUnit = 'AlQurashi-KSA';
        normalized.transactionSource = 'Vend';
        normalized.transactionType = 'Vend Invoice';
        normalizedRecords.push(normalized);
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Some rows have validation errors',
        errors: errors.slice(0, 10), // Return first 10 errors
        totalErrors: errors.length,
      });
    }

    // Group records by customer/invoice header (same logic as generatePayload)
    const invoiceGroups = {};
    for (const record of normalizedRecords) {
      const key = `${record.customerName}_${record.transactionDate}_${record.crossReference || ''}`;
      if (!invoiceGroups[key]) {
        invoiceGroups[key] = {
          header: {
            BusinessUnit: record.businessUnit,
            TransactionSource: record.transactionSource,
            TransactionType: record.transactionType,
            TransactionDate: record.transactionDate,
            AccountingDate: record.accountingDate,
            BillToCustomerName: record.customerName,
            BillToCustomerNumber: record.customerNumber,
            BillToSite: record.siteNumber,
            PaymentTerms: record.paymentTerms,
            InvoiceCurrencyCode: record.invoiceCurrencyCode,
            CrossReference: record.crossReference,
            Comments: record.comments,
          },
          lines: [],
        };
      }

      invoiceGroups[key].lines.push({
        LineNumber: record.lineNumber,
        ItemNumber: record.itemNumber,
        Description: record.description,
        Quantity: record.quantity,
        UnitSellingPrice: record.unitSellingPrice,
        TaxClassificationCode: record.taxClassificationCode,
        SalesOrder: record.salesOrder,
        MemoLine: record.memoLine,
      });
    }

    // Generate payloads for each invoice
    const payloads = Object.values(invoiceGroups).map(group => ({
      ...group.header,
      receivablesInvoiceLines: group.lines,
    }));

    console.log(`✅ [AR Invoice Data Preview] Generated ${payloads.length} invoice payloads from ${normalizedRecords.length} line items`);

    return res.json({
      success: true,
      message: `Preview generated ${payloads.length} invoices from ${normalizedRecords.length} line items`,
      invoiceCount: payloads.length,
      totalLines: normalizedRecords.length,
      payloads,
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ar-invoice-data/upload
 * Upload CSV file containing AR invoice line items
 */
async function uploadCsv(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please attach a CSV file.' });
    }

    const csvText = req.file.buffer.toString('utf-8');
    const filename = req.file.originalname || 'unknown.csv';

    console.log(`\n[AR Invoice Data] Processing CSV: ${filename}`);

    // Parse CSV
    let records;
    try {
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
        bom: true,
      });
    } catch (parseError) {
      return res.status(400).json({
        error: 'Failed to parse CSV file. Please ensure it is properly formatted.',
        details: parseError.message,
      });
    }

    if (!records || records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or has no valid rows.' });
    }

    // Validate CSV structure
    const validationError = validateCsv(records);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    console.log(`[AR Invoice Data] Parsed ${records.length} records from CSV`);

    // Generate a batch ID for this upload
    const uploadBatchId = uuidv4();

    // Normalize and validate all rows
    const normalizedRecords = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const normalized = await normalizeRow(records[i], i);
        normalizedRecords.push(normalized);
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Some rows have validation errors',
        errors: errors.slice(0, 10), // Return first 10 errors
        totalErrors: errors.length,
      });
    }

    // Insert all records into database
    const insertedRecords = [];
    for (const record of normalizedRecords) {
      const inserted = await prisma.arInvoiceData.create({
        data: {
          ...record,
          userId: req.user.id,
          uploadBatchId,
          status: 'PENDING',
        },
      });
      insertedRecords.push(inserted);
    }

    console.log(`✅ [AR Invoice Data] Successfully inserted ${insertedRecords.length} records`);

    return res.json({
      success: true,
      message: `Successfully uploaded ${insertedRecords.length} invoice line items`,
      uploadBatchId,
      totalRecords: insertedRecords.length,
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice-data/list
 * List all AR invoice data records (paginated)
 */
async function listRecords(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const status = req.query.status;
    const uploadBatchId = req.query.uploadBatchId;

    const where = {};
    if (req.user.role === 'USER') {
      where.userId = req.user.id;
    }
    if (status) {
      where.status = status;
    }
    if (uploadBatchId) {
      where.uploadBatchId = uploadBatchId;
    }

    const [records, total] = await Promise.all([
      prisma.arInvoiceData.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.arInvoiceData.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice-data/batches
 * List all upload batches
 */
async function listBatches(req, res, next) {
  try {
    const where = {};
    if (req.user.role === 'USER') {
      where.userId = req.user.id;
    }

    const batches = await prisma.arInvoiceData.groupBy({
      by: ['uploadBatchId'],
      where: {
        ...where,
        uploadBatchId: { not: null },
      },
      _count: { id: true },
      _min: { createdAt: true },
    });

    return res.json({
      batches: batches.map(b => ({
        uploadBatchId: b.uploadBatchId,
        recordCount: b._count.id,
        createdAt: b._min.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ar-invoice-data/generate-payload
 * Generate AR Invoice payload from stored data
 */
async function generatePayload(req, res, next) {
  try {
    const { uploadBatchId, recordIds } = req.body;

    if (!uploadBatchId && (!recordIds || !Array.isArray(recordIds))) {
      return res.status(400).json({
        error: 'Either uploadBatchId or recordIds array is required',
      });
    }

    let where = {};
    if (uploadBatchId) {
      where.uploadBatchId = uploadBatchId;
    } else {
      where.id = { in: recordIds };
    }

    if (req.user.role === 'USER') {
      where.userId = req.user.id;
    }

    const records = await prisma.arInvoiceData.findMany({
      where,
      orderBy: [{ customerName: 'asc' }, { lineNumber: 'asc' }],
    });

    if (records.length === 0) {
      return res.status(404).json({ error: 'No records found for the given criteria' });
    }

    // Group records by customer/invoice header
    const invoiceGroups = {};
    for (const record of records) {
      const key = `${record.customerName}_${record.transactionDate}_${record.crossReference || ''}`;
      if (!invoiceGroups[key]) {
        invoiceGroups[key] = {
          header: {
            BusinessUnit: record.businessUnit,
            TransactionSource: record.transactionSource,
            TransactionType: record.transactionType,
            TransactionDate: record.transactionDate,
            AccountingDate: record.accountingDate,
            BillToCustomerName: record.customerName,
            BillToCustomerNumber: record.customerNumber,
            BillToSite: record.siteNumber,
            PaymentTerms: record.paymentTerms,
            InvoiceCurrencyCode: record.invoiceCurrencyCode,
            CrossReference: record.crossReference,
            Comments: record.comments,
          },
          lines: [],
        };
      }

      invoiceGroups[key].lines.push({
        LineNumber: record.lineNumber,
        ItemNumber: record.itemNumber,
        Description: record.description,
        Quantity: record.quantity,
        UnitSellingPrice: record.unitSellingPrice,
        TaxClassificationCode: record.taxClassificationCode,
        SalesOrder: record.salesOrder,
        MemoLine: record.memoLine,
      });
    }

    // Generate payloads for each invoice
    const payloads = Object.values(invoiceGroups).map(group => ({
      ...group.header,
      receivablesInvoiceLines: group.lines,
    }));

    return res.json({
      success: true,
      invoiceCount: payloads.length,
      totalLines: records.length,
      payloads,
    });

  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/ar-invoice-data/batch/:uploadBatchId
 * Delete all records in a batch
 */
async function deleteBatch(req, res, next) {
  try {
    const { uploadBatchId } = req.params;

    const where = { uploadBatchId };
    if (req.user.role === 'USER') {
      where.userId = req.user.id;
    }

    const result = await prisma.arInvoiceData.deleteMany({ where });

    return res.json({
      success: true,
      message: `Deleted ${result.count} records from batch ${uploadBatchId}`,
      deletedCount: result.count,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice-data/template
 * Download CSV template
 */
function downloadTemplate(req, res) {
  const headers = TEMPLATE_FIELDS.join(',');
  const example = [
    'Aziz Mall',           // customerName
    '6281074736314',       // itemNumber
    'Product description', // description
    '10',                  // quantity
    '100.50',              // unitSellingPrice
    'OUTPUT-GOODS-DOM-15%', // taxClassificationCode
    '2026-05-17',          // transactionDate
    '2026-05-17',          // accountingDate
    'NET 30',              // paymentTerms
    'SAR',                 // invoiceCurrencyCode
    '13',                  // customerNumber
    '13',                  // siteNumber
    'EXBSA',               // subinventory
    'AlQurashi-KSA',       // businessUnit
    'Vend',                // transactionSource
    'Vend Invoice',        // transactionType
    'REF123',              // crossReference
    'Sample comment',      // comments
    '1',                   // lineNumber
    'ORDER123',            // salesOrder
    '',                    // memoLine
  ].join(',');

  const csvContent = `${headers}\n${example}`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ar_invoice_data_template.csv"');
  res.send(csvContent);
}

module.exports = {
  previewCsvPayload,
  uploadCsv,
  listRecords,
  listBatches,
  generatePayload,
  deleteBatch,
  downloadTemplate,
};
