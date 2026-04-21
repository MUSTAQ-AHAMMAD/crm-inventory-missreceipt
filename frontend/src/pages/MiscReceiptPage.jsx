/**
 * Miscellaneous Receipt Upload Page.
 * Provides CSV dropzone, SOAP XML preview, and upload functionality.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../hooks/useApi'
import FileDropzone from '../components/common/FileDropzone'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const REQUIRED_COLUMNS = [
  'Amount',
  'CurrencyCode',
  'DepositDate',
  'ReceiptDate',
  'GlDate',
  'OrgId',
  'ReceiptNumber',
  'ReceivableActivityName',
  'BankAccountNumber',
]

const OPTIONAL_COLUMNS = ['ReceiptMethodId', 'ReceiptMethodName']

export default function MiscReceiptPage() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [result, setResult] = useState(null)
  const [xmlPreviews, setXmlPreviews] = useState([])
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState('')

  const { data: uploadsData, isLoading } = useQuery({
    queryKey: ['miscUploads'],
    queryFn: () => api.get('/misc-receipt/uploads').then((r) => r.data),
  })

  const handlePreview = async () => {
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setPreviewing(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/misc-receipt/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setXmlPreviews(res.data.previews || [])
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
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/misc-receipt/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['miscUploads'] })
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadTemplate = () => {
    window.open(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/misc-receipt/template`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Miscellaneous Receipt Upload</h1>
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

        <FileDropzone onFile={setFile} label="misc receipt CSV" />

        {/* Column reference */}
        <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
          <p className="text-sm font-medium text-purple-700 mb-2">Required CSV Columns:</p>
          <div className="flex flex-wrap gap-2">
            {REQUIRED_COLUMNS.map((col) => (
              <span key={col} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-mono">{col}</span>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            <p className="text-sm font-medium text-purple-700">Optional columns (supported if your org needs a receipt method):</p>
            <div className="flex flex-wrap gap-2">
              {OPTIONAL_COLUMNS.map((col) => (
                <span key={col} className="px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-200 rounded text-xs font-mono">{col}</span>
              ))}
            </div>
            <p className="text-xs text-purple-700">
              Leave these blank if your Oracle setup defaults the receipt method automatically.
            </p>
          </div>
          <p className="text-xs text-purple-700 mt-2">
            Date fields (ReceiptDate, DepositDate, GlDate) must be in YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, DD/MM/YYYY format, or an Excel serial number (auto-converted).
          </p>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handlePreview}
            disabled={previewing || !file}
            className="px-5 py-2.5 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {previewing ? <Spinner size="sm" /> : '👁️'}
            {previewing ? 'Generating…' : 'Preview XML'}
          </button>

          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="px-5 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {uploading ? <Spinner size="sm" /> : '📤'}
            {uploading ? 'Sending…' : 'Upload & Send to Oracle'}
          </button>
        </div>

        {/* Result summary */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="font-semibold text-green-700 mb-2">✅ Upload Complete</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-gray-500">Total:</span> <strong>{result.totalRecords}</strong></div>
              <div><span className="text-gray-500">Success:</span> <strong className="text-green-600">{result.successCount}</strong></div>
              <div><span className="text-gray-500">Failed:</span> <strong className="text-red-600">{result.failureCount}</strong></div>
              <div><span className="text-gray-500">Status:</span> <strong>{result.status}</strong></div>
            </div>
          </div>
        )}
      </div>

      {/* XML Preview panel */}
      {showPreview && xmlPreviews.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">SOAP XML Preview ({xmlPreviews.length} row{xmlPreviews.length > 1 ? 's' : ''})</h2>
            <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {xmlPreviews.map((p) => (
              <div key={p.rowNumber}>
                <p className="text-xs text-gray-500 mb-1">Row {p.rowNumber}</p>
                <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {p.xml}
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
                  <th className="px-4 py-2 text-left">Response</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(!uploadsData?.uploads || uploadsData.uploads.length === 0) && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No uploads yet</td></tr>
                )}
                {uploadsData?.uploads?.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">#{u.id}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{u.filename}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.responseStatus} />
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
                        to={`/receipt-upload/misc/${u.id}`}
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
