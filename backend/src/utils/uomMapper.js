/**
 * UOM (Unit of Measure) Mapper
 * 
 * Maps common UOM descriptions to Oracle Fusion standard UOM codes.
 * Oracle requires uppercase UOM codes like 'EA', 'DOZ', 'KG', etc.
 */

// Standard UOM mapping from common descriptions to Oracle codes
const UOM_MAPPING = {
  // Each variations
  'each': 'EA',
  'ea': 'EA',
  'eaches': 'EA',
  'unit': 'EA',
  'units': 'EA',
  'piece': 'EA',
  'pieces': 'EA',
  'pcs': 'EA',
  'pc': 'EA',
  
  // Dozen variations
  'dozen': 'DOZ',
  'doz': 'DOZ',
  'dozens': 'DOZ',
  
  // Box/Carton variations
  'box': 'BOX',
  'boxes': 'BOX',
  'bx': 'BOX',
  'carton': 'CTN',
  'cartons': 'CTN',
  'ctn': 'CTN',
  
  // Case variations
  'case': 'CS',
  'cases': 'CS',
  'cs': 'CS',
  
  // Pair variations
  'pair': 'PR',
  'pairs': 'PR',
  'pr': 'PR',
  
  // Weight - Kilogram
  'kilogram': 'KG',
  'kilograms': 'KG',
  'kg': 'KG',
  'kilo': 'KG',
  'kilos': 'KG',
  
  // Weight - Gram
  'gram': 'G',
  'grams': 'G',
  'g': 'G',
  'gm': 'G',
  
  // Weight - Pound
  'pound': 'LB',
  'pounds': 'LB',
  'lb': 'LB',
  'lbs': 'LB',
  
  // Weight - Ounce
  'ounce': 'OZ',
  'ounces': 'OZ',
  'oz': 'OZ',
  
  // Volume - Liter
  'liter': 'L',
  'liters': 'L',
  'litre': 'L',
  'litres': 'L',
  'l': 'L',
  
  // Volume - Milliliter
  'milliliter': 'ML',
  'milliliters': 'ML',
  'millilitre': 'ML',
  'millilitres': 'ML',
  'ml': 'ML',
  
  // Volume - Gallon
  'gallon': 'GAL',
  'gallons': 'GAL',
  'gal': 'GAL',
  
  // Length - Meter
  'meter': 'M',
  'meters': 'M',
  'metre': 'M',
  'metres': 'M',
  'm': 'M',
  
  // Length - Centimeter
  'centimeter': 'CM',
  'centimeters': 'CM',
  'centimetre': 'CM',
  'centimetres': 'CM',
  'cm': 'CM',
  
  // Length - Foot
  'foot': 'FT',
  'feet': 'FT',
  'ft': 'FT',
  
  // Length - Inch
  'inch': 'IN',
  'inches': 'IN',
  'in': 'IN',
  
  // Pack variations
  'pack': 'PK',
  'packs': 'PK',
  'pk': 'PK',
  'package': 'PKG',
  'packages': 'PKG',
  'pkg': 'PKG',
  
  // Pallet variations
  'pallet': 'PLT',
  'pallets': 'PLT',
  'plt': 'PLT',
  
  // Roll variations
  'roll': 'RL',
  'rolls': 'RL',
  'rl': 'RL',
  
  // Set variations
  'set': 'SET',
  'sets': 'SET',
  
  // Bag variations
  'bag': 'BAG',
  'bags': 'BAG',
  
  // Bottle variations
  'bottle': 'BTL',
  'bottles': 'BTL',
  'btl': 'BTL',
  
  // Can variations
  'can': 'CAN',
  'cans': 'CAN',
  
  // Jar variations
  'jar': 'JAR',
  'jars': 'JAR',
  
  // Tray variations
  'tray': 'TRY',
  'trays': 'TRY',
  'try': 'TRY',
  
  // Bundle variations
  'bundle': 'BDL',
  'bundles': 'BDL',
  'bdl': 'BDL',
};

/**
 * Maps a UOM description to an Oracle standard UOM code
 * @param {string} uomDescription - The UOM description (e.g., "Each", "Dozen")
 * @param {string} [defaultCode='EA'] - Default code if no mapping found
 * @returns {string} - Oracle standard UOM code (uppercase)
 */
function mapUomCode(uomDescription, defaultCode = 'EA') {
  if (!uomDescription) {
    return defaultCode;
  }
  
  // Convert to string and normalize
  const normalized = String(uomDescription).toLowerCase().trim();
  
  // Check if it's already a valid UOM code (2-3 uppercase letters)
  if (/^[A-Z]{2,4}$/.test(uomDescription.trim())) {
    return uomDescription.trim().toUpperCase();
  }
  
  // Look up in mapping
  const mapped = UOM_MAPPING[normalized];
  
  if (mapped) {
    return mapped;
  }
  
  // If not found, try to extract potential code
  // e.g., "EA - Each" -> "EA"
  const codeMatch = uomDescription.match(/^([A-Z]{2,4})\s*[-–—:]/i);
  if (codeMatch) {
    return codeMatch[1].toUpperCase();
  }
  
  // If still not found, log warning and return default
  console.warn(`[UOM Mapper] Unknown UOM: "${uomDescription}". Using default: ${defaultCode}`);
  return defaultCode;
}

/**
 * Validates if a UOM code is valid for Oracle
 * @param {string} uomCode - The UOM code to validate
 * @returns {boolean} - True if valid
 */
function isValidUomCode(uomCode) {
  if (!uomCode) return false;
  const code = String(uomCode).trim();
  // Oracle UOM codes are typically 1-4 uppercase letters or numbers
  // Common codes: EA, DOZ, KG, G, L, ML, M, CM, etc.
  return /^[A-Z0-9]{1,4}$/.test(code);
}

/**
 * Gets all available UOM mappings
 * @returns {Object} - The complete UOM mapping object
 */
function getAllMappings() {
  return { ...UOM_MAPPING };
}

/**
 * Adds a custom UOM mapping
 * @param {string} description - The UOM description
 * @param {string} code - The Oracle UOM code
 */
function addCustomMapping(description, code) {
  if (!description || !code) {
    throw new Error('Both description and code are required');
  }
  
  const normalized = String(description).toLowerCase().trim();
  const upperCode = String(code).toUpperCase().trim();
  
  if (!isValidUomCode(upperCode)) {
    throw new Error(`Invalid UOM code format: ${code}. Must be 2-4 uppercase letters.`);
  }
  
  UOM_MAPPING[normalized] = upperCode;
}

module.exports = {
  mapUomCode,
  isValidUomCode,
  getAllMappings,
  addCustomMapping,
};
