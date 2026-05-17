/**
 * AR Invoice Creation Page.
 * Provides a form to create AR Invoices in Oracle Fusion via REST API.
 * Displays the request payload and Oracle API response.
 */

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const SAMPLE_PAYLOAD = {
  BusinessUnit: 'AlQurashi-KSA',
  TransactionSource: 'Vend',
  TransactionType: 'Vend Invoice',
  TransactionDate: '2025-10-01',
  AccountingDate: '2025-10-01',
  BillToCustomerName: 'Aziz Mall',
  BillToCustomerNumber: '13',
  BillToSite: '13',
  PaymentTerms: 'IMMEDIATE',
  InvoiceCurrencyCode: 'SAR',
  CrossReference: '32886',
  Comments: 'Invoice generated from request ID 32886',
  receivablesInvoiceLines: [
    {
      LineNumber: 1,
      ItemNumber: '6281074736314',
      Description: 'DOSE COLLECTION-HAPPINESS DOSE ROSE TOBACCO (PINK)/ Each',
      Quantity: 2,
      UnitSellingPrice: 94.79,
      TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
      SalesOrder: 'AZIZMALL/64181',
      MemoLine: null,
    },
    {
      LineNumber: 2,
      ItemNumber: '6281074736315',
      Description: 'DOSE COLLECTION-HAPPINESS DOSE ROSE TOBACCO (PINK)/ Each',
      Quantity: 2,
      UnitSellingPrice: 94.79,
      TaxClassificationCode: 'OUTPUT-GOODS-DOM-15%',
      SalesOrder: 'AZIZMALL/64181',
      MemoLine: null,
    },
  ],
}

export default function ArInvoicePage() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [payload, setPayload] = useState(JSON.stringify(SAMPLE_PAYLOAD, null, 2))
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // Check if a payload was passed from AR Invoice Data page
  useEffect(() => {
    if (location.state?.prefilledPayload) {
      setPayload(JSON.stringify(location.state.prefilledPayload, null, 2))
      // Clear the state so it doesn't persist on refresh
      window.history.replaceState({}, document.title)
    }
  }, [location.state])

  const { data: uploadsData, isLoading } = useQuery({
    queryKey: ['arInvoiceUploads'],
    queryFn: () => api.get('/ar-invoice/uploads').then((r) => r.data),
  })

  const handleSubmit = async () => {
    setError('')
    setResult(null)
    setSubmitting(true)

    try {
      // Parse and validate JSON
      const parsedPayload = JSON.parse(payload)

      // Submit to backend
      const res = await api.post('/ar-invoice/create', parsedPayload)
      setResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['arInvoiceUploads'] })
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON format. Please check your payload.')
      } else {
        setError(err.response?.data?.error || err.response?.data?.message || 'Submission failed.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleLoadSample = () => {
    setPayload(JSON.stringify(SAMPLE_PAYLOAD, null, 2))
    setError('')
    setResult(null)
  }

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(payload)
      setPayload(JSON.stringify(parsed, null, 2))
      setError('')
    } catch (err) {
      setError('Invalid JSON format. Cannot format.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">AR Invoice Creation</h1>
      </div>

      {/* Input card */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">Invoice Payload (JSON)</h2>
          <div className="flex gap-2">
            <button
              onClick={handleLoadSample}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              📋 Load Sample
            </button>
            <button
              onClick={handleFormatJson}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              ✨ Format JSON
            </button>
          </div>
        </div>

        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={20}
          className="w-full px-4 py-3 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
          placeholder="Paste your AR Invoice JSON payload here..."
        />

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-700 mb-2">Required Fields:</p>
          <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
            <li>BusinessUnit, TransactionSource, TransactionType</li>
            <li>TransactionDate, AccountingDate (YYYY-MM-DD format)</li>
            <li>BillToCustomerName, BillToCustomerNumber, BillToSite</li>
            <li>PaymentTerms, InvoiceCurrencyCode</li>
            <li>receivablesInvoiceLines (array with LineNumber, ItemNumber, Description, Quantity, UnitSellingPrice, TaxClassificationCode)</li>
          </ul>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        <button
          onClick={handleSubmit}
          disabled={submitting || !payload.trim()}
          className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          {submitting ? <Spinner size="sm" /> : '🚀'}
          {submitting ? 'Creating Invoice…' : 'Create AR Invoice'}
        </button>
      </div>

      {/* Result card */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-gray-700">Result</h2>

          <div className={`p-4 rounded-lg border ${
            result.status === 'SUCCESS' ? 'bg-green-50 border-green-200' :
            result.status === 'FAILED' ? 'bg-red-50 border-red-200' :
            'bg-yellow-50 border-yellow-200'
          }`}>
            <p className={`font-semibold ${
              result.status === 'SUCCESS' ? 'text-green-700' :
              result.status === 'FAILED' ? 'text-red-700' :
              'text-yellow-700'
            }`}>
              {result.status === 'SUCCESS' ? '✅ Invoice Created Successfully' :
               result.status === 'FAILED' ? '❌ Invoice Creation Failed' :
               '⚠️ Processing'}
            </p>
            {result.message && <p className="text-sm mt-1 text-gray-700">{result.message}</p>}
          </div>

          {result.response && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Oracle API Response:</p>
              <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
                {JSON.stringify(result.response, null, 2)}
              </pre>
            </div>
          )}

          {result.uploadId && (
            <Link
              to={`/ar-invoice/uploads/${result.uploadId}`}
              className="text-sm text-blue-600 hover:underline inline-block"
            >
              View Full Details →
            </Link>
          )}
        </div>
      )}

      {/* Upload history */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Recent Invoices</h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : uploadsData?.uploads?.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No invoices created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ID</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Created At</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">User</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">HTTP Status</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {uploadsData?.uploads?.map((upload) => (
                  <tr key={upload.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">#{upload.id}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {new Date(upload.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{upload.user?.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        upload.responseStatus === 'SUCCESS' ? 'bg-green-100 text-green-700' :
                        upload.responseStatus === 'FAILED' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {upload.responseStatus || 'PROCESSING'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{upload.httpStatus || '-'}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/ar-invoice/uploads/${upload.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View Details →
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
