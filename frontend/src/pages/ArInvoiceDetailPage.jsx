/**
 * AR Invoice Upload Detail Page.
 * Shows comprehensive details for a specific AR Invoice upload
 * including request payload and Oracle API response.
 */

import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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

function formatDetail(data) {
  if (!data) return '—'
  if (typeof data === 'string') {
    const parsed = parseJSON(data)
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
    return data
  }
  return JSON.stringify(data, null, 2)
}

export default function ArInvoiceDetailPage() {
  const { uploadId } = useParams()
  const navigate = useNavigate()

  const { data, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['arInvoiceDetail', uploadId],
    queryFn: () => api.get(`/ar-invoice/uploads/${uploadId}`).then((r) => r.data),
    enabled: !!uploadId,
  })

  if (isLoading) return <div className="flex justify-center mt-20"><Spinner size="lg" /></div>
  if (isError) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">AR Invoice Details</h1>
      <ErrorAlert message={queryError?.response?.data?.error || 'Failed to load invoice details.'} />
      <button onClick={() => navigate(-1)} className="inline-block px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
        ← Back
      </button>
    </div>
  )

  const upload = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">AR Invoice Details</h1>
          <p className="text-sm text-gray-500 mt-1">Upload #{upload.id}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate(-1)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Back
          </button>
          <Link to="/ar-invoice" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Create New Invoice
          </Link>
        </div>
      </div>

      {/* Upload summary card */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
              upload.responseStatus === 'SUCCESS' ? 'bg-green-100 text-green-700' :
              upload.responseStatus === 'FAILED' ? 'bg-red-100 text-red-700' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {upload.responseStatus || 'PROCESSING'}
            </span>
          </div>
          <div>
            <p className="text-sm text-gray-500">HTTP Status</p>
            <p className="font-medium text-gray-800 mt-1">{upload.httpStatus || '—'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Created At</p>
            <p className="font-medium text-gray-800 mt-1">
              {new Date(upload.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        {upload.responseMessage && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm text-gray-700">{upload.responseMessage}</p>
          </div>
        )}
        <div>
          <p className="text-sm text-gray-500">User</p>
          <p className="font-medium text-gray-800 mt-1">{upload.user?.email || '—'}</p>
        </div>
      </div>

      {/* Request payload */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Request Payload</h2>
        <div className="bg-gray-50 rounded-lg p-4">
          <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
            {formatDetail(upload.payloadJson)}
          </pre>
        </div>
      </div>

      {/* Response body */}
      {upload.responseBody && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-gray-700">Oracle API Response</h2>
          <div className="bg-gray-50 rounded-lg p-4">
            <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
              {formatDetail(upload.responseBody)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
