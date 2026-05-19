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

    // Build a map of store codes to their available payment types and subinventory info
    // Key insight: Each store can have multiple payment types (NORMAL, TABBY, TAMARA)
    // The Store column in payment lines matches the store code extracted from sales lines
    const storePaymentMap = {}; // Key: storeCode (from Store column) -> { paymentTypes: Set<string>, subinventory, branch }

    for (const payment of paymentLines) {
      // Use 'Store' column from payment lines - this matches the store code from sales lines
      const storeCode = String(payment['Store'] || '').trim().toUpperCase();
      const subinventoryCode = String(payment['Subinventory code'] || payment['Store'] || '').trim();
      const branch = String(payment['Branch'] || '').trim();
      const paymentMethod = String(payment['Payment Method'] || '').trim().toUpperCase();

      if (storeCode) {
        // Determine payment method type (NORMAL, TABBY, TAMARA)
        // Payment method categorization rules:
        // - TABBY: Only payment methods containing "TABBY"
        // - TAMARA: Only payment methods containing "TAMARA"
        // - NORMAL: Everything else including Cash, Mada, Visa, Master, Bank, Card, etc.
        let paymentType = 'NORMAL'; // Default for all payment methods

        // Check for TABBY (case-insensitive)
        if (paymentMethod.includes('TABBY')) {
          paymentType = 'TABBY';
        }
        // Check for TAMARA (case-insensitive)
        else if (paymentMethod.includes('TAMARA')) {
          paymentType = 'TAMARA';
        }
        // All other payment methods remain as NORMAL:
        // - Cash, Mada, Visa, Master, Mastercard
        // - Bank transfers, Credit Card, Debit Card
        // - Any other payment method not explicitly TABBY or TAMARA

        // Log payment method categorization for debugging
        console.log(`[Vend Invoice] Store: ${storeCode}, Payment Method: "${payment['Payment Method']}" → Type: ${paymentType}`);

        // Store payment types available for this store
        if (!storePaymentMap[storeCode]) {
          storePaymentMap[storeCode] = {
            subinventoryCode: subinventoryCode || storeCode, // Use Store as fallback for subinventory
            branch,
            paymentTypes: new Set(),
          };
        }
        storePaymentMap[storeCode].paymentTypes.add(paymentType);
      }
    }

    console.log(`[Vend Invoice] Built payment method map with ${Object.keys(storePaymentMap).length} stores`);
    console.log(`[Vend Invoice] Store codes in payment map:`, Object.keys(storePaymentMap).join(', '));

    // Process sales lines and group by store + date + payment type
    const invoiceGroups = {}; // Key: `${subinventory}_${date}_${paymentType}`
    const errors = [];

    for (let i = 0; i < salesLines.length; i++) {
      try {
        const row = salesLines[i];

        // Extract sales order reference (e.g., "AZIZMALL/64181")
        const salesOrderRef = String(row['Order Lines/Order Ref'] || '').trim();
        const storeCode = salesOrderRef.split('/')[0].toUpperCase(); // e.g., "AZIZMALL"

        // Find subinventory code, branch, and available payment types for this store
        let storeData = storePaymentMap[storeCode];

        if (!storeData) {
          // Fallback: if no payment data exists for this store code (e.g. payment
          // lines file uses different column values or is missing this store),
          // assume NORMAL payment type with the storeCode itself as subinventory
          // so that the invoice is still generated instead of silently dropping
          // every line for this store.
          console.warn(`[Vend Invoice] No payment data found for store code: ${storeCode} (from ${salesOrderRef}), using fallback (subinventory=${storeCode}, paymentType=NORMAL) for row ${i + 2}`);
          storeData = {
            subinventoryCode: storeCode,
            branch: '',
            paymentTypes: new Set(['NORMAL']),
          };
          storePaymentMap[storeCode] = storeData;
        }

        const { subinventoryCode, branch, paymentTypes } = storeData;

        // Extract date from sales lines (using Order Ref/Date column)
        const saleDate = normalizeDate(row['Order Lines/Order Ref/Date'], 'Sale Date');

        // Extract line item details
        const itemNumber = String(row['Order Lines/Product Barcode'] || '').trim();
        const description = String(row['Order Lines/Product'] || '').trim();
        const quantity = parseFloat(row['Order Lines/Base Quantity'] || 0);
        const unitSellingPrice = parseFloat(row['Order Lines/Tax Incl'] || 0);

        // Try to extract payment method from sales line (if available)
        // Payment method field might be named: "Payment Method", "Order Lines/Payment Method", etc.
        const linePaymentMethod = String(
          row['Payment Method'] ||
          row['Order Lines/Payment Method'] ||
          row['Payment Type'] ||
          ''
        ).trim().toUpperCase();

        // Determine which payment type this line belongs to
        // Payment method categorization rules:
        // - TABBY: Only payment methods containing "TABBY"
        // - TAMARA: Only payment methods containing "TAMARA"
        // - NORMAL: Everything else including Cash, Mada, Visa, Master, Bank, Card, etc.
        let linePaymentType = null;

        if (linePaymentMethod) {
          // Check for TABBY (case-insensitive)
          if (linePaymentMethod.includes('TABBY')) {
            linePaymentType = 'TABBY';
          }
          // Check for TAMARA (case-insensitive)
          else if (linePaymentMethod.includes('TAMARA')) {
            linePaymentType = 'TAMARA';
          }
          // All other payment methods map to NORMAL:
          // - Cash, Mada, Visa, Master, Mastercard
          // - Bank transfers, Credit Card, Debit Card
          // - Any other payment method not explicitly TABBY or TAMARA
          else {
            linePaymentType = 'NORMAL';
          }
        }

        // If line has a specific payment method, only add it to that invoice
        // Otherwise, add it to all available payment type invoices (for backward compatibility)
        const targetPaymentTypes = linePaymentType ? [linePaymentType] : Array.from(paymentTypes);

        for (const paymentType of targetPaymentTypes) {
          // Skip if this payment type is not available for this store
          if (!paymentTypes.has(paymentType)) {
            console.warn(`[Vend Invoice] Skipping line ${i + 2}: payment type ${paymentType} not available for store ${storeCode}`);
            continue;
          }
          // Create key for grouping: one invoice per store per day per payment type
          const groupKey = `${subinventoryCode}_${saleDate}_${paymentType}`;

          if (!invoiceGroups[groupKey]) {
            // Get metadata for this subinventory and payment type combination
            let headerData = {};
            let metadata = null;
            try {
              // Look up metadata by subinventory and customer type (payment type)
              metadata = await prisma.fusionSalesMetadata.findFirst({
                where: {
                  subinventory: subinventoryCode,
                  customerType: paymentType,
                }
              });

              if (metadata) {
                headerData = fusionMetadataService.mapToArInvoiceHeader(metadata);
                console.log(`[Vend Invoice] Found metadata for ${subinventoryCode}/${paymentType}: ${metadata.billToName} (${metadata.billToAccount}/${metadata.siteNumber})`);
              } else {
                console.warn(`[Vend Invoice] No metadata found for ${subinventoryCode}/${paymentType}`);
              }
            } catch (err) {
              console.warn(`[Vend Invoice] Could not fetch metadata for ${subinventoryCode}/${paymentType}:`, err.message);
            }

            invoiceGroups[groupKey] = {
              subinventoryCode,
              date: saleDate,
              paymentType,
              // Use metadata or fallback values
              customerName: headerData.BillToCustomerName || branch || subinventoryCode,
              customerNumber: headerData.BillToCustomerNumber || '',
              siteNumber: headerData.BillToSite || '',
              lines: [],
            };
          }

          // Add line item to this payment type's invoice
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
              SalesOrder: salesOrderRef,
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
              SalesOrder: salesOrderRef,
              MemoLine: null,
            });
          }
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

      // Determine payment type label for comments
      let paymentTypeLabel = 'Cash/Bank';
      if (group.paymentType === 'TABBY') {
        paymentTypeLabel = 'Tabby';
      } else if (group.paymentType === 'TAMARA') {
        paymentTypeLabel = 'Tamara';
      }

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
        Comments: `${paymentTypeLabel} payment - Invoice generated from request ID ${crossReference}`,
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

