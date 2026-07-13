/**
 * Client-side inventory CSV preview helpers.
 *
 * Parses an uploaded inventory CSV in the browser and produces a per-date
 * breakdown of how many records will be uploaded, so the user can visually
 * confirm the transaction dates BEFORE sending the file to the backend.
 *
 * The date-normalization logic here mirrors `formatDateToISO` in
 * backend/src/controllers/inventoryController.js so the preview matches what
 * the server will actually post (slash dates are treated as MM/DD/YYYY).
 */

// Alternative CSV headers (lowercased) → canonical field. Mirrors the backend
// COLUMN_ALIASES for the fields we need to build the preview.
const COLUMN_ALIASES = {
  'order lines/product/barcode': 'ItemNumber',
  'barcode': 'ItemNumber',
  'item number': 'ItemNumber',
  'product barcode': 'ItemNumber',
  'order lines/base uom': 'TransactionUnitOfMeasure',
  'order lines/base quantity': 'TransactionQuantity',
  'transaction date': 'TransactionDate',
  'order lines/order ref/date': 'TransactionDate',
  'date': 'TransactionDate',
  'transaction quantity': 'TransactionQuantity',
  'diff': 'TransactionQuantity',
  'quantity': 'TransactionQuantity',
  'transaction unit of measure': 'TransactionUnitOfMeasure',
  'unit of measure': 'TransactionUnitOfMeasure',
  'uom': 'TransactionUnitOfMeasure',
  'subinventory code': 'SubinventoryCode',
  'subinventory': 'SubinventoryCode',
  'order lines/branch/name': 'SubinventoryCode',
  'branch': 'SubinventoryCode',
  'branch/name': 'SubinventoryCode',
  'transaction reference': 'TransactionReference',
  'order lines/order ref': 'TransactionReference',
  'order ref': 'TransactionReference',
}

const CANONICAL = [
  'ItemNumber', 'TransactionQuantity', 'TransactionUnitOfMeasure',
  'TransactionDate', 'SubinventoryCode', 'TransactionReference',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Minimal RFC-4180-ish CSV parser that handles quoted fields, escaped quotes
 * and CRLF/LF line endings. Returns an array of string arrays (rows).
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/**
 * Normalizes a date string to `YYYY-MM-DD`, or returns null when it cannot be
 * parsed. Slash-separated dates are month-first (MM/DD/YYYY); dash-separated
 * dates are day-first (DD-MM-YYYY); year-first (YYYY-MM-DD) is detected when
 * the first component is > 999. Matches the backend parser.
 */
export function toIsoDate(dateStr) {
  const raw = String(dateStr ?? '').trim()
  if (!raw) return null

  const datePart = raw.split(/[T\s]/)[0]
  const sep = datePart.includes('/') ? '/' : '-'
  const parts = datePart.split(sep)
  if (parts.length !== 3) return null

  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n))) return null

  const [a, b, c] = nums
  let year, month, day

  if (a > 999) {
    year = a
    if (b > 12 && c <= 12) { day = b; month = c } else { month = b; day = c }
  } else if (sep === '/') {
    year = c
    if (a > 12 && b <= 12) { day = a; month = b } else { month = a; day = b }
  } else {
    year = c
    if (b > 12 && a <= 12) { month = a; day = b } else { day = a; month = b }
  }

  if (!year || !month || !day) return null

  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Extracts the branch/subinventory code from a reference like
 * "BRANCHNAME/OrderNumber". Returns null when there is no "/" separator.
 * Mirrors the backend `extractBranchFromRef`.
 */
export function extractBranchFromRef(ref) {
  if (!ref) return null
  const parts = String(ref).split('/')
  return parts.length >= 2 ? parts[0].trim() : null
}

/** Formats an ISO `YYYY-MM-DD` string to a human label like "01 Jul 2026". */
export function formatIsoLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}

/**
 * Builds a per-date preview from raw CSV text.
 *
 * @returns {{
 *   error?: string,
 *   totalRows: number,
 *   uploadable: number,
 *   skipped: number,
 *   invalidDates: number,
 *   byDate: Array<{ iso: string, label: string, count: number }>,
 * }}
 */
export function buildDatePreview(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    return { error: 'No data rows found in the CSV.', totalRows: 0, uploadable: 0, skipped: 0, invalidDates: 0, byDate: [] }
  }

  // Resolve header → column index using canonical names and aliases.
  const header = rows[0].map((h) => h.trim())
  const colIndex = {}
  header.forEach((h, i) => {
    const lower = h.toLowerCase()
    if (CANONICAL.includes(h) && !(h in colIndex)) colIndex[h] = i
    const canonical = COLUMN_ALIASES[lower]
    if (canonical && !(canonical in colIndex)) colIndex[canonical] = i
  })

  if (!('TransactionDate' in colIndex)) {
    return { error: 'Could not find a transaction date column in the CSV.', totalRows: 0, uploadable: 0, skipped: 0, invalidDates: 0, byDate: [] }
  }

  const get = (row, field) => {
    const idx = colIndex[field]
    return idx == null ? '' : String(row[idx] ?? '').trim()
  }

  const dateCounts = new Map()
  const branchCounts = new Map()
  let totalRows = 0
  let uploadable = 0
  let invalidDates = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    // Skip completely blank lines
    if (!row.some((cell) => String(cell ?? '').trim() !== '')) continue
    totalRows++

    const item = get(row, 'ItemNumber')
    const qty = parseFloat(get(row, 'TransactionQuantity'))
    const uom = get(row, 'TransactionUnitOfMeasure')
    const iso = toIsoDate(get(row, 'TransactionDate'))

    // Mirror the backend's core skip rules so the count reflects reality.
    const validCore = item !== '' && !Number.isNaN(qty) && qty !== 0 && uom !== ''
    if (!validCore) continue
    if (!iso) { invalidDates++; continue }

    uploadable++
    dateCounts.set(iso, (dateCounts.get(iso) || 0) + 1)

    // Branch: use SubinventoryCode, else derive it from the reference.
    const branch = get(row, 'SubinventoryCode') || extractBranchFromRef(get(row, 'TransactionReference')) || '—'
    branchCounts.set(branch, (branchCounts.get(branch) || 0) + 1)
  }

  const byDate = Array.from(dateCounts.entries())
    .map(([iso, count]) => ({ iso, label: formatIsoLabel(iso), count }))
    .sort((x, y) => (x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : 0))

  // Sort branches by count (desc), then name, so the busiest stores lead.
  const byBranch = Array.from(branchCounts.entries())
    .map(([branch, count]) => ({ branch, count }))
    .sort((x, y) => (y.count - x.count) || (x.branch < y.branch ? -1 : 1))

  return {
    totalRows,
    uploadable,
    skipped: totalRows - uploadable - invalidDates,
    invalidDates,
    byDate,
    byBranch,
  }
}
