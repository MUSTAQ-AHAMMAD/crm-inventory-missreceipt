# Oracle FBDI for Large AR Invoices — Investigation

## Why we're here

The AR pipeline creates invoices through the **`createSimpleInvoice` SOAP service**
(`RecInvoiceService`). This works for small invoices but **Oracle returns HTTP 500 for
large single invoices** (observed: 5–29 lines succeed; 428 and 1717 lines fail with 500).
The payload is well-formed (~0.94 MB, no data anomalies) — the limit is Oracle-side:
`createSimpleInvoice` is an interactive, one-transaction-at-a-time service and is not built
for thousands of lines in a single call.

Oracle's **recommended channel for high-volume AR invoice loading is FBDI + AutoInvoice**,
not the SOAP service. This document scopes what adopting it would take.

---

## What FBDI + AutoInvoice is

**File-Based Data Import (FBDI)** loads data into Oracle Fusion **interface tables** via a
CSV-in-a-ZIP upload, then runs standard **ESS (Enterprise Scheduler) jobs** to validate and
move the data into the base tables. For AR invoices the base-table importer is **AutoInvoice**.

The end-to-end flow (all server-to-server, no UI):

```
 our CSV (RaInterfaceLinesAll.csv)
        │  zip
        ▼
 erpintegrations.importBulkData   ── uploads ZIP to UCM, submits ESS ──►  RA_INTERFACE_LINES_ALL
        │                                                                        │
        │  poll ESSJobStatusRF                                                   │ AutoInvoice
        ▼                                                                        ▼
 RequestStatus = SUCCEEDED  ◄──────────── AutoInvoice Execution Report ──── RA_CUSTOMER_TRX_ALL
                                          (errors → RA_INTERFACE_ERRORS_ALL)   (real invoices)
```

### Interface tables
- **`RA_INTERFACE_LINES_ALL`** — header + line data combined. Lines are grouped into one
  invoice by matching `INTERFACE_LINE_ATTRIBUTE1-15` (the *line transaction flexfield*) plus
  `INTERFACE_LINE_CONTEXT`. This is how "1717 lines = one invoice" is expressed.
- `RA_INTERFACE_DISTRIBUTIONS_ALL` (optional) — only if we supply our own GL distributions.
- `RA_INTERFACE_SALESCREDITS_ALL` (optional) — sales credits.

### ESS jobs
1. **Load Interface File for Import** — loads the CSV into the interface table.
2. **Import AutoInvoice** (`AutoInvoiceImport`) — validates and creates the real transactions.

`importBulkData` can chain both: it uploads, loads, and submits the import job named in the
request, returning the ESS request IDs to poll.

---

## The REST integration (what we'd call)

**Submit** — `POST /fscmRestApi/resources/11.13.18.05/erpintegrations`

```jsonc
{
  "OperationName":   "importBulkData",
  "DocumentContent": "<base64 of the ZIP>",
  "ContentType":     "zip",
  "FileName":        "ArAutoInvoice_20260707.zip",
  "DocumentAccount": "fin$/receivables$/import$",   // AR import UCM account
  "JobName":         "oracle/apps/ess/financials/receivables/transactions/autoInvoices,AutoInvoiceImportEss",
  "ParameterList":   "<comma-separated AutoInvoice params, #NULL for blanks>",
  "CallbackURL":     "#NULL",                         // or our webhook
  "NotificationCode":"10"
}
```

- Auth: same Basic auth we already use for Oracle.
- Constraints: **ZIP ≤ 250 MB**, any single file ≤ 1 GB. Our 1717-line invoice is < 1 MB, so
  a whole day of stores fits comfortably in one ZIP.
- `JobName` / `ParameterList` are version- and setup-specific — **must be confirmed against our
  pod** (business unit, batch source, accounting date, etc.).

**Poll** — `GET /fscmRestApi/resources/11.13.18.05/erpintegrations?finder=ESSJobStatusRF;requestId=<ReqstId>`
→ watch `RequestStatus` until `SUCCEEDED` / `ERROR`.

**Results** — success/failure per invoice is not in the HTTP response; it's in the **AutoInvoice
Execution Report** and `RA_INTERFACE_ERRORS_ALL`. We'd fetch the report output (via
`erpintegrations` / `exportbulkdata` or ESS output) to reconcile which invoices imported.

---

## How it maps to our codebase

