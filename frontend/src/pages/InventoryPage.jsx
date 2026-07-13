/**
 * Inventory Upload Page.
 * Provides a CSV file dropzone, column mapping preview, upload with progress,
 * and a table of recent uploads with links to failure details.
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../hooks/useApi'
import FileDropzone from '../components/common/FileDropzone'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'
import HistoryFilterBar from '../components/common/HistoryFilterBar'
import { filterUploads } from '../utils/format'
import { buildDatePreview } from '../utils/inventoryPreview'

// Required CSV columns for inventory uploads (OrganizationName is a separate form field)
const REQUIRED_COLUMNS = [
  'TransactionTypeName', 'ItemNumber',
  'SubinventoryCode', 'TransactionDate', 'TransactionQuantity',
  'TransactionReference', 'TransactionUnitOfMeasure',
]

export default function InventoryPage() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [organizationName, setOrganizationName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  // Tracks the active upload being processed in the background
  const [activeUploadId, setActiveUploadId] = useState(null)
  // Client-side per-date breakdown of the selected file (visual confirmation)
  const [preview, setPreview] = useState(null)

  // Parse the selected CSV in the browser and build a per-date record count.
  const handleFile = useCallback((f) => {
    setFile(f)
    setPreview(null)
    if (!f) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        setPreview(buildDatePreview(String(e.target.result || '')))
      } catch {
        setPreview({ error: 'Could not read this file for preview.', byDate: [] })
      }
    }
    reader.onerror = () => setPreview({ error: 'Could not read this file for preview.', byDate: [] })
    reader.readAsText(f)
  }, [])

  // Fetch recent uploads
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const { data: uploadsData, isLoading } = useQuery({
    queryKey: ['inventoryUploads'],
    queryFn: () => api.get('/inventory/uploads').then((r) => r.data),
  })

  const allUploads = uploadsData?.uploads || []
  const filteredUploads = filterUploads(allUploads, {
    search, status: statusFilter, from: fromDate, to: toDate,
  })

  // Poll for progress when there is an active upload
  const { data: progressData } = useQuery({
    queryKey: ['inventoryProgress', activeUploadId],
    queryFn: () => api.get(`/inventory/uploads/${activeUploadId}/progress`).then((r) => r.data),
    enabled: !!activeUploadId,
    refetchInterval: 1500,
  })

  // When progress data indicates completion, finalize
  useEffect(() => {
    if (!progressData || !activeUploadId) return
    const { status } = progressData
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'PARTIAL') {
      setResult(progressData)
      setActiveUploadId(null)
      setUploading(false)
      setUploadProgress(0)
      queryClient.invalidateQueries({ queryKey: ['inventoryUploads'] })
    }
  }, [progressData, activeUploadId, queryClient])

  const handleUpload = useCallback(async () => {
    if (!organizationName.trim()) { setError('Please enter an Organization Name.'); return }
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setResult(null)
    setUploading(true)
    setUploadProgress(10)
    setActiveUploadId(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('organizationName', organizationName.trim())

    try {
      const res = await api.post('/inventory/bulk-upload', formData, {
        onUploadProgress: (e) => {
          setUploadProgress(Math.round((e.loaded / e.total) * 80))
        },
      })
      setUploadProgress(100)
      // Backend returns immediately with uploadId and PROCESSING status;
      // start polling for progress
      if (res.data.status === 'PROCESSING') {
        setActiveUploadId(res.data.uploadId)
      } else {
        // Already completed (unlikely but handle gracefully)
        setResult(res.data)
        setUploading(false)
        setUploadProgress(0)
        queryClient.invalidateQueries({ queryKey: ['inventoryUploads'] })
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.')
      setUploading(false)
      setUploadProgress(0)
    }
  }, [file, organizationName, queryClient])

  const handleDownloadTemplate = () => {
    window.open(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/inventory/template`, '_blank')
  }

  // Compute progress stats from polling data
  const processed = progressData ? progressData.successCount + progressData.failureCount : 0
  const total = progressData ? progressData.totalRecords : 0
  const remaining = total - processed
  const percentComplete = total > 0 ? Math.round((processed / total) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Inventory Bulk Upload</h1>
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

        <div>
          <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 mb-1">
            Organization Name
          </label>
          <input
            id="organizationName"
            type="text"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="e.g. Vision Operations"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
          />
        </div>

        <FileDropzone onFile={handleFile} label="inventory CSV" />

        {/* Per-date preview — visual confirmation before processing */}
        {preview && <DatePreview preview={preview} />}

        {/* Column mapping reference */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-700 mb-2">Required CSV Columns:</p>
          <div className="flex flex-wrap gap-2">
            {REQUIRED_COLUMNS.map((col) => (
              <span key={col} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono">{col}</span>
            ))}
          </div>
          <p className="text-xs text-blue-600 mt-2">
            Alternative column names are also accepted (e.g. <span className="font-mono">Order Lines/Product/Barcode</span> for <span className="font-mono">ItemNumber</span>,{' '}
            <span className="font-mono">Order Lines/Branch/Name</span> for <span className="font-mono">SubinventoryCode</span>,{' '}
            <span className="font-mono">diff</span> for <span className="font-mono">TransactionQuantity</span>,{' '}
            <span className="font-mono">Order Lines/Order Ref</span> for <span className="font-mono">TransactionReference</span>,{' '}
            <span className="font-mono">Order Lines/Order Ref/Date</span> for <span className="font-mono">TransactionDate</span>,{' '}
            <span className="font-mono">Order Lines/Base UoM</span> for <span className="font-mono">TransactionUnitOfMeasure</span>).
          </p>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        {/* File upload progress bar (before backend processing starts) */}
        {uploading && !activeUploadId && (
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {/* Backend processing progress panel */}
        {activeUploadId && progressData && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-blue-800 flex items-center gap-2">
                <Spinner size="sm" /> Processing Records…
              </span>
              <span className="text-sm font-bold text-blue-700">{percentComplete}%</span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-blue-100 rounded-full h-3">
              <div
                className="h-3 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${percentComplete}%`,
                  background: progressData.failureCount > 0
                    ? 'linear-gradient(90deg, #22c55e, #eab308)'
                    : '#22c55e',
                }}
              />
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
                <p className="text-xl font-bold text-gray-800">{total}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-green-600 uppercase tracking-wide">Completed</p>
                <p className="text-xl font-bold text-green-600">{progressData.successCount}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-red-600 uppercase tracking-wide">Failed</p>
                <p className="text-xl font-bold text-red-600">{progressData.failureCount}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-blue-600 uppercase tracking-wide">In Progress</p>
                <p className="text-xl font-bold text-blue-600">{remaining}</p>
              </div>
            </div>

            <p className="text-xs text-gray-500 text-center">
              {processed} of {total} records processed
            </p>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={uploading || !file || !organizationName.trim()}
          className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          {uploading ? <Spinner size="sm" /> : '📤'}
          {uploading ? 'Processing…' : 'Upload & Process'}
        </button>

        {/* Result summary */}
        {result && (
          <div className={`border rounded-lg p-4 ${
            result.status === 'COMPLETED' ? 'bg-green-50 border-green-200' :
            result.status === 'FAILED' ? 'bg-red-50 border-red-200' :
            'bg-yellow-50 border-yellow-200'
          }`}>
            <p className={`font-semibold mb-2 ${
              result.status === 'COMPLETED' ? 'text-green-700' :
              result.status === 'FAILED' ? 'text-red-700' :
              'text-yellow-700'
            }`}>
              {result.status === 'COMPLETED' ? '✅' : result.status === 'FAILED' ? '❌' : '⚠️'} Upload {result.status === 'COMPLETED' ? 'Complete' : result.status === 'FAILED' ? 'Failed' : 'Partially Complete'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-gray-500">Total:</span> <strong>{result.totalRecords}</strong></div>
              <div><span className="text-gray-500">Success:</span> <strong className="text-green-600">{result.successCount}</strong></div>
              <div><span className="text-gray-500">Failed:</span> <strong className="text-red-600">{result.failureCount}</strong></div>
              <div><span className="text-gray-500">Status:</span> <strong>{result.status}</strong></div>
            </div>
            {result.failureCount > 0 && (
              <Link
                to={`/failures/${result.uploadId}`}
                className="inline-block mt-3 text-sm text-blue-600 hover:underline"
              >
                View failure details →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Recent uploads table */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Recent Uploads</h2>
        {isLoading ? (
          <Spinner className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <HistoryFilterBar
              search={search} onSearch={setSearch}
              status={statusFilter} onStatus={setStatusFilter}
              from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate}
              count={filteredUploads.length} total={allUploads.length}
            />
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Filename</th>
                  <th className="px-4 py-2 text-left">Organization</th>
                  <th className="px-4 py-2 text-left">Total</th>
                  <th className="px-4 py-2 text-left">Success</th>
                  <th className="px-4 py-2 text-left">Failed</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUploads.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    {allUploads.length === 0 ? 'No uploads yet' : 'No uploads match your filters'}
                  </td></tr>
                )}
                {filteredUploads.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">#{u.id}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{u.filename}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{u.organizationName || '—'}</td>
                    <td className="px-4 py-3">{u.totalRecords}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{u.successCount}</td>
                    <td className="px-4 py-3 text-red-600 font-medium">{u.failureCount}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          to={`/uploads/${u.id}`}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          View details
                        </Link>
                        {u.failureCount > 0 && (
                          <Link
                            to={`/failures/${u.id}`}
                            className="text-red-600 hover:underline text-xs"
                          >
                            Failures
                          </Link>
                        )}
                      </div>
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

function DatePreview({ preview }) {
  if (preview.error) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
        ⚠️ {preview.error}
      </div>
    )
  }

  const { byDate = [], byBranch = [], uploadable = 0, skipped = 0, invalidDates = 0 } = preview
  const maxDate = byDate.reduce((m, d) => Math.max(m, d.count), 0)
  const maxBranch = byBranch.reduce((m, b) => Math.max(m, b.count), 0)

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-indigo-800 flex items-center gap-2">
          🔎 Upload Preview
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">
            {uploadable} to upload
          </span>
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">
            {byDate.length} {byDate.length === 1 ? 'date' : 'dates'}
          </span>
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">
            {byBranch.length} {byBranch.length === 1 ? 'branch' : 'branches'}
          </span>
          {invalidDates > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded font-medium">
              {invalidDates} bad date{invalidDates === 1 ? '' : 's'}
            </span>
          )}
          {skipped > 0 && (
            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
              {skipped} skipped
            </span>
          )}
        </div>
      </div>

      {byDate.length === 0 ? (
        <p className="text-sm text-indigo-700">No uploadable records found in this file.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          {/* By transaction date */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">By Transaction Date</p>
            <div className="space-y-1.5">
              {byDate.map((d) => (
                <PreviewBar key={d.iso} label={d.label} count={d.count} max={maxDate} labelWidth="w-24" />
              ))}
            </div>
          </div>

          {/* By branch / subinventory */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">By Branch / Subinventory</p>
            <div className="space-y-1.5">
              {byBranch.map((b) => (
                <PreviewBar key={b.branch} label={b.branch} count={b.count} max={maxBranch} labelWidth="w-28" mono />
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-indigo-600">
        Please confirm these match your file before uploading. Slash dates (e.g. <span className="font-mono">7/1/2026</span>) are read as <strong>month/day/year</strong> → July 1.
      </p>
    </div>
  )
}

function PreviewBar({ label, count, max, labelWidth, mono }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`${labelWidth} shrink-0 text-sm font-medium text-gray-700 whitespace-nowrap truncate ${mono ? 'font-mono text-xs' : ''}`}
        title={label}
      >
        {label}
      </span>
      <div className="flex-1 bg-indigo-100 rounded-full h-5 overflow-hidden">
        <div
          className="h-5 rounded-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${max > 0 ? Math.max((count / max) * 100, 6) : 0}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-sm font-bold text-indigo-800 text-right">{count}</span>
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
