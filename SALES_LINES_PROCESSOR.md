# Sales Lines Excel Processor

## Overview

The Sales Lines Excel Processor is a utility script that reads sales order lines from Excel files, automatically maps Unit of Measure (UOM) codes to Oracle Fusion standards, and outputs the data in formats suitable for AR invoice creation.

## Problem Solved

Oracle Fusion requires specific UOM codes (e.g., "EA" for Each, "DOZ" for Dozen) in uppercase format. Sales data often contains descriptive UOM values like "Each", "Pieces", "Unit", etc. This processor automatically maps these variations to Oracle-compliant codes.

## Features

- ✅ **Automatic UOM Mapping**: Converts common UOM descriptions ("Each", "Dozen", "Pieces", etc.) to Oracle standard codes ("EA", "DOZ", "PCS", etc.)
- ✅ **Multiple Output Formats**: JSON, CSV, or formatted console display
- ✅ **Smart Column Detection**: Automatically identifies columns regardless of exact naming
- ✅ **AR Invoice Ready**: Outputs data in the exact format needed for AR invoice creation
- ✅ **Statistics & Validation**: Shows UOM mapping statistics and identifies potential issues
- ✅ **Flexible Input**: Works with any Excel file structure containing sales lines data

## Installation

The processor is already included in the project. All dependencies are installed via:

```bash
cd backend
npm install
```

## Usage

### Basic Usage (Console Display)

```bash
# From backend directory
npm run process:sales-lines -- "Sales lines MAKABRAJ1 26MAR.xlsx"

# Or directly with node
node scripts/processSalesLines.js "Sales lines MAKABRAJ1 26MAR.xlsx"

# From project root
cd backend && npm run process:sales-lines -- "../Sales lines MAKABRAJ1 26MAR.xlsx"
```

### Export to JSON (AR Invoice Format)

```bash
npm run process:sales-lines -- "YASMEEN Sales Lines.xlsx" --format json --output output.json
```

### Export to CSV

```bash
npm run process:sales-lines -- "Sales lines MAKABRAJ1 28MAR.xlsx" --format csv --output output.csv
```

### Process Specific Sheet

```bash
npm run process:sales-lines -- "Sales lines MAKABRAJ1 26MAR.xlsx" --sheet "March Sales"
```

## Command Line Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--output <path>` | `-o` | Output file path | Console output |
| `--format <format>` | `-f` | Output format: `json`, `csv`, or `display` | `display` |
| `--sheet <name>` | `-s` | Specific sheet name to process | First sheet |
| `--help` | `-h` | Show help message | - |

## UOM Mapping

The processor includes comprehensive UOM mappings:

### Quantity Units
- **Each**: Each, ea, unit, piece, pc, pcs → `EA`
- **Dozen**: Dozen, doz → `DOZ`
- **Pair**: Pair, pr → `PR`
- **Set**: Set → `SET`

### Packaging Units
- **Box**: Box, bx → `BOX`
- **Carton**: Carton, ctn → `CTN`
- **Case**: Case, cs → `CS`
- **Pack**: Pack, pk → `PK`
- **Package**: Package, pkg → `PKG`
- **Pallet**: Pallet, plt → `PLT`
- **Bag**: Bag → `BAG`
- **Bottle**: Bottle, btl → `BTL`
- **Can**: Can → `CAN`
- **Jar**: Jar → `JAR`
- **Roll**: Roll, rl → `RL`
- **Bundle**: Bundle, bdl → `BDL`
- **Tray**: Tray, try → `TRY`

### Weight Units
- **Kilogram**: Kilogram, kg, kilo → `KG`
- **Gram**: Gram, g, gm → `G`
- **Pound**: Pound, lb, lbs → `LB`
- **Ounce**: Ounce, oz → `OZ`

### Volume Units
- **Liter**: Liter, litre, l → `L`
- **Milliliter**: Milliliter, millilitre, ml → `ML`
- **Gallon**: Gallon, gal → `GAL`

### Length Units
- **Meter**: Meter, metre, m → `M`
- **Centimeter**: Centimeter, centimetre, cm → `CM`
- **Foot**: Foot, feet, ft → `FT`
- **Inch**: Inch, in → `IN`

## Column Detection

The processor automatically detects columns with these patterns:

- **UOM**: "UOM", "Unit of Measure", "Base UOM", "Order UOM", etc.
- **Quantity**: "Quantity", "Qty", "Ordered Qty", "Line Qty", etc.
- **Item**: "Item", "Product", "SKU", "Item Number", "Product Code", etc.
- **Description**: "Description", "Item Desc", "Product Desc", etc.
- **Price**: "Price", "Unit Price", "Selling Price", "List Price", etc.
- **Line Number**: "Line Number", "Line No", "Line #", etc.
- **Sales Order**: "Sales Order", "SO Number", "Order Number", etc.
- **Sales Order Line**: "Sales Order Line", "SO Line", "Order Line", etc.

## Output Formats

### Display Format (Console)

Shows a formatted table with:
- Line Number
- Item Number
- Description
- Quantity
- Original UOM
- Mapped UOM
- Unit Price

Plus statistics showing:
- Total rows processed
- UOM mapping summary
- Invalid entries count

### JSON Format

Outputs AR Invoice-ready format:

