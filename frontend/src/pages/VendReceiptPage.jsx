/**
 * Vend Receipt Page.
 *
 * Allows users to upload a Vend Payment Lines Excel file, generate
 * Standard Receipt and Misc Receipt payloads from matched AR Invoices,
 * preview them, and submit to Oracle Fusion.
 *
 * Standard Receipt  → Oracle REST  (ORACLE_STANDARD_RECEIPT_API_URL)
 * Misc Receipt      → Oracle SOAP  (ORACLE_SOAP_URL)
 *
 * Receipt number conventions:
 *   Standard : {PaymentMethod}-{InvoiceNumber}       e.g. Mada-2912269
 *   Misc     : {PaymentMethod}-{InvoiceNumber}-MISC   e.g. Mada-2912269-MISC
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const REGIONS = ['SA', 'KW', 'BH', 'AE', 'OM', 'SN']

// Maximum number of receipt payloads sent in a single API call.
// Splitting large batches into chunks prevents HTTP gateway timeouts
// (mirrors ORACLE_INVOICE_LINE_CHUNK_SIZE used for AR/Vend invoices).
const RECEIPT_CHUNK_SIZE = parseInt(import.meta.env.VITE_RECEIPT_CHUNK_SIZE, 10) || 50

function fmt(n) {
  if (n == null || n === '') return '—'
  const num = parseFloat(n)
  if (isNaN(num)) return String(n)
  return num.toLocaleString('en-SA', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function StatusBadge({ status }) {
  const map = {
    GENERATED:  'bg-blue-100 text-blue-700',
    DONE:       'bg-green-100 text-green-700',
    PARTIAL:    'bg-yellow-100 text-yellow-700',
    FAILED:     'bg-red-100 text-red-700',
    SUBMITTING: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function PayloadTable({ rows, type }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-gray-500 italic">None generated.</p>

  const isStandard = type === 'standard'

  return (
    <div className="overflow-x-auto rounded border border-gray-200 max-h-96">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-gray-600 uppercase sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Receipt Number</th>
            <th className="px-3 py-2 text-left">Method</th>
            <th className="px-3 py-2 text-left">Date</th>
            {isStandard ? (
              <>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Business Unit</th>
                <th className="px-3 py-2 text-left">Cust Account</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2 text-right">Misc Amount</th>
                <th className="px-3 py-2 text-left">Activity</th>
                <th className="px-3 py-2 text-left">Bank Account</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 text-gray-500">{i + 1}</td>
              <td className="px-3 py-1.5 font-mono font-semibold text-blue-700">{r.ReceiptNumber}</td>
              <td className="px-3 py-1.5">{isStandard ? r.ReceiptMethod : r.ReceiptMethodName}</td>
              <td className="px-3 py-1.5">{r.ReceiptDate}</td>
              {isStandard ? (
                <>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(r.Amount)}</td>
                  <td className="px-3 py-1.5 truncate max-w-xs">{r.BusinessUnit}</td>
                  <td className="px-3 py-1.5">{r.CustomerAccountNumber}</td>
                </>
              ) : (
                <>
                  <td className={`px-3 py-1.5 text-right font-mono ${parseFloat(r.Amount) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {fmt(r.Amount)}
                  </td>
                  <td className="px-3 py-1.5">{r.ReceivableActivityName}</td>
                  <td className="px-3 py-1.5 truncate max-w-xs text-gray-500">{r.BankAccountNumber || '—'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function VendReceiptPage() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [region, setRegion] = useState('SA')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [submittingStd, setSubmittingStd] = useState(false)
  const [submittingMisc, setSubmittingMisc] = useState(false)
  const [stdChunkProgress, setStdChunkProgress] = useState(null)   // { current, total }
  const [miscChunkProgress, setMiscChunkProgress] = useState(null) // { current, total }
  const [submitResultStd, setSubmitResultStd] = useState(null)
  const [submitResultMisc, setSubmitResultMisc] = useState(null)
  const [activeTab, setActiveTab] = useState('standard')

  // History
  const { data: batchesData, isLoading: batchesLoading } = useQuery({
    queryKey: ['vendReceiptBatches'],
    queryFn: () => api.get('/vend-receipt/batches').then((r) => r.data),
  })

  const handleGenerate = async () => {
    if (!file) { setError('Please select a Payment Lines Excel file.'); return }
    setError('')
    setResult(null)
    setSubmitResultStd(null)
    setSubmitResultMisc(null)
    setGenerating(true)

    const formData = new FormData()
    formData.append('paymentLines', file)
    formData.append('region', region)

    try {
      const res = await api.post('/vend-receipt/generate', formData)
      setResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['vendReceiptBatches'] })
    } catch (err) {
      setError(err.response?.data?.error || 'Generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  const handleSubmitStandard = async () => {
    if (!result?.standardPayloads?.length) return
    setError('')
    setSubmitResultStd(null)
    setStdChunkProgress(null)
    setSubmittingStd(true)

    const payloads = result.standardPayloads
    const totalChunks = Math.ceil(payloads.length / RECEIPT_CHUNK_SIZE)

    // Aggregated totals across all chunks
    let totalSuccess = 0
    let totalFailure = 0
    let totalSkip = 0
    let totalTime = 0
    const allLogs = []

    try {
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        setStdChunkProgress({ current: chunkIdx + 1, total: totalChunks })
        const chunk = payloads.slice(chunkIdx * RECEIPT_CHUNK_SIZE, (chunkIdx + 1) * RECEIPT_CHUNK_SIZE)
        const res = await api.post('/vend-receipt/submit-standard', {
          batchId: result.batchId,
          payloads: chunk,
        })
        totalSuccess += res.data.successCount ?? 0
        totalFailure += res.data.failureCount ?? 0
        totalSkip    += res.data.skipCount    ?? 0
        totalTime    += res.data.processingTimeSeconds ?? 0
        if (res.data.logs?.length) allLogs.push(...res.data.logs)
      }

      setSubmitResultStd({
        successCount: totalSuccess,
        failureCount: totalFailure,
        skipCount: totalSkip,
        processingTimeSeconds: parseFloat(totalTime.toFixed(2)),
        logs: allLogs,
      })
      queryClient.invalidateQueries({ queryKey: ['vendReceiptBatches'] })
    } catch (err) {
      setError(err.response?.data?.error || 'Standard receipt submission failed.')
    } finally {
      setSubmittingStd(false)
      setStdChunkProgress(null)
    }
  }

  const handleSubmitMisc = async () => {
    if (!result?.miscPayloads?.length) return
    setError('')
    setSubmitResultMisc(null)
    setMiscChunkProgress(null)
    setSubmittingMisc(true)

    const payloads = result.miscPayloads
    const totalChunks = Math.ceil(payloads.length / RECEIPT_CHUNK_SIZE)

    let totalSuccess = 0
    let totalFailure = 0
    let totalTime = 0
    const allLogs = []

    try {
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        setMiscChunkProgress({ current: chunkIdx + 1, total: totalChunks })
        const chunk = payloads.slice(chunkIdx * RECEIPT_CHUNK_SIZE, (chunkIdx + 1) * RECEIPT_CHUNK_SIZE)
        const res = await api.post('/vend-receipt/submit-misc', {
          batchId: result.batchId,
          payloads: chunk,
        })
        totalSuccess += res.data.successCount ?? 0
        totalFailure += res.data.failureCount ?? 0
        totalTime    += res.data.processingTimeSeconds ?? 0
        if (res.data.logs?.length) allLogs.push(...res.data.logs)
      }

      setSubmitResultMisc({
        successCount: totalSuccess,
        failureCount: totalFailure,
        processingTimeSeconds: parseFloat(totalTime.toFixed(2)),
        logs: allLogs,
      })
      queryClient.invalidateQueries({ queryKey: ['vendReceiptBatches'] })
    } catch (err) {
      setError(err.response?.data?.error || 'Misc receipt submission failed.')
    } finally {
      setSubmittingMisc(false)
      setMiscChunkProgress(null)
    }
  }

  const handleCopyJson = (data) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    alert('Copied to clipboard!')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Vend Receipt Generation</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload Payment Lines → match AR Invoices → generate Standard &amp; Misc receipts
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/vend-receipt/data" className="text-sm text-blue-600 hover:underline">
            📋 View Receipt Tables
          </Link>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold">How it works:</p>
        <ul className="list-disc ml-5 space-y-0.5">
          <li>Upload a Vend <strong>Payment Lines</strong> Excel file (same format as Vend Invoice)</li>
          <li>Payments are grouped by <strong>Date × Store × Payment Type</strong></li>
          <li>Each group is matched to an existing AR Invoice in the database by store + date</li>
          <li><strong>Standard Receipt</strong>: one per payment method (not Tabby/Tamara) — amount = Σ payment amounts</li>
          <li><strong>Misc Receipt</strong>: one per non-cash method — amount = −(payment × bankCharge × (1 + tax))</li>
          <li>Cash Rounding misc: amount = −payment.amount</li>
        </ul>
      </div>

      {/* Upload form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-700">Generate Receipt Payloads</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* File input */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Lines Excel File (.xlsx / .xls)
            </label>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
              onClick={() => document.getElementById('payment-lines-input').click()}
            >
              <input
                id="payment-lines-input"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files[0])}
              />
              {file ? (
                <div>
                  <p className="text-green-700 font-medium">📄 {file.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-gray-500">
                  <p className="text-3xl mb-2">📂</p>
                  <p className="font-medium">Click or drag &amp; drop</p>
                  <p className="text-xs mt-1">Payment Lines Excel file (.xlsx / .xls)</p>
                </div>
              )}
            </div>
          </div>

          {/* Region selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Used to look up bank charges &amp; tax rates from receipt method table.
            </p>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleGenerate}
            disabled={!file || generating}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {generating ? <><Spinner size="sm" /> Generating…</> : '⚡ Generate Payloads'}
          </button>
          {file && (
            <button onClick={() => { setFile(null); setResult(null) }} className="text-sm text-gray-500 hover:text-gray-700">
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {error && <ErrorAlert message={error} />}

      {/* Generated payloads */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          {/* Summary bar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-700">
                Generated Payloads
                <span className="ml-2 text-sm font-normal text-gray-500">(Batch #{result.batchId})</span>
              </h2>
              <div className="flex gap-4 mt-1">
                <span className="text-sm text-blue-700 font-medium">
                  💳 {result.totalStandard} Standard Receipts
                </span>
                <span className="text-sm text-orange-700 font-medium">
                  🧾 {result.totalMisc} Misc Receipts
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleCopyJson({ standard: result.standardPayloads, misc: result.miscPayloads })}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg"
              >
                📋 Copy All JSON
              </button>
            </div>
          </div>

          {/* Warnings */}
          {result.warnings?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-yellow-800 mb-1">⚠️ Warnings ({result.warnings.length})</p>
              <ul className="text-xs text-yellow-700 space-y-0.5 list-disc ml-4">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="flex gap-1">
              {[
                { key: 'standard', label: `💳 Standard (${result.totalStandard})` },
                { key: 'misc', label: `🧾 Misc (${result.totalMisc})` },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {/* Standard receipt tab */}
          {activeTab === 'standard' && (
            <div className="space-y-3">
              <PayloadTable rows={result.standardPayloads} type="standard" />

              {/* Submit result */}
              {submitResultStd && (
                <div className={`rounded-lg p-3 text-sm ${submitResultStd.failureCount === 0 ? 'bg-green-50 border border-green-200' : submitResultStd.successCount === 0 ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <p className="font-semibold">
                    Oracle Response: {submitResultStd.successCount} succeeded, {submitResultStd.failureCount} failed
                    <span className="ml-2 font-normal text-gray-500">({submitResultStd.processingTimeSeconds}s)</span>
                  </p>
                  {submitResultStd.logs?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer text-gray-600">View logs</summary>
                      <pre className="text-xs mt-1 overflow-x-auto whitespace-pre-wrap">
                        {submitResultStd.logs.join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleSubmitStandard}
                  disabled={!result.standardPayloads?.length || submittingStd}
                  className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submittingStd
                    ? <><Spinner size="sm" /> {stdChunkProgress && stdChunkProgress.total > 1
                        ? `Chunk ${stdChunkProgress.current}/${stdChunkProgress.total}…`
                        : 'Submitting…'
                      }</>
                    : '🚀 Submit Standard Receipts to Oracle'}
                </button>
                <button
                  onClick={() => handleCopyJson(result.standardPayloads)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg"
                >
                  📋 Copy JSON
                </button>
              </div>
            </div>
          )}

          {/* Misc receipt tab */}
          {activeTab === 'misc' && (
            <div className="space-y-3">
              <PayloadTable rows={result.miscPayloads} type="misc" />

              {/* Submit result */}
              {submitResultMisc && (
                <div className={`rounded-lg p-3 text-sm ${submitResultMisc.failureCount === 0 ? 'bg-green-50 border border-green-200' : submitResultMisc.successCount === 0 ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <p className="font-semibold">
                    Oracle Response: {submitResultMisc.successCount} succeeded, {submitResultMisc.failureCount} failed
                    <span className="ml-2 font-normal text-gray-500">({submitResultMisc.processingTimeSeconds}s)</span>
                  </p>
                  {submitResultMisc.logs?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer text-gray-600">View logs</summary>
                      <pre className="text-xs mt-1 overflow-x-auto whitespace-pre-wrap">
                        {submitResultMisc.logs.join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleSubmitMisc}
                  disabled={!result.miscPayloads?.length || submittingMisc}
                  className="bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submittingMisc
                    ? <><Spinner size="sm" /> {miscChunkProgress && miscChunkProgress.total > 1
                        ? `Chunk ${miscChunkProgress.current}/${miscChunkProgress.total}…`
                        : 'Submitting…'
                      }</>
                    : '🚀 Submit Misc Receipts to Oracle'}
                </button>
                <button
                  onClick={() => handleCopyJson(result.miscPayloads)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg"
                >
                  📋 Copy JSON
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Batch history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Generation History</h2>

        {batchesLoading ? (
          <Spinner />
        ) : !batchesData?.batches?.length ? (
          <p className="text-sm text-gray-500 italic">No batches yet. Upload a Payment Lines file to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2 text-center">Standard</th>
                  <th className="px-3 py-2 text-center">Misc</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batchesData.batches.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">#{b.id}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-gray-700">{b.filename}</td>
                    <td className="px-3 py-2 text-gray-600">{b.region}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-green-700 font-medium">{b.successStandard}</span>
                      {b.failureStandard > 0 && (
                        <span className="text-red-600 ml-1">/{b.failureStandard} failed</span>
                      )}
                      <span className="text-gray-400 text-xs ml-1">/ {b.totalStandard}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-green-700 font-medium">{b.successMisc}</span>
                      {b.failureMisc > 0 && (
                        <span className="text-red-600 ml-1">/{b.failureMisc} failed</span>
                      )}
                      <span className="text-gray-400 text-xs ml-1">/ {b.totalMisc}</span>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{b.user?.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
