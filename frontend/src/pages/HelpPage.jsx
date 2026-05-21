/**
 * Help & Documentation Page.
 * Comprehensive user guide covering every section of the CRM Portal.
 * Includes step-by-step instructions, required fields, tips, and troubleshooting.
 */

import { useState, useMemo } from 'react'

// ─── Section definitions ────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: 'dashboard',
    icon: '📊',
    title: 'Dashboard',
    color: 'blue',
    badge: 'Overview',
    summary: 'Real-time metrics, upload trends, and recent activity at a glance.',
    description:
      'The Dashboard is the home screen of the CRM Portal. It gives you an instant snapshot of all upload activity and key statistics.',
    steps: [
      {
        step: 'Navigate to Dashboard',
        detail: 'Click Dashboard in the left sidebar under the Overview section.',
      },
      {
        step: 'Read the summary cards',
        detail:
          'Five cards at the top show: Inventory Uploads, Misc Receipt Uploads, Standard Receipt Uploads, Overall Success Rate, and Failed Records.',
      },
      {
        step: 'Review upload trend charts',
        detail:
          'Two charts cover the last 30 days — a line chart showing daily inventory successes/failures, and a bar chart for success vs failure side-by-side.',
      },
      {
        step: 'Check recent activity',
        detail:
          'The table at the bottom lists the latest actions made by all users: who did what, details, and exact time.',
      },
    ],
    tips: [
      'If the success rate drops below 80%, check the Failures tab in Reports for patterns.',
      'Activity timestamps are in your browser\'s local timezone.',
      'Dashboard data refreshes when you reload the page.',
    ],
    fields: [],
  },

  {
    id: 'inventory',
    icon: '📦',
    title: 'Inventory Upload',
    color: 'blue',
    badge: 'Inventory',
    summary: 'Bulk-upload inventory transactions to Oracle Fusion via CSV.',
    description:
      'The Inventory Upload page lets you send large batches of stock transactions directly to Oracle Fusion. Each row in the CSV becomes one transaction record.',
    steps: [
      {
        step: 'Download the CSV template',
        detail: 'Click ⬇️ Download Template (top-right). Open it in Excel or any spreadsheet tool to see the required column names.',
      },
      {
        step: 'Fill in your data',
        detail:
          'Each row is one inventory transaction. Fill every required column. TransactionDate must be a valid date (YYYY-MM-DD or DD/MM/YYYY). TransactionQuantity must be a number.',
      },
      {
        step: 'Enter Organisation Name',
        detail:
          'Type the Oracle Organization Name in the text box, e.g. "Vision Operations". This value is sent with every row.',
      },
      {
        step: 'Select your CSV file',
        detail: 'Drag and drop the CSV file onto the dropzone, or click the area to browse. Accepted format: .csv only.',
      },
      {
        step: 'Upload & Process',
        detail:
          'Click Upload & Process. A progress bar tracks the file upload. After the file is received, a live processing panel shows total, completed, failed, and in-progress counts updated every 1.5 seconds.',
      },
      {
        step: 'Review results',
        detail:
          'A summary banner shows the final status (COMPLETED / PARTIAL / FAILED). If there were failures, click "View failure details →" to see exactly which rows failed and why.',
      },
    ],
    tips: [
      'Column names are flexible — see alternatives listed on the upload form (e.g. "Order Lines/Product/Barcode" maps to ItemNumber).',
      'TransactionUnitOfMeasure defaults to "Each" when the column is empty.',
      'Large files (thousands of rows) are processed in the background; the page stays live while Oracle processes each record.',
      'You can navigate away and come back — the upload history table always shows past runs.',
    ],
    fields: [
      { name: 'TransactionTypeName', required: true, note: 'e.g. Misc Issue, Misc Receipt' },
      { name: 'ItemNumber', required: true, note: 'Product barcode or item code' },
      { name: 'SubinventoryCode', required: true, note: 'Branch / sub-inventory code' },
      { name: 'TransactionDate', required: true, note: 'YYYY-MM-DD or DD/MM/YYYY' },
      { name: 'TransactionQuantity', required: true, note: 'Numeric; negative for issues' },
      { name: 'TransactionReference', required: true, note: 'Order reference number' },
      { name: 'TransactionUnitOfMeasure', required: false, note: 'Defaults to "Each"' },
    ],
  },

  {
    id: 'inventory-template',
    icon: '🧩',
    title: 'Template Generation',
    color: 'indigo',
    badge: 'Inventory',
    summary: 'Convert raw Amro inventory exports into the standard inventory transaction template.',
    description:
      'Template Generation lets you take an Amro-format export file and automatically transform it into the Oracle-ready inventory transaction CSV. Use Preview to check the output before downloading.',
    steps: [
      {
        step: 'Prepare your Amro export',
        detail: 'Export the inventory data from Amro in its default CSV/Excel format. No manual column adjustments needed.',
      },
      {
        step: 'Select the file',
        detail: 'Drag and drop (or click to browse) the Amro export onto the dropzone.',
      },
      {
        step: 'Preview the output',
        detail:
          'Click Preview. The system shows the first rows of the transformed file along with totals (total rows, skipped rows) and any warnings.',
      },
      {
        step: 'Fix warnings',
        detail: 'Warnings appear for rows that were skipped or have issues. Review them and correct the source file if needed.',
      },
      {
        step: 'Download the template',
        detail: 'Click Download Template to save the transformed CSV ready for the Inventory Upload page.',
      },
    ],
    tips: [
      'Rows with missing mandatory fields are skipped — the skipped count tells you how many.',
      'Always preview first before downloading to catch transformation issues.',
      'After downloading, use the file directly on the Inventory Upload page.',
    ],
    fields: [],
  },

  {
    id: 'misc-receipt',
    icon: '🧾',
    title: 'Misc Receipt',
    color: 'purple',
    badge: 'Receipts',
    summary: 'Upload miscellaneous receipts (non-customer cash payments) to Oracle via SOAP.',
    description:
      'The Misc Receipt page handles miscellaneous (non-invoiced) cash receipts. It converts each CSV row into a SOAP XML message and sends it to Oracle Receivables.',
    steps: [
      {
        step: 'Download the template',
        detail: 'Click ⬇️ Download Template to get the correct CSV headers.',
      },
      {
        step: 'Prepare the CSV',
        detail: 'Fill in all required columns. Date fields accept YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, DD/MM/YYYY, or Excel serial numbers — all are auto-converted.',
      },
      {
        step: 'Select the file',
        detail: 'Drag and drop or browse to select your CSV file.',
      },
      {
        step: '(Optional) Preview XML',
        detail:
          'Click Preview XML to see the SOAP envelope that will be sent for each row. This is useful for debugging before sending to Oracle.',
      },
      {
        step: 'Upload & Send to Oracle',
        detail:
          'Click Upload & Send to Oracle. The portal sends each SOAP request to Oracle Receivables. A live progress panel shows success/failure counts per record.',
      },
      {
        step: 'Review results',
        detail:
          'After processing, a result banner shows total, success, and failed counts. Click View Details in the history table for full Oracle response logs.',
      },
    ],
    tips: [
      'OrgId is fixed by the system (300000001421038) — do not add an OrgId column to override it.',
      'ReceiptMethodId / ReceiptMethodName are optional — leave blank if Oracle defaults the method.',
      'Excel serial date numbers (e.g. 45123) are automatically converted to YYYY-MM-DD.',
      'The Preview XML button does not send anything to Oracle — it is safe to use at any time.',
    ],
    fields: [
      { name: 'Amount', required: true, note: 'Numeric receipt amount' },
      { name: 'CurrencyCode', required: true, note: 'e.g. SAR, USD' },
      { name: 'DepositDate', required: true, note: 'Date format: YYYY-MM-DD or DD/MM/YYYY' },
      { name: 'ReceiptDate', required: true, note: 'Date format: YYYY-MM-DD or DD/MM/YYYY' },
      { name: 'GlDate', required: true, note: 'General Ledger date' },
      { name: 'OrgId', required: true, note: 'Column required but value is overridden by system' },
      { name: 'ReceiptNumber', required: true, note: 'Unique receipt number' },
      { name: 'ReceivableActivityName', required: true, note: 'Oracle activity name' },
      { name: 'BankAccountNumber', required: true, note: 'Bank account for the receipt' },
      { name: 'ReceiptMethodId', required: false, note: 'Optional; auto-assigned by Oracle if blank' },
      { name: 'ReceiptMethodName', required: false, note: 'Optional; auto-assigned by Oracle if blank' },
    ],
  },

  {
    id: 'standard-receipt',
    icon: '💳',
    title: 'Standard Receipt',
    color: 'indigo',
    badge: 'Receipts',
    summary: 'Upload customer payment receipts to Oracle Receivables via REST API.',
    description:
      'Standard Receipts are payments from customers against open invoices. This page converts your CSV into REST API payloads and sends them to Oracle Receivables.',
    steps: [
      {
        step: 'Download the template',
        detail: 'Click ⬇️ Download Template to see all column headers.',
      },
      {
        step: 'Prepare the CSV',
        detail:
          'Fill in all 10 required columns per row. ReceiptDate and AccountingDate must be valid dates. Amount must be numeric.',
      },
      {
        step: 'Select the file',
        detail: 'Drag the file onto the dropzone or click Browse.',
      },
      {
        step: '(Optional) Preview Payload',
        detail: 'Click Preview Payload to review the JSON/REST body that will be sent for each row without actually submitting.',
      },
      {
        step: 'Upload & Send to Oracle',
        detail: 'Click to start processing. A real-time panel tracks each row with success/failure counters.',
      },
      {
        step: 'View details',
        detail: 'After completion, click View Details in the history table to see the exact Oracle response for every row.',
      },
    ],
    tips: [
      'Receipt dates must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, DD/MM/YYYY format or Excel serial numbers.',
      'CustomerAccountNumber and CustomerSite must exactly match what is set up in Oracle.',
      'A PARTIAL status means some rows succeeded and some failed — check the detail page to re-process failures.',
    ],
    fields: [
      { name: 'ReceiptNumber', required: true, note: 'Unique receipt identifier' },
      { name: 'ReceiptMethod', required: true, note: 'e.g. CHECK, CASH, EFT' },
      { name: 'ReceiptDate', required: true, note: 'Date of receipt' },
      { name: 'BusinessUnit', required: true, note: 'Oracle Business Unit name' },
      { name: 'CustomerAccountNumber', required: true, note: 'Oracle customer account number' },
      { name: 'CustomerSite', required: true, note: 'Oracle customer site code' },
      { name: 'Amount', required: true, note: 'Payment amount (numeric)' },
      { name: 'Currency', required: true, note: 'e.g. SAR' },
      { name: 'RemittanceBankAccountNumber', required: true, note: 'Receiving bank account' },
      { name: 'AccountingDate', required: true, note: 'GL date for accounting' },
    ],
  },

  {
    id: 'apply-receipt',
    icon: '🔗',
    title: 'Apply Receipt',
    color: 'teal',
    badge: 'Receipts',
    summary: 'Apply one or more receipts against open invoices via SOAP.',
    description:
      'The Apply Receipt page links previously created receipts to specific invoices, clearing the outstanding balance in Oracle Receivables. A single CSV row can apply multiple receipts to one invoice.',
    steps: [
      {
        step: 'Download the template',
        detail: 'Click ⬇️ Download Template to see the required structure.',
      },
      {
        step: 'Prepare the CSV',
        detail:
          'Each row must have an InvoiceNumber. Add ReceiptNumber1, ReceiptNumber2, etc. for each receipt to apply to that invoice.',
      },
      {
        step: 'Select the file',
        detail: 'Drop or browse to select your CSV.',
      },
      {
        step: 'Preview Payload',
        detail: 'Review the SOAP envelopes that will be generated.',
      },
      {
        step: '(Optional) Verify',
        detail: 'Use the Verify function to check that invoice numbers and receipt numbers exist in Oracle before applying.',
      },
      {
        step: 'Upload & Apply',
        detail: 'Submit to Oracle. The live panel shows progress row by row.',
      },
    ],
    tips: [
      'ReceiptNumber columns are unlimited — add ReceiptNumber1, ReceiptNumber2, ReceiptNumber3, etc. as needed.',
      'Verify before uploading to avoid "Invoice not found" errors from Oracle.',
      'If a receipt is already applied to an invoice, Oracle will return an error for that row only.',
    ],
    fields: [
      { name: 'InvoiceNumber', required: true, note: 'The Oracle invoice number to match' },
      { name: 'ReceiptNumber1', required: true, note: 'First receipt to apply' },
      { name: 'ReceiptNumber2', required: false, note: 'Additional receipt (optional)' },
      { name: 'ReceiptNumberN', required: false, note: 'Continue numbering for more receipts' },
    ],
  },

  {
    id: 'ar-invoice',
    icon: '📄',
    title: 'AR Invoice Upload',
    color: 'orange',
    badge: 'AR Invoice',
    summary: 'Manually create AR invoices in Oracle Fusion by editing and submitting a JSON payload.',
    description:
      'The AR Invoice Upload page is for advanced users who need to create a single invoice manually or submit a bulk list of pre-built JSON payloads to Oracle Fusion Receivables.',
    steps: [
      {
        step: 'Review the sample payload',
        detail: 'The page loads a sample JSON invoice payload. Study the structure: header fields (BusinessUnit, BillToCustomerName, etc.) and line items (receivablesInvoiceLines array).',
      },
      {
        step: 'Edit the payload',
        detail:
          'Modify the JSON in the text editor. Change dates, amounts, line items, and customer information to match your invoice. The JSON must remain valid.',
      },
      {
        step: 'Submit to Oracle',
        detail: 'Click Submit Invoice. The portal calls the Oracle Fusion REST API and returns the full response.',
      },
      {
        step: 'Review Oracle response',
        detail:
          'The Oracle response (invoice ID, status, errors) appears below the editor. A successful response includes the created invoice number.',
      },
      {
        step: '(Optional) Bulk submit',
        detail:
          'Switch to the Bulk tab to paste or upload a JSON array of multiple invoice payloads and submit them all at once.',
      },
    ],
    tips: [
      'TransactionDate and AccountingDate must be in YYYY-MM-DD format.',
      'For discount lines, omit ItemNumber entirely — Oracle requires a MemoLine for discount-type lines.',
      'Regular item lines must NOT include a MemoLine field — sending both causes Oracle error AR-855636.',
      'TaxClassificationCode must match exactly what is configured in Oracle (e.g. "OUTPUT-GOODS-DOM-15%").',
    ],
    fields: [
      { name: 'BusinessUnit', required: true, note: 'Oracle Business Unit (e.g. AlQurashi-KSA)' },
      { name: 'TransactionSource', required: true, note: 'e.g. Vend' },
      { name: 'TransactionType', required: true, note: 'e.g. Vend Invoice' },
      { name: 'TransactionDate', required: true, note: 'YYYY-MM-DD' },
      { name: 'AccountingDate', required: true, note: 'YYYY-MM-DD' },
      { name: 'BillToCustomerName', required: true, note: 'Oracle customer name' },
      { name: 'BillToCustomerNumber', required: true, note: 'Oracle customer account number' },
      { name: 'BillToSite', required: true, note: 'Oracle customer site' },
      { name: 'PaymentTerms', required: true, note: 'e.g. IMMEDIATE, NET30' },
      { name: 'InvoiceCurrencyCode', required: true, note: 'e.g. SAR' },
      { name: 'receivablesInvoiceLines', required: true, note: 'Array of line items' },
    ],
  },

  {
    id: 'ar-invoice-data',
    icon: '📋',
    title: 'AR Invoice Data',
    color: 'orange',
    badge: 'AR Invoice',
    summary: 'Browse and search all AR invoice upload history and per-invoice details.',
    description:
      'AR Invoice Data provides a searchable, paginated table of every AR invoice that has been submitted through the portal. Click any row to drill down into its full response from Oracle.',
    steps: [
      {
        step: 'Open AR Invoice Data',
        detail: 'Click AR Invoice Data in the sidebar under AR Invoice.',
      },
      {
        step: 'Browse the table',
        detail: 'The table shows invoice date, Oracle invoice number, customer name, amount, currency, and status.',
      },
      {
        step: 'Search or filter',
        detail: 'Use the search box or date filter controls to narrow down the list.',
      },
      {
        step: 'Drill into details',
        detail: 'Click any row or the "View" link to open the detail page with the full Oracle request and response payloads.',
      },
    ],
    tips: [
      'This is a read-only view — you cannot edit or delete invoices from here.',
      'Oracle invoice numbers appear here only after Oracle confirms the invoice was created.',
    ],
    fields: [],
  },

  {
    id: 'ar-invoice-response',
    icon: '📨',
    title: 'AR Invoice Response',
    color: 'orange',
    badge: 'AR Invoice',
    summary: 'Review Oracle Fusion AR invoice response data and sync status.',
    description:
      'The AR Invoice Response page shows responses that Oracle sent back for submitted invoices. Use it to identify invoices that Oracle rejected and understand the reason.',
    steps: [
      {
        step: 'Open AR Invoice Response',
        detail: 'Click AR Invoice Response in the sidebar.',
      },
      {
        step: 'Review the response table',
        detail: 'Each row shows the invoice reference, Oracle status, and error message (if any).',
      },
      {
        step: 'Identify failures',
        detail: 'Rows with a red/error status need attention. Click the row to see the full Oracle error message.',
      },
      {
        step: 'Resubmit if needed',
        detail: 'Fix the data in the original source, then re-upload via the AR Invoice Upload page.',
      },
    ],
    tips: [
      'Oracle error codes appear in the response body — search Oracle documentation for their meaning.',
      'Common error: AR-855636 means both ItemNumber and MemoLine were sent on the same line.',
    ],
    fields: [],
  },

  {
    id: 'vend-invoice',
    icon: '🏪',
    title: 'Vend Invoice',
    color: 'green',
    badge: 'Vend',
    summary: 'Upload Vend POS payment and sales Excel exports to auto-generate AR invoice payloads.',
    description:
      'The Vend Invoice page takes two Excel exports from the Vend POS system — Payment Lines and Sales Lines — and automatically groups them by store and date to produce AR invoice JSON payloads ready to send to Oracle.',
    steps: [
      {
        step: 'Export from Vend',
        detail:
          'In your Vend POS, export two separate reports: (1) the Payment Lines report and (2) the Sales Lines report. Save both as .xlsx files.',
      },
      {
        step: 'Upload Payment Lines',
        detail: 'Drag the Payment Lines .xlsx file onto the Payment Lines dropzone, or click to browse.',
      },
      {
        step: 'Upload Sales Lines',
        detail: 'Drag the Sales Lines .xlsx file onto the Sales Lines dropzone.',
      },
      {
        step: 'Process',
        detail:
          'Click Process. The system cross-references sales lines and payment lines, groups them by store and date, and splits invoices by payment type (Cash/Card = NORMAL, Tabby = TABBY, Tamara = TAMARA).',
      },
      {
        step: 'Review generated invoices',
        detail:
          'The results panel shows how many invoice payloads were created, grouped by store. Each payload is ready to submit to Oracle.',
      },
      {
        step: 'Submit to Oracle',
        detail: 'Click Submit Invoices (or the per-store button) to send the generated payloads to Oracle Fusion.',
      },
      {
        step: 'Download results',
        detail: 'Use the Download button to save the invoice payloads as a JSON file for your records.',
      },
    ],
    tips: [
      'Payment types are automatically categorised: Cash, Mada, Visa, Master, Bank → NORMAL; Tabby → TABBY; Tamara → TAMARA. Each type generates a separate invoice.',
      'The system supports both YASMEEN-format and standard Vend export column headers automatically.',
      'Discount lines (rows with no barcode/ItemNumber) are handled automatically with the correct MemoLine format.',
      'If a store has no sales on a day, no invoice is generated for that store/day combination.',
    ],
    fields: [
      { name: 'Payment Lines file', required: true, note: 'Vend payment export (.xlsx)' },
      { name: 'Sales Lines file', required: true, note: 'Vend sales export (.xlsx)' },
    ],
  },

  {
    id: 'vend-sales-metadata',
    icon: '🗂️',
    title: 'Sales Metadata',
    color: 'green',
    badge: 'Vend',
    summary: 'View the Fusion Sales Metadata lookup table used to map stores to Oracle billing accounts.',
    description:
      'The Sales Metadata page displays the FUSION_SALES_METADATA lookup table. This table maps each store/subinventory and payment type to the correct Oracle customer (BillTo) account, allowing Vend invoices to be routed to the right Oracle AR account.',
    steps: [
      {
        step: 'Open Sales Metadata',
        detail: 'Click Sales Metadata in the sidebar under Vend.',
      },
      {
        step: 'Browse the table',
        detail: 'The table shows CustomerType, SubInventory, BillToName, BillToNumber, BillToSite, and other mapping fields.',
      },
      {
        step: 'Navigate pages',
        detail: 'Use the Previous / Next buttons at the bottom to paginate. Each page shows 50 records.',
      },
      {
        step: 'Use as reference',
        detail:
          'When a Vend invoice fails because "BillTo not found", look up the store code here to verify it exists in the metadata.',
      },
    ],
    tips: [
      'This table contains 2,100 rows of mapping data seeded from the Oracle configuration.',
      'Changes to this table must be done at the database level by an administrator.',
      'Subinventory codes are stored in UPPERCASE — ensure Vend store codes match exactly.',
    ],
    fields: [],
  },

  {
    id: 'reports',
    icon: '📈',
    title: 'Reports & Monitoring',
    color: 'gray',
    badge: 'Reports',
    summary: 'Multi-tab view covering upload summaries, failure tables, activity logs, and CSV exports.',
    description:
      'Reports & Monitoring gives you complete visibility into all upload operations. Five tabs let you focus on different aspects of the data.',
    steps: [
      {
        step: 'Open Reports',
        detail: 'Click Reports in the sidebar under Reports & Logs.',
      },
      {
        step: 'Use the date range filter',
        detail: 'Set the From and To date fields at the top to filter all tabs to a specific period.',
      },
      {
        step: 'Dashboard tab',
        detail: 'High-level charts: daily upload trends, success/failure rates by type.',
      },
      {
        step: 'Upload History tab',
        detail: 'Table of every upload batch: filename, type, date, total records, success count, failure count, and status.',
      },
      {
        step: 'Failures tab',
        detail: 'All failed records across all upload types. Click a row to see the Oracle error response for that record.',
      },
      {
        step: 'Activity tab',
        detail: 'Audit log of all user actions: logins, uploads, admin changes, with user email and timestamp.',
      },
      {
        step: 'Export tab',
        detail: 'Download filtered data as a CSV file for offline analysis or reporting.',
      },
    ],
    tips: [
      'Use the Failures tab to identify recurring issues — patterns in error messages usually point to configuration problems.',
      'Activity logs are useful for auditing — every upload is recorded with the uploading user\'s email.',
      'Exported CSVs include all filtered rows, not just the current page.',
    ],
    fields: [],
  },

  {
    id: 'failures',
    icon: '⚠️',
    title: 'Logs & Failures',
    color: 'red',
    badge: 'Reports',
    summary: 'View per-upload failure records with Oracle error details.',
    description:
      'The Logs & Failures page (accessible from /failures or the sidebar) shows all records that failed during an upload, including the full Oracle error message for each row.',
    steps: [
      {
        step: 'Navigate to Logs & Failures',
        detail: 'Click Logs & Failures in the sidebar, or use the "View failure details" link on any upload result.',
      },
      {
        step: 'Browse failures',
        detail: 'The table lists every failed row: row number, item/receipt/invoice identifier, and the Oracle error message.',
      },
      {
        step: 'Interpret the error',
        detail:
          'Oracle errors are shown verbatim. Common codes: AR-855636 (conflicting line fields), API-validation errors (missing required fields), HTTP 400 (bad payload).',
      },
      {
        step: 'Fix and re-upload',
        detail:
          'Correct the underlying data in your source CSV, then re-upload only the failed rows on the relevant upload page.',
      },
    ],
    tips: [
      'Errors containing "AR-855636" usually mean a discount line has both ItemNumber and MemoLine.',
      'HTTP 422 errors from Oracle are validation failures — check all field values against Oracle configuration.',
      'Partial failures do not roll back the successful rows — only fix and re-submit the failed ones.',
    ],
    fields: [],
  },

  {
    id: 'users',
    icon: '👥',
    title: 'User Management',
    color: 'slate',
    badge: 'Admin Only',
    summary: 'Create, edit, enable, disable, and reset passwords for portal users. Admin role required.',
    description:
      'User Management is available only to users with the ADMIN role. It controls who can log in to the CRM Portal and what role they have.',
    steps: [
      {
        step: 'Open User Management',
        detail: 'Click User Management in the sidebar under Administration. Only visible to ADMIN users.',
      },
      {
        step: 'Create a new user',
        detail: 'Click + New User. Enter their email, a temporary password, and assign a role (ADMIN or USER). Click Save.',
      },
      {
        step: 'Edit an existing user',
        detail: 'Click the Edit button next to a user. You can update their email, role, or active status.',
      },
      {
        step: 'Disable a user',
        detail: 'Set Active to false when editing. Disabled users cannot log in.',
      },
      {
        step: 'Reset password',
        detail: 'Use the Reset Password option to set a new temporary password. The user should change it on next login.',
      },
    ],
    tips: [
      'Only ADMIN users see the Administration section in the sidebar.',
      'Disabling a user does not delete their data — all their uploads remain in the system.',
      'There should always be at least one active ADMIN account to avoid being locked out.',
    ],
    fields: [],
  },
]

