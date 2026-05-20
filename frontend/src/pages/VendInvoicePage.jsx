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
      // Show detailed errors if available
      if (err.response?.data?.errors) {
        const errorDetails = err.response.data.errors.map(e => `Row ${e.row}: ${e.error}`).join('\n')
        setError(`${err.response.data.error}\n\nDetails:\n${errorDetails}`)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadJson = async () => {
    if (!result?.payloads) return
    setDownloading(true)
    try {
      const response = await api.post('/vend-invoice/download-json', {
        payloads: result.payloads,
      }, {
        responseType: 'blob',
      })
      const blob = new Blob([JSON.stringify(result.payloads, null, 2)], { type: 'application/json' })
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
    if (!result?.payloads) return
    setDownloading(true)
    try {
      const response = await api.post('/vend-invoice/download-csv', {
        payloads: result.payloads,
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

  const handleBulkTransfer = () => {
    if (!result?.payloads) return
    // Navigate to AR Invoice page with all payloads
    navigate('/ar-invoice', { state: { bulkPayloads: result.payloads } })
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
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">Generated Payloads</h2>

            {/* Bulk actions */}
            <div className="flex gap-2">
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
                className="px-3 py-1.5 text-sm bg-blue-600 text-white font-medium rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
              >
                🚀 Bulk Transfer to AR Invoice
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-green-50 border-green-200">
            <p className="font-semibold text-green-700">✅ Success</p>
            <p className="text-sm mt-1 text-gray-700">{result.message}</p>
            <p className="text-xs mt-2 text-gray-600">
              Generated {result.invoiceCount} invoice(s) from {result.totalLines} sales line(s)
            </p>
          </div>

          {/* Amount Validation Report */}
          {result.amountValidation && (() => {
            const av = result.amountValidation
            const isMatch = av.isMatch
            const fmt = (n) => Number(n).toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            return (
              <div className={`p-4 rounded-lg border ${isMatch ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-semibold text-gray-800">📊 Amount Validation Report</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isMatch ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {isMatch ? '✅ AMOUNTS MATCH' : '⚠️ AMOUNT MISMATCH'}
                  </span>
                </div>

                {/* Totals comparison */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse mb-3">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-3 py-2 border border-gray-200 text-gray-700">Source</th>
                        <th className="text-right px-3 py-2 border border-gray-200 text-gray-700">Total Amount (SAR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-3 py-2 border border-gray-200 text-gray-600">Sales Lines File (raw input)</td>
                        <td className="px-3 py-2 border border-gray-200 text-right font-mono text-gray-800">{fmt(av.salesLinesTotal)}</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border border-gray-200 text-gray-600">Generated Payloads Total</td>
                        <td className="px-3 py-2 border border-gray-200 text-right font-mono text-gray-800">{fmt(av.payloadTotal)}</td>
                      </tr>
                      <tr className={isMatch ? 'bg-green-50' : 'bg-red-50'}>
                        <td className={`px-3 py-2 border border-gray-200 font-semibold ${isMatch ? 'text-green-700' : 'text-red-700'}`}>Difference</td>
                        <td className={`px-3 py-2 border border-gray-200 text-right font-mono font-bold ${isMatch ? 'text-green-700' : 'text-red-700'}`}>
                          {av.difference > 0 ? '+' : ''}{fmt(av.difference)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Per payment type breakdown */}
                <p className="text-xs font-medium text-gray-700 mb-1">Payload Amount by Payment Type:</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-3 py-2 border border-gray-200 text-gray-700">Payment Type</th>
                        <th className="text-right px-3 py-2 border border-gray-200 text-gray-700">Amount (SAR)</th>
                        <th className="text-right px-3 py-2 border border-gray-200 text-gray-700">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {['NORMAL', 'TABBY', 'TAMARA'].map((pt) => {
                        const amt = av.byPaymentType[pt] || 0
                        const pct = av.payloadTotal > 0 ? ((amt / av.payloadTotal) * 100).toFixed(1) : '0.0'
                        if (amt === 0) return null
                        return (
                          <tr key={pt}>
                            <td className="px-3 py-2 border border-gray-200 text-gray-600">{pt === 'NORMAL' ? 'Cash/Bank/Card (Normal)' : pt}</td>
                            <td className="px-3 py-2 border border-gray-200 text-right font-mono text-gray-800">{fmt(amt)}</td>
                            <td className="px-3 py-2 border border-gray-200 text-right text-gray-600">{pct}%</td>
                          </tr>
                        )
                      })}
                      <tr className="bg-gray-50 font-semibold">
                        <td className="px-3 py-2 border border-gray-200 text-gray-700">Total</td>
                        <td className="px-3 py-2 border border-gray-200 text-right font-mono text-gray-800">{fmt(av.payloadTotal)}</td>
                        <td className="px-3 py-2 border border-gray-200 text-right text-gray-600">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {!isMatch && (
                  <p className="text-xs text-red-600 mt-2">
                    ⚠️ The payload total differs from the sales lines total. This may occur when one sales order has multiple payment types (e.g., split between NORMAL and TABBY), causing lines to appear in more than one invoice. Please review the payloads below.
                  </p>
                )}
              </div>
            )
          })()}

          <div className="space-y-4">
            {result.payloads?.map((payload, index) => (
              <div key={index} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Invoice #{index + 1} - {payload.BillToCustomerName}
                    </p>
                    <p className="text-xs text-gray-600">
                      Date: {payload.TransactionDate} | CrossRef: {payload.CrossReference} | Lines: {payload.receivablesInvoiceLines.length}
                      {(() => {
                        const total = payload.receivablesInvoiceLines.reduce((s, l) => s + (l.Quantity || 0) * (l.UnitSellingPrice || 0), 0)
                        return <> | <span className="font-semibold text-gray-800">Total: SAR {Number(total).toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></>
                      })()}
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
                            {line.Quantity} × {line.UnitSellingPrice} = <span className="font-semibold">{Number(lineTotal).toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {/* Invoice grand total row */}
                  <div className="mt-2 pt-2 border-t border-gray-200 text-xs flex justify-between font-semibold text-gray-700">
                    <span>Invoice Total</span>
                    <span className="font-mono">SAR {Number(payload.receivablesInvoiceLines.reduce((s, l) => s + (l.Quantity || 0) * (l.UnitSellingPrice || 0), 0)).toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
