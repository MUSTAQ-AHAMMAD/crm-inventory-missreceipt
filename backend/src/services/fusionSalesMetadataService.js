/**
 * Fusion Sales Metadata Service
 * Provides lookup functionality for mapping sales metadata to AR invoice payloads
 */

const prisma = require('./prisma');

function normalizeLookupValue(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Find metadata by customer name and subinventory
 * @param {string} customerName - Customer/Bill-To name
 * @param {string} subinventory - Subinventory/location code
 * @returns {Promise<Object|null>} Metadata record or null if not found
 */
async function findBySalesHeader(customerName, subinventory) {
  try {
    const normalizedSubinventory = normalizeLookupValue(subinventory);

    const metadata = await prisma.fusionSalesMetadata.findFirst({
      where: {
        billToName: customerName,
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
    BillToCustomerName: metadata.billToName,
    BillToCustomerNumber: metadata.billToAccount.toString(),
    BillToSite: metadata.siteNumber,
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
  getArInvoiceHeaderMapping,
  getAllMetadata,
};
