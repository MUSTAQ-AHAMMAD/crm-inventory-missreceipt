/**
 * Inventory Template Generation Page.
 * Converts Amro inventory exports into the inventory transaction template with preview/download.
 */

import { useState } from 'react'
import api from '../hooks/useApi'
import FileDropzone from '../components/common/FileDropzone'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const OUTPUT_HEADERS = [
  'TransactionTypeName',
  'ItemNumber',
  'SubinventoryCode',
  'TransactionDate',
  'TransactionQuantity',
  'TransactionReference',
  'TransactionUnitOfMeasure',
]

export default function InventoryTemplateGenerationPage() {
  const [file, setFile] = useState(null)
  const [previewRows, setPreviewRows] = useState([])
  const [totalRows, setTotalRows] = useState(0)
  const [skippedRows, setSkippedRows] = useState(0)
  const [warnings, setWarnings] = useState([])
  const [previewing, setPreviewing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  const handlePreview = async () => {
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setPreviewRows([])
    setTotalRows(0)
    setSkippedRows(0)
    setWarnings([])
    setPreviewing(true)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await api.post('/inventory-template/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreviewRows(res.data.previewRows || [])
      setTotalRows(res.data.totalRows || 0)
      setSkippedRows(res.data.skippedRows || 0)
      setWarnings(res.data.warnings || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed.')
    } finally {
      setPreviewing(false)
    }
  }

  const handleDownload = async () => {
    if (!file) { setError('Please select a CSV file.'); return }
    setError('')
    setDownloading(true)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await api.post('/inventory-template/download', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'inventory_template_generated.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.error || 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Inventory Template Generation</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <p className="text-sm text-gray-700">
          Upload the Amro inventory export CSV and convert it into the inventory transaction template.
          Quantities are inverted (positive becomes negative, negative becomes positive), summed per Branch + Barcode + Order Ref, and transaction type is derived from the inverted sign.
          Exception: REFUND transactions keep their quantity positive.
        </p>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-700 mb-2">Mapping</p>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Branch/Name (text before "/") → SubinventoryCode</li>
              <li>Product/Barcode → ItemNumber</li>
              <li>Order Ref → TransactionReference</li>
              <li>Order Lines/Order Ref/Date (optional) → TransactionDate</li>
              <li>Base UoM (optional) → TransactionUnitOfMeasure</li>
              <li>Total → TransactionQuantity</li>
              <li>Picking Type/Name (optional) → Checked for "REFUND"</li>
            </ul>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-lg p-4">
            <p className="text-sm font-semibold text-green-700 mb-2">Derived values</p>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>TransactionQuantity: inverted sign (positive → negative, negative → positive) UNLESS it's a REFUND (then kept positive)</li>
              <li>TransactionTypeName: Vend Sales Issue when final qty &lt; 0, Vendor RMA when final qty &gt; 0</li>
              <li>TransactionDate: uses Order Ref Date when present, otherwise today (YYYY-MM-DD)</li>
              <li>TransactionUnitOfMeasure: defaults to Each when missing</li>
              <li>Output columns order is fixed:</li>
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              {OUTPUT_HEADERS.map((h) => (
                <span key={h} className="px-2 py-0.5 bg-white border border-green-200 rounded text-xs font-mono text-green-700">
                  {h}
                </span>
              ))}
            </div>
          </div>
        </div>

        <FileDropzone onFile={setFile} label="Amro inventory CSV" />

        <ErrorAlert message={error} onDismiss={() => setError('')} />

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handlePreview}
            disabled={previewing || !file}
            className="px-5 py-2.5 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {previewing ? <Spinner size="sm" /> : '👁️'}
            {previewing ? 'Generating preview…' : 'Preview conversion'}
          </button>

          <button
            onClick={handleDownload}
            disabled={downloading || !file}
            className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {downloading ? <Spinner size="sm" /> : '⬇️'}
            {downloading ? 'Preparing CSV…' : 'Download template CSV'}
          </button>
        </div>

        {totalRows > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <strong>{totalRows}</strong> converted row{totalRows === 1 ? '' : 's'}. Preview shows the first{' '}
            {Math.min(totalRows, previewRows.length)}.
          </div>
        )}

        {(skippedRows > 0 || warnings.length > 0) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800 space-y-2">
            <div className="font-semibold text-yellow-900">
              Skipped {skippedRows} row{skippedRows === 1 ? '' : 's'} due to missing or invalid data.
            </div>
            {warnings.length > 0 && (
              <ul className="list-disc list-inside space-y-1 text-yellow-900">
                {warnings.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {previewRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">Converted Preview</h2>
            <span className="text-sm text-gray-500">Showing up to 50 rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  {OUTPUT_HEADERS.map((col) => (
                    <th key={col} className="px-4 py-2 text-left whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    {OUTPUT_HEADERS.map((col) => (
                      <td key={col} className="px-4 py-2 text-gray-800 whitespace-nowrap">
                        {row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
