/**
 * Access modules – must match backend/src/config/modules.js.
 * A user whose `modules` is null (legacy users) or whose role is ADMIN has
 * access to everything; otherwise access is limited to the listed keys.
 * Dashboard, Reports & Logs and Help are not module-gated.
 */

export const MODULES = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'ar-invoice', label: 'AR Invoice' },
  { key: 'vend', label: 'Vend' },
]

// First path segment → module key, for blocking direct URL access in the UI.
export const PATH_MODULE = {
  'inventory': 'inventory',
  'inventory-template': 'inventory',
  'misc-receipt': 'receipts',
  'standard-receipt': 'receipts',
  'apply-receipt': 'receipts',
  'apply-credit-memo': 'receipts',
  'receipt-response': 'receipts',
  'ar-pipeline': 'ar-invoice',
  'ar-invoice': 'ar-invoice',
  'ar-invoice-data': 'ar-invoice',
  'ar-invoice-response': 'ar-invoice',
  'vend-invoice': 'vend',
  'vend-sales-metadata': 'vend',
  'vend-receipt': 'vend',
  'vendhq-registers': 'vend',
}

/** True if the user may access the given module. */
export function canAccess(user, moduleKey) {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  const mods = user.modules
  if (mods == null) return true // not set = full access (legacy users)
  return mods.includes(moduleKey)
}
