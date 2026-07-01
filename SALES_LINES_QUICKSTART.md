# Sales Lines Processor - Quick Start Guide

## What This Does

Converts sales lines from Excel files with UOM codes like "Each" → "EA" for Oracle compatibility.

## Installation

```bash
cd backend
npm install  # Already done if you've set up the project
```

## Basic Commands

### 1. View Sales Lines (Console Output)

```bash
cd backend
npm run process:sales-lines -- "../Sales lines MAKABRAJ1 26MAR.xlsx"
```

Or:

```bash
cd backend
node scripts/processSalesLines.js "../Sales lines MAKABRAJ1 26MAR.xlsx"
```

### 2. Export to JSON (AR Invoice Ready)

```bash
cd backend
npm run process:sales-lines -- "../YASMEEN Sales Lines.xlsx" -f json -o yasmeen-lines.json
```

### 3. Export to CSV

```bash
cd backend
npm run process:sales-lines -- "../Sales lines MAKABRAJ1 28MAR.xlsx" -f csv -o lines.csv
```

## What You Get

### Console Display
Shows formatted table with:
- ✅ Original UOM → Mapped UOM
- ✅ Statistics
- ✅ Validation warnings

### JSON Output
AR Invoice-ready format:
```json
[
  {
    "LineNumber": 1,
    "ItemNumber": "6287020283765",
    "Description": "Sales Item",
    "Quantity": 1,
    "UomCode": "EA",  ← Automatically mapped!
    "UnitSellingPrice": 300.00,
    "CurrencyCode": "SAR",
    "SalesOrder": null,
    "SalesOrderLine": 1,
    "TaxClassificationCode": "OUTPUT-GOODS-DOM-15%"
  }
]
```

## Common UOM Mappings

| Excel Value | Oracle Code |
|-------------|-------------|
| Each        | EA          |
| Dozen       | DOZ         |
| Piece       | EA          |
| Box         | BOX         |
| Carton      | CTN         |
| Kilogram    | KG          |
| Gram        | G           |
| Liter       | L           |

See [SALES_LINES_PROCESSOR.md](SALES_LINES_PROCESSOR.md) for complete mapping list.

## Files in Repository

Current sales lines files:
- `Sales lines MAKABRAJ1 26MAR.xlsx` (69 KB, 1732 rows)
- `Sales lines MAKABRAJ1 28MAR.xlsx` (115 KB)
- `YASMEEN Sales Lines.xlsx` (57 KB, 1289 rows)

## Help

```bash
cd backend
npm run process:sales-lines -- --help
```

## Full Documentation

See [SALES_LINES_PROCESSOR.md](SALES_LINES_PROCESSOR.md) for:
- All available options
- Complete UOM mapping list
- Integration examples
- Troubleshooting guide
