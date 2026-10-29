/**
 * Vend Invoice controller - Handles Excel uploads (Payment Lines & Sales Lines)
 * and generates AR Invoice payloads grouped by store and date
 */

const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../services/prisma');
const fusionMetadataService = require('../services/fusionSalesMetadataService');
const creditMemoService = require('../services/creditMemoService');

function normalizeCellValue(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeUpper(value) {
  return normalizeCellValue(value).toUpperCase();
}

function normalizeHeaderKey(value) {
  return normalizeUpper(value)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,\-_]+$/g, '')
    .trim();
}

const HEADER_MAP_CACHE_KEY = Symbol('vendInvoiceHeaderMap');

function getRowHeaderMap(row) {
  if (!row || typeof row !== 'object') return new Map();
  if (row[HEADER_MAP_CACHE_KEY]) return row[HEADER_MAP_CACHE_KEY];

  const headerMap = new Map();
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeHeaderKey(key);
    const normalizedValue = normalizeCellValue(value);
    const existingValue = headerMap.get(normalizedKey);
    if (!existingValue || normalizedValue) {
      headerMap.set(normalizedKey, normalizedValue);
    }
  }

  Object.defineProperty(row, HEADER_MAP_CACHE_KEY, {
    value: headerMap,
    enumerable: false,
  });

  return headerMap;
}

function getValueByHeaderAlias(row, alias) {
  const headerMap = getRowHeaderMap(row);
  return headerMap.get(normalizeHeaderKey(alias)) || '';
}

function getFirstNonEmpty(row, keys) {
  for (const key of keys) {
    const value = getValueByHeaderAlias(row, key);
    if (value) return value;
  }
  return '';
}

