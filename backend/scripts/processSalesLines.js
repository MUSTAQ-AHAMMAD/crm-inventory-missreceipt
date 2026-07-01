#!/usr/bin/env node

/**
 * Sales Lines Excel Processor
 * 
 * Reads sales lines data from Excel files, processes UOM codes,
 * and outputs the data in a format ready for AR invoice creation.
 * 
 * Usage:
 *   node scripts/processSalesLines.js <excel-file-path> [options]
 *   npm run process:sales-lines -- <excel-file-path> [options]
 * 
 * Options:
 *   --output, -o <path>    Output file path (default: output to console)
 *   --format, -f <format>  Output format: json, csv, or display (default: display)
 *   --sheet, -s <name>     Sheet name to process (default: first sheet)
 *   --help, -h             Show help
 * 
 * Examples:
 *   node scripts/processSalesLines.js "Sales lines MAKABRAJ1 26MAR.xlsx"
 *   node scripts/processSalesLines.js "YASMEEN Sales Lines.xlsx" --format json --output output.json
 *   npm run process:sales-lines -- "Sales lines MAKABRAJ1 26MAR.xlsx" -f csv -o output.csv
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { mapUomCode, isValidUomCode } = require('../src/utils/uomMapper');

// Configuration constants
const DISPLAY_LIMIT = 20; // Number of rows to display in console output
const DEFAULT_CURRENCY = 'SAR'; // Default currency for AR invoices
const DEFAULT_TAX_CODE = 'OUTPUT-GOODS-DOM-15%'; // Default tax classification code

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Sales Lines Excel Processor

Usage:
  node scripts/processSalesLines.js <excel-file-path> [options]

Options:
  --output, -o <path>    Output file path (default: output to console)
  --format, -f <format>  Output format: json, csv, or display (default: display)
  --sheet, -s <name>     Sheet name to process (default: first sheet)
  --help, -h             Show help

Examples:
  node scripts/processSalesLines.js "Sales lines MAKABRAJ1 26MAR.xlsx"
  node scripts/processSalesLines.js "YASMEEN Sales Lines.xlsx" --format json --output output.json
  npm run process:sales-lines -- "Sales lines MAKABRAJ1 26MAR.xlsx" -f csv -o output.csv
    `);
    process.exit(0);
  }
  
  const config = {
    filePath: null,
    output: null,
    format: 'display',
    sheetName: null,
  };
  
  // First non-flag argument is the file path
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('-') && !config.filePath) {
      config.filePath = args[i];
      continue;
    }
    
    if (args[i] === '--output' || args[i] === '-o') {
      config.output = args[++i];
    } else if (args[i] === '--format' || args[i] === '-f') {
      config.format = args[++i];
    } else if (args[i] === '--sheet' || args[i] === '-s') {
      config.sheetName = args[++i];
    }
  }
  
  if (!config.filePath) {
    console.error('Error: Excel file path is required');
    process.exit(1);
  }
  
  return config;
}

/**
 * Read Excel file and extract data
 */
