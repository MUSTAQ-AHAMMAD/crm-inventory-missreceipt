/**
 * Apply Credit Memo Upload Page.
 *
 * Bulk-applies on-account credit memos to invoices via Oracle's CreditMemoService
 * SOAP operation (createApplyOnAccountCreditMemo). Upload a CSV → one SOAP call
 * per row (processed in a loop on the backend) → per-row results.
 */

import { useState } from 'react'
import api from '../hooks/useApi'
import FileDropzone from '../components/common/FileDropzone'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const REQUIRED_COLUMNS = [
  'BusinessUnit',
  'CreditMemoTrxNumber',
  'InvoiceTrxNumber',
  'AmountApplied',
  'ApplyDate',
  'GlDate',
]

export default function ApplyCreditMemoPage() {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [result, setResult] = useState(null)
  const [payloadPreviews, setPayloadPreviews] = useState([])
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)

  const handlePreview = async () => {
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setPreviewing(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/apply-credit-memo/preview', formData)
      setPayloadPreviews(res.data.previews || [])
      setShowPreview(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed.')
    } finally {
      setPreviewing(false)
    }
  }

  const handleUpload = async () => {
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setResult(null)
    setUploading(true)
    setUploadProgress(10)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/apply-credit-memo/upload', formData, {
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 80))
        },
      })
      setUploadProgress(100)
      setResult(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDownloadTemplate = () => {
    window.open(
      `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/apply-credit-memo/template`,
      '_blank'
    )
  }

  const handleDownloadResults = () => {
    if (!result?.results?.length) return
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const headers = [
      'RowNumber', 'Status', 'BusinessUnit', 'CreditMemoTrxNumber',
      'InvoiceTrxNumber', 'AmountApplied', 'HttpStatus', 'Message',
    ]
    const rows = [headers.join(',')]
    for (const r of result.results) {
      rows.push([
        r.rowNumber, esc(r.status), esc(r.businessUnit), esc(r.creditMemoTrxNumber),
        esc(r.invoiceTrxNumber), esc(r.amountApplied), r.httpStatus ?? '', esc(r.message),
      ].join(','))
    }
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    link.download = `apply-credit-memo-results-${timestamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Apply Credit Memo</h1>
        <button
          onClick={handleDownloadTemplate}
          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
        >
          ⬇️ Download Template
        </button>
      </div>

      {/* Upload card */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Upload CSV File</h2>

        <FileDropzone onFile={setFile} label="apply credit memo CSV" />

        {/* Column reference */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
          <p className="text-sm font-medium text-indigo-700 mb-2">Required CSV Columns:</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {REQUIRED_COLUMNS.map((col) => (
              <span key={col} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-mono">{col}</span>
            ))}
          </div>
          <ul className="text-xs text-indigo-700 mt-2 space-y-1 list-disc list-inside">
            <li>Each row applies one on-account credit memo to one invoice — the file is processed in a loop.</li>
            <li><strong>CreditMemoTrxNumber</strong> and <strong>InvoiceTrxNumber</strong> are Oracle transaction numbers.</li>
            <li><strong>ApplyDate</strong> / <strong>GlDate</strong> accept YYYY-MM-DD, DD-MM-YYYY, or Excel serial formats. Both must fall in an open period.</li>
          </ul>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handlePreview}
            disabled={previewing || !file || uploading}
            className="px-5 py-2.5 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {previewing ? <Spinner size="sm" /> : '👁️'}
            {previewing ? 'Generating…' : 'Preview Payload'}
          </button>

          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {uploading ? <Spinner size="sm" /> : '🔗'}
            {uploading ? 'Processing…' : 'Upload & Apply to Oracle'}
          </button>
        </div>

        {/* File upload progress bar */}
        {uploading && uploadProgress > 0 && uploadProgress < 100 && (
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {uploading && uploadProgress === 100 && (
          <p className="text-sm text-gray-600 flex items-center gap-2">
            <Spinner size="sm" /> Applying credit memos in Oracle…
          </p>
        )}

        {/* Result summary */}
        {result && (
          <div className={`border rounded-lg p-4 ${
            result.status === 'SUCCESS' ? 'bg-green-50 border-green-200' :
            result.status === 'FAILED' ? 'bg-red-50 border-red-200' :
            'bg-yellow-50 border-yellow-200'
          }`}>
            <p className={`font-semibold mb-2 ${
              result.status === 'SUCCESS' ? 'text-green-700' :
              result.status === 'FAILED' ? 'text-red-700' :
              'text-yellow-700'
            }`}>
              {result.status === 'SUCCESS' ? '✅ All credit memos applied successfully' :
               result.status === 'FAILED' ? '❌ All rows failed' :
               '⚠️ Partial — some rows failed'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-gray-500">Total Rows:</span> <strong>{result.totalRecords}</strong></div>
              <div><span className="text-gray-500">Success:</span> <strong className="text-green-600">{result.successCount}</strong></div>
              <div><span className="text-gray-500">Failed:</span> <strong className="text-red-600">{result.failureCount}</strong></div>
              <div><span className="text-gray-500">Status:</span> <strong>{result.status}</strong></div>
            </div>
            {result.processingTimeSeconds != null && (
              <div className="mt-2 text-xs text-gray-600">
                Processing time: {result.processingTimeSeconds}s | Avg: {result.averageTimePerRow}s per row | Concurrency: {result.concurrency}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results table */}
      {result?.results?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">Per-Row Results ({result.results.length})</h2>
            <button
              onClick={handleDownloadResults}
              className="px-3 py-1.5 text-sm bg-green-600 text-white font-medium rounded hover:bg-green-700 transition-colors flex items-center gap-1"
            >
              📥 Download Results CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="px-3 py-2 text-left">Row</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Business Unit</th>
                  <th className="px-3 py-2 text-left">Credit Memo</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.results.map((r) => (
                  <tr key={r.rowNumber} className={r.status === 'FAILED' ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        r.status === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.businessUnit}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.creditMemoTrxNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.invoiceTrxNumber}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.amountApplied}</td>
                    <td className={`px-3 py-2 text-xs ${r.status === 'FAILED' ? 'text-red-700' : 'text-gray-500'}`}>
                      {r.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payload Preview panel */}
      {showPreview && payloadPreviews.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">
              SOAP Payload Preview ({payloadPreviews.length} application{payloadPreviews.length > 1 ? 's' : ''})
            </h2>
            <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {payloadPreviews.map((p, idx) => (
              <div key={idx}>
                <p className="text-xs text-gray-500 mb-1">
                  Row {p.rowNumber}: Credit Memo {p.creditMemoTrxNumber} → Invoice {p.invoiceTrxNumber} ({p.amountApplied})
                </p>
                <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {p.soapPayload}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