// ─── Colour helpers ────────────────────────────────────────────────────────

const COLOR_MAP = {
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'bg-blue-100 text-blue-700', badge: 'bg-blue-100 text-blue-700', step: 'bg-blue-600', dot: 'bg-blue-200', req: 'bg-blue-100 text-blue-700 border-blue-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'bg-indigo-100 text-indigo-700', badge: 'bg-indigo-100 text-indigo-700', step: 'bg-indigo-600', dot: 'bg-indigo-200', req: 'bg-indigo-100 text-indigo-700 border-indigo-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'bg-purple-100 text-purple-700', badge: 'bg-purple-100 text-purple-700', step: 'bg-purple-600', dot: 'bg-purple-200', req: 'bg-purple-100 text-purple-700 border-purple-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  teal: { bg: 'bg-teal-50', border: 'border-teal-200', icon: 'bg-teal-100 text-teal-700', badge: 'bg-teal-100 text-teal-700', step: 'bg-teal-600', dot: 'bg-teal-200', req: 'bg-teal-100 text-teal-700 border-teal-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'bg-orange-100 text-orange-700', badge: 'bg-orange-100 text-orange-700', step: 'bg-orange-500', dot: 'bg-orange-200', req: 'bg-orange-100 text-orange-700 border-orange-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  green: { bg: 'bg-green-50', border: 'border-green-200', icon: 'bg-green-100 text-green-700', badge: 'bg-green-100 text-green-700', step: 'bg-green-600', dot: 'bg-green-200', req: 'bg-green-100 text-green-700 border-green-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  gray: { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'bg-gray-100 text-gray-700', badge: 'bg-gray-100 text-gray-700', step: 'bg-gray-600', dot: 'bg-gray-200', req: 'bg-gray-100 text-gray-700 border-gray-200', opt: 'bg-gray-50 text-gray-500 border-gray-200' },
  red: { bg: 'bg-red-50', border: 'border-red-200', icon: 'bg-red-100 text-red-700', badge: 'bg-red-100 text-red-700', step: 'bg-red-600', dot: 'bg-red-200', req: 'bg-red-100 text-red-700 border-red-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
  slate: { bg: 'bg-slate-50', border: 'border-slate-200', icon: 'bg-slate-100 text-slate-700', badge: 'bg-slate-100 text-slate-700', step: 'bg-slate-600', dot: 'bg-slate-200', req: 'bg-slate-100 text-slate-700 border-slate-200', opt: 'bg-gray-100 text-gray-600 border-gray-200' },
}

// ─── Section Card ─────────────────────────────────────────────────────────

function SectionCard({ section, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const c = COLOR_MAP[section.color] || COLOR_MAP.gray

  return (
    <div id={section.id} className={`rounded-xl border ${c.border} overflow-hidden`}>
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-5 py-4 text-left ${c.bg} hover:brightness-95 transition-all`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-2xl w-10 h-10 flex items-center justify-center rounded-lg ${c.icon}`}>
            {section.icon}
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-800 text-base">{section.title}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.badge}`}>{section.badge}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5 text-left">{section.summary}</p>
          </div>
        </div>
        <span className="text-gray-400 text-lg ml-4 flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {open && (
        <div className="bg-white px-5 pb-6 pt-4 space-y-6">
          {/* Description */}
          <p className="text-gray-700 text-sm leading-relaxed">{section.description}</p>

          {/* Step-by-step guide */}
          {section.steps.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
                📋 Step-by-Step Guide
              </h3>
              <ol className="space-y-3">
                {section.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className={`flex-shrink-0 w-6 h-6 rounded-full ${c.step} text-white text-xs font-bold flex items-center justify-center mt-0.5`}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <span className="font-medium text-gray-800 text-sm">{s.step}</span>
                      <p className="text-gray-500 text-sm mt-0.5">{s.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* CSV Fields */}
          {section.fields.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
                📑 Fields Reference
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-100 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Field / Column</th>
                      <th className="px-4 py-2 text-left font-semibold">Required</th>
                      <th className="px-4 py-2 text-left font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {section.fields.map((f) => (
                      <tr key={f.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded border border-gray-200">
                            {f.name}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium border ${
                              f.required ? c.req : c.opt
                            }`}
                          >
                            {f.required ? 'Required' : 'Optional'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{f.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tips */}
          {section.tips.length > 0 && (
            <div className={`rounded-lg border ${c.border} ${c.bg} p-4`}>
              <h3 className="font-semibold text-gray-700 mb-2 text-sm">💡 Tips &amp; Gotchas</h3>
              <ul className="space-y-1.5">
                {section.tips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-600">
                    <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${c.step} mt-2`} />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Quick-start cards ────────────────────────────────────────────────────

const QUICK_START = [
  { icon: '📦', label: 'Upload Inventory', href: '/inventory', color: 'bg-blue-600' },
  { icon: '🧾', label: 'Misc Receipt', href: '/misc-receipt', color: 'bg-purple-600' },
  { icon: '💳', label: 'Standard Receipt', href: '/standard-receipt', color: 'bg-indigo-600' },
  { icon: '🔗', label: 'Apply Receipt', href: '/apply-receipt', color: 'bg-teal-600' },
  { icon: '🏪', label: 'Vend Invoice', href: '/vend-invoice', color: 'bg-green-600' },
  { icon: '📈', label: 'Reports', href: '/reports', color: 'bg-gray-600' },
]

// ─── Main page ─────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState('All')

  const groups = ['All', 'Overview', 'Inventory', 'Receipts', 'AR Invoice', 'Vend', 'Reports', 'Admin Only']

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return SECTIONS.filter((s) => {
      const matchGroup = activeGroup === 'All' || s.badge === activeGroup
      if (!matchGroup) return false
      if (!q) return true
      return (
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.steps.some((st) => st.step.toLowerCase().includes(q) || st.detail.toLowerCase().includes(q)) ||
        s.fields.some((f) => f.name.toLowerCase().includes(q)) ||
        s.tips.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [search, activeGroup])

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Help &amp; Documentation</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Complete user guide for the CRM Portal — step-by-step instructions for every feature.
        </p>
      </div>

      {/* Quick-start section */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-semibold text-gray-700 mb-3">⚡ Quick Start — Jump to a feature</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {QUICK_START.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-2 ${item.color} text-white rounded-lg p-3 hover:opacity-90 transition-opacity text-center`}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-xs font-medium leading-tight">{item.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Search + Group filter */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="Search documentation… (e.g. 'upload', 'CSV', 'receipt', 'Oracle')"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeGroup === g
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      {(search || activeGroup !== 'All') && (
        <p className="text-sm text-gray-500">
          {filtered.length === 0
            ? 'No sections match your search.'
            : `Showing ${filtered.length} of ${SECTIONS.length} sections`}
        </p>
      )}

      {/* Section cards */}
      <div className="space-y-3">
        {filtered.map((section) => (
          <SectionCard key={section.id} section={section} defaultOpen={!!search && filtered.length <= 3} />
        ))}
      </div>

      {/* Footer note */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-600 space-y-1">
        <p className="font-semibold text-gray-700">📌 General Tips</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Always <strong>download the CSV template</strong> for each upload page — it contains the exact column headers Oracle expects.</li>
          <li>Date columns accept multiple formats: <strong>YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD</strong>, and Excel serial numbers.</li>
          <li>Upload progress is tracked in real time — the page stays live; you can monitor without refreshing.</li>
          <li>After any upload with failures, use the <strong>View failure details</strong> link to see exact Oracle error messages.</li>
          <li>Contact your system administrator if you encounter consistent <strong>authentication</strong> or <strong>HTTP 500</strong> errors.</li>
        </ul>
      </div>
    </div>
  )
}
