/**
 * AR Invoice Data Upload Page.
 * Allows users to upload CSV files containing AR invoice line items,
 * view stored data, and generate payloads for Oracle submission.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../hooks/useApi'
import FileDropzone from '../components/common/FileDropzone'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const REQUIRED_COLUMNS = [
  'customerName',
  'itemNumber',
  'description',
  'quantity',
  'unitSellingPrice',
  'taxClassificationCode',
  'transactionDate',
  'accountingDate',
  'paymentTerms',
  'invoiceCurrencyCode',
]

const OPTIONAL_COLUMNS = [
  'customerNumber',
  'siteNumber',
  'subinventory',
  'businessUnit',
  'transactionSource',
  'transactionType',
  'crossReference',
  'comments',
  'lineNumber',
  'salesOrder',
  'memoLine',
]

export default function ArInvoiceDataPage() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [generatedPayload, setGeneratedPayload] = useState(null)
  const [generating, setGenerating] = useState(false)

  const { data: batchesData, isLoading: batchesLoading } = useQuery({
    queryKey: ['arInvoiceDataBatches'],
    queryFn: () => api.get('/ar-invoice-data/batches').then((r) => r.data),
  })

  const { data: recordsData, isLoading: recordsLoading } = useQuery({
    queryKey: ['arInvoiceDataRecords', selectedBatch],
    queryFn: () => {
      const params = selectedBatch ? `?uploadBatchId=${selectedBatch}` : ''
      return api.get(`/ar-invoice-data/list${params}`).then((r) => r.data)
    },
    enabled: !!selectedBatch,
  })

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a CSV file.')
      return
    }
    setError('')
    setResult(null)
    setUploading(true)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await api.post('/ar-invoice-data/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
      setFile(null)
      queryClient.invalidateQueries({ queryKey: ['arInvoiceDataBatches'] })
      // Auto-select the newly uploaded batch
      if (res.data.uploadBatchId) {
        setSelectedBatch(res.data.uploadBatchId)
      }
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.details || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadTemplate = () => {
    window.open(`${api.defaults.baseURL}/ar-invoice-data/template`, '_blank')
  }

  const handleGeneratePayload = async (uploadBatchId) => {
    setGenerating(true)
    setError('')
    setGeneratedPayload(null)

    try {
      const res = await api.post('/ar-invoice-data/generate-payload', {
        uploadBatchId,
      })
      setGeneratedPayload(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate payload.')
    } finally {
      setGenerating(false)
    }
  }

  const handleDeleteBatch = async (uploadBatchId) => {
    if (!confirm('Are you sure you want to delete this batch? This action cannot be undone.')) {
      return
    }

    try {
      await api.delete(`/ar-invoice-data/batch/${uploadBatchId}`)
      queryClient.invalidateQueries({ queryKey: ['arInvoiceDataBatches'] })
      if (selectedBatch === uploadBatchId) {
        setSelectedBatch(null)
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete batch.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">AR Invoice Data Upload</h1>
        <button
          onClick={handleDownloadTemplate}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
        >
          📥 Download Template
        </button>
      </div>

      {/* Upload card */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Upload CSV File</h2>

        <FileDropzone
          file={file}
          onFileSelect={setFile}
          accept=".csv"
          disabled={uploading}
        />

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-700 mb-2">Required CSV Columns:</p>
          <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
            <li>{REQUIRED_COLUMNS.slice(0, 5).join(', ')}</li>
            <li>{REQUIRED_COLUMNS.slice(5).join(', ')}</li>
          </ul>
          <p className="text-sm font-medium text-blue-700 mt-3 mb-2">Optional Columns:</p>
          <p className="text-xs text-blue-700">{OPTIONAL_COLUMNS.join(', ')}</p>
          <p className="text-xs text-blue-600 mt-2">
            💡 If you provide customerName and subinventory, header fields will be auto-populated from metadata.
          </p>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        <button
          onClick={handleUpload}
          disabled={uploading || !file}
          className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          {uploading ? <Spinner size="sm" /> : '📤'}
          {uploading ? 'Uploading…' : 'Upload CSV'}
        </button>
      </div>

      {/* Result card */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-gray-700">Upload Result</h2>

          <div className="p-4 rounded-lg border bg-green-50 border-green-200">
            <p className="font-semibold text-green-700">✅ Upload Successful</p>
            <p className="text-sm mt-1 text-gray-700">{result.message}</p>
            <p className="text-xs mt-2 text-gray-600">
              Batch ID: <span className="font-mono">{result.uploadBatchId}</span>
            </p>
          </div>
        </div>
      )}

      {/* Batches list */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Uploaded Batches</h2>

        {batchesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : batchesData?.batches?.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No batches uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Batch ID</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Records</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Created At</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batchesData?.batches?.map((batch) => (
                  <tr
                    key={batch.uploadBatchId}
                    className={`hover:bg-gray-50 ${
                      selectedBatch === batch.uploadBatchId ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                      {batch.uploadBatchId.substring(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-gray-700">{batch.recordCount}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {new Date(batch.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        onClick={() => setSelectedBatch(batch.uploadBatchId)}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View Records
                      </button>
                      <button
                        onClick={() => handleGeneratePayload(batch.uploadBatchId)}
                        disabled={generating}
                        className="text-green-600 hover:underline text-xs disabled:opacity-50"
                      >
                        Generate Payload
                      </button>
                      <button
                        onClick={() => handleDeleteBatch(batch.uploadBatchId)}
                        className="text-red-600 hover:underline text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Records for selected batch */}
      {selectedBatch && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">
              Records for Batch: {selectedBatch.substring(0, 8)}...
            </h2>
            <button
              onClick={() => setSelectedBatch(null)}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              ✕ Close
            </button>
          </div>

          {recordsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : recordsData?.records?.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No records found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Line#</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Customer</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Item</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Description</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Qty</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Price</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recordsData?.records?.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{record.lineNumber}</td>
                      <td className="px-3 py-2 text-gray-700">{record.customerName}</td>
                      <td className="px-3 py-2 text-gray-700 font-mono">{record.itemNumber}</td>
                      <td className="px-3 py-2 text-gray-700" title={record.description}>
                        {record.description.substring(0, 30)}
                        {record.description.length > 30 ? '...' : ''}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{record.quantity}</td>
                      <td className="px-3 py-2 text-gray-700">{record.unitSellingPrice}</td>
                      <td className="px-3 py-2 text-gray-700">{record.transactionDate}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            record.status === 'PENDING'
                              ? 'bg-yellow-100 text-yellow-700'
                              : record.status === 'PROCESSED'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {record.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Generated payload display */}
      {generatedPayload && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">Generated Payloads</h2>
            <button
              onClick={() => setGeneratedPayload(null)}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              ✕ Close
            </button>
          </div>

          <div className="p-4 rounded-lg border bg-green-50 border-green-200">
            <p className="font-semibold text-green-700">✅ Payload Generated</p>
            <p className="text-sm mt-1 text-gray-700">
              Generated {generatedPayload.invoiceCount} invoice(s) from {generatedPayload.totalLines} line(s)
            </p>
          </div>

          <div className="space-y-4">
            {generatedPayload.payloads?.map((payload, index) => (
              <div key={index} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">
                    Invoice #{index + 1} - {payload.BillToCustomerName}
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
                      alert('Payload copied to clipboard!')
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    📋 Copy JSON
                  </button>
                </div>
                <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto max-h-96">
                  {JSON.stringify(payload, null, 2)}
                </pre>
                <div className="mt-3">
                  <Link
                    to="/ar-invoice"
                    state={{ prefilledPayload: payload }}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    → Use this payload in AR Invoice Creation
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