```json
[
  {
    "LineNumber": 1,
    "ItemNumber": "6287020283765",
    "Description": "NEW MUSK COLLECTION-3*3",
    "Quantity": 1,
    "UomCode": "EA",
    "UnitSellingPrice": 300.00,
    "CurrencyCode": "SAR",
    "SalesOrder": "REDSEA/60822",
    "SalesOrderLine": 1,
    "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
  }
]
```

This format can be directly used in AR invoice payloads.

### CSV Format

Exports the same fields as JSON but in CSV format, suitable for Excel or database imports.

## Examples

### Example 1: Quick Preview

```bash
npm run process:sales-lines -- "Sales lines MAKABRAJ1 26MAR.xlsx"
```

Output:
```
🚀 Sales Lines Excel Processor

📄 Reading file: Sales lines MAKABRAJ1 26MAR.xlsx
📋 Processing sheet: Sheet1
📊 Available sheets: Sheet1

🔄 Processing 150 rows...

📈 Processing Statistics:
   Total rows processed: 150
   Invalid/Warning rows: 0

🏷️  UOM Mappings Found:
   ✅ "Each" → "EA" (150 occurrences)

📋 Processed Sales Lines (showing first 20):
────────────────────────────────────────────────────────────────────────────────
Line  Item           Description                   Qty     Original UOM   Mapped UOM  Price     
────────────────────────────────────────────────────────────────────────────────
1     6287020283765  NEW MUSK COLLECTION-3*3       1       Each           EA          300.00    
2     6287020283766  PREMIUM PERFUME SET           2       Each           EA          450.00    
...
```

### Example 2: Export for AR Invoice Creation

```bash
npm run process:sales-lines -- "YASMEEN Sales Lines.xlsx" -f json -o yasmeen-invoice-lines.json
```

Creates `yasmeen-invoice-lines.json` ready to be used in AR invoice creation.

### Example 3: Process Specific Sheet

```bash
npm run process:sales-lines -- "Sales lines MAKABRAJ1 28MAR.xlsx" --sheet "March 28" -f csv -o march28.csv
```

## Integration with AR Invoice Creation

The JSON output can be directly used with the AR Invoice API:

```javascript
const salesLines = require('./yasmeen-invoice-lines.json');

const invoicePayload = {
  BusinessUnit: 'SA1_BU',
  TransactionSource: 'VEND',
  TransactionType: 'INV',
  TransactionDate: '2026-03-26',
  AccountingDate: '2026-03-26',
  BillToCustomerName: 'MAKABRAJ1',
  BillToCustomerNumber: '12345',
  BillToSite: 'SITE1',
  PaymentTerms: 'Immediate',
  InvoiceCurrencyCode: 'SAR',
  receivablesInvoiceLines: salesLines // ← Use processed data here
};

// Send to AR Invoice API
const response = await axios.post('/api/ar-invoice/create', invoicePayload);
```

## Troubleshooting

### Unknown UOM Warning

If you see:
```
⚠️  [UOM Mapper] Unknown UOM: "Barrel". Using default: EA
```

You can add custom mappings in `backend/src/utils/uomMapper.js`:

```javascript
const { addCustomMapping } = require('./src/utils/uomMapper');
addCustomMapping('Barrel', 'BBL');
```

### Column Not Found

If columns aren't detected, check that your Excel file has headers in the first row. The processor looks for common patterns but you may need to rename columns.

### File Not Found

Ensure the file path is correct. Use:
- Absolute path: `/home/user/files/Sales lines.xlsx`
- Relative to project root: `Sales lines MAKABRAJ1 26MAR.xlsx`
- Relative to backend: `../Sales lines MAKABRAJ1 26MAR.xlsx`

## Related Documentation

- [AR Invoice UOM Code Fix](../AR_INVOICE_UOM_CODE_FIX.md) - Details on the UOM code error fix
- [AR Invoice Feature](../AR_INVOICE_FEATURE.md) - AR Invoice creation feature documentation
- [SOAP Envelope Builder](../src/services/soapEnvelopeBuilder.js) - SOAP payload generation

## Technical Details

### UOM Mapper Module

Located at: `backend/src/utils/uomMapper.js`

Key functions:
- `mapUomCode(description, defaultCode)` - Maps UOM description to code
- `isValidUomCode(code)` - Validates Oracle UOM code format
- `getAllMappings()` - Returns all available mappings
- `addCustomMapping(description, code)` - Adds custom mapping

### Processor Script

Located at: `backend/scripts/processSalesLines.js`

Key functions:
- `readExcelFile(filePath, sheetName)` - Reads Excel workbook
- `processSalesLines(rawData)` - Processes and validates data
- `convertToArInvoiceFormat(data)` - Converts to AR invoice format
- `outputData(data, format, outputPath)` - Outputs in specified format

## Support

For issues or questions:
1. Check this documentation
2. Review the [AR_INVOICE_UOM_CODE_FIX.md](../AR_INVOICE_UOM_CODE_FIX.md) for UOM-related issues
3. Check console output for specific error messages
4. Open an issue in the repository

## Future Enhancements

Potential improvements:
- [ ] Web UI for uploading and processing files
- [ ] Batch processing multiple files
- [ ] Direct database import option
- [ ] Custom mapping configuration file
- [ ] Support for additional file formats (XLS, ODS)
- [ ] Validation against Oracle item catalog
