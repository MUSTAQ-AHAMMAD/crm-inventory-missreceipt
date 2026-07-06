/**
 * AR Invoice controller - Handles Oracle Fusion AR Invoice creation via SOAP API
 * Sends SOAP XML envelope to Oracle's RecInvoiceService (createSimpleInvoice operation),
 * matching the Oracle Fusion Receivables Invoice SOAP API.
 */

const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');
const { createOracleSoapClient } = require('../services/OracleSoapClient');
const { buildArInvoiceSoapEnvelope, AR_INVOICE_SOAP_ACTION, sanitizeAccountNumber } = require('../services/soapEnvelopeBuilder');

/**
 * POST /api/ar-invoice/preview
 * Validates and previews an AR Invoice payload without sending to Oracle.
 * Returns the complete validated payload and the REST endpoint that would be used.
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
        const hasItemIdentifier = line.ItemNumber || line.MemoLine || line.MemoLineName;
        if (!line.LineNumber || !hasItemIdentifier || !line.Description) {
          validationErrors.push(`Line ${index + 1}: Missing required fields: LineNumber, ItemNumber or MemoLine/MemoLineName, and Description`);
        }
        // Quantity and UnitSellingPrice can legitimately be 0 (free/zero-price items)
        if (line.Quantity == null || line.UnitSellingPrice == null || !line.TaxClassificationCode) {
          validationErrors.push(`Line ${index + 1}: Missing required fields: Quantity, UnitSellingPrice, or TaxClassificationCode`);
        }
        // UomCode is required (defaults to 'EA' in SOAP envelope builder if missing)
        // CurrencyCode is required per line (defaults to header currency if missing)
        // SalesOrderLine is optional but recommended
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

    // Generate SOAP envelope for preview
    const soapEnvelope = buildArInvoiceSoapEnvelope(payload);

    // Return validated payload
    return res.json({
      valid: true,
      message: 'Payload is valid and ready to send to Oracle via SOAP',
      payload,
      soapEnvelope,
      soapEndpoint: process.env.ORACLE_AR_INVOICE_SOAP_URL || '(ORACLE_AR_INVOICE_SOAP_URL not set)',
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Parse a date string or value returned by Oracle and return a JavaScript Date
 * (or null if the value is empty / unparseable).
 */
