/**
 * Fusion Sales Metadata Service
 * Provides lookup functionality for mapping sales metadata to AR invoice payloads
 */

const prisma = require('./prisma');

function normalizeLookupValue(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Find metadata by customer name and subinventory
 * @param {string} customerName - Customer/Bill-To name
 * @param {string} subinventory - Subinventory/location code
 * @returns {Promise<Object|null>} Metadata record or null if not found
 */
async function findBySalesHeader(customerName, subinventory) {
  try {
    const normalizedCustomerName = String(customerName || '').trim();
    const normalizedSubinventory = normalizeLookupValue(subinventory);

    const metadata = await prisma.fusionSalesMetadata.findFirst({
      where: {
        billToName: normalizedCustomerName,
        subinventory: normalizedSubinventory,
      },
    });
    return metadata;
  } catch (error) {
    console.error('[FusionMetadata] Error finding metadata:', error);
    throw error;
  }
}

/**
 * Find metadata by customer type and subinventory
 * @param {string} customerType - Customer type (e.g., HUNGERSTATION, MRSOOL, NORMAL)
 * @param {string} subinventory - Subinventory/location code
 * @returns {Promise<Object|null>} Metadata record or null if not found
 */
async function findByCustomerType(customerType, subinventory) {
  try {
    const normalizedCustomerType = normalizeLookupValue(customerType);
    const normalizedSubinventory = normalizeLookupValue(subinventory);

    const metadata = await prisma.fusionSalesMetadata.findFirst({
      where: {
        customerType: normalizedCustomerType,
        subinventory: normalizedSubinventory,
      },
    });
    return metadata;
  } catch (error) {
    console.error('[FusionMetadata] Error finding metadata by customer type:', error);
    throw error;
  }
}

/**
 * Derive a Credit Memo (credit note) transaction type from an invoice transaction type.
 *
 * Oracle names the credit-memo transaction type as the invoice type with " - CN"
 * appended — e.g.
 *   "Vend Invoice"        → "Vend Invoice - CN"
 *   "HA Vend Invoice"     → "HA Vend Invoice - CN"
 *   "Vend Invoice Oman"   → "Vend Invoice Oman - CN"
 * This lets negative groups be routed to a credit-memo type using the invoice type
 * already stored in metadata, with no separate mapping to import. Idempotent: a type
 * that already ends in " - CN" is returned unchanged.
 *
 * @param {string} txnType - invoice transaction type (e.g. "Vend Invoice")
 * @returns {string|null}
 */
function deriveCreditMemoType(txnType) {
  if (!txnType) return null;
  const s = String(txnType).trim();
  if (!s) return null;
  return /\s-\s*CN$/i.test(s) ? s : `${s} - CN`;
}

/**
 * Map metadata to AR invoice header fields
 * @param {Object} metadata - FusionSalesMetadata record
 * @returns {Object} AR invoice header fields
 */
function mapToArInvoiceHeader(metadata) {
  if (!metadata) {
    return {};
  }

  return {
    BusinessUnit: metadata.businessUnit,
    TransactionSource: metadata.txnSource,
    TransactionType: metadata.txnType,
    // Per-brand Credit Memo transaction type for negative/zero-total groups.
    // Prefer an explicit mapping (txnTypeCreditMemo override); otherwise derive it
    // from the invoice type already in the DB (Invoice → Credit Memo).
    CreditMemoTransactionType: metadata.txnTypeCreditMemo ?? deriveCreditMemoType(metadata.txnType),
    BillToCustomerName: metadata.billToName,
    BillToCustomerNumber: metadata.billToAccount.toString(),
    BillToSite: metadata.siteNumber,
    ConversionRateType: metadata.rateIsCorporate === '1' ? 'Corporate' : 'User',
  };
}

/**
 * Find and map sales header data for AR invoice
 * @param {string} customerName - Customer/Bill-To name
 * @param {string} subinventory - Subinventory/location code
 * @returns {Promise<Object>} Mapped AR invoice header fields
 */
async function getArInvoiceHeaderMapping(customerName, subinventory) {
  const metadata = await findBySalesHeader(customerName, subinventory);

  if (!metadata) {
    console.warn(`[FusionMetadata] No metadata found for customer="${customerName}", subinventory="${subinventory}"`);
    return {};
  }

  return mapToArInvoiceHeader(metadata);
}

/**
 * Get all metadata records (for admin/debugging)
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Metadata records and total count
 */
async function getAllMetadata(options = {}) {
  const { page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;

  try {
    const [records, total] = await Promise.all([
      prisma.fusionSalesMetadata.findMany({
        skip,
        take: limit,
        orderBy: { billToName: 'asc' },
      }),
      prisma.fusionSalesMetadata.count(),
    ]);

    return { records, total, page, limit };
  } catch (error) {
    console.error('[FusionMetadata] Error fetching all metadata:', error);
    throw error;
  }
}

module.exports = {
  findBySalesHeader,
  findByCustomerType,
  mapToArInvoiceHeader,
  deriveCreditMemoType,
  getArInvoiceHeaderMapping,
  getAllMetadata,
};
