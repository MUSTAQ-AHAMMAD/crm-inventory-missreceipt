/**
 * Vend Invoice controller - Handles Excel uploads (Payment Lines & Sales Lines)
 * and generates AR Invoice payloads grouped by store and date
 */

const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');

/**
 * Parse Excel file buffer and return array of row objects
 */
function parseExcelFile(buffer, filename) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error(`No sheets found in ${filename}`);
    }
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    return data;
  } catch (err) {
    throw new Error(`Failed to parse ${filename}: ${err.message}`);
  }
}

/**
 * Normalize date from various formats to YYYY-MM-DD
 */
function normalizeDate(raw, fieldName) {
  if (!raw) throw new Error(`${fieldName} is required`);

  // If it's a Date object from Excel
  if (raw instanceof Date) {
    const year = raw.getFullYear();
    const month = String(raw.getMonth() + 1).padStart(2, '0');
    const day = String(raw.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const value = String(raw).trim();
  if (!value) throw new Error(`${fieldName} is required`);

  // Check if it's a datetime string (e.g., "2026-04-30 18:11:16") and extract just the date
  const datetimeMatch = value.match(/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+\d{2}:\d{2}:\d{2}$/);
  if (datetimeMatch) {
    const datePart = datetimeMatch[1].replace(/\//g, '-'); // Normalize slashes to hyphens
    return datePart;
  }

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

/**
 * Get next auto-incremented CrossReference number
 */
async function getNextCrossReference() {
  // Get the maximum crossReference from FusionInvoiceHeader table
  const maxHeader = await prisma.fusionInvoiceHeader.findFirst({
    orderBy: { requestId: 'desc' },
    select: { requestId: true },
  });

  // Also check ArInvoiceUpload for recent cross references
  const recentUploads = await prisma.arInvoiceUpload.findMany({
    where: {
      payloadJson: {
        contains: 'CrossReference',
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  let maxCrossRef = maxHeader?.requestId || 32886; // Default starting point

  // Parse CrossReference from recent uploads to find the max
  for (const upload of recentUploads) {
    try {
      const payload = JSON.parse(upload.payloadJson);
      const crossRef = parseInt(payload.CrossReference);
      if (!isNaN(crossRef) && crossRef > maxCrossRef) {
        maxCrossRef = crossRef;
      }
    } catch (err) {
      // Ignore parsing errors
    }
  }

  return maxCrossRef + 1;
}

/**
 * POST /api/vend-invoice/upload
 * Upload two Excel files (Payment Lines and Sales Lines) and generate AR Invoice payloads
 */
async function uploadVendInvoice(req, res, next) {
  try {
    if (!req.files || !req.files.paymentLines || !req.files.salesLines) {
      return res.status(400).json({
        error: 'Both paymentLines and salesLines Excel files are required.',
      });
    }

    const paymentLinesFile = req.files.paymentLines;
    const salesLinesFile = req.files.salesLines;

    console.log(`\n[Vend Invoice] Processing files:`);
    console.log(`  Payment Lines: ${paymentLinesFile.name}`);
    console.log(`  Sales Lines: ${salesLinesFile.name}`);

    // Parse both Excel files
    const paymentLines = parseExcelFile(paymentLinesFile.data, paymentLinesFile.name);
    const salesLines = parseExcelFile(salesLinesFile.data, salesLinesFile.name);

    console.log(`[Vend Invoice] Parsed ${paymentLines.length} payment lines and ${salesLines.length} sales lines`);

    if (salesLines.length === 0) {
      return res.status(400).json({ error: 'Sales Lines file is empty or has no valid rows.' });
    }

    // Build a map of Payment Method Details to Subinventory Code
    // Payment Lines: Map by "Payment Method Details" to get "Subinventory code"
    const paymentMethodMap = {};
    for (const payment of paymentLines) {
      const paymentMethodDetails = String(payment['Payment Method Details'] || '').trim().toUpperCase();
      const subinventoryCode = String(payment['Subinventory code'] || '').trim();
      if (paymentMethodDetails && subinventoryCode) {
        paymentMethodMap[paymentMethodDetails] = subinventoryCode;
      }
    }

    console.log(`[Vend Invoice] Built payment method map with ${Object.keys(paymentMethodMap).length} entries`);

    // Process sales lines and group by store + date
    const invoiceGroups = {}; // Key: `${subinventory}_${date}`
    const errors = [];

    for (let i = 0; i < salesLines.length; i++) {
      try {
        const row = salesLines[i];

        // Extract sales order (e.g., "AZIZMALL/64181") and split to get store code
        const salesOrder = String(row['Order Lines/Order'] || '').trim();
        const storeCode = salesOrder.split('/')[0].toUpperCase(); // e.g., "AZIZMALL"

        // Find subinventory code from payment lines using the store code
        // The store code should match "Payment Method Details" in payment lines
        const subinventoryCode = paymentMethodMap[storeCode] || storeCode;

        if (!paymentMethodMap[storeCode]) {
          console.warn(`[Vend Invoice] No subinventory found for store code: ${storeCode}, using store code as fallback`);
        }

        // Extract date from sales lines (using Order Ref/Date column)
        const saleDate = normalizeDate(row['Order Lines/Order Ref/Date'], 'Sale Date');

        // Extract line item details
        const itemNumber = String(row['Order Lines/Product Barcode'] || '').trim();
        const description = String(row['Order Lines/Product'] || '').trim();
        const quantity = parseFloat(row['Order Lines/Base Quantity'] || 0);
        const unitSellingPrice = parseFloat(row['Order Lines/Tax Incl'] || 0);

        // Create key for grouping: one invoice per store per day
        const groupKey = `${subinventoryCode}_${saleDate}`;

        if (!invoiceGroups[groupKey]) {
          // Get metadata for this subinventory
          let headerData = {};
          try {
            headerData = await fusionMetadataService.getArInvoiceHeaderMapping(
              subinventoryCode,
              subinventoryCode
            );
          } catch (err) {
            console.warn(`[Vend Invoice] Could not fetch metadata for ${subinventoryCode}:`, err.message);
          }

          invoiceGroups[groupKey] = {
            subinventoryCode,
            date: saleDate,
            customerName: headerData.BillToCustomerName || subinventoryCode,
            customerNumber: headerData.BillToCustomerNumber || '',
            siteNumber: headerData.BillToSite || '',
            lines: [],
          };
        }

        // Add line item
        const lineNumber = invoiceGroups[groupKey].lines.length + 1;

        // If itemNumber is empty, treat it as a MemoLine
        if (!itemNumber) {
          invoiceGroups[groupKey].lines.push({
            LineNumber: lineNumber,
            ItemNumber: '',
            Description: description || 'Discount Item',
            Quantity: quantity,
            UnitSellingPrice: unitSellingPrice,
            TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
            SalesOrder: salesOrder,
            MemoLine: description || 'Discount Item',
          });
        } else {
          invoiceGroups[groupKey].lines.push({
            LineNumber: lineNumber,
            ItemNumber: itemNumber,
            Description: description,
            Quantity: quantity,
            UnitSellingPrice: unitSellingPrice,
            TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
            SalesOrder: salesOrder,
            MemoLine: null,
          });
        }
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Some rows have validation errors',
        errors: errors.slice(0, 10),
        totalErrors: errors.length,
      });
    }

    // Generate payloads for each invoice group
    const payloads = [];
    for (const group of Object.values(invoiceGroups)) {
      const crossReference = await getNextCrossReference();

      payloads.push({
        BusinessUnit: 'AlQurashi-KSA',
        TransactionSource: 'Vend',
        TransactionType: 'Vend Invoice',
        TransactionDate: group.date,
        AccountingDate: group.date,
        BillToCustomerName: group.customerName,
        BillToCustomerNumber: group.customerNumber,
        BillToSite: group.siteNumber,
        PaymentTerms: 'IMMEDIATE',
        InvoiceCurrencyCode: 'SAR',
        CrossReference: String(crossReference),
        Comments: `Invoice generated from request ID ${crossReference}`,
        receivablesInvoiceLines: group.lines,
      });
    }

    console.log(`✅ [Vend Invoice] Generated ${payloads.length} invoice payloads from ${salesLines.length} sales lines`);

    return res.json({
      success: true,
      message: `Generated ${payloads.length} invoice(s) from ${salesLines.length} sales line(s)`,
      invoiceCount: payloads.length,
      totalLines: salesLines.length,
      payloads,
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/vend-invoice/preview
 * Preview payloads without storing to database (same logic as upload)
 */
async function previewVendInvoice(req, res, next) {
  // Same logic as uploadVendInvoice for now
  return uploadVendInvoice(req, res, next);
}

module.exports = {
  uploadVendInvoice,
  previewVendInvoice,
};
