import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../hooks/useApi'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

const PAGE_SIZE = 50

const EMPTY_FORM = {
  registerId: '',
  outletId: '',
  registerName: '',
  cashAccount: '',
  cashAccountId: '',
  bankAccount: '',
  bankAccountId: '',
  version: '',
  deletedAt: '',
  region: '',
  giftAccount: '',
  giftAccountId: '',
  customerAccountId: '',
}

function formatNullable(value) {
  return value == null || value === '' ? '—' : value
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto px-6 py-4 flex-1">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, name, value, onChange, required, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder || ''}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

function RegisterForm({ form, onChange, onSubmit, onCancel, submitting, error, submitLabel }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorAlert message={error} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Register ID" name="registerId" value={form.registerId} onChange={onChange} required />
        <Field label="Outlet ID" name="outletId" value={form.outletId} onChange={onChange} />
        <Field label="Register Name" name="registerName" value={form.registerName} onChange={onChange} required />
        <Field label="Region" name="region" value={form.region} onChange={onChange} />
        <Field label="Cash Account" name="cashAccount" value={form.cashAccount} onChange={onChange} />
        <Field label="Cash Account ID" name="cashAccountId" value={form.cashAccountId} onChange={onChange} />
        <Field label="Bank Account" name="bankAccount" value={form.bankAccount} onChange={onChange} />
        <Field label="Bank Account ID" name="bankAccountId" value={form.bankAccountId} onChange={onChange} />
        <Field label="Gift Account" name="giftAccount" value={form.giftAccount} onChange={onChange} />
        <Field label="Gift Account ID" name="giftAccountId" value={form.giftAccountId} onChange={onChange} />
        <Field label="Version" name="version" value={form.version} onChange={onChange} />
        <Field label="Deleted At" name="deletedAt" value={form.deletedAt} onChange={onChange} placeholder="e.g. 2024-01-01" />
        <Field label="Customer Account ID" name="customerAccountId" value={form.customerAccountId} onChange={onChange} placeholder="Oracle CUST_ACCOUNT_ID (e.g. 300000158776674)" />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {submitting && <Spinner size="sm" />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

export default function VendhqRegistersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editRecord, setEditRecord] = useState(null)
  const [deleteRecord, setDeleteRecord] = useState(null)
  const [formError, setFormError] = useState('')
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [editForm, setEditForm] = useState(EMPTY_FORM)

  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['vendhqRegisters', page, search],
    queryFn: () =>
      api
        .get('/vendhq-registers', { params: { page, limit: PAGE_SIZE, search } })
        .then((r) => r.data),
    keepPreviousData: true,
  })

  const records = data?.records || []
  const total = data?.total || 0
  const limit = data?.limit || PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = total === 0 ? 0 : (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['vendhqRegisters'] })

  const addMutation = useMutation({
    mutationFn: (data) => api.post('/vendhq-registers', data).then((r) => r.data),
    onSuccess: () => { invalidate(); setShowAdd(false); setAddForm(EMPTY_FORM); setFormError('') },
    onError: (err) => setFormError(err.response?.data?.error || 'Failed to create record.'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => api.put(`/vendhq-registers/${id}`, data).then((r) => r.data),
    onSuccess: () => { invalidate(); setEditRecord(null); setFormError('') },
    onError: (err) => setFormError(err.response?.data?.error || 'Failed to update record.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/vendhq-registers/${id}`).then((r) => r.data),
    onSuccess: () => { invalidate(); setDeleteRecord(null) },
  })

  function handleAddChange(e) {
    const { name, value } = e.target
    setAddForm((f) => ({ ...f, [name]: value }))
  }

  function handleEditChange(e) {
    const { name, value } = e.target
    setEditForm((f) => ({ ...f, [name]: value }))
  }

  function openEdit(rec) {
    setEditRecord(rec)
    setEditForm({
      registerId: rec.registerId || '',
      outletId: rec.outletId || '',
      registerName: rec.registerName || '',
      cashAccount: rec.cashAccount || '',
      cashAccountId: rec.cashAccountId || '',
      bankAccount: rec.bankAccount || '',
      bankAccountId: rec.bankAccountId || '',
      version: rec.version || '',
      deletedAt: rec.deletedAt || '',
      region: rec.region || '',
      giftAccount: rec.giftAccount || '',
      giftAccountId: rec.giftAccountId || '',
      customerAccountId: rec.customerAccountId || '',
    })
    setFormError('')
  }

  function handleSearch(e) {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">VendHQ Registers</h1>
        <button
          onClick={() => { setShowAdd(true); setAddForm(EMPTY_FORM); setFormError('') }}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          + Add Register
        </button>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-sm">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, ID, or region…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="px-4 py-2 text-sm bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200">
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </form>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-10"><Spinner /></div>
        ) : error ? (
          <ErrorAlert message="Failed to load VendHQ registers. Please refresh and try again." />
        ) : records.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No registers found.</p>
        ) : (
          <>
            <div className="text-xs text-gray-500">
              Showing {start}–{end} of {total} records • Page {page} of {totalPages}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Register ID</th>
                    <th className="px-3 py-2 text-left">Register Name</th>
                    <th className="px-3 py-2 text-left">Outlet ID</th>
                    <th className="px-3 py-2 text-left">Region</th>
                    <th className="px-3 py-2 text-left">Cash Account</th>
                    <th className="px-3 py-2 text-left">Cash Acct ID</th>
                    <th className="px-3 py-2 text-left">Bank Account</th>
                    <th className="px-3 py-2 text-left">Bank Acct ID</th>
                    <th className="px-3 py-2 text-left">Gift Account</th>
                    <th className="px-3 py-2 text-left">Gift Acct ID</th>
                    <th className="px-3 py-2 text-left">Cust Acct ID</th>
                    <th className="px-3 py-2 text-left">Version</th>
                    <th className="px-3 py-2 text-left">Deleted At</th>
                    <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((rec) => (
                    <tr key={rec.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{rec.id}</td>
                      <td className="px-3 py-2 font-mono">{formatNullable(rec.registerId)}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{formatNullable(rec.registerName)}</td>
                      <td className="px-3 py-2">{formatNullable(rec.outletId)}</td>
                      <td className="px-3 py-2">{formatNullable(rec.region)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatNullable(rec.cashAccount)}</td>
                      <td className="px-3 py-2 font-mono">{formatNullable(rec.cashAccountId)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatNullable(rec.bankAccount)}</td>
                      <td className="px-3 py-2 font-mono">{formatNullable(rec.bankAccountId)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatNullable(rec.giftAccount)}</td>
                      <td className="px-3 py-2 font-mono">{formatNullable(rec.giftAccountId)}</td>
                      <td className="px-3 py-2 font-mono">{formatNullable(rec.customerAccountId)}</td>
                      <td className="px-3 py-2">{formatNullable(rec.version)}</td>
                      <td className="px-3 py-2">{formatNullable(rec.deletedAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEdit(rec)}
                            className="px-2 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteRecord(rec)}
                            className="px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">Total: {total}</p>
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

      {/* Add Modal */}
      {showAdd && (
        <Modal title="Add New Register" onClose={() => setShowAdd(false)}>
          <RegisterForm
            form={addForm}
            onChange={handleAddChange}
            onSubmit={(e) => { e.preventDefault(); addMutation.mutate(addForm) }}
            onCancel={() => setShowAdd(false)}
            submitting={addMutation.isPending}
            error={formError}
            submitLabel="Add Register"
          />
        </Modal>
      )}

      {/* Edit Modal */}
      {editRecord && (
        <Modal title={`Edit Register — ${editRecord.registerName}`} onClose={() => setEditRecord(null)}>
          <RegisterForm
            form={editForm}
            onChange={handleEditChange}
            onSubmit={(e) => { e.preventDefault(); editMutation.mutate({ id: editRecord.id, data: editForm }) }}
            onCancel={() => setEditRecord(null)}
            submitting={editMutation.isPending}
            error={formError}
            submitLabel="Save Changes"
          />
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteRecord && (
        <Modal title="Delete Register" onClose={() => setDeleteRecord(null)}>
          <p className="text-sm text-gray-700 mb-6">
            Are you sure you want to delete register{' '}
            <span className="font-semibold">{deleteRecord.registerName}</span>{' '}
            (ID: <span className="font-mono">{deleteRecord.registerId}</span>)?
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteRecord(null)}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteMutation.mutate(deleteRecord.id)}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              {deleteMutation.isPending && <Spinner size="sm" />}
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