We already produce a structured payload (`buildArInvoiceSoapEnvelope`'s input): header fields
(BillTo, BusinessUnit, TransactionSource/Type, dates, currency) + `receivablesInvoiceLines`
(LineNumber, ItemNumber/MemoLine, Description, Quantity, UnitSellingPrice, Tax, SalesOrder).
Most of this maps directly to AutoInvoice columns. New work:

| Piece | Effort | Notes |
|------|--------|------|
| CSV generator for `RA_INTERFACE_LINES_ALL` | **Medium** | Map our payload → the AutoInvoice FBDI template columns; generate one row per line, grouped by a per-invoice `INTERFACE_LINE_ATTRIBUTE` key. |
| ZIP builder | Low | We already gzip; switch to a real `.zip` (e.g. `archiver`/`jszip`). |
| `erpintegrations` client (submit + poll) | Medium | New REST client; base64 the ZIP, submit, poll `ESSJobStatusRF`. |
| Field mapping / setup values | **Medium–High** | AutoInvoice needs a **batch source**, memo-line/tax setup, line transaction flexfield context, GL date rules, etc. Requires Oracle functional input. |
| Result reconciliation | Medium | Parse AutoInvoice Execution Report / `RA_INTERFACE_ERRORS_ALL`; update our `FusionInvoiceHeader`/upload records. |
| Async model | Low–Medium | Already have batch/upload tracking + polling UI; adapt to ESS request IDs. |

The existing (broken) `ultraFastBulkInvoiceService` / `oracleBulkApiClient` were an attempt at
this idea but pointed at a **non-existent `/bulk/process` endpoint**. FBDI is the real version of
that concept and would replace them.

---

## Trade-offs

**FBDI + AutoInvoice**
- ✅ Oracle's supported path for high line counts — no per-call size ceiling that matters for us.
- ✅ One ZIP can carry many invoices (a full day of stores) in a single submission.
- ✅ Reuses our existing Basic auth and async/polling infrastructure.
- ⚠️ Asynchronous and batch: results arrive via report parsing, not an immediate response.
- ⚠️ Requires AutoInvoice **functional setup** (batch source, flexfield context, tax/memo config)
  — needs an Oracle AR consultant/admin to confirm.
- ⚠️ Error handling is coarser (per-batch execution report vs. per-call fault).

**Keep `createSimpleInvoice` SOAP + split large invoices into multiple invoices**
- ✅ Small, self-contained code change; synchronous per-invoice results.
- ❌ Breaks the "one invoice per store/day" rule for large stores.
- ❌ Still bounded by whatever line count Oracle's SOAP service tolerates.

**Hybrid (recommended long-term)**
- Small invoices → `createSimpleInvoice` (fast, synchronous, already working).
- Large invoices (above a confirmed threshold) → FBDI/AutoInvoice.

---

## Open questions to confirm before building

1. **Exact Oracle 500 cause** — deploy the new error-capture (now stored in
   `arInvoiceUpload.responseMessage`/`responseBody`) and retry one large invoice to read the
   actual fault. Confirms it's a size/limit issue and not a specific line.
2. **AutoInvoice setup** — batch source name, transaction flexfield context, tax classification,
   memo-line mapping, GL date derivation. (Oracle AR functional owner.)
3. **`JobName` + `ParameterList`** for AutoInvoice Import on our pod/version.
4. **UCM account** — confirm `fin$/receivables$/import$` is correct for our environment.
5. **Reconciliation source** — how we read the AutoInvoice Execution Report output programmatically.

---

## Suggested next step

Low-risk and decision-useful: **retry one large invoice with the new error-capture** to record
Oracle's exact 500 message, and in parallel obtain the AutoInvoice setup values from the Oracle
AR functional owner. With those two inputs, the FBDI generator + `erpintegrations` client is a
well-scoped build (est. a few days once setup values are known).

---

## Sources
- [AutoInvoice Interface Table RA_INTERFACE_LINES_ALL — Oracle Financials 25D](https://docs.oracle.com/en/cloud/saas/financials/25d/faofc/autoinvoice-interface-table-ra-interface-lines-all.html)
- [File-Based Data Import (FBDI) for Financials — AutoInvoice Import](https://docs.oracle.com/en/cloud/saas/financials/25c/oefbf/autoinvoiceimport-3114.html)
- [OIC ERP — importBulkData using erpintegrations REST API (soalicious)](https://soalicious.blogspot.com/2024/06/oic-erp-importbulkdata-using.html)
- [Oracle ERP Cloud Adapter — bulk import (Oracle Integration 3 docs)](https://docs.oracle.com/en/cloud/paas/application-integration/erp-adapter/bulk-import-issues.html)
- [Oracle Fusion FBDI: AR AutoInvoice Import (walkthrough)](https://rpforacle.blogspot.com/2018/02/oracle-fusion-fbdi-ar-auto-invoice-import.html)
- [Oracle Fusion AR AutoInvoice: Rejection, Error, Success (Medium/Sanrusha)](https://medium.com/sanrusha-consultancy/oracle-fusion-ar-autoinvoice-cb6332162b32)