function readExcelFile(filePath, sheetName = null) {
  try {
    // Read the workbook
    const workbook = XLSX.readFile(filePath);
    
    // Get sheet name
    const targetSheet = sheetName || workbook.SheetNames[0];
    
    if (!workbook.Sheets[targetSheet]) {
      throw new Error(`Sheet "${targetSheet}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }
    
    console.log(`📄 Reading file: ${path.basename(filePath)}`);
    console.log(`📋 Processing sheet: ${targetSheet}`);
    console.log(`📊 Available sheets: ${workbook.SheetNames.join(', ')}\n`);
    
    // Convert sheet to JSON
    const worksheet = workbook.Sheets[targetSheet];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    
    return rawData;
  } catch (error) {
    console.error(`Error reading Excel file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Process and normalize sales lines data
 */
function processSalesLines(rawData) {
  console.log(`🔄 Processing ${rawData.length} rows...\n`);
  
  const processed = [];
  const uomStats = {};
  let invalidCount = 0;
  
  rawData.forEach((row, index) => {
    try {
      // Try to identify common column names (case-insensitive)
      const rowKeys = Object.keys(row);
      
      // Find UOM column
      const uomKey = rowKeys.find(key => 
        /uom|unit.*measure|base.*uom|order.*uom/i.test(key)
      ) || rowKeys.find(key => /unit/i.test(key));
      
      // Find quantity column
      const qtyKey = rowKeys.find(key => 
        /quantity|qty|ordered.*qty|line.*qty/i.test(key)
      );
      
      // Find item/product column
      const itemKey = rowKeys.find(key => 
        /item|product|sku|item.*number|product.*code/i.test(key)
      );
      
      // Find description column
      const descKey = rowKeys.find(key => 
        /description|item.*desc|product.*desc|line.*desc/i.test(key)
      );
      
      // Find price columns
      const priceKey = rowKeys.find(key => 
        /price|unit.*price|selling.*price|list.*price/i.test(key)
      );
      
      // Find line number
      const lineNumKey = rowKeys.find(key => 
        /line.*number|line.*no|line\s*#/i.test(key)
      );
      
      // Find sales order
      const soKey = rowKeys.find(key => 
        /sales.*order|so.*number|order.*number/i.test(key)
      );
      
      // Find sales order line
      const solKey = rowKeys.find(key => 
        /sales.*order.*line|so.*line|order.*line/i.test(key)
      );
      
      // Extract values
      const originalUom = uomKey ? String(row[uomKey]).trim() : '';
      const mappedUom = mapUomCode(originalUom);
      
      // Track UOM mappings
      if (originalUom) {
        if (!uomStats[originalUom]) {
          uomStats[originalUom] = { count: 0, mappedTo: mappedUom };
        }
        uomStats[originalUom].count++;
      }
      
      // Validate mapped UOM
      if (!isValidUomCode(mappedUom)) {
        console.warn(`⚠️  Row ${index + 1}: Invalid UOM code "${mappedUom}"`);
        invalidCount++;
      }
      
      // Build processed row
      const processedRow = {
        lineNumber: lineNumKey ? row[lineNumKey] : index + 1,
        itemNumber: itemKey ? String(row[itemKey]).trim() : '',
        description: descKey ? String(row[descKey]).trim() : '',
        quantity: qtyKey ? parseFloat(row[qtyKey]) || 0 : 0,
        originalUom: originalUom,
        mappedUom: mappedUom,
        unitPrice: priceKey ? parseFloat(row[priceKey]) || 0 : 0,
        salesOrder: soKey ? String(row[soKey]).trim() : '',
        salesOrderLine: solKey ? row[solKey] : null,
        rawData: row, // Keep original data for reference
      };
      
      processed.push(processedRow);
      
    } catch (error) {
      console.error(`Error processing row ${index + 1}: ${error.message}`);
      invalidCount++;
    }
  });
  
  // Print statistics
  console.log(`\n📈 Processing Statistics:`);
  console.log(`   Total rows processed: ${processed.length}`);
  console.log(`   Invalid/Warning rows: ${invalidCount}`);
  console.log(`\n🏷️  UOM Mappings Found:`);
  
  Object.entries(uomStats).forEach(([original, { count, mappedTo }]) => {
    const status = isValidUomCode(mappedTo) ? '✅' : '❌';
    console.log(`   ${status} "${original}" → "${mappedTo}" (${count} occurrences)`);
  });
  
  return processed;
}

/**
 * Format data for display
 */
function formatForDisplay(data) {
  console.log(`\n📋 Processed Sales Lines (showing first ${DISPLAY_LIMIT}):\n`);
  console.log('─'.repeat(120));
  console.log(
    'Line'.padEnd(6) +
    'Item'.padEnd(15) +
    'Description'.padEnd(30) +
    'Qty'.padEnd(8) +
    'Original UOM'.padEnd(15) +
    'Mapped UOM'.padEnd(12) +
    'Price'.padEnd(10)
  );
  console.log('─'.repeat(120));
  
  data.slice(0, DISPLAY_LIMIT).forEach(row => {
    console.log(
      String(row.lineNumber).padEnd(6) +
      String(row.itemNumber).substring(0, 14).padEnd(15) +
      String(row.description).substring(0, 29).padEnd(30) +
      String(row.quantity).padEnd(8) +
      String(row.originalUom).substring(0, 14).padEnd(15) +
      String(row.mappedUom).padEnd(12) +
      String(row.unitPrice.toFixed(2)).padEnd(10)
    );
  });
  
  if (data.length > DISPLAY_LIMIT) {
    console.log(`\n   ... and ${data.length - DISPLAY_LIMIT} more rows`);
  }
  
  console.log('─'.repeat(120));
}

/**
 * Convert to AR Invoice format
 */
function convertToArInvoiceFormat(data) {
  return data.map(row => ({
    LineNumber: row.lineNumber,
    ItemNumber: row.itemNumber || null,
    Description: row.description || 'Sales Item',
    Quantity: row.quantity || 0,
    UomCode: row.mappedUom,
    UnitSellingPrice: row.unitPrice || 0,
    CurrencyCode: DEFAULT_CURRENCY,
    SalesOrder: row.salesOrder || null,
    SalesOrderLine: row.salesOrderLine || null,
    TaxClassificationCode: DEFAULT_TAX_CODE,
  }));
}

/**
 * Output data to file or console
 */
function outputData(data, format, outputPath) {
  if (format === 'display') {
    formatForDisplay(data);
    return;
  }
  
  let outputContent;
  let fileExt;
  
  if (format === 'json') {
    const arInvoiceFormat = convertToArInvoiceFormat(data);
    outputContent = JSON.stringify(arInvoiceFormat, null, 2);
    fileExt = '.json';
  } else if (format === 'csv') {
    const arInvoiceFormat = convertToArInvoiceFormat(data);
    const headers = Object.keys(arInvoiceFormat[0]).join(',');
    const rows = arInvoiceFormat.map(row => 
      Object.values(row).map(val => `"${val}"`).join(',')
    );
    outputContent = [headers, ...rows].join('\n');
    fileExt = '.csv';
  } else {
    console.error(`Unknown format: ${format}`);
    process.exit(1);
  }
  
  if (outputPath) {
    // Ensure output path has correct extension
    if (!outputPath.endsWith(fileExt)) {
      outputPath += fileExt;
    }
    
    fs.writeFileSync(outputPath, outputContent, 'utf8');
    console.log(`\n✅ Output written to: ${outputPath}`);
    console.log(`   Format: ${format.toUpperCase()}`);
    console.log(`   Size: ${outputContent.length} bytes`);
  } else {
    console.log(`\n${outputContent}`);
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🚀 Sales Lines Excel Processor\n');
  
  const config = parseArgs();
  
  // Resolve file path
  let filePath = config.filePath;
  if (!path.isAbsolute(filePath)) {
    // Try relative to project root
    const projectRoot = path.join(__dirname, '..');
    const rootPath = path.join(projectRoot, filePath);
    
    if (fs.existsSync(rootPath)) {
      filePath = rootPath;
    } else if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      console.error(`Tried: ${filePath}`);
      console.error(`Tried: ${rootPath}`);
      process.exit(1);
    }
  }
  
  // Read and process
  const rawData = readExcelFile(filePath, config.sheetName);
  const processed = processSalesLines(rawData);
  
  // Output
  outputData(processed, config.format, config.output);
  
  console.log(`\n✨ Processing complete!\n`);
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  readExcelFile,
  processSalesLines,
  convertToArInvoiceFormat,
};