function parseNumericField(row, keys, defaultValue = 0) {
  const raw = getFirstNonEmpty(row, keys);
  if (!raw) return defaultValue;
  const normalized = raw.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * Determine a line's unit of measure from the sales row.
 *
 * Priority: an explicit UOM column (various Vend/export header spellings), then the
 * product-name suffix — Vend names gram-measured products "…/ Gram" (e.g.
 * "MUSK-ALQURASHI/ Gram"). Returns the raw token (e.g. "Each", "Gram", "G"); the SOAP
 * builder's mapUomCode() translates it to the Oracle code (Ea / G). Returns '' when
 * nothing is found so callers can default to Each.
 */
function extractUom(row, description) {
  const col = getFirstNonEmpty(row, [
    // Authoritative per-line UOM in the Vend sales export (values: "Each", "G", ...)
    'Order Lines/Base UoM',
    'Order Lines/Base UOM',
    'Order Lines/Base Uom',
    'Base UoM',
    'Base UOM',
    'Base Uom',
    // Other spellings seen across exports
    'Order Lines/Product/Unit',
    'Order Lines/Product/UOM',
    'Order Lines/UOM',
    'Order Lines/Unit',
    'Order Lines/Unit of Measure',
    'UOM',
    'Unit of Measure',
    'Uom',
  ]);
  if (col) return String(col).trim();

  // Derive from the product-name suffix after the last "/", e.g. "…/ Gram" → "Gram".
  const s = String(description ?? '');
  const idx = s.lastIndexOf('/');
  if (idx >= 0 && idx < s.length - 1) {
    return s.slice(idx + 1).trim();
  }
  return '';
}

function getPaymentType(paymentMethod) {
  const normalizedMethod = normalizeUpper(paymentMethod);
  if (normalizedMethod.includes('TABBY')) return 'TABBY';
  if (normalizedMethod.includes('TAMARA')) return 'TAMARA';
  return 'NORMAL';
}

/** True when a metadata region code denotes Oman (region 'OM'). */
function isOmanRegion(region) {
  const key = normalizeUpper(region);
  return key === 'OM' || key === 'OMAN';
}

/**
 * Tax classification code (the "tax name") for a region.
 * Oman uses OM-OUTPUT-GOODS-DOM-5% (5% VAT); KSA uses OUTPUT-GOODS-DOM-15% (15% VAT).
 */
function taxClassificationForRegion(region) {
  return isOmanRegion(region) ? 'OM-OUTPUT-GOODS-DOM-5%' : 'OUTPUT-GOODS-DOM-15%';
}

/** Currency for a region: Oman → OMR, otherwise SAR. */
function currencyForRegion(region) {
  return isOmanRegion(region) ? 'OMR' : 'SAR';
}

/**
 * Fallback branch assignment when the sales/payment files carry no usable order
 * reference (the order-ref prefix is empty, so a discount line can't be tied to a
 * branch by reference). The payment file lists each branch with its gross (tax-incl)
 * total; the sales lines are assumed to be ordered by branch to match the payment
 * rows. We walk the sales lines top-to-bottom and assign consecutive lines to each
 * payment row's Branch until their running gross total reaches that row's amount,
 * then advance to the next payment row.
 *
 * @param {Array<{amount:number}>} salesAmounts - per-line gross (tax-incl) amounts, in file order
 * @param {Array<{store:string, paymentType:string, amount:number}>} paymentRows - branch rows, in file order
 * @returns {Map<number, {store:string, paymentType:string}>} salesIndex -> assignment
 */
function assignBranchesByCumulativeAmount(salesAmounts, paymentRows) {
  const assignment = new Map();
  if (!paymentRows.length) return assignment;

  // Tolerance absorbs per-line rounding (each gross amount is rounded to 2 dp, so a
  // block of N lines can differ from the branch total by up to ~0.01·N).
  const TOL = 0.5;
  let pi = 0;
  let running = 0;

  for (let i = 0; i < salesAmounts.length; i++) {
    // Once past the last payment row, dump any remaining lines onto the last branch.
    const idx = Math.min(pi, paymentRows.length - 1);
    assignment.set(i, { store: paymentRows[idx].store, paymentType: paymentRows[idx].paymentType });

    if (pi < paymentRows.length) {
      running += Math.abs(Number(salesAmounts[i].amount) || 0);
      const target = Math.abs(Number(paymentRows[pi].amount) || 0);
      if (running >= target - TOL) {
        pi++;
        running = 0;
      }
    }
  }
  return assignment;
}

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
    const year = raw.getUTCFullYear();
    const month = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const day = String(raw.getUTCDate()).padStart(2, '0');
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
    const excelEpoch = new Date(Date.UTC(1899, 11, 31)); // Dec 31, 1899
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
 * Compute the next safe CrossReference base for a single upload request.
 * Returns the starting number; the caller is responsible for incrementing
 * in-memory for each additional chunk so that all chunks in one request
 * get distinct CrossReference values without re-querying the DB.
 */
async function getNextCrossReferenceBase() {
  // Get the maximum CrossReference already stored in FusionInvoiceHeader
  const maxHeader = await prisma.fusionInvoiceHeader.findFirst({
    orderBy: { requestId: 'desc' },
    select: { requestId: true },
  });

  // Also scan the most recent ArInvoiceUpload payloads in case headers have
  // not yet been written (in-flight uploads from the same session).
  const recentUploads = await prisma.arInvoiceUpload.findMany({
    where: { payloadJson: { contains: 'CrossReference' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  let maxCrossRef = maxHeader?.requestId || 32886; // default starting point

  for (const upload of recentUploads) {
    try {
      const payload = JSON.parse(upload.payloadJson);
      const crossRef = parseInt(payload.CrossReference, 10);
      if (!isNaN(crossRef) && crossRef > maxCrossRef) {
        maxCrossRef = crossRef;
      }
    } catch (_) {
      // ignore unparseable rows
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
    const storePaymentMap = {}; // Key: storeCode -> { paymentTypes: Set<string>, subinventory, branch }
    const orderPaymentTypeMap = {}; // Key: orderRef (upper) -> Set<paymentType>
    // Key: orderRef (upper) -> store code resolved from the payment file's Branch column.
    // The Branch is the authoritative store name for metadata/customer lookup; the sales
    // order-ref prefix does not always match the store, so we map each order to its
    // payment Branch here and prefer it over the prefix when processing sales lines.
    const orderStoreMap = {};

    for (const payment of paymentLines) {
      const orderRef = normalizeUpper(getFirstNonEmpty(payment, ['Order Ref', 'Order Lines/Order Ref', 'Order Reference']));
      const orderStoreCode = normalizeUpper(orderRef.split('/')[0] || '');
      const storeCode = normalizeUpper(getFirstNonEmpty(payment, ['Store', 'Store Code', 'Branch'])) || orderStoreCode;
      const subinventoryCode = normalizeUpper(getFirstNonEmpty(payment, ['Subinventory code', 'Subinventory Code', 'SubinventoryCode', 'Subinventory', 'Store', 'Branch'])) || orderStoreCode;
      const branch = getFirstNonEmpty(payment, ['Branch', 'Store']) || orderStoreCode;
      const paymentMethod = getFirstNonEmpty(payment, ['Payment Method', 'Payments/Payment Method', 'Payments/Method', 'Order Payment/Method', 'Order Payment/Payment Method', 'Payment Method Details', 'Method']);

      if (storeCode) {
        const paymentType = getPaymentType(paymentMethod);

        // Log payment method categorization for debugging
        console.log(`[Vend Invoice] Store: ${storeCode}, Payment Method: "${paymentMethod}" → Type: ${paymentType}`);

        // Store payment types available for this store
        if (!storePaymentMap[storeCode]) {
          storePaymentMap[storeCode] = {
            subinventoryCode: subinventoryCode || storeCode, // Use Store as fallback for subinventory
            branch,
            paymentTypes: new Set(),
          };
        }
        storePaymentMap[storeCode].paymentTypes.add(paymentType);

        if (orderRef) {
          if (!orderPaymentTypeMap[orderRef]) {
            orderPaymentTypeMap[orderRef] = new Set();
          }
          orderPaymentTypeMap[orderRef].add(paymentType);

          // Remember which store (from the Branch column) this order belongs to, so
          // sales lines can resolve their store from the payment file rather than the
          // order-ref prefix. First payment row for an order wins.
          if (!orderStoreMap[orderRef]) {
            orderStoreMap[orderRef] = storeCode;
          }
        }
      }
    }

    console.log(`[Vend Invoice] Built payment method map with ${Object.keys(storePaymentMap).length} stores`);
    console.log(`[Vend Invoice] Store codes in payment map:`, Object.keys(storePaymentMap).join(', '));

    // ── Optional dedup: skip sales lines already invoiced in Fusion ──────────
    // Mirrors the Java client's dedup-and-skip-existing-lines: a sales line that
    // already has a SUCCESS FusionInvoiceLine (from a prior run) is not re-added
    // to the payload. This prevents duplicate lines and shrinks the payload on
    // re-runs. Opt-in via VEND_INVOICE_SKIP_EXISTING_LINES so default behaviour
    // is unchanged.
    const skipExisting = process.env.VEND_INVOICE_SKIP_EXISTING_LINES === 'true';
    let skippedExistingCount = 0;
    const existingLineKeys = new Set();
    // Stable per-line identity: sales order ref + item barcode (or, for memo/
    // discount lines with no item, + description). FusionInvoiceLine.salesOrder
    // is indexed, so the lookup is cheap even for large uploads.
    const lineDedupKey = (salesOrder, itemNumber, description) => {
      const so = String(salesOrder ?? '').trim().toUpperCase();
      const item = String(itemNumber ?? '').trim().toUpperCase();
      return item
        ? `${so}||I||${item}`
        : `${so}||M||${String(description ?? '').trim().toUpperCase()}`;
    };

    if (skipExisting) {
      const distinctSalesOrders = [...new Set(
        salesLines
          .map((r) => getFirstNonEmpty(r, ['Order Lines/Order Ref', 'Order Ref', 'Order Reference']))
          .filter(Boolean)
      )];
      if (distinctSalesOrders.length > 0) {
        const existing = await prisma.fusionInvoiceLine.findMany({
          where: {
            salesOrder: { in: distinctSalesOrders },
            status:     { in: ['SUCCESS', 'Success'] },
          },
          select: { salesOrder: true, itemNumber: true, description: true },
        });
        for (const l of existing) {
          existingLineKeys.add(lineDedupKey(l.salesOrder, l.itemNumber, l.description));
        }
        console.log(
          `[Vend Invoice] Dedup enabled: ${existingLineKeys.size} sales line(s) already in Fusion ` +
          `across ${distinctSalesOrders.length} order(s) — these will be skipped.`
        );
      }
    }

    // Refund/return lines (item lines with a negative price) are pulled OUT of the
    // invoice — Oracle's createSimpleInvoice rejects a negative-price standard item
    // line (oracle.jbo.JboException). We collect them here with full detail so they
    // can be reviewed/downloaded and handled separately (credit memo / refund flow).
    const refunds = [];

    // Fallback: when NO sales line carries a usable order-ref prefix, the lines can't
    // be tied to a branch by reference. In that case assign them to the payment file's
    // Branch rows by cumulative gross (tax-incl) amount in file order (see helper).
    // Files with real order refs skip this entirely and use the order-ref mapping.
    const salesHaveNoStoreRef = salesLines.every((r) =>
      !normalizeUpper(getFirstNonEmpty(r, ['Order Lines/Order Ref', 'Order Ref', 'Order Reference']).split('/')[0]));
    let branchAssignment = null;
    if (salesHaveNoStoreRef) {
      const paymentRowsForMatch = paymentLines.map((p) => {
        const orderRef = normalizeUpper(getFirstNonEmpty(p, ['Order Ref', 'Order Lines/Order Ref', 'Order Reference']));
        const orderStoreCode = normalizeUpper(orderRef.split('/')[0] || '');
        const store = normalizeUpper(getFirstNonEmpty(p, ['Store', 'Store Code', 'Branch'])) || orderStoreCode;
        const method = getFirstNonEmpty(p, ['Payment Method', 'Payments/Payment Method', 'Payments/Method', 'Order Payment/Method', 'Order Payment/Payment Method', 'Payment Method Details', 'Method']);
        const amount = parseNumericField(p, ['Payments/Amount', 'Payment Amount', 'Amount', 'Payments/Total', 'Total']);
        return { store, paymentType: getPaymentType(method), amount };
      }).filter((r) => r.store);
      const salesAmounts = salesLines.map((r) => ({
        amount: parseNumericField(r, ['Order Lines/Tax Incl.', 'Order Lines/Tax Incl', 'Tax Incl.', 'Tax Incl']),
      }));
      branchAssignment = assignBranchesByCumulativeAmount(salesAmounts, paymentRowsForMatch);
      const branches = [...new Set([...branchAssignment.values()].map((a) => `${a.store}/${a.paymentType}`))];
      console.log(`[Vend Invoice] Order refs absent — matched ${salesLines.length} sales line(s) to ${paymentRowsForMatch.length} payment branch(es) by cumulative amount: ${branches.join(', ')}`);
    }

    // Process sales lines and group by store + date + payment type
    const invoiceGroups = {}; // Key: `${subinventory}_${date}_${paymentType}`
    const errors = [];
    for (let i = 0; i < salesLines.length; i++) {
      try {
        const row = salesLines[i];

        // Extract sales order reference (e.g., "AZIZMALL/64181")
        const salesOrderRef = getFirstNonEmpty(row, ['Order Lines/Order Ref', 'Order Ref', 'Order Reference']);
        const salesOrderRefKey = normalizeUpper(salesOrderRef);
        const storeCodeFromRef = normalizeUpper(salesOrderRef.split('/')[0]); // e.g., "AZIZMALL"
        // Branch assigned by cumulative-amount matching (only when order refs are absent).
        const assigned = branchAssignment ? branchAssignment.get(i) : null;
        // Store resolution priority: (1) cumulative-amount branch when order refs are
        // absent, (2) the payment file's Branch keyed by order ref, (3) the sales
        // order-ref prefix. The Branch column is the authoritative store for metadata.
        const storeCode = (assigned && assigned.store) || orderStoreMap[salesOrderRefKey] || storeCodeFromRef;
        const orderPaymentTypes = orderPaymentTypeMap[salesOrderRefKey];

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
              paymentTypes: new Set(orderPaymentTypes && orderPaymentTypes.size > 0 ? Array.from(orderPaymentTypes) : ['NORMAL']),
            };
            storePaymentMap[storeCode] = storeData;
        }

        const { subinventoryCode, branch, paymentTypes } = storeData;

        // Extract date from sales lines. Try multiple column name variants to handle
        // different Vend/YASMEEN export formats.
        const saleDate = normalizeDate(getFirstNonEmpty(row, [
          'Order Lines/Order Ref/Date',
          'Order Ref/Date',
          'Order Lines/Date',
          'Order Date',
          'Sale Date',
          'Transaction Date',
          'Order Lines/Transaction Date',
          'Date',
        ]), 'Sale Date');

        // Extract line item details
        const itemNumber = getFirstNonEmpty(row, ['Order Lines/Product Barcode', 'Order Lines/Product/Barcode', 'Product Barcode', 'Barcode', 'Item Number']);
        const description = getFirstNonEmpty(row, ['Order Lines/Product/Name', 'Order Lines/Product', 'Product', 'Description']);
        const quantity = parseNumericField(row, ['Order Lines/Base Quantity', 'Base Quantity', 'Order Lines/Quantity', 'Quantity', 'Qty']);

        // Unit of measure: prefer an explicit UOM column, else derive from the product
        // name suffix (Vend names gram-measured products "…/ Gram"). Oracle rejects the
        // wrong UOM with AR-856356, so we pass the real one through (mapped to Ea / G in
        // the SOAP builder) instead of forcing "Ea" on every line.
        const lineUom = extractUom(row, description);

        // Compute UnitSellingPrice as: Subtotal w/o Tax ÷ Base Quantity
        // 'Order Lines/Subtotal w/o Tax' (standard Vend) and 'Order Lines/Tax Excl.'
        // (YASMEEN export) both represent the per-line total excluding tax. Dividing
        // by quantity converts the line total into the per-unit price that Oracle AR
        // expects in UnitSellingPrice.
        const subtotalRaw = getFirstNonEmpty(row, [
          'Order Lines/Subtotal w/o Tax',
          'Subtotal w/o Tax',
          'Order Lines/Tax Excl.',
          'Order Lines/Tax Excl',
          'Tax Excl.',
          'Tax Excl',
        ]);
        let unitSellingPrice;
        if (subtotalRaw !== '') {
          // Column holds the line total (subtotal); divide by quantity to get unit price.
          // Round to 6 decimal places (Oracle AR standard precision) so that Oracle can
          // reconstruct Quantity × UnitSellingPrice without sub-penny floating-point error.
          // Use String() before .replace() because XLSX returns numeric cells as JS numbers.
          const subtotalValue = parseFloat(String(subtotalRaw).replace(/,/g, '')) || 0;
          const rawUnitPrice = quantity > 0 ? subtotalValue / quantity : subtotalValue;
          unitSellingPrice = Math.round(rawUnitPrice * 1e6) / 1e6;
        } else {
          // Fall back to direct unit-price columns (no division needed).
          unitSellingPrice = parseNumericField(row, [
            'Order Lines/Unit Price',
            'Unit Price',
            'Order Lines/Sell Price',
            'Order Lines/Selling Price',
            'Selling Price',
            'Price',
            'Order Lines/Tax Incl.',
            'Order Lines/Tax Incl',
            'Tax Incl.',
            'Tax Incl',
            'Total',
          ]);
        }

        // Try to extract payment method from sales line (if available)
        // Payment method field might be named: "Payment Method", "Order Lines/Payment Method", etc.
        const linePaymentMethod = normalizeUpper(getFirstNonEmpty(row, [
          'Payment Method',
          'Order Lines/Payment Method',
          'Payment Type',
          'Payments/Payment Method',
          'Order Payment/Method',
        ]));

        // Determine which payment type this line belongs to
        // Payment method categorization rules:
        // - TABBY: Only payment methods containing "TABBY"
        // - TAMARA: Only payment methods containing "TAMARA"
        // - NORMAL: Everything else including Cash, Mada, Visa, Master, Bank, Card, etc.
        let linePaymentType = null;

        if (linePaymentMethod) {
          linePaymentType = getPaymentType(linePaymentMethod);
        }

        // Separate refund/return lines: a real product line (has an item barcode)
        // priced negative is a return. Divert it to the refunds file instead of the
        // invoice so the remaining (positive) data still produces a valid invoice.
        if (itemNumber && Number(unitSellingPrice) < 0) {
          const qtyAbs = Math.abs(Number(quantity) || 0);
          const lineTotal = Math.round(qtyAbs * Number(unitSellingPrice) * 100) / 100;
          refunds.push({
            store: subinventoryCode,
            branch: branch || '',
            date: saleDate,
            orderRef: salesOrderRef,
            paymentMethod: linePaymentMethod || '',
            itemNumber,
            description,
            quantity: qtyAbs,
            unitSellingPrice: Number(unitSellingPrice),
            lineTotal,
          });
          continue;
        }

        // Skip this sales line entirely if it was already invoiced in Fusion
        // (opt-in dedup). Keeps re-run payloads small and avoids duplicate lines.
        if (skipExisting && existingLineKeys.has(lineDedupKey(salesOrderRef, itemNumber, description))) {
          skippedExistingCount++;
          continue;
        }

        // Payment type priority: (1) the cumulative-amount assignment's payment type
        // (the matched payment row's method), (2) an explicit line payment method,
        // (3) the order's detected types, (4) the store's types.
        const targetPaymentTypes = (assigned && assigned.paymentType)
          ? [assigned.paymentType]
          : (linePaymentType
            ? [linePaymentType]
            : (orderPaymentTypes && orderPaymentTypes.size > 0
              ? Array.from(orderPaymentTypes)
              : Array.from(paymentTypes)));

        for (const paymentType of targetPaymentTypes) {
          // Ensure store-level payment types include detected order-level payment types
          if (!paymentTypes.has(paymentType)) {
            paymentTypes.add(paymentType);
          }
          // Create key for grouping: one invoice per store per day per payment type
          const groupKey = `${subinventoryCode}_${saleDate}_${paymentType}`;

          if (!invoiceGroups[groupKey]) {
            // Get metadata for this subinventory and payment type combination
            let headerData = {};
            let metadata = null;
            try {
              // Look up metadata by subinventory and customer type (payment type)
              metadata = await fusionMetadataService.findByCustomerType(paymentType, subinventoryCode);

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
              conversionRateType: headerData.ConversionRateType || 'Corporate',
              // Per-brand transaction identifiers from metadata. Fall back to the
              // AlQurashi defaults so behaviour is unchanged when metadata is absent.
              businessUnit: headerData.BusinessUnit || 'AlQurashi-KSA',
              txnSource: headerData.TransactionSource || 'Vend',
              txnType: headerData.TransactionType || 'Vend Invoice',
              // Credit-memo transaction type used to route negative/zero-total groups.
              // Null when metadata has no mapping yet — those groups stay separate and
              // are not stamped with a credit-memo type.
              creditMemoType: headerData.CreditMemoTransactionType || null,
              // Region from metadata drives the tax name (KSA 15% vs Oman 5%) and
              // currency (SAR vs OMR). Defaults to SA when metadata is absent.
              region: (metadata && metadata.region) || 'SA',
              lines: [],
            };
          }

          // Add line item to this payment type's invoice
          const lineNumber = invoiceGroups[groupKey].lines.length + 1;

           // If itemNumber is empty, always use fixed discount item text.
           // Omit ItemNumber entirely so Oracle does not receive both ItemNumber
           // and MemoLine in the same line (AR-855636).
           if (!itemNumber) {
            // Both MemoLineName and MemoLine are included for compatibility:
            // - MemoLineName is the correct Oracle SOAP field name per problem statement
            // - MemoLine is kept for backward compatibility with existing code that may reference it
            // The SOAP envelope builder (soapEnvelopeBuilder.js) prioritizes MemoLineName.
            invoiceGroups[groupKey].lines.push({
              LineNumber: lineNumber,
              Description: 'Discount Item',
              Quantity: quantity,
              UnitSellingPrice: unitSellingPrice,
              UomCode: 'EA',
              CurrencyCode: currencyForRegion(invoiceGroups[groupKey].region),
              TaxClassificationCode: taxClassificationForRegion(invoiceGroups[groupKey].region),
              SalesOrder: salesOrderRef,
              SalesOrderLine: lineNumber,
              MemoLineName: 'Discount Item',
              MemoLine: 'Discount Item',
            });
          } else {
            // Omit MemoLine entirely for regular item lines; sending MemoLine: null
            // alongside ItemNumber causes Oracle error AR-855636.
            invoiceGroups[groupKey].lines.push({
              LineNumber: lineNumber,
              ItemNumber: itemNumber,
              Description: description,
              Quantity: quantity,
              UnitSellingPrice: unitSellingPrice,
              UomCode: lineUom || 'EA',
              CurrencyCode: currencyForRegion(invoiceGroups[groupKey].region),
              TaxClassificationCode: taxClassificationForRegion(invoiceGroups[groupKey].region),
              SalesOrder: salesOrderRef,
              SalesOrderLine: lineNumber,
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

    // Compute a single CrossReference base for this entire upload request.
    // Each group (store/date/payment-type) produces exactly ONE Oracle invoice containing all its
    // lines (no line-count limit).  The business requirement is one invoice per day per store;
    // Oracle timeout concerns should be addressed at the HTTP/network layer if needed.
    let nextCrossRef = await getNextCrossReferenceBase();

    // Generate one payload per invoice group — one invoice per store/date/payment-type.
    const payloads = [];
    // Stats tracked separately — not added to payload objects
    const payloadStats = [];

    for (const group of Object.values(invoiceGroups)) {
      // Determine payment type label for comments
      let paymentTypeLabel = 'Cash/Bank';
      if (group.paymentType === 'TABBY') {
        paymentTypeLabel = 'Tabby';
      } else if (group.paymentType === 'TAMARA') {
        paymentTypeLabel = 'Tamara';
      }

      // Number all lines sequentially starting at 1 (Oracle requires sequential LineNumbers)
      const renumberedLines = group.lines.map((line, idx) => ({ ...line, LineNumber: idx + 1 }));

      // One CrossReference per group (one invoice per store/date/payment-type)
      const crossReference = nextCrossRef++;

      const payload = {
        BusinessUnit: group.businessUnit,
        TransactionSource: group.txnSource,
        TransactionType: group.txnType,
        TransactionDate: group.date,
        AccountingDate: group.date,
        BillToCustomerName: group.customerName,
        BillToCustomerNumber: group.customerNumber,
        BillToSite: group.siteNumber,
        PaymentTerms: 'Immediate',
        InvoiceCurrencyCode: currencyForRegion(group.region),
        CrossReference: String(crossReference),
        Comments: `${paymentTypeLabel} payment - Cross-reference: ${crossReference}`,
        receivablesInvoiceLines: renumberedLines,
      };

      // Compute payload totals in separate variables (not attached to the payload)
      const lineCount = renumberedLines.length;
      let totalAmount = 0;
      for (const line of renumberedLines) {
        totalAmount += (line.Quantity || 0) * (line.UnitSellingPrice || 0);
      }
      totalAmount = Math.round(totalAmount * 100) / 100;

      payloads.push(payload);
      payloadStats.push({
        crossReference: String(crossReference),
        billToCustomerName: group.customerName,
        transactionDate: group.date,
        paymentType: group.paymentType,
        lineCount,
        totalAmount,
        // Carried alongside (not on the payload) so the split step can stamp the
        // right Credit Memo transaction type on negative/zero-total groups.
        creditMemoType: group.creditMemoType,
        // Region drives the credit-memo tax regime (KSA REGIME vs OMAN REGIME).
        region: group.region,
      });
    }

    // Split payloads into positive and negative based on totalAmount
    const positivePayloads = [];
    const negativePayloads = [];
    let positiveTotalAmount = 0;
    let negativeTotalAmount = 0;

    // Groups whose net total is not strictly positive must NOT go in as an invoice:
    // an invoice transaction type has Creation Sign = Positive, and Oracle rejects a
    // zero-or-negative total with AR-855286. Such groups are routed to the per-brand
    // Credit Memo transaction type and kept in a separate list the user pushes
    // explicitly. `> 0` (not `>= 0`) so net-zero groups are diverted too.
    let negativeMissingCreditMemoType = 0;
    for (let i = 0; i < payloads.length; i++) {
      const stat = payloadStats[i];
      if (stat.totalAmount > 0) {
        positivePayloads.push(payloads[i]);
        positiveTotalAmount += stat.totalAmount;
      } else {
        if (stat.creditMemoType) {
          payloads[i].TransactionType = stat.creditMemoType;
        } else {
          // No credit-memo type mapped for this brand yet — keep the payload separate
          // and flag it so the UI can warn instead of silently pushing a bad-sign type.
          negativeMissingCreditMemoType++;
        }
        // Stamp the region on the (soon-to-be credit-memo) payload so Source 1 can pass
        // the right tax regime. Safe: negative payloads are never sent as invoices.
        payloads[i].region = stat.region;
        negativePayloads.push(payloads[i]);
        negativeTotalAmount += stat.totalAmount;
      }
    }

    positiveTotalAmount = Math.round(positiveTotalAmount * 100) / 100;
    negativeTotalAmount = Math.round(negativeTotalAmount * 100) / 100;

    // ── Build credit-memo payloads (REST receivablesCreditMemos) ──────────────
    // Two sources (per requirement): (1) the net-negative invoice groups already
    // stamped with the "- CN" type, and (2) the returned-item refund lines,
    // grouped by store/date/payment type. Oracle has no SOAP credit-memo op, so
    // these go to the REST resource; sign is moved to LineQuantityCredit.
    const creditMemoPayloads = [];

    // GL/accounting date for credit memos follows the transaction (sale) date so the
    // memo posts into the same period as the sale it credits — the July period must be
    // kept OPEN until these are posted. CREDIT_MEMO_GL_DATE remains an optional override:
    // if a sale's period is already closed, set it to a date in an OPEN period. Unset →
    // accounting date = transaction (sale) date.
    const cmAccountingDateOverride = process.env.CREDIT_MEMO_GL_DATE || null;

    // Credit-memo transaction type + source. Verified against Oracle's LOVs:
    //   - "Vend" is NOT a valid credit-memo transaction source (invoices use it, credit
    //     memos cannot) → sending it triggers AR-856386. Valid sources include "Manual".
    //   - "Credit Memo" is a valid transaction type (and "Manual"+"Credit Memo" is the
    //     combo on 190 existing AlQurashi credit memos).
    // So credit memos ALWAYS use a valid CM type/source; the invoice's Vend source is
    // never propagated here. Overridable per environment via env vars.
    const cmType   = process.env.CREDIT_MEMO_TXN_TYPE   || 'Credit Memo';
    const cmSource = process.env.CREDIT_MEMO_TXN_SOURCE || 'Manual';

    // Source 1: net-negative invoice groups → credit memos (header already resolved).
    for (const p of negativePayloads) {
      creditMemoPayloads.push(creditMemoService.buildCreditMemoPayload({
        BillToCustomerNumber: p.BillToCustomerNumber,
        BillToSite:           p.BillToSite,
        BusinessUnit:         p.BusinessUnit,
        TransactionSource:    cmSource,
        TransactionType:      cmType,
        TransactionDate:      p.TransactionDate,
        AccountingDate:       cmAccountingDateOverride || p.TransactionDate,
        CrossReference:       p.CrossReference,
        region:              p.region || 'SA',
        lines: (p.receivablesInvoiceLines || []).map((l) => ({
          ItemNumber:            l.ItemNumber,
          MemoLineName:          l.MemoLineName,
          Description:           l.Description,
          Quantity:              l.Quantity,
          UnitSellingPrice:      l.UnitSellingPrice,
          SalesOrder:            l.SalesOrder,
          TaxClassificationCode: l.TaxClassificationCode,
        })),
      }));
    }

    // Source 2: returned-item refund lines → credit memos grouped by store/date/payment type.
    const refundGroups = {};
    for (const r of refunds) {
      const pType = getPaymentType(r.paymentMethod);
      const key = `${r.store}_${r.date}_${pType}`;
      if (!refundGroups[key]) refundGroups[key] = { store: r.store, date: r.date, paymentType: pType, lines: [] };
      refundGroups[key].lines.push(r);
    }
    for (const g of Object.values(refundGroups)) {
      let headerData = {};
      let refundRegion = 'SA';
      try {
        const metadata = await fusionMetadataService.findByCustomerType(g.paymentType, g.store);
        if (metadata) {
          headerData = fusionMetadataService.mapToArInvoiceHeader(metadata);
          refundRegion = metadata.region || 'SA';
        }
      } catch (err) {
        console.warn(`[Vend Invoice] Credit-memo metadata lookup failed for ${g.store}/${g.paymentType}: ${err.message}`);
      }
      creditMemoPayloads.push(creditMemoService.buildCreditMemoPayload({
        BillToCustomerNumber: headerData.BillToCustomerNumber || '',
        BillToSite:           headerData.BillToSite || '',
        BusinessUnit:         headerData.BusinessUnit || 'AlQurashi-KSA',
        TransactionSource:    cmSource,
        TransactionType:      cmType,
        TransactionDate:      g.date,
        AccountingDate:       cmAccountingDateOverride || g.date,
        CrossReference:       String(nextCrossRef++),
        region:              refundRegion,
        lines: g.lines.map((r) => ({
          ItemNumber:            r.itemNumber,
          Description:           r.description,
          Quantity:              r.quantity,
          UnitSellingPrice:      r.unitSellingPrice,
          SalesOrder:            r.orderRef,
          TaxClassificationCode: taxClassificationForRegion(refundRegion),
        })),
      }));
    }

    // A credit memo is unpushable only if it has no transaction type at all
    // (empty). The type itself (e.g. "Credit Memo", "… - CN") is validated by Oracle.
    const creditMemoMissingType = creditMemoPayloads.filter(
      (p) => !String(p.TransactionType || '').trim()
    ).length;

    const refundTotal = Math.round(refunds.reduce((sum, r) => sum + (r.lineTotal || 0), 0) * 100) / 100;

    const stats = {
      totalSalesLines: salesLines.length,
      totalPayloads: payloads.length,
      positivePayloadsCount: positivePayloads.length,
      negativePayloadsCount: negativePayloads.length,
      // Negative/zero groups with no per-brand Credit Memo type mapped in metadata.
      // These are kept separate and still carry the invoice type — the UI warns.
      negativeMissingCreditMemoType,
      // Credit-memo (REST receivablesCreditMemos) payloads built from both sources.
      creditMemoPayloadsCount: creditMemoPayloads.length,
      creditMemoMissingType,
      skippedExistingLines: skippedExistingCount,
      refundLinesCount: refunds.length,
      refundTotalAmount: refundTotal,
      payloadStats,
      overallTotalAmount: Math.round((positiveTotalAmount + negativeTotalAmount) * 100) / 100,
      positiveTotalAmount,
      negativeTotalAmount,
    };

    console.log(
      `✅ [Vend Invoice] Generated ${payloads.length} invoice payloads from ${salesLines.length} sales lines ` +
      `(${positivePayloads.length} positive, ${negativePayloads.length} negative` +
      (refunds.length ? `, ${refunds.length} refund line(s) separated (SAR ${refundTotal})` : '') +
      (skipExisting ? `, ${skippedExistingCount} line(s) skipped as already in Fusion` : '') + `)`
    );

    return res.json({
      success: true,
      message: `Generated ${payloads.length} invoice(s) from ${salesLines.length} sales line(s) — ` +
        `${positivePayloads.length} positive, ${negativePayloads.length} negative` +
        (refunds.length ? `, ${refunds.length} refund line(s) separated` : ''),
      positivePayloads,
      negativePayloads,
      creditMemoPayloads,
      refunds,
      stats,
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/vend-invoice/create-credit-memos
 * Posts credit-memo payloads to Oracle's receivablesCreditMemos REST resource.
 * Synchronous: credit memos per upload are few (returns), so results are returned
 * directly rather than via async batch polling.
 */
async function createCreditMemos(req, res, next) {
  try {
    const { payloads } = req.body;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ error: 'payloads must be a non-empty array.' });
    }
    if (!process.env.ORACLE_RECEIVABLES_CREDIT_MEMOS_API_URL) {
      return res.status(500).json({ error: 'Missing env var: ORACLE_RECEIVABLES_CREDIT_MEMOS_API_URL' });
    }

    let successCount = 0;
    let failureCount = 0;
    const results = [];

    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      const label = `${payload.TransactionType || 'CN'} ${payload.CrossReference || ''}`.trim();

      // Guard: never push a credit memo with no transaction type at all.
      if (!String(payload.TransactionType || '').trim()) {
        failureCount++;
        results.push({ index: i, status: 'FAILED', crossReference: payload.CrossReference || null, message: 'Missing credit-memo transaction type', payloadSent: payload });
        continue;
      }

      try {
        const response = await creditMemoService.sendCreditMemoRest(payload, label);
        const data = response.data;
        if (response.status >= 200 && response.status < 300) {
          successCount++;
          const cmNumber = (data && (data.TransactionNumber ?? data.CreditMemoNumber ?? data.CustomerTransactionId)) ?? null;
          results.push({ index: i, status: 'SUCCESS', crossReference: payload.CrossReference || null, creditMemoNumber: cmNumber != null ? String(cmNumber) : null, httpStatus: response.status, payloadSent: payload });
        } else {
          failureCount++;
          const detail = (data && (data.detail || data.title)) || (typeof data === 'string' ? data.slice(0, 300) : `HTTP ${response.status}`);
          results.push({ index: i, status: 'FAILED', crossReference: payload.CrossReference || null, message: `Oracle HTTP ${response.status}: ${detail}`, httpStatus: response.status, payloadSent: payload });
        }
      } catch (err) {
        failureCount++;
        results.push({ index: i, status: 'FAILED', crossReference: payload.CrossReference || null, message: err.message, payloadSent: payload });
      }
    }

    const status = failureCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL';
    return res.json({ total: payloads.length, successCount, failureCount, status, results });
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

/**
 * POST /api/vend-invoice/download-refunds-csv
 * Download the separated refund/return lines as a CSV file with full details.
 */
async function downloadRefundsAsCsv(req, res, next) {
  try {
    const { refunds } = req.body;

    if (!refunds || !Array.isArray(refunds)) {
      return res.status(400).json({ error: 'refunds array is required' });
    }

    const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'Store', 'Branch', 'Date', 'OrderRef', 'PaymentMethod',
      'ItemNumber', 'Description', 'Quantity', 'UnitSellingPrice', 'LineTotal',
    ];
    const rows = [headers.join(',')];

    for (const r of refunds) {
      rows.push([
        csv(r.store), csv(r.branch), csv(r.date), csv(r.orderRef), csv(r.paymentMethod),
        csv(r.itemNumber), csv(r.description), r.quantity ?? '', r.unitSellingPrice ?? '', r.lineTotal ?? '',
      ].join(','));
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `vend-refunds-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.join('\n'));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadVendInvoice,
  previewVendInvoice,
  createCreditMemos,
  downloadPayloadsAsJson,
  downloadPayloadsAsCsv,
  downloadRefundsAsCsv,
};
