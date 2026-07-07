import { useState } from 'react'

/**
 * Renders long text (response messages, logs) with a Show more / Show less toggle
 * instead of hard-truncating with an easy-to-miss hover tooltip. Empty → em dash.
 */
export default function ExpandableText({ text, max = 90, mono = false }) {
  const [open, setOpen] = useState(false)
  const str = text == null ? '' : String(text)

  if (!str.trim()) return <span className="text-gray-300">—</span>

  const long = str.length > max
  const body = open || !long ? str : `${str.slice(0, max)}…`

  return (
    <div className="max-w-md">
      <div className={`${open ? 'whitespace-pre-wrap break-words max-h-64 overflow-y-auto' : 'truncate'} ${mono ? 'font-mono' : ''}`}>
        {body}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-blue-500 hover:underline text-[10px] mt-0.5"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
