/**
 * Standard Receipt Upload Page.
 * Provides CSV upload, payload preview, and REST submission to Oracle.
 * Features real-time progress tracking with detailed API response visibility.
 */

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../hooks/useApi'
import FileDropzone from '../components/common/FileDropzone'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const REQUIRED_COLUMNS = [
  'ReceiptNumber',
  'ReceiptMethod',
  'ReceiptDate',
  'BusinessUnit',
  'CustomerAccountNumber',
  'CustomerSite',
  'Amount',
  'Currency',
  'RemittanceBankAccountNumber',
  'AccountingDate',
]

export default function StandardReceiptPage() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [result, setResult] = useState(null)
  const [payloadPreviews, setPayloadPreviews] = useState([])
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState('')
  const [activeUploadId, setActiveUploadId] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  const { data: uploadsData, isLoading } = useQuery({
    queryKey: ['standardUploads'],
    queryFn: () => api.get('/standard-receipt/uploads').then((r) => r.data),
  })

  // Poll for progress when there is an active upload
  const { data: progressData } = useQuery({
    queryKey: ['standardReceiptProgress', activeUploadId],
    queryFn: () => api.get(`/standard-receipt/uploads/${activeUploadId}/progress`).then((r) => r.data),
    enabled: !!activeUploadId,
    refetchInterval: activeUploadId ? 1500 : false, // Poll every 1.5 seconds
  })

  // When progress data indicates completion, finalize
  useEffect(() => {
    if (!progressData || !activeUploadId) return
    const { status } = progressData
    if (status === 'SUCCESS' || status === 'FAILED' || status === 'PARTIAL') {
      setResult(progressData)
      setUploading(false)
      setActiveUploadId(null)
      setUploadProgress(0)
      queryClient.invalidateQueries({ queryKey: ['standardUploads'] })
    }
  }, [progressData, activeUploadId, queryClient])

  // Compute progress stats from polling data
  const processed = progressData ? progressData.successCount + progressData.failureCount : 0
  const total = progressData ? progressData.totalRecords : 0

  const handlePreview = async () => {
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setPreviewing(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/standard-receipt/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
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
      const res = await api.post('/standard-receipt/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          setUploadProgress(Math.round((e.loaded / e.total) * 80))
        },
      })
      setUploadProgress(100)
      // If processing completes immediately, show result. Otherwise start polling
      if (res.data.status === 'SUCCESS' || res.data.status === 'FAILED' || res.data.status === 'PARTIAL') {
        setResult(res.data)
        setUploading(false)
        setUploadProgress(0)
        queryClient.invalidateQueries({ queryKey: ['standardUploads'] })
      } else {
        // Start polling for progress
        setActiveUploadId(res.data.uploadId)
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.')
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDownloadTemplate = () => {
    window.open(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/standard-receipt/template`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Standard Receipt Upload</h1>
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

        <FileDropzone onFile={setFile} label="standard receipt CSV" />

        {/* Column reference */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-700 mb-2">Required CSV Columns:</p>
          <div className="flex flex-wrap gap-2">
            {REQUIRED_COLUMNS.map((col) => (
              <span key={col} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono">{col}</span>
            ))}
          </div>
          <p className="text-xs text-blue-700 mt-2">
            Dates must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, or DD/MM/YYYY format (auto-converted). Currency should match Oracle expectation (e.g., SAR).
          </p>
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
            className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {uploading ? <Spinner size="sm" /> : '📤'}
            {uploading ? 'Sending…' : 'Upload & Send to Oracle'}
          </button>
        </div>

        {/* File upload progress bar (before backend processing starts) */}
        {uploading && uploadProgress > 0 && uploadProgress < 100 && (
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}

        {/* Backend processing progress panel */}
        {activeUploadId && progressData && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
            <p className="font-semibold text-blue-700 flex items-center gap-2">
              <Spinner size="sm" /> Processing Standard Receipt Requests...
            </p>

            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className="h-3 rounded-full transition-all"
                style={{
                  width: `${total > 0 ? (processed / total) * 100 : 0}%`,
                  background: progressData.failureCount > 0
                    ? 'linear-gradient(90deg, #22c55e, #eab308)'
                    : '#22c55e'
                }}
              />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-white rounded p-2 text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Records</p>
                <p className="text-xl font-bold text-gray-800">{progressData.totalRecords || 0}</p>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <p className="text-xs text-green-600 uppercase tracking-wide">Success</p>
                <p className="text-xl font-bold text-green-600">{progressData.successCount}</p>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <p className="text-xs text-red-600 uppercase tracking-wide">Failed</p>
                <p className="text-xl font-bold text-red-600">{progressData.failureCount}</p>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <p className="text-xs text-blue-600 uppercase tracking-wide">In Progress</p>
                <p className="text-xl font-bold text-blue-600">{processed} / {total}</p>
              </div>
            </div>

            {/* Response message */}
            {progressData.responseMessage && (
              <div className="bg-white rounded-lg p-3 text-sm">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Response Message</p>
                <p className="text-gray-700">{progressData.responseMessage}</p>
              </div>
            )}

            {/* Response log - expandable */}
            {progressData.responseLog && (
              <details className="bg-white rounded-lg p-3">
                <summary className="text-sm font-medium text-blue-600 hover:underline cursor-pointer">
                  View Detailed Response Log
                </summary>
                <pre className="mt-2 text-xs bg-gray-900 text-green-400 rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {progressData.responseLog}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Result summary */}
        {result && !activeUploadId && (
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
              {result.status === 'SUCCESS' ? '✅ Upload Complete - All Receipts Sent Successfully' :
               result.status === 'FAILED' ? '❌ Upload Failed' :
               '⚠️ Upload Partial - Some Receipts Failed'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-gray-500">Total:</span> <strong>{result.totalRecords}</strong></div>
              <div><span className="text-gray-500">Success:</span> <strong className="text-green-600">{result.successCount}</strong></div>
              <div><span className="text-gray-500">Failed:</span> <strong className="text-red-600">{result.failureCount}</strong></div>
              <div><span className="text-gray-500">Status:</span> <strong>{result.status}</strong></div>
            </div>
            {result.responseMessage && (
              <div className="mt-3 p-2 bg-white rounded text-sm">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Response Message</p>
                <p className="text-gray-700">{result.responseMessage}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payload Preview panel */}
      {showPreview && payloadPreviews.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">Payload Preview ({payloadPreviews.length} row{payloadPreviews.length > 1 ? 's' : ''})</h2>
            <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {payloadPreviews.map((p) => (
              <div key={p.rowNumber}>
                <p className="text-xs text-gray-500 mb-1">Row {p.rowNumber}</p>
                <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(p.payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent uploads table */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Recent Uploads</h2>
        {isLoading ? (
          <Spinner className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Filename</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Records</th>
                  <th className="px-4 py-2 text-left">Response</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(!uploadsData?.uploads || uploadsData.uploads.length === 0) && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No uploads yet</td></tr>
                )}
                {uploadsData?.uploads?.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">#{u.id}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{u.filename}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div className="flex gap-2">
                        <span className="text-green-600">✓ {u.successCount || 0}</span>
                        <span className="text-red-600">✗ {u.failureCount || 0}</span>
                      </div>
                    </td>
                    <td
                      className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate"
                      title={u.responseLog || (typeof u.responseMessage === 'object' ? JSON.stringify(u.responseMessage) : u.responseMessage)}
                    >
                      {typeof u.responseMessage === 'object' ? JSON.stringify(u.responseMessage) : (u.responseMessage || '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/receipt-upload/standard/${u.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View Details
                      </Link>
                    </td>
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

function StatusBadge({ status }) {
  const map = {
    SUCCESS: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
    PARTIAL: 'bg-yellow-100 text-yellow-700',
    PROCESSING: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status || 'UNKNOWN'}
    </span>
  )
}
