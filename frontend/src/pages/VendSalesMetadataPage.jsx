import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const PAGE_SIZE = 50

export default function VendSalesMetadataPage() {
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ['fusionSalesMetadata', page],
    queryFn: () =>
      api
        .get('/ar-invoice/metadata/list', {
          params: { page, limit: PAGE_SIZE },
        })
        .then((r) => r.data),
  })

  const records = data?.records || []
  const total = data?.total || 0
  const limit = data?.limit || PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = total === 0 ? 0 : (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Vendsales Meta Data</h1>
        <div className="text-sm text-gray-600">
          Total: <span className="font-semibold">{total}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorAlert message="Failed to load Fusion sales metadata." />
        ) : records.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No metadata records found.</p>
        ) : (
          <>
            <div className="text-xs text-gray-500">
              Showing {start}-{end} of {total} records • Page {page} of {totalPages} • Limit {limit}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Row ID</th>
                    <th className="px-3 py-2 text-left">Bill To Name</th>
                    <th className="px-3 py-2 text-left">Bill To Account</th>
                    <th className="px-3 py-2 text-left">Site Number</th>
                    <th className="px-3 py-2 text-left">Business Unit</th>
                    <th className="px-3 py-2 text-left">Txn Source</th>
                    <th className="px-3 py-2 text-left">Txn Type</th>
                    <th className="px-3 py-2 text-left">Rate Is Corporate</th>
                    <th className="px-3 py-2 text-left">Rec Activity Name Bank</th>
                    <th className="px-3 py-2 text-left">Subinventory</th>
                    <th className="px-3 py-2 text-left">Integration Source</th>
                    <th className="px-3 py-2 text-left">Distribution Acc ID</th>
                    <th className="px-3 py-2 text-left">Rec Activity Name Cash</th>
                    <th className="px-3 py-2 text-left">Customer Type</th>
                    <th className="px-3 py-2 text-left">Region</th>
                    <th className="px-3 py-2 text-left">Cost Center Code</th>
                    <th className="px-3 py-2 text-left">Created At</th>
                    <th className="px-3 py-2 text-left">Updated At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{record.id}</td>
                      <td className="px-3 py-2">{record.rowId}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{record.billToName}</td>
                      <td className="px-3 py-2">{record.billToAccount}</td>
                      <td className="px-3 py-2">{record.siteNumber}</td>
                      <td className="px-3 py-2">{record.businessUnit}</td>
                      <td className="px-3 py-2">{record.txnSource}</td>
                      <td className="px-3 py-2">{record.txnType}</td>
                      <td className="px-3 py-2">{record.rateIsCorporate}</td>
                      <td className="px-3 py-2">{record.recActivityNameBank}</td>
                      <td className="px-3 py-2">{record.subinventory}</td>
                      <td className="px-3 py-2">{record.integrationSource}</td>
                      <td className="px-3 py-2">{record.distributionAccId || '—'}</td>
                      <td className="px-3 py-2">{record.recActivityNameCash}</td>
                      <td className="px-3 py-2">{record.customerType}</td>
                      <td className="px-3 py-2">{record.region}</td>
                      <td className="px-3 py-2">{record.costCenterCode || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {record.createdAt ? new Date(record.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Pagination: page={page}, limit={limit}, total={total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
