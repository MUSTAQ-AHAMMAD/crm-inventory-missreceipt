/**
 * Receipt Upload Detail Page.
 * Shows comprehensive details for a specific receipt upload (Standard or Misc)
 * including request payloads, API responses, and failure details.
 */

import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

function parseJSON(text) {
  if (!text) return null
  if (typeof text === 'object') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function formatPreview(data, maxLength = 100) {
  if (!data) return '—'
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function formatDetail(data) {
  if (!data) return '—'
  if (typeof data === 'string') {
    // Try to format as JSON if possible
    const parsed = parseJSON(data)
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
    return data
  }
  return JSON.stringify(data, null, 2)
}

export default function ReceiptUploadDetailPage() {
  const { type, uploadId } = useParams() // type: 'standard' or 'misc'
  const navigate = useNavigate()
  const [expandedRows, setExpandedRows] = useState({})

  const { data, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['receiptUploadDetail', type, uploadId],
    queryFn: () => api.get(`/reports/upload-detail/${type}/${uploadId}`).then((r) => r.data),
    enabled: !!uploadId && !!type,
  })

  const toggleRow = (id) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }))
  }

  if (isLoading) return <div className="flex justify-center mt-20"><Spinner size="lg" /></div>
  if (isError) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Receipt Upload Details</h1>
      <ErrorAlert message={queryError?.response?.data?.error || 'Failed to load upload details.'} />
      <button onClick={() => navigate(-1)} className="inline-block px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
        ← Back
      </button>
    </div>
  )

  const upload = data
  const isStandard = type === 'standard'
  const isMisc = type === 'misc'

  // For standard receipts
  const totalRecords = upload.totalRecords || 0
  const successCount = upload.successCount || 0
  const failureCount = upload.failureCount || 0
  const status = upload.status || upload.responseStatus

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {isStandard ? 'Standard' : 'Miscellaneous'} Receipt Upload Details
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload #{upload.id} – <span className="font-mono">{upload.filename}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate(-1)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Back
          </button>
        </div>
      </div>

      {/* Upload summary card */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Upload Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
            <p className="mt-1"><StatusBadge status={status} /></p>
          </div>
          {isStandard && (
            <>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Records</p>
                <p className="text-xl font-bold text-gray-800">{totalRecords}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 uppercase tracking-wide">Success</p>
                <p className="text-xl font-bold text-green-600">{successCount}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-xs text-red-600 uppercase tracking-wide">Failed</p>
                <p className="text-xl font-bold text-red-600">{failureCount}</p>
              </div>
            </>
          )}
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Uploaded</p>
            <p className="text-sm font-semibold text-gray-700">{new Date(upload.createdAt).toLocaleString()}</p>
          </div>
        </div>
        {upload.user && (
          <p className="text-xs text-gray-400 mt-3">Uploaded by: {upload.user.email}</p>
        )}

        {/* Response message and log */}
        {upload.responseMessage && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Response Message</p>
            {typeof upload.responseMessage === 'object' ? (
              <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                {JSON.stringify(upload.responseMessage, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-gray-700">{upload.responseMessage}</p>
            )}
          </div>
        )}

        {upload.responseLog && (
          <div className="mt-4">
            <details className="cursor-pointer">
              <summary className="text-sm font-medium text-blue-600 hover:underline">View Full Response Log</summary>
              <pre className="mt-2 text-xs bg-gray-900 text-green-400 rounded p-4 overflow-x-auto max-h-96">
                {upload.responseLog}
              </pre>
            </details>
          </div>
        )}
      </div>

      {/* Failures table */}
      {upload.failures && upload.failures.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">
            Failure Details ({upload.failures.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="px-4 py-2 text-left">Row #</th>
                  <th className="px-4 py-2 text-left">{isStandard ? 'Receipt #' : 'Receipt #'}</th>
                  <th className="px-4 py-2 text-left">Error Message</th>
                  <th className="px-4 py-2 text-left">HTTP Status</th>
                  <th className="px-4 py-2 text-left">Request</th>
                  <th className="px-4 py-2 text-left">Response</th>
                  <th className="px-4 py-2 text-left">Raw Data</th>
                  <th className="px-4 py-2 text-left">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {upload.failures.map((f) => {
                  const isExpanded = expandedRows[f.id]
                  const receiptNumber = f.rawData?.ReceiptNumber || '—'

                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 font-medium">{f.rowNumber}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {receiptNumber}
                      </td>
                      <td className="px-4 py-3 text-red-600 text-xs max-w-xs">
                        <div className="truncate" title={f.errorMessage}>
                          {f.errorMessage}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {f.responseStatus ? (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            f.responseStatus >= 200 && f.responseStatus < 300 ? 'bg-green-100 text-green-700' :
                            f.responseStatus >= 400 && f.responseStatus < 500 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {f.responseStatus}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {f.requestPayload ? (
                          <button
                            onClick={() => toggleRow(`req-${f.id}`)}
                            className="text-blue-600 hover:underline"
                          >
                            {expandedRows[`req-${f.id}`] ? 'Hide' : 'View'} {isStandard ? 'JSON' : 'XML'}
                          </button>
                        ) : '—'}
                        {expandedRows[`req-${f.id}`] && f.requestPayload && (
                          <pre className="mt-2 text-xs bg-gray-900 text-green-400 rounded p-2 overflow-x-auto max-w-md max-h-64">
                            {formatDetail(f.requestPayload)}
                          </pre>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {f.responseBody ? (
                          <button
                            onClick={() => toggleRow(`res-${f.id}`)}
                            className="text-blue-600 hover:underline"
                          >
                            {expandedRows[`res-${f.id}`] ? 'Hide' : 'View'} Response
                          </button>
                        ) : '—'}
                        {expandedRows[`res-${f.id}`] && f.responseBody && (
                          <pre className="mt-2 text-xs bg-gray-900 text-red-400 rounded p-2 overflow-x-auto max-w-md max-h-64">
                            {formatDetail(f.responseBody)}
                          </pre>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleRow(`data-${f.id}`)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          {expandedRows[`data-${f.id}`] ? 'Hide' : 'View'} Data
                        </button>
                        {expandedRows[`data-${f.id}`] && (
                          <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto max-w-md">
                            {JSON.stringify(f.rawData, null, 2)}
                          </pre>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {new Date(f.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No failures message */}
      {(!upload.failures || upload.failures.length === 0) && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-gray-400 text-center py-8">
            ✅ No failure records found. All receipts were processed successfully!
          </p>
        </div>
      )}

      {/* Download options */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Export Options</h2>
        <div className="flex gap-3">
          <a
            href={`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/reports/export?type=${type}-failures`}
            download
            className="px-4 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            📥 Export Failures as CSV
          </a>
        </div>
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
    PENDING: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}
