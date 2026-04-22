/**
 * Reports & Monitoring Page.
 * Tabbed interface with dashboard charts, failure tables, activity logs, and CSV export.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const TABS = ['Dashboard', 'Upload History', 'Failures', 'Activity', 'Export']

export default function ReportsPage() {
  const [tab, setTab] = useState('Dashboard')
  const [filters, setFilters] = useState({ from: '', to: '', type: '' })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Reports & Monitoring</h1>

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
          </button>
        ))}
      </div>

      {/* Date range filter (shared across tabs) */}
      <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
        {tab === 'Failures' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="">All</option>
              <option value="inventory">Inventory</option>
              <option value="misc">Misc Receipt</option>
              <option value="standard">Standard Receipt</option>
            </select>
          </div>
        )}
        <button
          onClick={() => setFilters({ from: '', to: '', type: '' })}
          className="px-3 py-1.5 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Clear
        </button>
      </div>

      {/* Tab content */}
      {tab === 'Dashboard' && <DashboardTab />}
      {tab === 'Upload History' && <UploadHistoryTab filters={filters} />}
      {tab === 'Failures' && <FailuresTab filters={filters} />}
      {tab === 'Activity' && <ActivityTab filters={filters} />}
      {tab === 'Export' && <ExportTab filters={filters} />}
    </div>
  )
}

function DashboardTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then((r) => r.data),
  })

  if (isLoading) return <Spinner className="py-12" />
  if (error) return <ErrorAlert message="Failed to load dashboard metrics." />

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <h2 className="font-semibold text-gray-700">Summary Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Inventory Uploads', value: data?.totalInventoryUploads },
          { label: 'Misc Uploads', value: data?.totalMiscUploads },
          { label: 'Standard Uploads', value: data?.totalStandardReceiptUploads },
          { label: 'Success Records', value: data?.totalSuccessRecords },
          { label: 'Failed Records', value: data?.totalFailureRecords },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{value ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function UploadHistoryTab({ filters }) {
  const [page, setPage] = useState(1)
  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: ['allUploads', filters, page],
    queryFn: () => api.get('/reports/all-uploads', { params: { page, limit } }).then((r) => r.data),
  })

  if (isLoading) return <Spinner className="py-12" />
  if (error) return <ErrorAlert message="Failed to load upload history." />

  const uploads = data?.uploads || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / limit) || 1

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="font-semibold text-gray-700 mb-4">Upload History ({total} uploads)</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">CSV File</th>
              <th className="px-4 py-2 text-left">Organization</th>
              <th className="px-4 py-2 text-left">Uploaded By</th>
              <th className="px-4 py-2 text-left">Total</th>
              <th className="px-4 py-2 text-left">Success</th>
              <th className="px-4 py-2 text-left">Failed</th>
              <th className="px-4 py-2 text-left">Success Rate</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {uploads.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">No uploads found</td></tr>
            )}
            {uploads.map((u) => {
              const totalRecords = u.totalRecords || 0
              const successCount = u.successCount || 0
              const failureCount = u.failureCount || 0
              const rate = totalRecords > 0 ? Math.round((successCount / totalRecords) * 100) : 0
              const uploadType = u.uploadType
              const status = u.status || u.responseStatus || 'UNKNOWN'

              // Determine the detail page link based on upload type
              let detailLink = `/uploads/${u.id}`
              if (uploadType === 'standard') {
                detailLink = `/receipt-upload/standard/${u.id}`
              } else if (uploadType === 'misc') {
                detailLink = `/receipt-upload/misc/${u.id}`
              } else if (uploadType === 'apply') {
                detailLink = `/receipt-upload/apply/${u.id}`
              }

              return (
                <tr key={`${uploadType}-${u.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">#{u.id}</td>
                  <td className="px-4 py-3">
                    <UploadTypeBadge type={uploadType} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{u.filename}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{u.organizationName || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{u.user?.email || '—'}</td>
                  <td className="px-4 py-3">{totalRecords || '—'}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{successCount || '—'}</td>
                  <td className="px-4 py-3 text-red-600 font-medium">{failureCount || '—'}</td>
                  <td className="px-4 py-3">
                    {totalRecords > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-green-500"
                            style={{ width: `${rate}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{rate}%</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <UploadStatusBadge status={status} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link to={detailLink} className="text-blue-600 hover:underline text-xs">
                      View details
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadStatusBadge({ status }) {
  const map = {
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
    PARTIAL: 'bg-yellow-100 text-yellow-700',
    PROCESSING: 'bg-blue-100 text-blue-700',
    PENDING: 'bg-gray-100 text-gray-600',
    SUCCESS: 'bg-green-100 text-green-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function UploadTypeBadge({ type }) {
  const map = {
    inventory: { label: 'Inventory', class: 'bg-blue-100 text-blue-700' },
    standard: { label: 'Standard Receipt', class: 'bg-purple-100 text-purple-700' },
    misc: { label: 'Misc Receipt', class: 'bg-green-100 text-green-700' },
    apply: { label: 'Apply Receipt', class: 'bg-indigo-100 text-indigo-700' },
  }
  const badge = map[type] || { label: type, class: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.class}`}>
      {badge.label}
    </span>
  )
}

function FailuresTab({ filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reportFailures', filters],
    queryFn: () => api.get('/reports/failures', { params: filters }).then((r) => r.data),
  })

  if (isLoading) return <Spinner className="py-12" />
  if (error) return <ErrorAlert message="Failed to load failures." />

  const invFails = data?.inventoryFailures || []
  const miscFails = data?.miscFailures || []
  const standardFails = data?.standardFailures || []

  return (
    <div className="space-y-6">
      {(!filters.type || filters.type === 'inventory') && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">Inventory Failures ({invFails.length})</h2>
          <FailureTable rows={invFails} />
        </div>
      )}
      {(!filters.type || filters.type === 'misc') && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">Misc Receipt Failures ({miscFails.length})</h2>
          <FailureTable rows={miscFails} />
        </div>
      )}
      {(!filters.type || filters.type === 'standard') && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">Standard Receipt Failures ({standardFails.length})</h2>
          <FailureTable rows={standardFails} />
        </div>
      )}
    </div>
  )
}

function FailureTable({ rows }) {
  if (rows.length === 0) return <p className="text-gray-400 text-sm py-4">No failures found.</p>
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
            <th className="px-4 py-2 text-left">Upload ID</th>
            <th className="px-4 py-2 text-left">Filename</th>
            <th className="px-4 py-2 text-left">Row #</th>
            <th className="px-4 py-2 text-left">Error</th>
            <th className="px-4 py-2 text-left">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-500">#{r.uploadId}</td>
              <td className="px-4 py-3 text-gray-600 text-xs font-mono">{r.upload?.filename}</td>
              <td className="px-4 py-3">{r.rowNumber}</td>
              <td className="px-4 py-3 text-red-600 text-xs max-w-xs truncate">{r.errorMessage}</td>
              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivityTab({ filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reportActivity', filters],
    queryFn: () => api.get('/reports/activity', { params: filters }).then((r) => r.data),
  })

  if (isLoading) return <Spinner className="py-12" />
  if (error) return <ErrorAlert message="Failed to load activity logs." />

  const logs = data?.logs || []

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="font-semibold text-gray-700 mb-4">Activity Logs ({data?.total ?? 0})</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="px-4 py-2 text-left">User</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Details</th>
              <th className="px-4 py-2 text-left">IP</th>
              <th className="px-4 py-2 text-left">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No activity found</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-600">{l.user?.email}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{l.actionType}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{l.actionDetails}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{l.ipAddress}</td>
                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExportTab({ filters }) {
  const [exporting, setExporting] = useState('')

  const handleExport = async (type) => {
    setExporting(type)
    try {
      const res = await api.get('/reports/export', {
        params: { type, ...filters },
        responseType: 'blob',
      })
      const filename = type === 'activity' ? 'activity_export.csv' : 'failures_export.csv'
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      if (err.response?.status !== 401) {
        console.error('Export failed:', err)
      }
    } finally {
      setExporting('')
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <h2 className="font-semibold text-gray-700">Export Reports</h2>
      <p className="text-sm text-gray-500">Download CSV reports with the current date filters applied.</p>
      <div className="flex flex-wrap gap-4 mt-4">
        <button
          onClick={() => handleExport('failures')}
          disabled={!!exporting}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          ⬇️ {exporting === 'failures' ? 'Exporting…' : 'Export Failures CSV'}
        </button>
        <button
          onClick={() => handleExport('activity')}
          disabled={!!exporting}
          className="px-5 py-2.5 bg-gray-600 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          ⬇️ {exporting === 'activity' ? 'Exporting…' : 'Export Activity CSV'}
        </button>
      </div>
    </div>
  )
}