/**
 * POST /api/vend-invoice/download-json
 * Download payloads as JSON file
 */
async function downloadPayloadsAsJson(req, res, next) {
  try {
    const { payloads } = req.body;

    if (!payloads || !Array.isArray(payloads)) {
      return res.status(400).json({ error: 'payloads array is required' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `vend-invoices-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(payloads);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/vend-invoice/download-csv
 * Download payloads as CSV file (flattened structure)
 */
async function downloadPayloadsAsCsv(req, res, next) {
  try {
    const { payloads } = req.body;

    if (!payloads || !Array.isArray(payloads)) {
      return res.status(400).json({ error: 'payloads array is required' });
    }

    // Flatten payloads into CSV rows
    const rows = [];
    const headers = [
      'CrossReference',
      'BusinessUnit',
      'TransactionSource',
      'TransactionType',
      'TransactionDate',
      'AccountingDate',
      'BillToCustomerName',
      'BillToCustomerNumber',
      'BillToSite',
      'PaymentTerms',
      'InvoiceCurrencyCode',
      'Comments',
      'LineNumber',
      'ItemNumber',
      'Description',
      'Quantity',
      'UnitSellingPrice',
      'TaxClassificationCode',
      'SalesOrder',
      'MemoLine',
    ];

    rows.push(headers.join(','));

    for (const payload of payloads) {
      for (const line of payload.receivablesInvoiceLines || []) {
        const row = [
          payload.CrossReference || '',
          payload.BusinessUnit || '',
          payload.TransactionSource || '',
          payload.TransactionType || '',
          payload.TransactionDate || '',
          payload.AccountingDate || '',
          `"${(payload.BillToCustomerName || '').replace(/"/g, '""')}"`,
          payload.BillToCustomerNumber || '',
          payload.BillToSite || '',
          payload.PaymentTerms || '',
          payload.InvoiceCurrencyCode || '',
          `"${(payload.Comments || '').replace(/"/g, '""')}"`,
          line.LineNumber || '',
          line.ItemNumber || '',
          `"${(line.Description || '').replace(/"/g, '""')}"`,
          line.Quantity || '',
          line.UnitSellingPrice || '',
          line.TaxClassificationCode || '',
          line.SalesOrder || '',
          line.MemoLine ? `"${line.MemoLine.replace(/"/g, '""')}"` : '',
        ];
        rows.push(row.join(','));
      }
    }

    const csvContent = rows.join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `vend-invoices-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadVendInvoice,
  previewVendInvoice,
  downloadPayloadsAsJson,
  downloadPayloadsAsCsv,
};
