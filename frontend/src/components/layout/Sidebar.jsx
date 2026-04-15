/**
 * Persistent sidebar navigation component.
 * Collapses on mobile, always visible on lg+ screens.
 */

import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊', exact: true },
  { to: '/inventory', label: 'Inventory Upload', icon: '📦' },
  { to: '/inventory-template', label: 'Inventory Template Generation', icon: '🧩' },
  { to: '/misc-receipt', label: 'Misc Receipt', icon: '🧾' },
  { to: '/standard-receipt', label: 'Standard Receipt', icon: '💳' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/failures/0', label: 'Logs & Failures', icon: '⚠️' },
]

const ADMIN_ITEMS = [
  { to: '/admin/users', label: 'User Management', icon: '👥' },
]

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth()

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-6 border-b border-gray-700">
        <span className="text-xl font-bold text-blue-400">CRM Portal</span>
        <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-white">✕</button>
      </div>

      {/* Navigation */}
      <nav className="mt-4 px-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">
          Main Menu
        </div>
        {NAV_ITEMS.map(({ to, label, icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            <span>{icon}</span>
            {label}
          </NavLink>
        ))}

        {/* Admin-only items */}
        {user?.role === 'ADMIN' && (
          <>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mt-6 mb-2">
              Administration
            </div>
            {ADMIN_ITEMS.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`
                }
              >
                <span>{icon}</span>
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User role badge at bottom */}
      <div className="absolute bottom-4 left-0 right-0 px-6">
        <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400">
          <div className="font-medium text-white truncate">{user?.email}</div>
          <div className="mt-1">
            <span className="bg-blue-600 text-blue-100 px-2 py-0.5 rounded-full text-xs">
              {user?.role}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
