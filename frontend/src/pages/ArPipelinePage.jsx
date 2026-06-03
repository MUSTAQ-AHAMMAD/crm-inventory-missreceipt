/**
 * AR Pipeline Page
 *
 * Single-page end-to-end AR processing wizard with 4 steps:
 *   Step 1 – AR Invoice Creation   (links to AR Invoice Upload / Vend Invoice)
 *   Step 2 – Standard Receipt      (links to Standard Receipt Upload / Vend Receipt)
 *   Step 3 – Misc Receipt          (links to Misc Receipt Upload / Vend Receipt)
 *   Step 4 – Apply Receipt         (auto-matched pairs, verify, submit)
 *
 * Each step shows a verification table and a clear status indicator.
 */

import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n, digits = 2) {
  if (n == null || n === '') return '—'
  const num = parseFloat(n)
  if (isNaN(num)) return String(n)
  return num.toLocaleString('en-SA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function dateFmt(val) {
  if (!val) return '—'
  const s = String(val).split('T')[0]
  return s || '—'
}

function StepBadge({ step, current, label, icon }) {
  const done = step < current
  const active = step === current
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      done ? 'bg-green-100 text-green-700' :
      active ? 'bg-blue-600 text-white' :
      'bg-gray-100 text-gray-500'
    }`}>
      <span>{done ? '✅' : active ? icon : '○'}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  )
}

function SectionCard({ title, children, badge }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        {badge}
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function StatusChip({ count, label, color }) {
  const cls = {
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls[color] || cls.gray}`}>
      {count} {label}
    </span>
  )
}

// ─── Date filter bar ────────────────────────────────────────────────────────

function DateFilter({ dateFrom, dateTo, store, onChange }) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value, dateTo, store })}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onChange({ dateFrom, dateTo: e.target.value, store })}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Store / Customer</label>
        <input
          type="text"
          placeholder="e.g. Aziz Mall"
          value={store}
          onChange={(e) => onChange({ dateFrom, dateTo, store: e.target.value })}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 w-40"
        />
      </div>
      <button
        onClick={() => onChange({ dateFrom: '', dateTo: '', store: '' })}
        className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        Clear
      </button>
    </div>
  )
}

// ─── Step 1: AR Invoice ─────────────────────────────────────────────────────

