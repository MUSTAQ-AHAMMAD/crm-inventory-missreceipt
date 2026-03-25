/**
 * Root application component.
 * Sets up React Router and applies the AuthContext to all routes.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import InventoryPage from './pages/InventoryPage'
import MiscReceiptPage from './pages/MiscReceiptPage'
import UserManagementPage from './pages/UserManagementPage'
import ReportsPage from './pages/ReportsPage'
import FailureDetailsPage from './pages/FailureDetailsPage'
import UploadDetailPage from './pages/UploadDetailPage'

/** Route guard – redirects unauthenticated users to /login */
function PrivateRoute({ children }) {
  const { token, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>
  return token ? children : <Navigate to="/login" replace />
}

/** Route guard – restricts access to Admin users */
function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>
  if (!user || user.role !== 'ADMIN') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes – wrapped in persistent sidebar layout */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="misc-receipt" element={<MiscReceiptPage />} />
            <Route
              path="admin/users"
              element={
                <AdminRoute>
                  <UserManagementPage />
                </AdminRoute>
              }
            />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="uploads/:uploadId" element={<UploadDetailPage />} />
            <Route path="failures/:uploadId" element={<FailureDetailsPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
