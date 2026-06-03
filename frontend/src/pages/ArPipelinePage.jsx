/**
 * AR Pipeline Page – End-to-End Workflow
 *
 * A single page where a user uploads two files (Payment Lines + Sales Lines)
 * and drives the entire AR cycle step-by-step:
 *
 *   Step 1 – Upload Files & Generate AR Invoice Payloads → Create AR Invoices
 *   Step 2 – Generate Standard & Misc Receipt Payloads  → Create Receipts
 *   Step 3 – Apply Receipts (auto-matched from DB)
 *
 * Every Oracle response is stored in the same DB tables used by the individual
 * feature pages (FusionInvoiceHeader, FusionStandardReceipt, FusionMiscReceipt,
 * FusionApplyReceipt, ArInvoiceUpload, VendReceiptBatch).
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

// ─── Shared helpers ──────────────────────────────────────────────────────────

function fmt(n, digits = 2) {
  if (n == null || n === '') return '—'
  const num = parseFloat(n)
  if (isNaN(num)) return String(n)
  return num.toLocaleString('en-SA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function dateFmt(val) {
  if (!val) return '—'
  return String(val).split('T')[0] || '—'
}

function StatusChip({ count, label, color }) {
  const cls = {
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
    gray:   'bg-gray-100 text-gray-600',
    orange: 'bg-orange-100 text-orange-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls[color] || cls.gray}`}>
      {count} {label}
    </span>
  )
}

function Badge({ children, color = 'gray' }) {
  const cls = {
    blue:   'bg-blue-100 text-blue-700 border-blue-200',
    green:  'bg-green-100 text-green-700 border-green-200',
    yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    red:    'bg-red-100 text-red-700 border-red-200',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
    gray:   'bg-gray-100 text-gray-600 border-gray-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls[color] || cls.gray}`}>
      {children}
    </span>
  )
}

// ─── File Drop Zone ──────────────────────────────────────────────────────────

function FileDropZone({ label, accept, file, onFile, hint, color = 'blue' }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const border = {
    blue:   'border-blue-300 hover:border-blue-400',
    green:  'border-green-300 hover:border-green-400',
  }
  const activeBg = {
    blue:   'bg-blue-50',
    green:  'bg-green-50',
  }

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors cursor-pointer select-none
        ${dragging ? activeBg[color] : 'bg-white'} ${border[color]}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]) }}
      />
      {file ? (
        <div className="space-y-1">
          <p className="text-2xl">📄</p>
          <p className="text-sm font-semibold text-gray-800 truncate max-w-xs mx-auto">{file.name}</p>
          <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-2xl">☁️</p>
          <p className="text-sm font-semibold text-gray-700">{label}</p>
          <p className="text-xs text-gray-400">{hint || 'Drop file here or click to browse (.xlsx, .xls)'}</p>
        </div>
      )}
    </div>
  )
}

// ─── Step card wrapper ────────────────────────────────────────────────────────

function StepCard({ number, title, status, children, locked }) {
  const statusConfig = {
    idle:    { icon: '○', ring: 'ring-gray-200',   bg: 'bg-gray-50',    text: 'text-gray-400',  label: 'Not started' },
    active:  { icon: '▶', ring: 'ring-blue-400',   bg: 'bg-blue-50',    text: 'text-blue-700',  label: 'In progress' },
    done:    { icon: '✅', ring: 'ring-green-400',  bg: 'bg-green-50',   text: 'text-green-700', label: 'Complete' },
    error:   { icon: '❌', ring: 'ring-red-400',    bg: 'bg-red-50',     text: 'text-red-700',   label: 'Error' },
    partial: { icon: '⚠️', ring: 'ring-yellow-400', bg: 'bg-yellow-50',  text: 'text-yellow-700',label: 'Partial' },
  }
  const cfg = statusConfig[status] || statusConfig.idle

  return (
    <div className={`rounded-2xl shadow-sm border overflow-hidden transition-all
      ${locked ? 'opacity-60' : ''}
      ${status === 'active' ? 'ring-2 ring-blue-400 shadow-md' : status === 'done' ? 'ring-1 ring-green-300' : 'ring-1 ring-gray-100'}`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-5 py-4 ${cfg.bg} border-b border-gray-100`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ring-2 ${cfg.ring} bg-white`}>
          {cfg.icon === '○' ? number : cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800">Step {number}: {title}</p>
        </div>
        <Badge color={
          status === 'done' ? 'green' : status === 'active' ? 'blue' :
          status === 'error' ? 'red' : status === 'partial' ? 'yellow' : 'gray'
        }>
          {cfg.label}
        </Badge>
      </div>
      {/* Body */}
      {!locked && (
        <div className="bg-white p-5">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Stat grid ────────────────────────────────────────────────────────────────

function StatGrid({ stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
      {stats.map(({ label, value, color }) => (
        <div key={label} className={`rounded-xl p-3 ${
          color === 'blue'   ? 'bg-blue-50 border border-blue-100' :
          color === 'green'  ? 'bg-green-50 border border-green-100' :
          color === 'red'    ? 'bg-red-50 border border-red-100' :
          color === 'purple' ? 'bg-purple-50 border border-purple-100' :
          'bg-gray-50 border border-gray-100'
        }`}>
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className={`text-xl font-bold mt-1 ${
            color === 'blue' ? 'text-blue-700' :
            color === 'green' ? 'text-green-700' :
            color === 'red' ? 'text-red-700' :
            color === 'purple' ? 'text-purple-700' :
            'text-gray-700'
          }`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Payload preview table ───────────────────────────────────────────────────

function PayloadTable({ payloads, label, color = 'blue' }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? payloads : payloads.slice(0, 8)
  if (payloads.length === 0) return null

  return (
    <div className="mt-3">
      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
        color === 'blue' ? 'text-blue-600' : color === 'green' ? 'text-green-600' : 'text-gray-600'
      }`}>{label} ({payloads.length})</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Payment Type</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Est. Amount</th>
              <th className="px-3 py-2 text-left">Cross Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((p, i) => {
              const totalAmt = (p.receivablesInvoiceLines || []).reduce(
                (s, l) => s + (parseFloat(l.Quantity) || 0) * (parseFloat(l.UnitSellingPrice) || 0), 0
              )
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium text-gray-800 max-w-[180px] truncate">{p.BillToCustomerName || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{p.TransactionDate || '—'}</td>
                  <td className="px-3 py-1.5">
                    <Badge color={
                      (p.Comments || '').includes('Tabby') ? 'purple' :
                      (p.Comments || '').includes('Tamara') ? 'yellow' : 'blue'
                    }>
                      {(p.Comments || '').includes('Tabby') ? 'Tabby' :
                       (p.Comments || '').includes('Tamara') ? 'Tamara' : 'Normal'}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right">{(p.receivablesInvoiceLines || []).length}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${totalAmt < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                    {fmt(totalAmt)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-400 font-mono">{p.CrossReference || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {payloads.length > 8 && (
          <div className="p-2 text-center border-t border-gray-100">
            <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 hover:underline">
              {showAll ? 'Show fewer' : `Show all ${payloads.length}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Creation results table ──────────────────────────────────────────────────

function InvoiceResultsTable({ results }) {
  const [showAll, setShowAll] = useState(false)
  if (!results || results.length === 0) return null
  const visible = showAll ? results : results.slice(0, 10)

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Customer</th>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Txn #</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visible.map((r) => (
            <tr key={r.index} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 text-gray-400">{r.index + 1}</td>
              <td className="px-3 py-1.5 font-medium text-gray-800 max-w-[200px] truncate">{r.customerName || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500">{r.date || '—'}</td>
              <td className="px-3 py-1.5 font-mono font-semibold text-blue-700">{r.txnNumber || '—'}</td>
              <td className="px-3 py-1.5">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  r.status === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {r.status === 'SUCCESS' ? '✓ Created' : `✗ ${r.message?.slice(0, 40) || 'Failed'}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.length > 10 && (
        <div className="p-2 text-center border-t border-gray-100">
          <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 hover:underline">
            {showAll ? 'Show fewer' : `Show all ${results.length}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Receipt payload table ────────────────────────────────────────────────────

function ReceiptPayloadsTable({ payloads, label, color = 'green', columns }) {
  const [showAll, setShowAll] = useState(false)
  if (!payloads || payloads.length === 0) return null
  const visible = showAll ? payloads : payloads.slice(0, 8)

  return (
    <div className="mt-3">
      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
        color === 'green' ? 'text-green-600' : color === 'purple' ? 'text-purple-600' : 'text-gray-600'
      }`}>{label} ({payloads.length})</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-1.5 ${c.right ? 'text-right font-mono' : ''} ${c.mono ? 'font-mono font-semibold' : ''} ${
                    c.colorFn ? c.colorFn(row[c.key]) : ''
                  }`}>
                    {c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {payloads.length > 8 && (
          <div className="p-2 text-center border-t border-gray-100">
            <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 hover:underline">
              {showAll ? 'Show fewer' : `Show all ${payloads.length}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({ onClick, disabled, loading, children, color = 'blue', size = 'md' }) {
  const colors = {
    blue:   'bg-blue-600 hover:bg-blue-700 text-white',
    green:  'bg-green-600 hover:bg-green-700 text-white',
    purple: 'bg-purple-600 hover:bg-purple-700 text-white',
    orange: 'bg-orange-600 hover:bg-orange-700 text-white',
    gray:   'bg-gray-200 hover:bg-gray-300 text-gray-700',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center gap-2 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed
        ${colors[color] || colors.blue} ${sizes[size] || sizes.md}`}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ done, total, label }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span>{done}/{total} ({pct}%)</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-2 bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Apply Receipt component
// ─────────────────────────────────────────────────────────────────────────────

function ApplyReceiptPanel({ onDone }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [applyError, setApplyError] = useState('')
  const [activeUploadId, setActiveUploadId] = useState(null)

  const { data: pendingData, isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['arPipelinePendingApply'],
    queryFn:  () => api.get('/ar-pipeline/pending-apply').then((r) => r.data),
    refetchInterval: 0,
  })

  const { data: progressData } = useQuery({
    queryKey: ['arPipelineApplyProgress', activeUploadId],
    queryFn:  () => api.get(`/apply-receipt/uploads/${activeUploadId}/progress`).then((r) => r.data),
    enabled:  !!activeUploadId,
    refetchInterval: activeUploadId ? 2000 : false,
  })

  useEffect(() => {
    if (!progressData || !activeUploadId) return
    const { status } = progressData
    if (['SUCCESS', 'FAILED', 'PARTIAL'].includes(status)) {
      setSubmitResult(progressData)
      setSubmitting(false)
      setActiveUploadId(null)
      queryClient.invalidateQueries({ queryKey: ['arPipelinePendingApply'] })
      refetchPending()
      onDone?.()
    }
  }, [progressData, activeUploadId, queryClient, refetchPending, onDone])

  const pairs = pendingData?.pendingPairs ?? []
  const grouped = {}
  pairs.forEach((p, i) => {
    const k = `${p.store || 'Unknown'}__${p.txnDate || 'Unknown'}`
    if (!grouped[k]) grouped[k] = { store: p.store, date: p.txnDate, pairs: [] }
    grouped[k].pairs.push({ ...p, index: i })
  })

  const toggleAll = () => {
    if (selected.size === pairs.length) setSelected(new Set())
    else setSelected(new Set(pairs.map((_, i) => i)))
  }
  const toggleOne = (i) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i) else next.add(i)
      return next
    })
  }

  const handleApply = async () => {
    if (selected.size === 0) { setApplyError('Select at least one pair.'); return }
    setApplyError('')
    setSubmitting(true)
    setSubmitResult(null)
    const chosenPairs = [...selected].map(i => ({
      txnNumber:     pairs[i].txnNumber,
      receiptNumber: pairs[i].receiptNumber,
    }))
    try {
      const res = await api.post('/ar-pipeline/submit-apply', { pairs: chosenPairs })
      setActiveUploadId(res.data.uploadId)
    } catch (err) {
      setApplyError(err.response?.data?.error || 'Submission failed.')
      setSubmitting(false)
    }
  }

  const processed = progressData ? progressData.successCount + progressData.failureCount : 0
  const total = progressData ? progressData.totalReceipts : 0

  return (
    <div className="space-y-4">
      {/* Info */}
      <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 text-sm text-orange-800 text-xs space-y-1">
        <p className="font-semibold text-orange-700">Automated matching based on receipt number pattern</p>
        <p>Standard receipts named <code className="bg-white px-1 rounded">Method-TxnNumber</code> (e.g. <code className="bg-white px-1 rounded">Mada-2912269</code>) are auto-matched to their invoices. Already-applied pairs are excluded.</p>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2 items-center">
        <StatusChip count={pairs.length} label="pending pairs" color={pairs.length > 0 ? 'yellow' : 'green'} />
        <StatusChip count={selected.size} label="selected" color="blue" />
        {submitResult && <>
          <StatusChip count={submitResult.successCount} label="applied ✓" color="green" />
          <StatusChip count={submitResult.failureCount} label="failed" color="red" />
        </>}
        <button onClick={() => refetchPending()} className="ml-auto text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1">
          ↺ Refresh
        </button>
      </div>

      {/* Progress while submitting */}
      {submitting && activeUploadId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <p className="text-sm font-medium text-blue-700">Applying receipts…</p>
          </div>
          <ProgressBar done={processed} total={total} label="Progress" />
        </div>
      )}

      {/* Result */}
      {submitResult && !submitting && (
        <div className={`rounded-lg border p-4 text-sm ${
          submitResult.status === 'SUCCESS' ? 'bg-green-50 border-green-200' :
          submitResult.status === 'PARTIAL'  ? 'bg-yellow-50 border-yellow-200' :
          'bg-red-50 border-red-200'
        }`}>
          <p className={`font-semibold ${
            submitResult.status === 'SUCCESS' ? 'text-green-700' :
            submitResult.status === 'PARTIAL'  ? 'text-yellow-700' : 'text-red-700'
          }`}>
            {submitResult.status === 'SUCCESS' ? '✅ All applied successfully' :
             submitResult.status === 'PARTIAL'  ? '⚠️ Partially applied' : '❌ Apply failed'}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            {submitResult.successCount} succeeded · {submitResult.failureCount} failed
          </p>
          {submitResult.uploadId && (
            <Link to={`/receipt-upload/apply/${submitResult.uploadId}`} className="text-blue-600 hover:underline text-xs mt-1 inline-block">
              View detailed results →
            </Link>
          )}
        </div>
      )}

      <ErrorAlert message={applyError} onDismiss={() => setApplyError('')} />

      {pendingLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm font-semibold text-green-700">All receipts applied — nothing pending!</p>
          <p className="text-xs text-gray-400 mt-1">Create receipts in Step 2 first, then come back to apply.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline" disabled={submitting}>
              {selected.size === pairs.length ? 'Deselect All' : 'Select All'}
            </button>
            <ActionBtn onClick={handleApply} loading={submitting} disabled={selected.size === 0} color="orange">
              ⚡ Apply {selected.size} Selected
            </ActionBtn>
          </div>
          {Object.values(grouped).map(({ store, date, pairs: gp }) => (
            <div key={`${store}__${date}`} className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-800">🏪 {store || 'Unknown'}</span>
                <span className="text-xs text-gray-500">📅 {date || '—'}</span>
                <span className="ml-auto"><StatusChip count={gp.length} label="pairs" color="blue" /></span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-white text-gray-500 uppercase border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 w-8 text-left">
                      <input type="checkbox"
                        checked={gp.every(p => selected.has(p.index))}
                        onChange={() => {
                          const allIn = gp.every(p => selected.has(p.index))
                          setSelected(prev => {
                            const next = new Set(prev)
                            gp.forEach(p => allIn ? next.delete(p.index) : next.add(p.index))
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
                  {gp.map(({ index, txnNumber, receiptNumber, amount }) => (
                    <tr key={index}
                      className={`hover:bg-gray-50 cursor-pointer ${selected.has(index) ? 'bg-orange-50' : ''}`}
                      onClick={() => toggleOne(index)}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={selected.has(index)}
                          onChange={() => toggleOne(index)}
                          onClick={e => e.stopPropagation()} className="rounded" />
                      </td>
                      <td className="px-3 py-1.5 font-mono font-semibold text-blue-700">{txnNumber}</td>
                      <td className="px-3 py-1.5 font-mono text-green-700">{receiptNumber}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmt(amount)}</td>
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function ArPipelinePage() {
  const queryClient = useQueryClient()

  // ── Files ──────────────────────────────────────────────────────────────────
  const [paymentFile, setPaymentFile] = useState(null)
  const [salesFile, setSalesFile] = useState(null)

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [s1, setS1] = useState({
    status: 'idle', // idle | generating | generated | creating | done | error
    payloads: null,        // { positivePayloads, negativePayloads, stats }
    createResults: null,   // { total, successCount, failureCount, results }
    error: '',
  })

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [s2, setS2] = useState({
    status: 'idle', // idle | generating | generated | creating-std | creating-misc | done | error
    batch: null,            // { batchId, standardPayloads, miscPayloads, warnings }
    stdResults: null,
    miscResults: null,
    error: '',
  })

  // ─── Summary from DB (counts only) ────────────────────────────────────────
  const { data: summaryData, refetch: refetchSummary } = useQuery({
    queryKey: ['arPipelineSummaryFull'],
    queryFn:  () => api.get('/ar-pipeline/summary').then((r) => r.data),
    refetchInterval: 0,
  })

  // ─── Derived flags ────────────────────────────────────────────────────────
  const filesReady       = !!(paymentFile && salesFile)
  const invoicesCreated  = s1.status === 'done' || s1.status === 'partial'
  const step2Unlocked    = s1.status === 'done' || s1.status === 'partial' || s1.status === 'generated' || s1.status === 'error'

  // derive step statuses for StepCard
  const step1Status = s1.status === 'idle' ? 'idle'
    : s1.status === 'generating' || s1.status === 'creating' ? 'active'
    : s1.status === 'generated' ? 'active'
    : s1.status === 'done' ? 'done'
    : s1.status === 'partial' ? 'partial'
    : 'error'

  const step2Status = s2.status === 'idle' ? 'idle'
    : s2.status.startsWith('creating') || s2.status === 'generating' ? 'active'
    : s2.status === 'generated' ? 'active'
    : s2.status === 'done' ? 'done'
    : s2.status === 'partial' ? 'partial'
    : s2.status === 'error' ? 'error'
    : 'idle'

  // ─── All combined payloads for step 1 ────────────────────────────────────
  const allInvoicePayloads = s1.payloads
    ? [...(s1.payloads.positivePayloads || []), ...(s1.payloads.negativePayloads || [])]
    : []

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1 handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleGenerateInvoices = async () => {
    if (!filesReady) return
    setS1({ status: 'generating', payloads: null, createResults: null, error: '' })
    const fd = new FormData()
    fd.append('paymentLines', paymentFile)
    fd.append('salesLines', salesFile)
    try {
      const res = await api.post('/vend-invoice/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setS1(prev => ({ ...prev, status: 'generated', payloads: res.data, error: '' }))
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to generate invoice payloads.'
      setS1(prev => ({ ...prev, status: 'error', error: msg }))
    }
  }

  const handleCreateInvoices = async () => {
    if (!allInvoicePayloads.length) return
    setS1(prev => ({ ...prev, status: 'creating', createResults: null, error: '' }))
    try {
      const res = await api.post('/ar-pipeline/create-invoice-batch', {
        payloads: allInvoicePayloads,
      })
      const { total, successCount, failureCount, results } = res.data
      const newStatus = failureCount === 0 ? 'done' : successCount === 0 ? 'error' : 'partial'
      setS1(prev => ({
        ...prev,
        status: newStatus,
        createResults: { total, successCount, failureCount, results },
        error: failureCount > 0 && successCount === 0 ? `All ${failureCount} invoices failed.` : '',
      }))
      refetchSummary()
      queryClient.invalidateQueries({ queryKey: ['arPipelinePendingApply'] })
    } catch (err) {
      const msg = err.response?.data?.error || 'Batch invoice creation failed.'
      setS1(prev => ({ ...prev, status: 'error', error: msg }))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2 handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleGenerateReceipts = async () => {
    if (!paymentFile) return
    setS2({ status: 'generating', batch: null, stdResults: null, miscResults: null, error: '' })
    const fd = new FormData()
    fd.append('paymentLines', paymentFile)
    fd.append('region', 'SA')
    try {
      const res = await api.post('/vend-receipt/generate', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setS2(prev => ({ ...prev, status: 'generated', batch: res.data, error: '' }))
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to generate receipt payloads.'
      setS2(prev => ({ ...prev, status: 'error', error: msg }))
    }
  }

  // step 2 combined: create std + misc in sequence
  const handleCreateReceipts = async () => {
    if (!s2.batch) return
    setS2(prev => ({ ...prev, status: 'creating-std', stdResults: null, miscResults: null, error: '' }))

    let stdRes = null
    if (s2.batch.standardPayloads?.length) {
      try {
        const res = await api.post('/vend-receipt/submit-standard', {
          batchId:  s2.batch.batchId,
          payloads: s2.batch.standardPayloads,
        })
        stdRes = res.data
        refetchSummary()
      } catch (err) {
        const msg = err.response?.data?.error || 'Standard receipt creation failed.'
        setS2(prev => ({ ...prev, status: 'error', stdResults: null, error: msg }))
        return
      }
    }

    let miscRes = null
    if (s2.batch.miscPayloads?.length) {
      setS2(prev => ({ ...prev, status: 'creating-misc', stdResults: stdRes }))
      try {
        const res = await api.post('/vend-receipt/submit-misc', {
          batchId:  s2.batch.batchId,
          payloads: s2.batch.miscPayloads,
        })
        miscRes = res.data
        refetchSummary()
        queryClient.invalidateQueries({ queryKey: ['arPipelinePendingApply'] })
      } catch (err) {
        const msg = err.response?.data?.error || 'Misc receipt creation failed.'
        setS2(prev => ({ ...prev, status: 'error', stdResults: stdRes, error: msg }))
        return
      }
    }

    const hasError = (stdRes && stdRes.failureCount > 0) || (miscRes && miscRes.failureCount > 0)
    const allFailed = (!stdRes || stdRes.successCount === 0) && (!miscRes || miscRes.successCount === 0)
    setS2(prev => ({
      ...prev,
      status: allFailed ? 'error' : hasError ? 'partial' : 'done',
      stdResults: stdRes,
      miscResults: miscRes,
      error: '',
    }))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pipeline DB Summary bar
  // ─────────────────────────────────────────────────────────────────────────

  const dbStats = [
    { label: 'AR Invoices', value: summaryData?.invoiceCount ?? '…', color: 'blue',   icon: '📄' },
    { label: 'Std Receipts', value: summaryData?.standardReceiptCount ?? '…', color: 'green', icon: '💳' },
    { label: 'Misc Receipts', value: summaryData?.miscReceiptCount ?? '…', color: 'purple', icon: '🧾' },
    { label: 'Applied',      value: summaryData?.appliedCount ?? '…', color: 'orange', icon: '⚡' },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          🔄 AR Pipeline
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Complete end-to-end AR workflow — upload two files and process every step from this single page.
        </p>
      </div>

      {/* ── DB Summary bar ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {dbStats.map(({ label, value, color, icon }) => (
          <div key={label} className={`rounded-xl border p-4 ${
            color === 'blue'   ? 'bg-blue-50 border-blue-100' :
            color === 'green'  ? 'bg-green-50 border-green-100' :
            color === 'purple' ? 'bg-purple-50 border-purple-100' :
            'bg-orange-50 border-orange-100'
          }`}>
            <p className="text-xs text-gray-500 font-medium">{icon} {label}</p>
            <p className={`text-2xl font-bold mt-1 ${
              color === 'blue' ? 'text-blue-700' :
              color === 'green' ? 'text-green-700' :
              color === 'purple' ? 'text-purple-700' :
              'text-orange-700'
            }`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">in database</p>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FILE UPLOAD PANEL                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <span className="text-xl">📂</span>
          <div>
            <p className="font-bold">Upload Your Files</p>
            <p className="text-xs text-blue-100">These files are used for all steps — upload once, use everywhere</p>
          </div>
          {filesReady && <Badge color="green" className="ml-auto">✓ Files ready</Badge>}
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">1. Payment Lines File <span className="text-red-500">*</span></p>
            <FileDropZone
              label="Drop Payment Lines file"
              hint="YASMEEN Payment Lines.xlsx"
              accept=".xlsx,.xls"
              file={paymentFile}
              onFile={setPaymentFile}
              color="blue"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">2. Sales Lines File <span className="text-red-500">*</span></p>
            <FileDropZone
              label="Drop Sales Lines file"
              hint="YASMEEN Sales Lines.xlsx"
              accept=".xlsx,.xls"
              file={salesFile}
              onFile={setSalesFile}
              color="green"
            />
          </div>
        </div>
        {!filesReady && (
          <div className="px-5 pb-4">
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              ⚠️ Both files are required to generate AR invoice payloads. The payment file alone is enough for receipt generation.
            </p>
          </div>
        )}
        {filesReady && (
          <div className="px-5 pb-4">
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              ✅ Files ready — proceed to Step 1 to generate AR invoice payloads.
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STEP 1: AR INVOICE CREATION                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <StepCard number={1} title="AR Invoice Creation" status={step1Status} locked={false}>
        <div className="space-y-4">

          {/* Info */}
          <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="font-semibold text-blue-700 mb-1">What happens here</p>
            <p>Generates AR Invoice payloads from your uploaded files, grouped by store + date + payment type, then creates them in Oracle Fusion AR. Transaction numbers are stored in the database.</p>
          </div>

          {/* Generate button */}
          <div className="flex flex-wrap items-center gap-3">
            <ActionBtn
              onClick={handleGenerateInvoices}
              loading={s1.status === 'generating'}
              disabled={!filesReady || s1.status === 'creating'}
              color="blue"
            >
              📊 Generate AR Invoice Payloads
            </ActionBtn>
            {s1.payloads && s1.status !== 'generating' && (
              <p className="text-xs text-gray-500">
                {allInvoicePayloads.length} payload{allInvoicePayloads.length !== 1 ? 's' : ''} ready
              </p>
            )}
          </div>

          {/* Error */}
          {s1.error && <ErrorAlert message={s1.error} onDismiss={() => setS1(p => ({ ...p, error: '' }))} />}

          {/* Payload verification */}
          {s1.payloads && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                ✅ Payload Verification
              </div>

              {/* Stats */}
              <StatGrid stats={[
                { label: 'Total Payloads',     value: allInvoicePayloads.length,                       color: 'blue'  },
                { label: 'Positive',           value: s1.payloads.positivePayloads?.length ?? 0,       color: 'green' },
                { label: 'Negative (Returns)', value: s1.payloads.negativePayloads?.length ?? 0,       color: 'red'   },
                { label: 'Sales Lines',        value: s1.payloads.stats?.totalSalesLines ?? 0,         color: 'gray'  },
              ]} />

              {/* Warnings */}
              {s1.payloads.stats?.payloadStats?.some(p => !p.billToCustomerName) && (
                <div className="text-xs bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-yellow-700">
                  ⚠️ Some payloads have missing customer names. Check the Sales Metadata mappings.
                </div>
              )}

              {/* Payload tables */}
              {s1.payloads.positivePayloads?.length > 0 && (
                <PayloadTable payloads={s1.payloads.positivePayloads} label="Positive Invoice Payloads" color="green" />
              )}
              {s1.payloads.negativePayloads?.length > 0 && (
                <PayloadTable payloads={s1.payloads.negativePayloads} label="Negative Invoice Payloads (Returns)" color="blue" />
              )}

              {/* Create button */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
                <ActionBtn
                  onClick={handleCreateInvoices}
                  loading={s1.status === 'creating'}
                  disabled={allInvoicePayloads.length === 0 || s1.status === 'creating'}
                  color="blue"
                  size="lg"
                >
                  🚀 Create {allInvoicePayloads.length} AR Invoice{allInvoicePayloads.length !== 1 ? 's' : ''} in Oracle
                </ActionBtn>
                <p className="text-xs text-gray-400">Sends payloads to Oracle Fusion and stores responses in database</p>
              </div>
            </div>
          )}

          {/* Creation results */}
          {s1.createResults && (
            <div className="space-y-3">
              <div className={`rounded-lg border p-4 text-sm ${
                s1.createResults.failureCount === 0 ? 'bg-green-50 border-green-200' :
                s1.createResults.successCount === 0 ? 'bg-red-50 border-red-200' :
                'bg-yellow-50 border-yellow-200'
              }`}>
                <p className={`font-semibold ${
                  s1.createResults.failureCount === 0 ? 'text-green-700' :
                  s1.createResults.successCount === 0 ? 'text-red-700' : 'text-yellow-700'
                }`}>
                  {s1.createResults.failureCount === 0
                    ? `✅ All ${s1.createResults.successCount} invoices created successfully!`
                    : s1.createResults.successCount === 0
                    ? `❌ All ${s1.createResults.failureCount} invoices failed`
                    : `⚠️ ${s1.createResults.successCount} created, ${s1.createResults.failureCount} failed`}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Transaction numbers are now available for receipt generation → proceed to Step 2.
                </p>
              </div>

              {/* Per-invoice results */}
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Creation Results</div>
              <InvoiceResultsTable results={s1.createResults.results} />
            </div>
          )}
        </div>
      </StepCard>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STEP 2: STANDARD & MISC RECEIPTS                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <StepCard number={2} title="Standard & Misc Receipt Creation" status={step2Status} locked={!step2Unlocked}>
        <div className="space-y-4">

          {/* Info */}
          <div className="text-xs text-gray-500 bg-green-50 border border-green-100 rounded-lg p-3">
            <p className="font-semibold text-green-700 mb-1">What happens here</p>
            <p>Reads the payment file again and matches each payment to the AR Invoice already in the database (by store + date + payment type). Generates Standard and Misc receipt payloads, then creates them in Oracle Fusion.</p>
            {!invoicesCreated && (
              <p className="mt-1 text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                💡 Tip: Complete Step 1 first so new invoices are available. You can also generate receipts for invoices already in the database.
              </p>
            )}
          </div>

          {/* Generate button */}
          <div className="flex flex-wrap items-center gap-3">
            <ActionBtn
              onClick={handleGenerateReceipts}
              loading={s2.status === 'generating'}
              disabled={!paymentFile || s2.status.startsWith('creating')}
              color="green"
            >
              📊 Generate Receipt Payloads
            </ActionBtn>
            {!paymentFile && (
              <p className="text-xs text-red-500">Payment Lines file required (upload above)</p>
            )}
          </div>

          {/* Error */}
          {s2.error && <ErrorAlert message={s2.error} onDismiss={() => setS2(p => ({ ...p, error: '' }))} />}

          {/* Warnings */}
          {s2.batch?.warnings?.length > 0 && (
            <div className="text-xs bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-yellow-700 space-y-1">
              <p className="font-semibold">⚠️ {s2.batch.warnings.length} warning{s2.batch.warnings.length > 1 ? 's' : ''}:</p>
              {s2.batch.warnings.map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}

          {/* Receipt payload verification */}
          {s2.batch && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                ✅ Payload Verification
              </div>

              <StatGrid stats={[
                { label: 'Standard Receipts', value: s2.batch.standardPayloads?.length ?? 0, color: 'green'  },
                { label: 'Misc Receipts',     value: s2.batch.miscPayloads?.length ?? 0,     color: 'purple' },
                { label: 'Total SAR (Std)',
                  value: fmt((s2.batch.standardPayloads || []).reduce((s, r) => s + parseFloat(r.Amount || 0), 0)),
                  color: 'blue' },
                { label: 'Total Misc (Chgs)',
                  value: fmt((s2.batch.miscPayloads || []).reduce((s, r) => s + Math.abs(parseFloat(r.Amount || 0)), 0)),
                  color: 'gray' },
              ]} />

              {/* Standard receipt payloads table */}
              <ReceiptPayloadsTable
                payloads={s2.batch.standardPayloads}
                label="Standard Receipt Payloads"
                color="green"
                columns={[
                  { key: 'ReceiptNumber',   label: 'Receipt #',       mono: true },
                  { key: 'ReceiptDate',     label: 'Date' },
                  { key: 'ReceiptMethod',   label: 'Method' },
                  { key: 'BusinessUnit',    label: 'BU' },
                  { key: 'Amount',          label: 'Amount (SAR)',    right: true, fmt: fmt },
                  { key: 'Currency',        label: 'CCY' },
                ]}
              />

              {/* Misc receipt payloads table */}
              <ReceiptPayloadsTable
                payloads={s2.batch.miscPayloads}
                label="Misc Receipt Payloads (Bank Charges)"
                color="purple"
                columns={[
                  { key: 'ReceiptNumber',          label: 'Receipt #',  mono: true },
                  { key: 'ReceiptDate',             label: 'Date' },
                  { key: 'ReceiptMethodName',       label: 'Method' },
                  { key: 'ReceivableActivityName',  label: 'Activity' },
                  { key: 'Amount',                  label: 'Amount',     right: true, fmt: fmt,
                    colorFn: (v) => parseFloat(v) < 0 ? 'text-red-600' : '' },
                  { key: 'BankAccountNumber',       label: 'Bank Acc' },
                ]}
              />

              {/* Create receipts button */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
                <ActionBtn
                  onClick={handleCreateReceipts}
                  loading={s2.status === 'creating-std' || s2.status === 'creating-misc'}
                  disabled={
                    (!s2.batch.standardPayloads?.length && !s2.batch.miscPayloads?.length) ||
                    s2.status === 'creating-std' || s2.status === 'creating-misc'
                  }
                  color="green"
                  size="lg"
                >
                  🚀 Create All Receipts in Oracle
                </ActionBtn>
                {(s2.status === 'creating-std' || s2.status === 'creating-misc') && (
                  <p className="text-xs text-gray-500">
                    {s2.status === 'creating-std' ? 'Creating standard receipts…' : 'Creating misc receipts…'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Results */}
          {(s2.stdResults || s2.miscResults) && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Creation Results</div>

              {s2.stdResults && (
                <div className={`rounded-lg border p-3 text-xs ${
                  s2.stdResults.failureCount === 0 ? 'bg-green-50 border-green-200 text-green-700' :
                  s2.stdResults.successCount === 0 ? 'bg-red-50 border-red-200 text-red-700' :
                  'bg-yellow-50 border-yellow-200 text-yellow-700'
                }`}>
                  <p className="font-semibold">Standard Receipts: {s2.stdResults.successCount} ✓ · {s2.stdResults.failureCount} ✗ of {s2.stdResults.total}</p>
                </div>
              )}

              {s2.miscResults && (
                <div className={`rounded-lg border p-3 text-xs ${
                  s2.miscResults.failureCount === 0 ? 'bg-green-50 border-green-200 text-green-700' :
                  s2.miscResults.successCount === 0 ? 'bg-red-50 border-red-200 text-red-700' :
                  'bg-yellow-50 border-yellow-200 text-yellow-700'
                }`}>
                  <p className="font-semibold">Misc Receipts: {s2.miscResults.successCount} ✓ · {s2.miscResults.failureCount} ✗ of {s2.miscResults.total}</p>
                </div>
              )}

              {(s2.status === 'done' || s2.status === 'partial') && (
                <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
                  {s2.status === 'done'
                    ? '✅ Receipts created. Proceed to Step 3 to apply receipts to invoices.'
                    : '⚠️ Some receipts failed. Review above and retry if needed, then proceed to Step 3.'}
                </div>
              )}
            </div>
          )}
        </div>
      </StepCard>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STEP 3: APPLY RECEIPTS                                             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <StepCard number={3} title="Apply Receipts" status="idle" locked={false}>
        <div className="space-y-4">
          <div className="text-xs text-gray-500 bg-orange-50 border border-orange-100 rounded-lg p-3">
            <p className="font-semibold text-orange-700 mb-1">What happens here</p>
            <p>Automatically reads transaction numbers from the invoice table and receipt numbers from the receipt table, builds apply-receipt payloads, verifies them, and applies them in Oracle via SOAP. All results are stored in <code className="bg-white px-1 rounded">FusionApplyReceipt</code>.</p>
          </div>
          <ApplyReceiptPanel onDone={refetchSummary} />
        </div>
      </StepCard>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PIPELINE HISTORY SUMMARY (from DB)                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {summaryData?.grouped && summaryData.grouped.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">📋 Pipeline History — Store &amp; Date Summary</h2>
            <p className="text-xs text-gray-400 mt-0.5">Status of all AR data stored in the database</p>
          </div>
          <div className="p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Store</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Invoices</th>
                  <th className="px-4 py-2 text-right">Receipts Matched</th>
                  <th className="px-4 py-2 text-right">Pending Apply</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
