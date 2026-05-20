/**
 * AR Invoice Response Page.
 * Displays the Oracle Fusion AR Invoice response data stored in the database:
 *   1. AR Invoice Header  (FusionInvoiceHeader)
 *   2. AR Invoice Lines   (FusionInvoiceLine – for the selected header, or all lines)
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const PAGE_SIZE_HEADERS = 20
const PAGE_SIZE_LINES = 50

function fmt(value) {
  return value == null || value === '' ? '—' : String(value)
}

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function StatusBadge({ status }) {
  const base = 'px-2 py-0.5 rounded-full text-xs font-medium'
  const color =
    status === 'Success'
      ? 'bg-green-100 text-green-700'
      : status === 'Failed'
      ? 'bg-red-100 text-red-700'
      : 'bg-yellow-100 text-yellow-700'
  return <span className={`${base} ${color}`}>{fmt(status)}</span>
}

export default function ArInvoiceResponsePage() {
  const [headerPage, setHeaderPage] = useState(1)
  const [linePage, setLinePage] = useState(1)
  const [selectedHeader, setSelectedHeader] = useState(null)

  // ── AR Invoice Headers ────────────────────────────────────────────────────
  const {
    data: headersData,
    isLoading: headersLoading,
    error: headersError,
  } = useQuery({
    queryKey: ['arResponseHeaders', headerPage],
    queryFn: () =>
      api
        .get('/ar-invoice/response-headers', {
          params: { page: headerPage, limit: PAGE_SIZE_HEADERS },
        })
        .then((r) => r.data),
  })

  const headers = headersData?.headers || []
  const headerTotal = headersData?.total || 0
  const headerTotalPages = Math.max(1, Math.ceil(headerTotal / PAGE_SIZE_HEADERS))

  // ── AR Invoice Lines ──────────────────────────────────────────────────────
  const {
    data: linesData,
    isLoading: linesLoading,
    error: linesError,
  } = useQuery({
    queryKey: ['arResponseLines', selectedHeader, linePage],
    queryFn: () =>
      api
        .get('/ar-invoice/response-lines', {
          params: {
            page: linePage,
            limit: PAGE_SIZE_LINES,
            ...(selectedHeader ? { headerId: selectedHeader } : {}),
          },
        })
        .then((r) => r.data),
  })

  const lines = linesData?.lines || []
  const lineTotal = linesData?.total || 0
  const lineTotalPages = Math.max(1, Math.ceil(lineTotal / PAGE_SIZE_LINES))

  const handleSelectHeader = (id) => {
    setSelectedHeader((prev) => (prev === id ? null : id))
    setLinePage(1)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-800">AR Invoice Response Tables</h1>
        <div className="text-sm text-gray-500">
          Oracle Fusion AR Invoice response data from{' '}
          <span className="font-mono">FusionInvoiceHeader</span> /{' '}
          <span className="font-mono">FusionInvoiceLine</span>
        </div>
      </div>

      {/* ── 1. AR Invoice Header ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-gray-700 text-lg">1. AR Invoice Header</h2>
          <span className="text-xs text-gray-500">
            Total: <strong>{headerTotal}</strong> records
            {selectedHeader && (
              <button
                onClick={() => setSelectedHeader(null)}
                className="ml-3 text-blue-600 hover:underline"
              >
                Clear filter ✕
              </button>
            )}
          </span>
        </div>

        {headersError && (
          <ErrorAlert message="Failed to load invoice headers. Please refresh the page." />
        )}

        {headersLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : headers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            No AR Invoice response headers found.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Txn Number</th>
                    <th className="px-3 py-2 text-left">Bill To Customer</th>
                    <th className="px-3 py-2 text-left">Bill To Location</th>
                    <th className="px-3 py-2 text-left">Business Unit</th>
                    <th className="px-3 py-2 text-left">Txn Source</th>
                    <th className="px-3 py-2 text-left">Txn Type</th>
                    <th className="px-3 py-2 text-left">Currency</th>
                    <th className="px-3 py-2 text-left">Txn Date</th>
                    <th className="px-3 py-2 text-left">GL Date</th>
                    <th className="px-3 py-2 text-left">Region</th>
                    <th className="px-3 py-2 text-left">Lines</th>
                    <th className="px-3 py-2 text-left">Message</th>
                    <th className="px-3 py-2 text-left">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {headers.map((h) => (
                    <tr
                      key={h.id}
                      className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                        selectedHeader === h.id ? 'bg-blue-100' : ''
                      }`}
                      onClick={() => handleSelectHeader(h.id)}
                      title="Click to filter lines by this header"
                    >
                      <td className="px-3 py-2 font-mono">{h.id}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={h.status} />
                      </td>
                      <td className="px-3 py-2 font-mono">{fmt(h.txnNumber)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(h.billToCustName)}</td>
                      <td className="px-3 py-2">{fmt(h.billToLocation)}</td>
                      <td className="px-3 py-2">{fmt(h.businessUnit)}</td>
                      <td className="px-3 py-2">{fmt(h.txnSource)}</td>
                      <td className="px-3 py-2">{fmt(h.txnType)}</td>
                      <td className="px-3 py-2">{fmt(h.currencyCode)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(h.txnDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(h.glDate)}</td>
                      <td className="px-3 py-2">{fmt(h.region)}</td>
                      <td className="px-3 py-2 text-center">{h._count?.lines ?? 0}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={h.message ?? ''}>
                        {fmt(h.message)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(h.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Header pagination */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Page {headerPage} of {headerTotalPages} ({headerTotal} records)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setHeaderPage((p) => Math.max(1, p - 1))}
                  disabled={headerPage <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setHeaderPage((p) => Math.min(headerTotalPages, p + 1))}
                  disabled={headerPage >= headerTotalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 2. AR Invoice Lines ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-gray-700 text-lg">2. AR Invoice Lines</h2>
          <span className="text-xs text-gray-500">
            {selectedHeader ? (
              <>
                Showing lines for <strong>Header #{selectedHeader}</strong> —{' '}
                <button
                  onClick={() => setSelectedHeader(null)}
                  className="text-blue-600 hover:underline"
                >
                  Show all
                </button>
              </>
            ) : (
              <>
                Total: <strong>{lineTotal}</strong> lines
                {headers.length > 0 && (
                  <span className="ml-1 text-gray-400">(click a header row to filter)</span>
                )}
              </>
            )}
          </span>
        </div>

        {linesError && (
          <ErrorAlert message="Failed to load invoice lines. Please refresh the page." />
        )}

        {linesLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : lines.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            No AR Invoice response lines found.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Header ID</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Invoice No.</th>
                    <th className="px-3 py-2 text-left">Line#</th>
                    <th className="px-3 py-2 text-left">Item Number</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-left">UOM</th>
                    <th className="px-3 py-2 text-left">Qty</th>
                    <th className="px-3 py-2 text-left">Unit Price</th>
                    <th className="px-3 py-2 text-left">Currency</th>
                    <th className="px-3 py-2 text-left">Tax Code</th>
                    <th className="px-3 py-2 text-left">Sales Order</th>
                    <th className="px-3 py-2 text-left">SO Line</th>
                    <th className="px-3 py-2 text-left">Region</th>
                    <th className="px-3 py-2 text-left">Message</th>
                    <th className="px-3 py-2 text-left">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono">{l.id}</td>
                      <td className="px-3 py-2 font-mono">{fmt(l.headerId)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="px-3 py-2 font-mono">{fmt(l.invoiceNumber)}</td>
                      <td className="px-3 py-2 text-center">{fmt(l.lineNumber)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(l.itemNumber)}</td>
                      <td
                        className="px-3 py-2 max-w-xs truncate"
                        title={l.description ?? ''}
                      >
                        {fmt(l.description)}
                      </td>
                      <td className="px-3 py-2">{fmt(l.uom)}</td>
                      <td className="px-3 py-2 text-right">{fmt(l.quantity)}</td>
                      <td className="px-3 py-2 text-right">{fmt(l.unitSellingPrice)}</td>
                      <td className="px-3 py-2">{fmt(l.currencyCode)}</td>
                      <td className="px-3 py-2">{fmt(l.taxCode)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(l.salesOrder)}</td>
                      <td className="px-3 py-2 text-center">{fmt(l.salesOrderLine)}</td>
                      <td className="px-3 py-2">{fmt(l.region)}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={l.message ?? ''}>
                        {fmt(l.message)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Lines pagination */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Page {linePage} of {lineTotalPages} ({lineTotal} lines)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setLinePage((p) => Math.max(1, p - 1))}
                  disabled={linePage <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setLinePage((p) => Math.min(lineTotalPages, p + 1))}
                  disabled={linePage >= lineTotalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
