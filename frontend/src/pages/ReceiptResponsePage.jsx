/**
 * Receipt Response Page.
 *
 * Displays the Oracle Fusion receipt response data stored in the database:
 *   1. Standard Receipts  (FusionStandardReceipt)
 *   2. Misc Receipts      (FusionMiscReceipt)
 *   3. Apply Receipts     (FusionApplyReceipt)
 *   4. Receipt Methods    (FusionReceiptMethod – payment method mappings)
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const PAGE_SIZE = 50
const TABS = [
  { key: 'standard',  label: 'Standard Receipts',  icon: '💳' },
  { key: 'misc',      label: 'Misc Receipts',       icon: '🧾' },
  { key: 'apply',     label: 'Apply Receipts',      icon: '🔗' },
  { key: 'methods',   label: 'Receipt Methods',     icon: '🗂️' },
]

function fmt(value) {
  return value == null || value === '' ? '—' : String(value)
}

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function fmtAmount(value) {
  if (value == null || value === '') return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return String(value)
  return num.toLocaleString('en-SA', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtPct(value) {
  if (value == null || value === '') return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return String(value)
  return `${(num * 100).toFixed(4)}%`
}

function StatusBadge({ status }) {
  const base = 'px-2 py-0.5 rounded-full text-xs font-medium'
  const color =
    status === 'Success'
      ? 'bg-green-100 text-green-700'
      : status === 'Failed'
      ? 'bg-red-100 text-red-700'
      : status === 'PROCESSING'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-yellow-100 text-yellow-700'
  return <span className={`${base} ${color}`}>{fmt(status)}</span>
}

function Pagination({ page, totalPages, total, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
      <p className="text-xs text-gray-500">
        Page {page} of {totalPages} ({total} records)
      </p>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// ── Standard Receipts ─────────────────────────────────────────────────────────

function StandardReceiptsTab() {
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ['fusionStandardReceipts', page],
    queryFn: () =>
      api.get('/vend-receipt/standard-receipts', { params: { page, limit: PAGE_SIZE } }).then((r) => r.data),
  })

  const receipts = data?.receipts || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>
  if (error) return <ErrorAlert message="Failed to load Standard Receipt data." />

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Oracle Fusion Standard Receipt responses stored in <span className="font-mono">FusionStandardReceipt</span>.
        Total: <strong>{total}</strong> records.
      </p>

      {receipts.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No standard receipt records found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Receipt Number</th>
                  <th className="px-3 py-2 text-left">Method ID</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Currency</th>
                  <th className="px-3 py-2 text-left">Receipt Date</th>
                  <th className="px-3 py-2 text-left">GL Date</th>
                  <th className="px-3 py-2 text-left">Deposit Date</th>
                  <th className="px-3 py-2 text-left">Customer ID</th>
                  <th className="px-3 py-2 text-left">Org ID</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-left">Request ID</th>
                  <th className="px-3 py-2 text-left">Request Date</th>
                  <th className="px-3 py-2 text-left">Message</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{r.id}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700 whitespace-nowrap">{fmt(r.receiptNumber)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.receiptMethodId)}</td>
                    <td className="px-3 py-2 text-right">{fmtAmount(r.amount)}</td>
                    <td className="px-3 py-2">{fmt(r.currencyCode)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.receiptDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.glDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.depositDate)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.customerId)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.orgId)}</td>
                    <td className="px-3 py-2">{fmt(r.region)}</td>
                    <td className="px-3 py-2">{fmt(r.integMode)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.requestId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.requestDate)}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={r.message ?? ''}>{fmt(r.message)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page} totalPages={totalPages} total={total}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        </>
      )}
    </div>
  )
}

// ── Misc Receipts ─────────────────────────────────────────────────────────────

function MiscReceiptsTab() {
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ['fusionMiscReceipts', page],
    queryFn: () =>
      api.get('/vend-receipt/misc-receipts', { params: { page, limit: PAGE_SIZE } }).then((r) => r.data),
  })

  const receipts = data?.receipts || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>
  if (error) return <ErrorAlert message="Failed to load Misc Receipt data." />

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Oracle Fusion Misc Receipt responses stored in <span className="font-mono">FusionMiscReceipt</span>.
        Total: <strong>{total}</strong> records.
      </p>

      {receipts.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No misc receipt records found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Receipt Number</th>
                  <th className="px-3 py-2 text-left">Method Name</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Currency</th>
                  <th className="px-3 py-2 text-left">Receipt Date</th>
                  <th className="px-3 py-2 text-left">GL Date</th>
                  <th className="px-3 py-2 text-left">Bank Account</th>
                  <th className="px-3 py-2 text-left">Activity Name</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-left">Request ID</th>
                  <th className="px-3 py-2 text-left">Request Date</th>
                  <th className="px-3 py-2 text-left">Message</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{r.id}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700 whitespace-nowrap">{fmt(r.receiptNumber)}</td>
                    <td className="px-3 py-2">{fmt(r.receiptMethodName)}</td>
                    <td className="px-3 py-2 text-right">{fmtAmount(r.amount)}</td>
                    <td className="px-3 py-2">{fmt(r.currencyCode)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.receiptDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.glDate)}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={r.bankAccNumber ?? ''}>{fmt(r.bankAccNumber)}</td>
                    <td className="px-3 py-2">{fmt(r.recActivityName)}</td>
                    <td className="px-3 py-2">{fmt(r.region)}</td>
                    <td className="px-3 py-2">{fmt(r.integMode)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.requestId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.requestDate)}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={r.message ?? ''}>{fmt(r.message)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page} totalPages={totalPages} total={total}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        </>
      )}
    </div>
  )
}

// ── Apply Receipts ────────────────────────────────────────────────────────────

function ApplyReceiptsTab() {
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ['fusionApplyReceipts', page],
    queryFn: () =>
      api.get('/vend-receipt/apply-receipts', { params: { page, limit: PAGE_SIZE } }).then((r) => r.data),
  })

  const receipts = data?.receipts || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>
  if (error) return <ErrorAlert message="Failed to load Apply Receipt data." />

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Oracle Fusion Apply Receipt responses stored in <span className="font-mono">FusionApplyReceipt</span>.
        Total: <strong>{total}</strong> records.
      </p>

      {receipts.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No apply receipt records found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Receipt Number</th>
                  <th className="px-3 py-2 text-left">Txn Number</th>
                  <th className="px-3 py-2 text-right">Amount Applied</th>
                  <th className="px-3 py-2 text-left">Currency</th>
                  <th className="px-3 py-2 text-left">Accounting Date</th>
                  <th className="px-3 py-2 text-left">Application Date</th>
                  <th className="px-3 py-2 text-left">Txn Source</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-left">Request ID</th>
                  <th className="px-3 py-2 text-left">Request Date</th>
                  <th className="px-3 py-2 text-left">Message</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{r.id}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700 whitespace-nowrap">{fmt(r.receiptNumber)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.txnNumber)}</td>
                    <td className="px-3 py-2 text-right">{fmtAmount(r.amountApplied)}</td>
                    <td className="px-3 py-2">{fmt(r.currencyCode)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.accountingDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.applicationDate)}</td>
                    <td className="px-3 py-2">{fmt(r.txnSource)}</td>
                    <td className="px-3 py-2">{fmt(r.region)}</td>
                    <td className="px-3 py-2">{fmt(r.integMode)}</td>
                    <td className="px-3 py-2 font-mono">{fmt(r.requestId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.requestDate)}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={r.message ?? ''}>{fmt(r.message)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page} totalPages={totalPages} total={total}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        </>
      )}
    </div>
  )
}

// ── Receipt Methods ───────────────────────────────────────────────────────────

const REGIONS = ['', 'SA', 'KW', 'BH', 'AE', 'OM', 'SN']

function ReceiptMethodsTab() {
  const [page, setPage] = useState(1)
  const [region, setRegion] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['fusionReceiptMethods', page, region],
    queryFn: () =>
      api.get('/vend-receipt/receipt-methods', { params: { page, limit: PAGE_SIZE, ...(region ? { region } : {}) } }).then((r) => r.data),
  })

  const methods = data?.methods || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>
  if (error) return <ErrorAlert message="Failed to load Receipt Method data." />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <p className="text-xs text-gray-500">
          Payment method mappings with bank charge rates and tax rates stored in{' '}
          <span className="font-mono">FusionReceiptMethod</span>.
          Total: <strong>{total}</strong> records.
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-600 font-medium">Filter by Region:</label>
          <select
            value={region}
            onChange={(e) => { setRegion(e.target.value); setPage(1) }}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r || 'All Regions'}</option>
            ))}
          </select>
        </div>
      </div>

      {methods.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">
          No receipt method records found.{' '}
          {total === 0 && (
            <span className="text-gray-400">
              Run <span className="font-mono">npm run seed:receipt-methods</span> in the backend to load the data.
            </span>
          )}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Receipt Method ID</th>
                  <th className="px-3 py-2 text-left">Method Name</th>
                  <th className="px-3 py-2 text-center">Is Cash</th>
                  <th className="px-3 py-2 text-right">Bank Charge</th>
                  <th className="px-3 py-2 text-right">Method Tax</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2 text-left">Row ID</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {methods.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{m.id}</td>
                    <td className="px-3 py-2 font-mono">{fmt(m.receiptMethodId)}</td>
                    <td className="px-3 py-2 font-semibold">{fmt(m.receiptMethodName)}</td>
                    <td className="px-3 py-2 text-center">
                      {m.receiptIsCash ? (
                        <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">Yes</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmtPct(m.receiptBankCharge)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtPct(m.receiptMethodTax)}</td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">{fmt(m.region)}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-500">{fmt(m.rowId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page} totalPages={totalPages} total={total}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReceiptResponsePage() {
  const [activeTab, setActiveTab] = useState('standard')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Receipt Response Tables</h1>
        <div className="text-sm text-gray-500">
          Oracle Fusion receipt response data from seeded CSV files and live submissions
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-xl shadow-sm">
        <div className="flex border-b border-gray-200">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'standard' && <StandardReceiptsTab />}
          {activeTab === 'misc'     && <MiscReceiptsTab />}
          {activeTab === 'apply'    && <ApplyReceiptsTab />}
          {activeTab === 'methods'  && <ReceiptMethodsTab />}
        </div>
      </div>
    </div>
  )
}
