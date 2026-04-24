/**
 * Hook for downloading the failure-records CSV for a specific inventory upload.
 * Calls the authenticated `/inventory/uploads/:id/failures/export` endpoint via
 * the axios instance (so the JWT auth header is sent), then triggers a browser
 * download of the resulting CSV blob.
 *
 * Returns:
 *   - exporting: boolean — true while a download is in progress
 *   - error:     string  — last error message, or '' when none
 *   - exportFailures(uploadId): triggers the download for the given upload
 *   - clearError(): clears the current error message
 */

import { useState, useCallback } from 'react'
import api from './useApi'

export default function useExportInventoryFailures() {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const exportFailures = useCallback(async (uploadId) => {
    if (!uploadId) return
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
      // Honor the filename suggested by the server (Content-Disposition header)
      const disposition = res.headers?.['content-disposition'] || ''
      const match = /filename="?([^";]+)"?/i.exec(disposition)
      link.setAttribute('download', match?.[1] || `failures_upload_${uploadId}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      // Blob responses with JSON error bodies need to be read out of the blob
      let message = err.response?.data?.error
      if (!message && err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text()
          const parsed = JSON.parse(text)
          message = parsed?.error
        } catch {
          /* ignore parse errors and fall back to the default message */
        }
      }
      setError(message || 'Failed to export failures CSV.')
    } finally {
      setExporting(false)
    }
  }, [])

  const clearError = useCallback(() => setError(''), [])

  return { exporting, error, exportFailures, clearError }
}