function Step1Invoices({ invoices, total, loading }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? invoices : invoices.slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip count={total} label="total invoices" color="blue" />
        <StatusChip count={invoices.filter(i => i.status === 'Success' || i.status === 'SUCCESS').length} label="success" color="green" />
        <StatusChip count={invoices.filter(i => i.status === 'Failed' || i.status === 'FAILED').length} label="failed" color="red" />
      </div>

      <div className="text-sm text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
        <p className="font-medium text-blue-700 mb-1">Step 1: AR Invoice Creation</p>
        <p>Create AR Invoices in Oracle Fusion. Use <strong>Vend Invoice</strong> page to generate from Vend data, or <strong>AR Invoice Upload</strong> for manual entry.</p>
        <div className="flex gap-3 mt-2">
          <Link to="/vend-invoice" className="text-blue-600 hover:underline text-xs font-medium">→ Vend Invoice</Link>
          <Link to="/ar-invoice" className="text-blue-600 hover:underline text-xs font-medium">→ AR Invoice Upload</Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No invoices found for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Txn #</th>
                <th className="px-3 py-2 text-left">Store</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Business Unit</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-semibold text-blue-700">{inv.txnNumber || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{inv.billToCustName || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{dateFmt(inv.txnDate)}</td>
                  <td className="px-3 py-2 text-gray-500 truncate max-w-xs">{inv.businessUnit || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      (inv.status || '').toLowerCase() === 'success' ? 'bg-green-100 text-green-700' :
                      (inv.status || '').toLowerCase() === 'failed'  ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{inv.status || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.length > 10 && (
            <div className="p-3 text-center">
              <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 hover:underline">
                {showAll ? 'Show less' : `Show all ${invoices.length} records`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Standard Receipt ───────────────────────────────────────────────

function Step2StandardReceipts({ records, total, loading }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? records : records.slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip count={total} label="total receipts" color="blue" />
        <StatusChip count={records.filter(r => (r.status || '').toLowerCase() === 'success').length} label="success" color="green" />
      </div>

      <div className="text-sm text-gray-500 bg-green-50 border border-green-100 rounded-lg p-3">
        <p className="font-medium text-green-700 mb-1">Step 2: Standard Receipt</p>
        <p>Standard Receipts are created via the <strong>Vend Receipt Generator</strong> or the <strong>Standard Receipt Upload</strong> page. Receipt numbers follow the pattern <code className="bg-white px-1 rounded">Method-InvoiceNumber</code>.</p>
        <div className="flex gap-3 mt-2">
          <Link to="/vend-receipt" className="text-green-700 hover:underline text-xs font-medium">→ Vend Receipt Generator</Link>
          <Link to="/standard-receipt" className="text-green-700 hover:underline text-xs font-medium">→ Standard Receipt Upload</Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : records.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No standard receipts found for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Receipt #</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Method ID</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-semibold text-green-700">{r.receiptNumber || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{dateFmt(r.receiptDate)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.amount)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.receiptMethodId || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      (r.status || '').toLowerCase() === 'success' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>{r.status || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 10 && (
            <div className="p-3 text-center">
              <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 hover:underline">
                {showAll ? 'Show less' : `Show all ${records.length} records`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Misc Receipt ───────────────────────────────────────────────────

function Step3MiscReceipts({ records, total, loading }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? records : records.slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip count={total} label="total misc receipts" color="blue" />
        <StatusChip count={records.filter(r => (r.status || '').toLowerCase() === 'success').length} label="success" color="green" />
      </div>

      <div className="text-sm text-gray-500 bg-purple-50 border border-purple-100 rounded-lg p-3">
        <p className="font-medium text-purple-700 mb-1">Step 3: Misc Receipt (Bank Charges)</p>
        <p>Misc Receipts are created via the <strong>Vend Receipt Generator</strong> or the <strong>Misc Receipt Upload</strong> page. They record bank charges and deductions.</p>
        <div className="flex gap-3 mt-2">
          <Link to="/vend-receipt" className="text-purple-700 hover:underline text-xs font-medium">→ Vend Receipt Generator</Link>
          <Link to="/misc-receipt" className="text-purple-700 hover:underline text-xs font-medium">→ Misc Receipt Upload</Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : records.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No misc receipts found for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Receipt #</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Method</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-semibold text-purple-700">{r.receiptNumber || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{dateFmt(r.receiptDate)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${parseFloat(r.amount) < 0 ? 'text-red-600' : ''}`}>{fmt(r.amount)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.receiptMethodName || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      (r.status || '').toLowerCase() === 'success' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>{r.status || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 10 && (
            <div className="p-3 text-center">
              <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 hover:underline">
                {showAll ? 'Show less' : `Show all ${records.length} records`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 4: Apply Receipt ──────────────────────────────────────────────────

function Step4ApplyReceipt({ pendingPairs, totalPending, loadingPending, onRefresh, filters }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [error, setError] = useState('')
  const [activeUploadId, setActiveUploadId] = useState(null)

  // Poll progress
  const { data: progressData } = useQuery({
    queryKey: ['arPipelineProgress', activeUploadId],
    queryFn: () => api.get(`/apply-receipt/uploads/${activeUploadId}/progress`).then((r) => r.data),
    enabled: !!activeUploadId,
    refetchInterval: activeUploadId ? 2000 : false,
  })

  // Handle progress completion
  useEffect(() => {
    if (!progressData || !activeUploadId) return
    const { status } = progressData
    if (status === 'SUCCESS' || status === 'FAILED' || status === 'PARTIAL') {
      setSubmitResult(progressData)
      setSubmitting(false)
      setActiveUploadId(null)
      queryClient.invalidateQueries({ queryKey: ['arPipelinePending'] })
      onRefresh()
    }
  }, [progressData, activeUploadId, queryClient, onRefresh])

  const toggleAll = () => {
    if (selected.size === pendingPairs.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pendingPairs.map((_, i) => i)))
    }
  }

  const toggleOne = (i) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // Group pending pairs by store + date for display
  const grouped = {}
  pendingPairs.forEach((p, i) => {
    const key = `${p.store || 'Unknown'}__${p.txnDate || 'Unknown'}`
    if (!grouped[key]) grouped[key] = { store: p.store, date: p.txnDate, pairs: [] }
    grouped[key].pairs.push({ ...p, index: i })
  })

  const handleSubmit = async () => {
    if (selected.size === 0) {
      setError('Please select at least one pair to apply.')
      return
    }
    setError('')
    setSubmitting(true)
    setSubmitResult(null)

    const chosenPairs = [...selected].map((i) => ({
      txnNumber: pendingPairs[i].txnNumber,
      receiptNumber: pendingPairs[i].receiptNumber,
    }))

    try {
      const res = await api.post('/ar-pipeline/submit-apply', { pairs: chosenPairs })
      setActiveUploadId(res.data.uploadId)
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed.')
      setSubmitting(false)
    }
  }

  const processed = progressData ? progressData.successCount + progressData.failureCount : 0
  const total = progressData ? progressData.totalReceipts : 0

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 text-sm text-orange-800">
        <p className="font-semibold text-orange-700 mb-1">Step 4: Apply Receipt (Automated)</p>
        <ul className="list-disc ml-5 space-y-0.5 text-xs">
          <li>The system automatically matches AR Invoice transaction numbers with Standard Receipt numbers.</li>
          <li>Matching is based on the <strong>receipt number pattern</strong>: standard receipts created by Vend Receipt Generator are named <code className="bg-white px-1 rounded">Method-TxnNumber</code> (e.g. <code className="bg-white px-1 rounded">Mada-2912269</code>).</li>
          <li>Already-applied pairs are automatically excluded.</li>
          <li>Select the pairs to apply, verify them, then click <strong>Submit Selected</strong>.</li>
        </ul>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2">
        <StatusChip count={totalPending} label="pending pairs" color={totalPending > 0 ? 'yellow' : 'green'} />
        <StatusChip count={selected.size} label="selected" color="blue" />
        {submitResult && (
          <>
            <StatusChip count={submitResult.successCount} label="applied ✓" color="green" />
            <StatusChip count={submitResult.failureCount} label="failed" color="red" />
          </>
        )}
      </div>

      {/* Progress bar while submitting */}
      {submitting && activeUploadId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Spinner size="sm" />
            <p className="text-sm font-medium text-blue-700">
              Applying receipts… {processed}/{total}
            </p>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: total > 0 ? `${Math.round((processed / total) * 100)}%` : '10%' }}
            />
          </div>
        </div>
      )}

      {/* Submit result */}
      {submitResult && !submitting && (
        <div className={`rounded-lg border p-4 text-sm ${
          submitResult.status === 'SUCCESS' ? 'bg-green-50 border-green-200' :
          submitResult.status === 'PARTIAL' ? 'bg-yellow-50 border-yellow-200' :
          'bg-red-50 border-red-200'
        }`}>
          <p className={`font-semibold ${
            submitResult.status === 'SUCCESS' ? 'text-green-700' :
            submitResult.status === 'PARTIAL' ? 'text-yellow-700' :
            'text-red-700'
          }`}>
            {submitResult.status === 'SUCCESS' ? '✅ All receipts applied successfully' :
             submitResult.status === 'PARTIAL' ? '⚠️ Partially applied' :
             '❌ Apply receipt failed'}
          </p>
          <p className="text-gray-600 text-xs mt-1">
            {submitResult.successCount} succeeded, {submitResult.failureCount} failed.
          </p>
          {submitResult.uploadId && (
            <Link to={`/receipt-upload/apply/${submitResult.uploadId}`} className="text-blue-600 hover:underline text-xs mt-1 inline-block">
              View detailed results →
            </Link>
          )}
        </div>
      )}

      <ErrorAlert message={error} onDismiss={() => setError('')} />

      {/* Pairs grouped by store + date */}
      {loadingPending ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-8">
          <p className="text-4xl mb-2">🎉</p>
          <p className="text-sm font-medium text-green-700">All receipts have been applied!</p>
          <p className="text-xs text-gray-500 mt-1">No pending pairs found for this filter.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Select all / submit controls */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button
              onClick={toggleAll}
              className="text-sm text-blue-600 hover:underline"
              disabled={submitting}
            >
              {selected.size === pendingPairs.length ? 'Deselect All' : 'Select All'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0}
              className="px-5 py-2 bg-orange-600 text-white font-semibold text-sm rounded-lg hover:bg-orange-700 disabled:opacity-60 transition-colors flex items-center gap-2"
            >
              {submitting ? <Spinner size="sm" /> : '⚡'}
              {submitting ? 'Applying…' : `Apply ${selected.size} Selected`}
            </button>
          </div>

          {Object.values(grouped).map(({ store, date, pairs }) => (
            <div key={`${store}__${date}`} className="rounded-lg border border-gray-200 overflow-hidden">
              {/* Group header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-sm font-semibold text-gray-800">🏪 {store || 'Unknown Store'}</span>
                <span className="text-xs text-gray-500">📅 {date || 'Unknown Date'}</span>
                <span className="ml-auto">
                  <StatusChip count={pairs.length} label="pairs" color="blue" />
                </span>
              </div>

              {/* Pair rows */}
              <table className="w-full text-xs">
                <thead className="bg-white text-gray-500 uppercase border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left w-8">
                      <input
                        type="checkbox"
                        checked={pairs.every(p => selected.has(p.index))}
                        onChange={() => {
                          const allIn = pairs.every(p => selected.has(p.index))
                          setSelected(prev => {
                            const next = new Set(prev)
                            pairs.forEach(p => allIn ? next.delete(p.index) : next.add(p.index))
                            return next
                          })
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Invoice Txn #</th>
                    <th className="px-3 py-2 text-left">Receipt Number</th>
                    <th className="px-3 py-2 text-right">Amount (SAR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pairs.map(({ index, txnNumber, receiptNumber, amount }) => (
                    <tr
                      key={index}
                      className={`hover:bg-gray-50 cursor-pointer ${selected.has(index) ? 'bg-orange-50' : ''}`}
                      onClick={() => toggleOne(index)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(index)}
                          onChange={() => toggleOne(index)}
                          className="rounded"
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold text-blue-700">{txnNumber}</td>
                      <td className="px-3 py-2 font-mono text-green-700">{receiptNumber}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ArPipelinePage() {
  const [activeStep, setActiveStep] = useState(1)
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', store: '' })

  const queryParams = new URLSearchParams()
  if (filters.dateFrom) queryParams.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) queryParams.set('dateTo', filters.dateTo)
  if (filters.store) queryParams.set('store', filters.store)
  const qs = queryParams.toString()

  // Summary data (step counts)
  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['arPipelineSummary', qs],
    queryFn: () => api.get(`/ar-pipeline/summary${qs ? '?' + qs : ''}`).then((r) => r.data),
    keepPreviousData: true,
  })

  // Step 1 invoices
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['arPipelineInvoices', qs],
    queryFn: () => api.get(`/ar-pipeline/invoices?limit=200&${qs}`).then((r) => r.data),
    enabled: activeStep === 1,
    keepPreviousData: true,
  })

  // Step 2 standard receipts
  const { data: stdData, isLoading: stdLoading } = useQuery({
    queryKey: ['arPipelineStdReceipts', qs],
    queryFn: () => api.get(`/ar-pipeline/standard-receipts?limit=200&${qs}`).then((r) => r.data),
    enabled: activeStep === 2,
    keepPreviousData: true,
  })

  // Step 3 misc receipts
  const { data: miscData, isLoading: miscLoading } = useQuery({
    queryKey: ['arPipelineMiscReceipts', qs],
    queryFn: () => api.get(`/ar-pipeline/misc-receipts?limit=200&${qs}`).then((r) => r.data),
    enabled: activeStep === 3,
    keepPreviousData: true,
  })

  // Step 4 pending apply pairs
  const { data: pendingData, isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['arPipelinePending', qs],
    queryFn: () => api.get(`/ar-pipeline/pending-apply${qs ? '?' + qs : ''}`).then((r) => r.data),
    enabled: activeStep === 4,
    keepPreviousData: true,
  })

  const handleFiltersChange = useCallback((f) => setFilters(f), [])

  const invoiceCount = summaryData?.invoiceCount ?? 0
  const stdCount = summaryData?.standardReceiptCount ?? 0
  const miscCount = summaryData?.miscReceiptCount ?? 0
  const appliedCount = summaryData?.appliedCount ?? 0
  const pendingCount = pendingData?.total ?? 0

  const steps = [
    { step: 1, label: 'AR Invoice',       icon: '📄', count: invoiceCount, color: 'blue'   },
    { step: 2, label: 'Standard Receipt', icon: '💳', count: stdCount,     color: 'green'  },
    { step: 3, label: 'Misc Receipt',     icon: '🧾', count: miscCount,    color: 'purple' },
    { step: 4, label: 'Apply Receipt',    icon: '⚡', count: pendingCount, color: 'orange' },
  ]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">AR Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          End-to-end AR processing — AR Invoice → Standard Receipt → Misc Receipt → Apply Receipt
        </p>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Filter by Date / Store</p>
        <DateFilter
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          store={filters.store}
          onChange={handleFiltersChange}
        />
      </div>

      {/* Pipeline overview cards */}
      {summaryLoading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {steps.map(({ step, label, icon, count, color }) => (
            <button
              key={step}
              onClick={() => setActiveStep(step)}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                activeStep === step
                  ? color === 'blue'   ? 'border-blue-500 bg-blue-50 shadow-md'
                  : color === 'green'  ? 'border-green-500 bg-green-50 shadow-md'
                  : color === 'purple' ? 'border-purple-500 bg-purple-50 shadow-md'
                  : 'border-orange-500 bg-orange-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">{icon}</div>
              <div className="text-xs font-medium text-gray-500">{label}</div>
              <div className={`text-2xl font-bold mt-1 ${
                color === 'blue' ? 'text-blue-600' :
                color === 'green' ? 'text-green-600' :
                color === 'purple' ? 'text-purple-600' :
                'text-orange-600'
              }`}>{count}</div>
              {step === 4 && (
                <div className="text-xs text-gray-400 mt-0.5">{appliedCount} already applied</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Step indicator bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {steps.map(({ step, label, icon }) => (
          <button key={step} onClick={() => setActiveStep(step)} className="focus:outline-none">
            <StepBadge step={step} current={activeStep} label={label} icon={icon} />
          </button>
        ))}
      </div>

      {/* Step content */}
      {activeStep === 1 && (
        <SectionCard
          title="Step 1 — AR Invoice Creation"
          badge={<StatusChip count={invoiceCount} label="invoices" color="blue" />}
        >
          <Step1Invoices
            invoices={invoicesData?.invoices ?? []}
            total={invoicesData?.total ?? 0}
            loading={invoicesLoading}
          />
        </SectionCard>
      )}

      {activeStep === 2 && (
        <SectionCard
          title="Step 2 — Standard Receipt"
          badge={<StatusChip count={stdCount} label="receipts" color="green" />}
        >
          <Step2StandardReceipts
            records={stdData?.records ?? []}
            total={stdData?.total ?? 0}
            loading={stdLoading}
          />
        </SectionCard>
      )}

      {activeStep === 3 && (
        <SectionCard
          title="Step 3 — Misc Receipt (Bank Charges)"
          badge={<StatusChip count={miscCount} label="misc receipts" color="gray" />}
        >
          <Step3MiscReceipts
            records={miscData?.records ?? []}
            total={miscData?.total ?? 0}
            loading={miscLoading}
          />
        </SectionCard>
      )}

      {activeStep === 4 && (
        <SectionCard
          title="Step 4 — Apply Receipt (Auto-Matched)"
          badge={<StatusChip count={pendingCount} label="pending" color={pendingCount > 0 ? 'yellow' : 'green'} />}
        >
          <Step4ApplyReceipt
            pendingPairs={pendingData?.pendingPairs ?? []}
            totalPending={pendingData?.total ?? 0}
            loadingPending={pendingLoading}
            onRefresh={() => { refetchPending(); refetchSummary() }}
            filters={filters}
          />
        </SectionCard>
      )}

      {/* Grouped store+date summary (visible on all steps) */}
      {summaryData?.grouped && summaryData.grouped.length > 0 && (
        <SectionCard title="Pipeline Summary — by Store & Date">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Store</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Invoices</th>
                  <th className="px-4 py-2 text-right">Receipts Matched</th>
                  <th className="px-4 py-2 text-right">Pending Apply</th>
                  <th className="px-4 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summaryData.grouped.map((g) => (
                  <tr key={`${g.store}__${g.date}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">🏪 {g.store || '—'}</td>
                    <td className="px-4 py-2 text-gray-500">📅 {g.date || '—'}</td>
                    <td className="px-4 py-2 text-right">{g.invoices.length}</td>
                    <td className="px-4 py-2 text-right">{g.totalReceipts}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        g.pendingApply > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {g.pendingApply > 0 ? `${g.pendingApply} pending` : '✓ Done'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {g.pendingApply > 0 && (
                        <button
                          onClick={() => {
                            setFilters({ dateFrom: g.date, dateTo: g.date, store: g.store || '' })
                            setActiveStep(4)
                          }}
                          className="text-xs text-orange-600 hover:underline font-medium"
                        >
                          Apply →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
