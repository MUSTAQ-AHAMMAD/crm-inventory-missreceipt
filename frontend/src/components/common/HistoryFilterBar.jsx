/**
 * Reusable search + status + date-range filter bar for history/uploads tables.
 * Fully controlled — parent owns the state and does the filtering (see
 * filterUploads in utils/format.js).
 */
export default function HistoryFilterBar({
  search,
  onSearch,
  status,
  onStatus,
  statusOptions = ['SUCCESS', 'PARTIAL', 'FAILED', 'PROCESSING'],
  from = '',
  to = '',
  onFrom,
  onTo,
  showDates = true,
  searchPlaceholder = 'Search filename, status, response…',
  count,
  total,
}) {
  const showDateInputs = showDates && onFrom && onTo
  const canClear = search || status || from || to

  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs text-gray-500 mb-1">Search</label>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {onStatus && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => onStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">All</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {showDateInputs && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => onFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => onTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </>
      )}

      {canClear && (
        <button
          type="button"
          onClick={() => {
            onSearch('')
            onStatus && onStatus('')
            onFrom && onFrom('')
            onTo && onTo('')
          }}
          className="text-xs text-gray-500 hover:text-gray-700 underline pb-2.5"
        >
          Clear
        </button>
      )}

      {typeof count === 'number' && (
        <span className="text-xs text-gray-400 pb-2.5 ml-auto">
          {count}{typeof total === 'number' ? ` of ${total}` : ''} shown
        </span>
      )}
    </div>
  )
}
