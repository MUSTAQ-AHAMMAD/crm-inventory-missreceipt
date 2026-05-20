/**
 * AR Invoice controller - Handles Oracle Fusion AR Invoice creation via REST API
 * Sends JSON payload to Oracle's receivablesInvoices endpoint
 */

const axios = require('axios');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');

/**
 * POST /api/ar-invoice/preview
 * Validates and previews an AR Invoice payload without sending to Oracle
 * Returns the complete payload that would be sent, with metadata auto-populated if applicable
 */
async function previewPayload(req, res, next) {
  try {
    let payload = req.body;

    // Auto-populate sales header from metadata if customerName and subinventory are provided
    if (payload.customerName && payload.subinventory) {
      console.log(`[AR Invoice Preview] Looking up metadata for customer="${payload.customerName}", subinventory="${payload.subinventory}"`);

      const headerData = await fusionMetadataService.getArInvoiceHeaderMapping(
        payload.customerName,
        payload.subinventory
      );

      if (Object.keys(headerData).length > 0) {
        // Merge metadata into payload (existing fields take precedence)
        payload = {
          ...headerData,
          ...payload,
        };
        console.log('[AR Invoice Preview] Sales header populated from metadata');
      } else {
        console.warn('[AR Invoice Preview] No metadata found, proceeding with provided data');
      }
    }

    // Validate required fields in the payload
    const validationErrors = [];

    if (!payload.BusinessUnit || !payload.TransactionSource || !payload.TransactionType) {
      validationErrors.push('Missing required fields: BusinessUnit, TransactionSource, or TransactionType');
    }

    if (!payload.TransactionDate || !payload.AccountingDate) {
      validationErrors.push('Missing required fields: TransactionDate or AccountingDate');
    }

    if (!payload.BillToCustomerName || !payload.BillToCustomerNumber || !payload.BillToSite) {
      validationErrors.push('Missing required fields: BillToCustomerName, BillToCustomerNumber, or BillToSite');
    }

    if (!payload.PaymentTerms || !payload.InvoiceCurrencyCode) {
      validationErrors.push('Missing required fields: PaymentTerms or InvoiceCurrencyCode');
    }

    if (!payload.receivablesInvoiceLines || !Array.isArray(payload.receivablesInvoiceLines) || payload.receivablesInvoiceLines.length === 0) {
      validationErrors.push('receivablesInvoiceLines must be a non-empty array');
    } else {
      // Validate each line item
      for (const [index, line] of payload.receivablesInvoiceLines.entries()) {
        // ItemNumber may be empty for discount/memo lines that supply MemoLine instead
        const hasItemIdentifier = line.ItemNumber || line.MemoLine;
        if (!line.LineNumber || !hasItemIdentifier || !line.Description) {
          validationErrors.push(`Line ${index + 1}: Missing required fields: LineNumber, ItemNumber or MemoLine, and Description`);
        }
        // Quantity and UnitSellingPrice can legitimately be 0 (free/zero-price items)
        if (line.Quantity == null || line.UnitSellingPrice == null || !line.TaxClassificationCode) {
          validationErrors.push(`Line ${index + 1}: Missing required fields: Quantity, UnitSellingPrice, or TaxClassificationCode`);
        }
      }
    }

    // Return validation errors if any
    if (validationErrors.length > 0) {
      return res.status(400).json({
        valid: false,
        errors: validationErrors,
        payload,
      });
    }

    // Return validated payload
    return res.json({
      valid: true,
      message: 'Payload is valid and ready to send to Oracle',
      payload,
      endpoint: process.env.ORACLE_AR_INVOICE_URL || 'https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/receivablesInvoices',
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ar-invoice/create
 * Creates an AR Invoice in Oracle Fusion and stores the response in the database
 *
 * This endpoint accepts the following scenarios:
 * 1. Full payload with all required fields (traditional mode)
 * 2. Minimal payload with customerName and subinventory - will auto-populate sales header from FusionSalesMetadata
 */
async function createInvoice(req, res, next) {
  try {
    let payload = req.body;

    // Auto-populate sales header from metadata if customerName and subinventory are provided
    if (payload.customerName && payload.subinventory) {
      console.log(`[AR Invoice] Looking up metadata for customer="${payload.customerName}", subinventory="${payload.subinventory}"`);

      const headerData = await fusionMetadataService.getArInvoiceHeaderMapping(
        payload.customerName,
        payload.subinventory
      );

      if (Object.keys(headerData).length > 0) {
        // Merge metadata into payload (existing fields take precedence)
        payload = {
          ...headerData,
          ...payload,
        };
        console.log('[AR Invoice] Sales header populated from metadata');
      } else {
        console.warn('[AR Invoice] No metadata found, proceeding with provided data');
      }
    }

    // Validate required fields in the payload
    if (!payload.BusinessUnit || !payload.TransactionSource || !payload.TransactionType) {
      return res.status(400).json({
        error: 'Missing required fields: BusinessUnit, TransactionSource, TransactionType'
      });
    }

    if (!payload.TransactionDate || !payload.AccountingDate) {
      return res.status(400).json({
        error: 'Missing required fields: TransactionDate, AccountingDate'
      });
    }

    if (!payload.BillToCustomerName || !payload.BillToCustomerNumber || !payload.BillToSite) {
      return res.status(400).json({
        error: 'Missing required fields: BillToCustomerName, BillToCustomerNumber, BillToSite'
      });
    }

    if (!payload.PaymentTerms || !payload.InvoiceCurrencyCode) {
      return res.status(400).json({
        error: 'Missing required fields: PaymentTerms, InvoiceCurrencyCode'
      });
    }

    if (!payload.receivablesInvoiceLines || !Array.isArray(payload.receivablesInvoiceLines) || payload.receivablesInvoiceLines.length === 0) {
      return res.status(400).json({
        error: 'receivablesInvoiceLines must be a non-empty array'
      });
    }

    // Validate each line item
    for (const [index, line] of payload.receivablesInvoiceLines.entries()) {
      // ItemNumber may be empty for discount/memo lines that supply MemoLine instead
      const hasItemIdentifier = line.ItemNumber || line.MemoLine;
      if (!line.LineNumber || !hasItemIdentifier || !line.Description) {
        return res.status(400).json({
          error: `Line ${index + 1}: Missing required fields: LineNumber, ItemNumber or MemoLine, Description`
        });
      }
      // Quantity and UnitSellingPrice can legitimately be 0 (free/zero-price items)
      if (line.Quantity == null || line.UnitSellingPrice == null || !line.TaxClassificationCode) {
        return res.status(400).json({
          error: `Line ${index + 1}: Missing required fields: Quantity, UnitSellingPrice, TaxClassificationCode`
        });
      }
    }

    // Get Oracle endpoint and credentials from environment variables
    const endpoint = process.env.ORACLE_AR_INVOICE_URL || 'https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/receivablesInvoices';
    const username = process.env.ORACLE_USERNAME;
    const password = process.env.ORACLE_PASSWORD;

    if (!username || !password) {
      return res.status(500).json({
        error: 'Oracle credentials not configured. Check ORACLE_USERNAME and ORACLE_PASSWORD in .env'
      });
    }

    console.log(`\n[AR Invoice] Creating invoice for customer ${payload.BillToCustomerName}`);
    console.log(`[AR Invoice] Endpoint: ${endpoint}`);

    // Create upload record
    const uploadRecord = await prisma.arInvoiceUpload.create({
      data: {
        userId: req.user.id,
        payloadJson: JSON.stringify(payload, null, 2),
        responseStatus: 'PROCESSING',
      },
    });

    let responseStatus = 'SUCCESS';
    let responseMessage = 'Invoice created successfully';
    let responseBody = null;
    let httpStatus = null;

    try {
      // Send request to Oracle
      const response = await axios.post(endpoint, payload, {
        auth: {
          username,
          password,
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 30000, // 30 seconds
      });

      httpStatus = response.status;
      responseBody = JSON.stringify(response.data, null, 2);

      console.log(`✅ [AR Invoice] Success - HTTP ${httpStatus}`);
      console.log(`Response: ${responseBody.substring(0, 500)}`);

    } catch (error) {
      responseStatus = 'FAILED';
      httpStatus = error.response?.status || null;
      responseBody = error.response?.data
        ? JSON.stringify(error.response.data, null, 2)
        : error.message;
      responseMessage = `Failed to create invoice: ${error.message}`;

      console.error(`❌ [AR Invoice] Failed - HTTP ${httpStatus}`);
      console.error(`Error: ${error.message}`);
      console.error(`Response: ${responseBody.substring(0, 500)}`);
    }

    // Update upload record with response
    await prisma.arInvoiceUpload.update({
      where: { id: uploadRecord.id },
      data: {
        responseStatus,
        responseMessage,
        responseBody,
        httpStatus,
      },
    });

    if (responseStatus === 'FAILED') {
      return res.status(httpStatus || 500).json({
        uploadId: uploadRecord.id,
        status: responseStatus,
        message: responseMessage,
        response: responseBody ? JSON.parse(responseBody) : null,
      });
    }

    return res.json({
      uploadId: uploadRecord.id,
      status: responseStatus,
      message: responseMessage,
      response: responseBody ? JSON.parse(responseBody) : null,
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/uploads
 * Lists all AR Invoice uploads (paginated)
 */
async function listUploads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = req.user.role === 'USER' ? { userId: req.user.id } : {};

    const [uploads, total] = await Promise.all([
      prisma.arInvoiceUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { email: true } } },
      }),
      prisma.arInvoiceUpload.count({ where }),
    ]);

    return res.json({ uploads, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/uploads/:id
 * Gets details of a specific AR Invoice upload
 */
async function getUpload(req, res, next) {
  try {
    const uploadId = parseInt(req.params.id);
    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID.' });
    }

    const uploadRecord = await prisma.arInvoiceUpload.findUnique({
      where: { id: uploadId },
      include: {
        user: { select: { email: true } },
      },
    });

    if (!uploadRecord) {
      return res.status(404).json({ error: 'Upload not found.' });
    }

    if (req.user.role === 'USER' && uploadRecord.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Parse JSON strings back to objects for better display
    const parsedRecord = {
      ...uploadRecord,
      payloadJson: (() => {
        try { return JSON.parse(uploadRecord.payloadJson); }
        catch { return uploadRecord.payloadJson; }
      })(),
      responseBody: uploadRecord.responseBody ? (() => {
        try { return JSON.parse(uploadRecord.responseBody); }
        catch { return uploadRecord.responseBody; }
      })() : null,
    };

    return res.json(parsedRecord);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/metadata
 * Retrieves sales header metadata for a given customer and subinventory
 */
async function getMetadata(req, res, next) {
  try {
    const { customerName, subinventory } = req.query;

    if (!customerName || !subinventory) {
      return res.status(400).json({
        error: 'Missing required query parameters: customerName, subinventory'
      });
    }

    const metadata = await fusionMetadataService.findBySalesHeader(customerName, subinventory);

    if (!metadata) {
      return res.status(404).json({
        error: 'No metadata found for the given customer and subinventory'
      });
    }

    const headerMapping = fusionMetadataService.mapToArInvoiceHeader(metadata);

    return res.json({
      metadata,
      headerMapping,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/metadata/list
 * Lists all available sales metadata (paginated)
 */
async function listMetadata(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    const result = await fusionMetadataService.getAllMetadata({ page, limit });

    return res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/response-headers
 * Lists AR Invoice response headers from Oracle (FusionInvoiceHeader table), paginated.
 */
async function listResponseHeaders(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const status = req.query.status || undefined;

    const where = status ? { status } : {};

    const [headers, total] = await Promise.all([
      prisma.fusionInvoiceHeader.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { lines: true } } },
      }),
      prisma.fusionInvoiceHeader.count({ where }),
    ]);

    return res.json({ headers, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/response-headers/:id
 * Gets a single AR Invoice response header with its line items.
 */
async function getResponseHeader(req, res, next) {
  try {
    const headerId = parseInt(req.params.id);
    if (isNaN(headerId)) {
      return res.status(400).json({ error: `Invalid header ID: expected a valid integer, received '${req.params.id}'.` });
    }

    const header = await prisma.fusionInvoiceHeader.findUnique({
      where: { id: headerId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    if (!header) {
      return res.status(404).json({ error: `Header not found with ID: ${headerId}.` });
    }

    return res.json(header);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ar-invoice/response-lines
 * Lists AR Invoice response lines (FusionInvoiceLine table), paginated.
 * Optionally filtered by headerId.
 */
async function listResponseLines(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const headerId = req.query.headerId ? parseInt(req.query.headerId) : undefined;
    const status = req.query.status || undefined;

    const where = {
      ...(headerId ? { headerId } : {}),
      ...(status ? { status } : {}),
    };

    const [lines, total] = await Promise.all([
      prisma.fusionInvoiceLine.findMany({
        where,
        orderBy: [{ headerId: 'asc' }, { lineNumber: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.fusionInvoiceLine.count({ where }),
    ]);

    return res.json({ lines, total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  previewPayload,
  createInvoice,
  listUploads,
  getUpload,
  getMetadata,
  listMetadata,
  listResponseHeaders,
  getResponseHeader,
  listResponseLines,
};