function parseOracleDate(value) {
  if (!value) return null;
  // Always extract the YYYY-MM-DD part and store as UTC midnight so that the
  // date-range queries in findInvoiceHeader (which use midnight-UTC boundaries)
  // reliably match regardless of whether Oracle includes a timezone offset.
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return new Date(`${m[1]}T00:00:00.000Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? null
    : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Extract invoice data from SOAP XML response.
 * Parses the createSimpleInvoiceResponse structure from Oracle RecInvoiceService.
 * 
 * @param {object} parsed - Parsed XML object from OracleSoapClient
 * @returns {object} - Extracted invoice data matching REST response format
 */
function extractInvoiceDataFromSoap(parsed) {
  try {
    // Navigate SOAP envelope structure
    const envelope = parsed['soapenv:Envelope'] || parsed['env:Envelope'] || parsed['Envelope'] || {};
    const body = envelope['soapenv:Body'] || envelope['env:Body'] || envelope['Body'] || {};
    const response = body['ns2:createSimpleInvoiceResponse'] || 
                     body['createSimpleInvoiceResponse'] || 
                     body['inv:createSimpleInvoiceResponse'] || 
                     body['typ:createSimpleInvoiceResponse'] || 
                     {};
    const result = response['result'] || response['ns2:result'] || response['inv:result'] || response['typ:result'] || {};

    // Extract invoice data from the result
    // The SOAP response structure will vary, but typically includes fields like:
    // - TrxNumber (TransactionNumber)
    // - CustomerTrxId
    // - Other invoice fields
    
    const invoiceData = {
      TransactionNumber: result['TrxNumber'] || result['TransactionNumber'] || null,
      CustomerTrxId: result['CustomerTrxId'] || null,
      BillToCustomerName: result['BillToCustomerName'] || null,
      BillToCustomerNumber: result['BillToAccountNumber'] || result['BillToCustomerNumber'] || null,
      BillToSite: result['BillToLocation'] || result['BillToSite'] || null,
      BusinessUnit: result['BusinessUnit'] || null,
      TransactionSource: result['TransactionSource'] || null,
      TransactionType: result['TransactionType'] || null,
      TransactionDate: result['TrxDate'] || result['TransactionDate'] || null,
      AccountingDate: result['GlDate'] || result['AccountingDate'] || null,
      InvoiceCurrencyCode: result['InvoiceCurrencyCode'] || null,
      PaymentTerms: result['PaymentTermsName'] || result['PaymentTerms'] || null,
    };

    return invoiceData;
  } catch (error) {
    console.error('[AR Invoice] Error extracting data from SOAP response:', error.message);
    return {};
  }
}

/**
 * Attempt to JSON-parse a string; return the parsed object on success,
 * or the original value if it cannot be parsed.
 */
function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * Persist an Oracle AR Invoice JSON response into FusionInvoiceHeader and
 * FusionInvoiceLine.  The `requestId` is set to the ArInvoiceUpload record id
 * so the two tables can be joined back to the raw request/response.
 *
 * Called for both successful and failed Oracle responses so that every attempt
 * is traceable.  Lines are only inserted when `status` is 'SUCCESS'.
 *
 * @param {object} opts
 * @param {number}  opts.uploadId   - ArInvoiceUpload record id used as requestId
 * @param {string}  opts.status     - 'SUCCESS' | 'FAILED'
 * @param {string}  opts.message    - Human-readable status message
 * @param {object}  opts.oracleData - Parsed Oracle JSON response (may be null on failure)
 * @param {object}  opts.payload    - Original request payload (used as fallback for field values)
 * @returns {Promise<import('@prisma/client').FusionInvoiceHeader>}
 */
async function storeInvoiceResponse({ uploadId, status, message, oracleData, payload }) {
  // Prefer values from the Oracle response; fall back to the original payload.
  const src = oracleData || payload || {};
  const fallback = payload || {};

  // Digits-only so a stray BigInt-literal "n" (e.g. "300000158776674n") can't crash BigInt().
  const billToAccRaw = sanitizeAccountNumber(src.BillToCustomerNumber ?? fallback.BillToCustomerNumber);
  const txnNumberRaw = src.TransactionNumber ?? null;
  const customerTxnIdRaw = src.CustomerTrxId ?? src.CustomerTxnId ?? null;

  const header = await prisma.fusionInvoiceHeader.create({
    data: {
      requestId:        uploadId,
      status,
      message,
      requestDate:      new Date(),
      billToCustName:   src.BillToCustomerName  ?? fallback.BillToCustomerName  ?? null,
      billToLocation:   src.BillToSite          ?? fallback.BillToSite          ?? null,
      billToAccNumber:  billToAccRaw             ? BigInt(billToAccRaw)          : null,
      businessUnit:     src.BusinessUnit         ?? fallback.BusinessUnit        ?? null,
      paymentTermsName: src.PaymentTerms         ?? fallback.PaymentTerms        ?? null,
      txnSource:        src.TransactionSource    ?? fallback.TransactionSource   ?? null,
      txnType:          src.TransactionType      ?? fallback.TransactionType     ?? null,
      txnDate:          parseOracleDate(src.TransactionDate  ?? fallback.TransactionDate),
      glDate:           parseOracleDate(src.AccountingDate   ?? fallback.AccountingDate),
      currencyCode:     src.InvoiceCurrencyCode  ?? fallback.InvoiceCurrencyCode ?? null,
      txnNumber:        txnNumberRaw             ? BigInt(txnNumberRaw)          : null,
      customerTxnId:    customerTxnIdRaw         ? BigInt(customerTxnIdRaw)      : null,
      region:           'SA',
    },
  });

  // Only insert line records when the invoice was successfully created in Oracle.
  if (status === 'SUCCESS') {
    const lines = src.receivablesInvoiceLines ?? fallback.receivablesInvoiceLines ?? [];
    if (lines.length > 0) {
      const now = new Date();
      await prisma.fusionInvoiceLine.createMany({
        data: lines.map((line) => ({
          requestId:        uploadId,
          status,
          requestDate:      now,
          headerId:         header.id,
          invoiceNumber:    txnNumberRaw != null ? String(txnNumberRaw) : null,
          lineNumber:       line.LineNumber       != null ? parseInt(line.LineNumber, 10)       : null,
          itemNumber:       line.ItemNumber       ?? null,
          description:      line.Description      ?? null,
          uom:              line.UnitOfMeasure     ?? line.UOM ?? null,
          quantity:         line.Quantity          != null ? parseFloat(line.Quantity)          : null,
          unitSellingPrice: line.UnitSellingPrice  != null ? parseFloat(line.UnitSellingPrice)  : null,
          currencyCode:     line.InvoiceCurrencyCode ?? src.InvoiceCurrencyCode ?? fallback.InvoiceCurrencyCode ?? null,
          taxCode:          line.TaxClassificationCode ?? null,
          version:          line.LockingEtag       != null ? parseInt(line.LockingEtag, 10)    : null,
          salesOrder:       line.SalesOrder        ?? null,
          salesOrderLine:   line.SalesOrderLine    != null ? parseInt(line.SalesOrderLine, 10) : null,
          region:           'SA',
        })),
      });
    }
  }

  return header;
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
      const hasItemIdentifier = line.ItemNumber || line.MemoLine || line.MemoLineName;
      if (!line.LineNumber || !hasItemIdentifier || !line.Description) {
        return res.status(400).json({
          error: `Line ${index + 1}: Missing required fields: LineNumber, ItemNumber or MemoLine/MemoLineName, Description`
        });
      }
      // Quantity and UnitSellingPrice can legitimately be 0 (free/zero-price items)
      if (line.Quantity == null || line.UnitSellingPrice == null || !line.TaxClassificationCode) {
        return res.status(400).json({
          error: `Line ${index + 1}: Missing required fields: Quantity, UnitSellingPrice, TaxClassificationCode`
        });
      }
      // UomCode is required (defaults to 'EA' in SOAP envelope builder if missing)
      // CurrencyCode is required per line (defaults to header currency if missing)
      // SalesOrderLine is optional but recommended
    }

    // Get Oracle SOAP endpoint
    const soapEndpoint = process.env.ORACLE_AR_INVOICE_SOAP_URL;
    if (!soapEndpoint) {
      return res.status(500).json({
        error: 'Oracle AR Invoice SOAP URL not configured. Check ORACLE_AR_INVOICE_SOAP_URL in .env'
      });
    }

    const username = process.env.ORACLE_USERNAME;
    const password = process.env.ORACLE_PASSWORD;
    if (!username || !password) {
      return res.status(500).json({
        error: 'Oracle credentials not configured. Check ORACLE_USERNAME and ORACLE_PASSWORD in .env'
      });
    }

    console.log(`\n[AR Invoice] Creating invoice for customer ${payload.BillToCustomerName}`);
    console.log(`[AR Invoice] SOAP Endpoint: ${soapEndpoint}`);
    
    // Log full payload if verbose logging is enabled (WARNING: may contain sensitive data)
    if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
      console.log(`[AR Invoice] Payload being sent:`, JSON.stringify(payload, null, 2));
    } else {
      console.log(`[AR Invoice] Payload summary: customer=${payload.BillToCustomerNumber}, lines=${payload.receivablesInvoiceLines?.length || 0}`);
    }

    // Create upload record
    const uploadRecord = await prisma.arInvoiceUpload.create({
      data: {
        userId: req.user.id,
        payloadJson: JSON.stringify(payload),
        responseStatus: 'PROCESSING',
      },
    });

    let responseStatus = 'SUCCESS';
    let responseMessage = 'Invoice created successfully';
    let responseBody = null;
    let httpStatus = null;
    let oracleData = null;

    // Build SOAP envelope
    const soapXml = buildArInvoiceSoapEnvelope(payload);

    try {
      console.log(`[AR Invoice] Sending SOAP request for invoice`);
      console.log(`[AR Invoice] API URL: ${soapEndpoint}`);
      const soapClient = createOracleSoapClient(soapEndpoint);
      const response = await soapClient.callWithCustomEnvelope(soapXml, AR_INVOICE_SOAP_ACTION);

      httpStatus = response.status;
      responseBody = response.data;
      
      // Log full response if verbose logging is enabled (WARNING: may contain sensitive data)
      if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
        console.log(`[AR Invoice] Full API Response:`, JSON.stringify({
          status: response.status,
          data: response.data,
          headers: response.headers
        }, null, 2));
      }
      
      // Parse SOAP response to extract invoice data
      const parsed = response.parsed;
      oracleData = extractInvoiceDataFromSoap(parsed);

      if (response.status >= 400) {
        responseStatus = 'FAILED';
        responseMessage = `Oracle returned HTTP ${httpStatus}`;
      }

      console.log(`✅ [AR Invoice] Success - HTTP ${httpStatus}`);
      console.log(`TransactionNumber: ${oracleData?.TransactionNumber}, CustomerTrxId: ${oracleData?.CustomerTrxId}`);

    } catch (error) {
      responseStatus = 'FAILED';
      httpStatus = error.response?.status || null;
      responseBody = error.response?.data || error.message;
      oracleData = null;
      responseMessage = `Failed to create invoice: ${error.message}`;

      console.error(`❌ [AR Invoice] Failed - HTTP ${httpStatus}`);
      console.error(`Error: ${error.message}`);
      
      // Log full error response if verbose logging is enabled
      if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
        console.error(`[AR Invoice] Error Response:`, JSON.stringify({
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        }, null, 2));
      }
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

    // Persist Oracle response fields into FusionInvoiceHeader / FusionInvoiceLine.
    // This is done for both SUCCESS and FAILED so every attempt is traceable.
    let fusionHeader = null;
    try {
      fusionHeader = await storeInvoiceResponse({
        uploadId: uploadRecord.id,
        status: responseStatus,
        message: responseMessage,
        oracleData,
        payload,
      });
      console.log(`[AR Invoice] Stored fusion header id=${fusionHeader.id}`);
    } catch (storeErr) {
      // Non-fatal: log but do not fail the response
      console.error(`[AR Invoice] Failed to store fusion response: ${storeErr.message}`);
    }

    if (responseStatus === 'FAILED') {
      return res.status(httpStatus || 500).json({
        uploadId: uploadRecord.id,
        fusionHeaderId: fusionHeader?.id ?? null,
        status: responseStatus,
        message: responseMessage,
        response: oracleData ?? safeJsonParse(responseBody),
      });
    }

    return res.json({
      uploadId: uploadRecord.id,
      fusionHeaderId: fusionHeader?.id ?? null,
      status: responseStatus,
      message: responseMessage,
      response: oracleData,
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
