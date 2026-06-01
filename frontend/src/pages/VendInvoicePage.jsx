/**
 * Vend Invoice Upload Page.
 * Allows users to upload two Excel files (Payment Lines and Sales Lines)
 * and generates AR Invoice payloads grouped by store and date.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

export default function VendInvoicePage() {
  const navigate = useNavigate()
  const [paymentLinesFile, setPaymentLinesFile] = useState(null)
  const [salesLinesFile, setSalesLinesFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const handleFileSelect = (type, file) => {
    if (type === 'payment') {
      setPaymentLinesFile(file)
    } else {
      setSalesLinesFile(file)
    }
    setError('')
  }

  const handleDrop = (type, e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(type, file)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const handleUpload = async () => {
    if (!paymentLinesFile || !salesLinesFile) {
      setError('Please select both Payment Lines and Sales Lines files.')
      return
    }
    setError('')
    setResult(null)
    setUploading(true)

    const formData = new FormData()
    formData.append('paymentLines', paymentLinesFile)
    formData.append('salesLines', salesLinesFile)

    try {
      const res = await api.post('/vend-invoice/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
      setPaymentLinesFile(null)
      setSalesLinesFile(null)
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.details || 'Upload failed.')
      if (err.response?.data?.errors) {
        const errorDetails = err.response.data.errors.map(e => `Row ${e.row}: ${e.error}`).join('\n')
        setError(`${err.response.data.error}\n\nDetails:\n${errorDetails}`)
      }
    } finally {
      setUploading(false)
    }
  }

  // Combine positive + negative for downloads
  const allPayloads = result
    ? [...(result.positivePayloads || []), ...(result.negativePayloads || [])]
    : []

  const handleDownloadJson = async () => {
    if (!allPayloads.length) return
    setDownloading(true)
    try {
      const blob = new Blob([JSON.stringify(allPayloads, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      link.download = `vend-invoices-${timestamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('Failed to download JSON file')
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadCsv = async () => {
    if (!allPayloads.length) return
    setDownloading(true)
    try {
      const response = await api.post('/vend-invoice/download-csv', {
        payloads: allPayloads,
      }, {
        responseType: 'blob',
      })
      const blob = new Blob([response.data], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      link.download = `vend-invoices-${timestamp}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('Failed to download CSV file')
    } finally {
      setDownloading(false)
    }
  }

  // Only positive payloads are transferred to AR Invoice
  const handleBulkTransfer = () => {
    if (!result?.positivePayloads?.length) return
    navigate('/ar-invoice', { state: { bulkPayloads: result.positivePayloads } })
  }

  const fmt = (n) =>
    Number(n).toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const PayloadCard = ({ payload, index, isNegative }) => {
    return (
      <div className={`rounded-lg p-4 ${isNegative ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className={`text-sm font-medium ${isNegative ? 'text-red-700' : 'text-gray-700'}`}>
              {isNegative ? '⚠️ ' : ''}Invoice #{index + 1} - {payload.BillToCustomerName}
            </p>
            <p className="text-xs text-gray-600">
              Date: {payload.TransactionDate} | CrossRef: {payload.CrossReference} | Lines: {payload.receivablesInvoiceLines.length}
            </p>
          </div>
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

        {/* Summary of line items */}
        <div className="mt-3 p-3 bg-white rounded border border-gray-200">
          <p className="text-xs font-medium text-gray-700 mb-2">Line Items Summary:</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {payload.receivablesInvoiceLines.map((line, lineIdx) => {
              const lineTotal = (line.Quantity || 0) * (line.UnitSellingPrice || 0)
              return (
                <div key={lineIdx} className="text-xs text-gray-600 flex justify-between gap-2">
                  <span className="truncate">
                    {line.LineNumber}. {line.ItemNumber || <em className="text-gray-500">(MemoLine)</em>} - {line.Description.substring(0, 35)}
                    {line.Description.length > 35 ? '...' : ''}
                  </span>
                  <span className="font-mono whitespace-nowrap">
                    {line.Quantity} × {line.UnitSellingPrice} = <span className="font-semibold">{fmt(lineTotal)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Full JSON preview (collapsed by default) */}
        <details className="mt-3">
          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
            View Full JSON
          </summary>
          <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto max-h-96 mt-2">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>

        {!isNegative && (
          <div className="mt-3">
            <Link
              to="/ar-invoice"
              state={{ prefilledPayload: payload }}
              className="text-sm text-blue-600 hover:underline"
            >
              → Use this payload in AR Invoice Creation
            </Link>
          </div>
        )}
      </div>
    )
  }

  const FileUploadBox = ({ title, file, onFileSelect, type }) => (
    <div className="flex-1">
      <h3 className="font-semibold text-gray-700 mb-2">{title}</h3>
      <div
        onDrop={(e) => handleDrop(type, e)}
        onDragOver={handleDragOver}
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors cursor-pointer"
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => onFileSelect(type, e.target.files[0])}
          className="hidden"
          id={`${type}-file-input`}
          disabled={uploading}
        />
        <label htmlFor={`${type}-file-input`} className="cursor-pointer">
          {file ? (
            <div className="space-y-2">
              <div className="text-green-600 text-2xl">✓</div>
              <p className="text-sm font-medium text-gray-700">{file.name}</p>
              <p className="text-xs text-gray-500">
                {(file.size / 1024).toFixed(2)} KB
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  onFileSelect(type, null)
                }}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-gray-400 text-3xl">📁</div>
              <p className="text-sm text-gray-600">
                Drag & drop an Excel file here, or click to browse
              </p>
              <p className="text-xs text-gray-500">Supports .xlsx and .xls files</p>
            </div>
          )}
        </label>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Vend Invoice Upload</h1>
      </div>

      {/* Upload card */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Upload Excel Files</h2>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-700 mb-2">Instructions:</p>
          <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
            <li>Upload two Excel files: Payment Lines and Sales Lines</li>
            <li>System will automatically group data by store (subinventory code) and date</li>
            <li>One invoice will be generated per store per day</li>
            <li>Lines without SKU will be treated as MemoLine items (e.g., discounts)</li>
            <li>CrossReference numbers are auto-incremented</li>
          </ul>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <FileUploadBox
            title="Payment Lines (Excel)"
            file={paymentLinesFile}
            onFileSelect={handleFileSelect}
            type="payment"
          />
          <FileUploadBox
            title="Sales Lines (Excel)"
            file={salesLinesFile}
            onFileSelect={handleFileSelect}
            type="sales"
          />
        </div>

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        <button
          onClick={handleUpload}
          disabled={uploading || !paymentLinesFile || !salesLinesFile}
          className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          {uploading ? <Spinner size="sm" /> : '📤'}
          {uploading ? 'Processing…' : 'Generate AR Invoice Payloads'}
        </button>
      </div>

      {/* Result card */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-gray-700">Generated Payloads</h2>

            {/* Bulk actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleDownloadJson}
                disabled={downloading}
                className="px-3 py-1.5 text-sm bg-green-600 text-white font-medium rounded hover:bg-green-700 disabled:opacity-60 transition-colors flex items-center gap-1"
              >
                {downloading ? <Spinner size="sm" /> : '📥'}
                Download JSON
              </button>
              <button
                onClick={handleDownloadCsv}
                disabled={downloading}
                className="px-3 py-1.5 text-sm bg-green-600 text-white font-medium rounded hover:bg-green-700 disabled:opacity-60 transition-colors flex items-center gap-1"
              >
                {downloading ? <Spinner size="sm" /> : '📥'}
                Download CSV
              </button>
              <button
                onClick={handleBulkTransfer}
                disabled={!result?.positivePayloads?.length}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white font-medium rounded hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-1"
              >
                🚀 Bulk Transfer to AR Invoice
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-green-50 border-green-200">
            <p className="font-semibold text-green-700">✅ Success</p>
            <p className="text-sm mt-1 text-gray-700">{result.message}</p>
          </div>

          {/* ── Statistics ── */}
          {result.stats && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-700">📊 Statistics</h3>

              {/* Overall summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { label: 'Sales Lines', value: result.stats.totalSalesLines },
                  { label: 'Total Payloads', value: result.stats.totalPayloads },
                  { label: 'Positive Payloads', value: result.stats.positivePayloadsCount, color: 'text-green-700' },
                  { label: 'Negative Payloads', value: result.stats.negativePayloadsCount, color: 'text-red-700' },
                  { label: 'Overall Total (SAR)', value: fmt(result.stats.overallTotalAmount), mono: true },
                ].map((item) => (
                  <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center border border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <p className={`font-bold text-base ${item.color || 'text-gray-800'} ${item.mono ? 'font-mono' : ''}`}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Positive / negative totals */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs text-green-700 font-medium">Positive Payloads Total (SAR)</p>
                  <p className="font-mono font-bold text-green-800 text-sm mt-1">{fmt(result.stats.positiveTotalAmount)}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs text-red-700 font-medium">Negative Payloads Total (SAR)</p>
                  <p className="font-mono font-bold text-red-800 text-sm mt-1">{fmt(result.stats.negativeTotalAmount)}</p>
                </div>
              </div>

              {/* Per-payload stats table */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2">CrossRef</th>
                      <th className="text-left px-3 py-2">Customer</th>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Payment Type</th>
                      <th className="text-right px-3 py-2">Lines</th>
                      <th className="text-right px-3 py-2">Total (SAR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stats.payloadStats.map((s, idx) => (
                      <tr key={idx} className={`border-t border-gray-100 ${s.totalAmount < 0 ? 'bg-red-50 text-red-700' : 'text-gray-700'}`}>
                        <td className="px-3 py-2 font-mono">{s.crossReference}</td>
                        <td className="px-3 py-2 truncate max-w-[180px]">{s.billToCustomerName}</td>
                        <td className="px-3 py-2">{s.transactionDate}</td>
                        <td className="px-3 py-2">{s.paymentType}</td>
                        <td className="px-3 py-2 text-right">{s.lineCount}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${s.totalAmount < 0 ? 'text-red-700' : ''}`}>
                          {fmt(s.totalAmount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                      <td className="px-3 py-2" colSpan={4}>Overall Total</td>
                      <td className="px-3 py-2 text-right">{result.stats.payloadStats.reduce((s, r) => s + r.lineCount, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(result.stats.overallTotalAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Positive Payloads ── */}
          {result.positivePayloads?.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-700 text-green-700">
                ✅ Positive Payloads ({result.positivePayloads.length})
              </h3>
              {result.positivePayloads.map((payload, index) => (
                <PayloadCard key={index} payload={payload} index={index} isNegative={false} />
              ))}
            </div>
          )}

          {/* ── Negative Payloads ── */}
          {result.negativePayloads?.length > 0 && (
            <div className="space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="font-semibold text-red-700">
                  ⚠️ Negative Payloads ({result.negativePayloads.length}) — Cannot be processed in AR Invoice
                </p>
                <p className="text-xs text-red-600 mt-1">
                  These invoices have a negative total amount. Review the sales lines data before processing.
                </p>
              </div>
              {result.negativePayloads.map((payload, index) => (
                <PayloadCard key={index} payload={payload} index={index} isNegative={true} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
