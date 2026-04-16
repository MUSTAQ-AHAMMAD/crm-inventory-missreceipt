/**
 * Upload Detail Page.
 * Shows comprehensive details for a specific inventory upload including
 * both success and failure records with pagination.
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
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

function formatResponseDetail(body) {
  const parsed = parseResponseBody(body)
  if (!parsed) return '—'
  if (typeof parsed === 'string') return parsed
  return JSON.stringify(parsed, null, 2)
}

const TABS = ['Overview', 'Success Records', 'Failure Records', 'Debug Log']

export default function UploadDetailPage() {
  const { uploadId } = useParams()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('Overview')
  const [successPage, setSuccessPage] = useState(1)
  const [failurePage, setFailurePage] = useState(1)
  const [debugPage, setDebugPage] = useState(1)
  const [retrying, setRetrying] = useState(false)
  const [retryResult, setRetryResult] = useState(null)
  const [error, setError] = useState('')
  const PAGE_SIZE = 50

  const isDebugTab = tab === 'Debug Log'

  // Fetch upload detail
  const { data, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['uploadDetail', uploadId, tab, successPage, failurePage, debugPage],
    queryFn: () => {
      if (isDebugTab) {
        return api.get(`/inventory/uploads/${uploadId}/debug-log`, {
          params: { page: debugPage, limit: PAGE_SIZE },
        }).then((r) => r.data)
      }
      const type = tab === 'Success Records' ? 'success' : tab === 'Failure Records' ? 'failure' : 'all'
      const page = type === 'success' ? successPage : type === 'failure' ? failurePage : 1
      return api.get(`/inventory/uploads/${uploadId}/detail`, {
        params: { type, page, limit: PAGE_SIZE },
      }).then((r) => r.data)
    },
    enabled: !!uploadId && uploadId !== '0',
  })

  const handleRetry = async () => {
    setError('')
    setRetrying(true)
    try {
      const res = await api.post(`/inventory/uploads/${uploadId}/retry`)
      setRetryResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['uploadDetail'] })
    } catch (err) {
      setError(err.response?.data?.error || 'Retry failed.')
    } finally {
      setRetrying(false)
    }
  }

  if (!uploadId || uploadId === '0') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">Upload Details</h1>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-gray-500">
            Select a specific upload from the{' '}
            <Link to="/inventory" className="text-blue-600 hover:underline">Inventory Upload</Link> page to view details.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) return <div className="flex justify-center mt-20"><Spinner size="lg" /></div>
  if (isError) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Upload Details</h1>
      <ErrorAlert message={queryError?.response?.data?.error || 'Failed to load upload details.'} />
      <Link to="/inventory" className="inline-block px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
        ← Back to Uploads
      </Link>
    </div>
  )

  const {
    upload,
    successes = [],
    failures = [],
    records: debugRecords = [],
    totalSuccessRecords = 0,
    totalFailureRecords = 0,
    totalRecords: totalDebugRecords = 0,
  } = data || {}

  const successTotalPages = Math.ceil(totalSuccessRecords / PAGE_SIZE) || 1
  const failureTotalPages = Math.ceil(totalFailureRecords / PAGE_SIZE) || 1
  const debugTotalPages = Math.ceil(totalDebugRecords / PAGE_SIZE) || 1

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Upload Details</h1>
          {upload && (
            <p className="text-sm text-gray-500 mt-1">
              Upload #{upload.id} – <span className="font-mono">{upload.filename}</span>
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Link to="/inventory" className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Back to Uploads
          </Link>
          {(upload?.failureCount > 0 && upload?.status !== 'PROCESSING') && (
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

      {/* Upload summary card */}
      {upload && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">Upload Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
              <p className="mt-1"><StatusBadge status={upload.status} /></p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Records</p>
              <p className="text-xl font-bold text-gray-800">{upload.totalRecords}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-xs text-green-600 uppercase tracking-wide">Success</p>
              <p className="text-xl font-bold text-green-600">{upload.successCount}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-xs text-red-600 uppercase tracking-wide">Failed</p>
              <p className="text-xl font-bold text-red-600">{upload.failureCount}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Organization</p>
              <p className="text-sm font-semibold text-gray-700 truncate">{upload.organizationName || '—'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Uploaded</p>
              <p className="text-sm font-semibold text-gray-700">{new Date(upload.createdAt).toLocaleString()}</p>
            </div>
          </div>
          {upload.user && (
            <p className="text-xs text-gray-400 mt-3">Uploaded by: {upload.user.email}</p>
          )}
          {/* Progress bar */}
          {upload.totalRecords > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Success Rate</span>
                <span>{Math.round((upload.successCount / upload.totalRecords) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full"
                  style={{
                    width: `${(upload.successCount / upload.totalRecords) * 100}%`,
                    background: upload.failureCount > 0
                      ? 'linear-gradient(90deg, #22c55e, #eab308)'
                      : '#22c55e',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Retry result */}
      {retryResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
          <p className="font-semibold text-green-700">Retry Complete</p>
          <p>✅ {retryResult.retrySuccess} succeeded &nbsp; ❌ {retryResult.retryFail} still failing</p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
            {t === 'Success Records' && <span className="ml-1 text-xs text-green-600">({totalSuccessRecords})</span>}
            {t === 'Failure Records' && <span className="ml-1 text-xs text-red-600">({totalFailureRecords})</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Overview' && (
        <div className="space-y-6">
          {/* Recent successes preview */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-700">Recent Success Records ({totalSuccessRecords})</h2>
              {totalSuccessRecords > 10 && (
                <button onClick={() => setTab('Success Records')} className="text-sm text-blue-600 hover:underline">
                  View all →
                </button>
              )}
            </div>
            <RecordsTable records={successes} type="success" />
          </div>

          {/* Recent failures preview */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-700">Recent Failure Records ({totalFailureRecords})</h2>
              {totalFailureRecords > 10 && (
                <button onClick={() => setTab('Failure Records')} className="text-sm text-blue-600 hover:underline">
                  View all →
                </button>
              )}
            </div>
            <RecordsTable records={failures} type="failure" />
          </div>
        </div>
      )}

      {tab === 'Success Records' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">
            Success Records ({totalSuccessRecords})
          </h2>
          <RecordsTable records={successes} type="success" />
          <Pagination page={successPage} totalPages={successTotalPages} onPageChange={setSuccessPage} />
        </div>
      )}

      {tab === 'Failure Records' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">
            Failure Records ({totalFailureRecords})
          </h2>
          <RecordsTable records={failures} type="failure" />
          <Pagination page={failurePage} totalPages={failureTotalPages} onPageChange={setFailurePage} />
        </div>
      )}

      {tab === 'Debug Log' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">
            Debug Log ({totalDebugRecords})
          </h2>
          <DebugTable records={debugRecords} />
          <Pagination page={debugPage} totalPages={debugTotalPages} onPageChange={setDebugPage} />
        </div>
      )}
    </div>
  )
}

function RecordsTable({ records, type }) {
  if (!records || records.length === 0) {
    return (
      <p className="text-gray-400 text-sm py-4">
        {type === 'success' ? 'No success records found.' : 'No failure records found. ✅'}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
            <th className="px-4 py-2 text-left">Row #</th>
            <th className="px-4 py-2 text-left">Item Number</th>
            <th className="px-4 py-2 text-left">Organization</th>
            <th className="px-4 py-2 text-left">Subinventory</th>
            <th className="px-4 py-2 text-left">Quantity</th>
            <th className="px-4 py-2 text-left">HTTP</th>
            <th className="px-4 py-2 text-left">Response</th>
            {type === 'failure' && <th className="px-4 py-2 text-left">Error</th>}
            <th className="px-4 py-2 text-left">Data</th>
            <th className="px-4 py-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-500">{r.rowNumber}</td>
              <td className="px-4 py-3 font-mono text-xs text-gray-700">
                {r.rawData?.ItemNumber || '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {r.rawData?.OrganizationName || '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {r.rawData?.SubinventoryCode || '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {r.rawData?.TransactionQuantity || '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {r.responseStatus ? `HTTP ${r.responseStatus}` : '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                <details className="cursor-pointer">
                  <summary className="text-xs text-blue-600 hover:underline">
                    {formatResponsePreview(r.responseBody)}
                  </summary>
                  <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto max-w-md">
                    {formatResponseDetail(r.responseBody)}
                  </pre>
                </details>
              </td>
              {type === 'failure' && (
                <td className="px-4 py-3 text-red-600 text-xs max-w-xs">
                  {r.errorMessage}
                </td>
              )}
              <td className="px-4 py-3">
                <details className="cursor-pointer">
                  <summary className="text-xs text-blue-600 hover:underline">View JSON</summary>
                  <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto max-w-md">
                    {JSON.stringify(r.rawData, null, 2)}
                  </pre>
                </details>
              </td>
              <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                {new Date(r.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DebugTable({ records }) {
  if (!records || records.length === 0) {
    return (
      <p className="text-gray-400 text-sm py-4">
        No debug records found.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
            <th className="px-4 py-2 text-left">Row #</th>
            <th className="px-4 py-2 text-left">Item</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">HTTP</th>
            <th className="px-4 py-2 text-left">Response</th>
            <th className="px-4 py-2 text-left">Error</th>
            <th className="px-4 py-2 text-left">Payload</th>
            <th className="px-4 py-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {records.map((r) => (
            <tr key={`${r.recordType}-${r.id}`} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-500">{r.rowNumber}</td>
              <td className="px-4 py-3 font-mono text-xs text-gray-700">
                {r.rawData?.ItemNumber || '—'}
              </td>
              <td className="px-4 py-3">
                <RecordTypeBadge type={r.recordType} />
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {r.responseStatus ? `HTTP ${r.responseStatus}` : '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                <details className="cursor-pointer">
                  <summary className="text-xs text-blue-600 hover:underline">
                    {formatResponsePreview(r.responseBody)}
                  </summary>
                  <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto max-w-md">
                    {formatResponseDetail(r.responseBody)}
                  </pre>
                </details>
              </td>
              <td className="px-4 py-3 text-xs text-red-600 max-w-xs">
                {r.recordType === 'FAILURE' ? (r.errorMessage || '—') : '—'}
              </td>
              <td className="px-4 py-3">
                <details className="cursor-pointer">
                  <summary className="text-xs text-blue-600 hover:underline">View JSON</summary>
                  <pre className="mt-2 text-xs bg-gray-100 rounded p-2 overflow-x-auto max-w-md">
                    {JSON.stringify(r.rawData, null, 2)}
                  </pre>
                </details>
              </td>
              <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                {new Date(r.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
      <p className="text-xs text-gray-500">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    COMPLETED: 'bg-green-100 text-green-700',
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

function RecordTypeBadge({ type }) {
  const isSuccess = type === 'SUCCESS'
  const isFailure = type === 'FAILURE'
  const color = isSuccess
    ? 'bg-green-100 text-green-700'
    : isFailure
      ? 'bg-red-100 text-red-700'
      : 'bg-gray-100 text-gray-700'
  const label = type === 'SUCCESS' ? 'Success' : type === 'FAILURE' ? 'Failure' : type || 'Unknown'
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}
