/**
 * Drag-and-drop / click-to-select CSV file dropzone component.
 */

import { useCallback, useState } from 'react'

export default function FileDropzone({ onFile, accept = '.csv', label = 'CSV file' }) {
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')

  const handleFile = useCallback((file) => {
    if (!file) return
    setFileName(file.name)
    onFile(file)
  }, [onFile])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }, [handleFile])

  const handleChange = (e) => handleFile(e.target.files[0])

  return (
    <label
      className={`
        flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-colors
        ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}
      `}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="flex flex-col items-center gap-2 text-gray-500">
        <span className="text-4xl">📂</span>
        {fileName ? (
          <span className="text-sm font-medium text-blue-600">{fileName}</span>
        ) : (
          <>
            <span className="text-sm font-medium">Drop {label} here or click to select</span>
            <span className="text-xs text-gray-400">{accept} files only</span>
          </>
        )}
      </div>
      <input type="file" accept={accept} className="hidden" onChange={handleChange} />
    </label>
  )
}
