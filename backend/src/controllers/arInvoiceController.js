/**
 * AR Invoice controller - Handles Oracle Fusion AR Invoice creation via REST API
 * Sends JSON payload to Oracle's receivablesInvoices endpoint
 */

const axios = require('axios');
const prisma = require('../services/prisma');

/**
 * POST /api/ar-invoice/create
 * Creates an AR Invoice in Oracle Fusion and stores the response in the database
 */
async function createInvoice(req, res, next) {
  try {
    const payload = req.body;

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
      if (!line.LineNumber || !line.ItemNumber || !line.Description) {
        return res.status(400).json({
          error: `Line ${index + 1}: Missing required fields: LineNumber, ItemNumber, Description`
        });
      }
      if (!line.Quantity || !line.UnitSellingPrice || !line.TaxClassificationCode) {
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

module.exports = {
  createInvoice,
  listUploads,
  getUpload,
};
