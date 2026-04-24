/**
 * Failure Details Page.
 * Shows individual row failures for a specific upload with raw data
 * and a retry button per upload.
 */

import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

function parseResponseBody(body) {
  if (!body) return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return body
    }
  }
  return body
}

function formatResponsePreview(body) {
  const parsed = parseResponseBody(body)
  if (!parsed) return '—'
  const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  if (!text) return '—'
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

function formatResponseDetail(body) {
  const parsed = parseResponseBody(body)
  if (!parsed) return '—'
  if (typeof parsed === 'string') return parsed
  return JSON.stringify(parsed, null, 2)
}

export default function FailureDetailsPage() {
  const { uploadId } = useParams()
  const queryClient = useQueryClient()
  const [retrying, setRetrying] = useState(false)
  const [retryResult, setRetryResult] = useState(null)
  const [error, setError] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inventoryFailures', uploadId],
    queryFn: () => api.get(`/inventory/uploads/${uploadId}/failures`).then((r) => r.data),
    enabled: uploadId !== '0', // '0' is the placeholder from sidebar link
  })

  const handleRetry = async () => {
    setError('')
    setRetrying(true)
    try {
      const res = await api.post(`/inventory/uploads/${uploadId}/retry`)
      setRetryResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['inventoryFailures', uploadId] })
    } catch (err) {
      setError(err.response?.data?.error || 'Retry failed.')
    } finally {
      setRetrying(false)
    }
  }

  const [exporting, setExporting] = useState(false)
  const handleExportFailures = async () => {
    setError('')
    setExporting(true)
    try {
      const res = await api.get(`/inventory/uploads/${uploadId}/failures/export`, {
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const disposition = res.headers?.['content-disposition'] || ''
      const match = /filename="?([^";]+)"?/i.exec(disposition)
      link.setAttribute('download', match?.[1] || `failures_upload_${uploadId}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to export failures CSV.')
    } finally {
      setExporting(false)
    }
  }

  if (uploadId === '0') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">Logs & Failures</h1>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-gray-500">
            Select a specific upload from the{' '}
            <Link to="/inventory" className="text-blue-600 hover:underline">Inventory Upload</Link> page
            or the{' '}
            <Link to="/reports" className="text-blue-600 hover:underline">Reports</Link> page to view failures.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) return <div className="flex justify-center mt-20"><Spinner size="lg" /></div>
  if (isError) return <ErrorAlert message="Failed to load failure records." />

  const { upload, failures } = data || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Failure Details</h1>
          {upload && (
            <p className="text-sm text-gray-500 mt-1">
              Upload #{upload.id} – <span className="font-mono">{upload.filename}</span>
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Link to="/inventory" className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Back
          </Link>
          {failures?.length > 0 && (
            <button
              onClick={handleExportFailures}
              disabled={exporting}
              className="px-4 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2"
              title="Download all failed rows as CSV (includes original CSV columns plus error details)"
            >
              {exporting ? <Spinner size="sm" /> : '📥'}
              {exporting ? 'Exporting…' : 'Export Failures CSV'}
            </button>
          )}
          {failures?.length > 0 && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
            >
              {retrying ? <Spinner size="sm" /> : '🔄'}
              Retry All Failures
            </button>
          )}
        </div>
      </div>

      <ErrorAlert message={error} onDismiss={() => setError('')} />

      {/* Upload summary */}
      {upload && (
        <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap gap-6 text-sm">
          <div><span className="text-gray-500">Total Records:</span> <strong>{upload.totalRecords}</strong></div>
          <div><span className="text-gray-500">Successes:</span> <strong className="text-green-600">{upload.successCount}</strong></div>
          <div><span className="text-gray-500">Failures:</span> <strong className="text-red-600">{upload.failureCount}</strong></div>
          <div><span className="text-gray-500">Status:</span> <strong>{upload.status}</strong></div>
        </div>
      )}

      {/* Retry result */}
      {retryResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
          <p className="font-semibold text-green-700">Retry Complete</p>
          <p>✅ {retryResult.retrySuccess} succeeded &nbsp; ❌ {retryResult.retryFail} still failing</p>
        </div>
      )}

      {/* Failures table */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">
          Failure Records ({failures?.length ?? 0})
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="px-4 py-2 text-left">Row #</th>
                <th className="px-4 py-2 text-left">Item Number</th>
                <th className="px-4 py-2 text-left">Error Message</th>
                <th className="px-4 py-2 text-left">Oracle Code</th>
                <th className="px-4 py-2 text-left">HTTP</th>
                <th className="px-4 py-2 text-left">Response</th>
                <th className="px-4 py-2 text-left">Raw Data</th>
                <th className="px-4 py-2 text-left">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(!failures || failures.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No failure records found ✅
                  </td>
                </tr>
              )}
              {failures?.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{f.rowNumber}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {f.rawData?.ItemNumber || '—'}
                  </td>
                  <td className="px-4 py-3 text-red-600 text-xs max-w-xs">
                    {f.errorMessage}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {f.oracleErrorCode ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-mono font-semibold text-xs">
                        {f.oracleErrorCode}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {f.responseStatus ? `HTTP ${f.responseStatus}` : '—'}
                    {f.oracleProcessStatus && (
                      <span className="ml-1 text-orange-600">(PS:{f.oracleProcessStatus})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                    <details className="cursor-pointer">
                      <summary className="text-xs text-blue-600 hover:underline">
                        {formatResponsePreview(f.responseBody)}
                      </summary>
                      <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto">
                        {formatResponseDetail(f.responseBody)}
                      </pre>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    <details className="cursor-pointer">
                      <summary className="text-xs text-blue-600 hover:underline">View JSON</summary>
                      <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto">
                        {JSON.stringify(f.rawData, null, 2)}
                      </pre>
                    </details>
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                    {new Date(f.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
