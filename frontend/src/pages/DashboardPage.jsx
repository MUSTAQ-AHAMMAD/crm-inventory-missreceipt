/**
 * Dashboard Page.
 * Shows summary metrics, upload trend charts, and recent activity log.
 */

import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '../hooks/useApi'
import StatCard from '../components/common/StatCard'
import Spinner from '../components/common/Spinner'
import ErrorAlert from '../components/common/ErrorAlert'

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then((r) => r.data),
  })

  if (isLoading) return <div className="flex justify-center mt-20"><Spinner size="lg" /></div>
  if (error) return <ErrorAlert message="Failed to load dashboard data." />

  const {
    totalInventoryUploads = 0,
    totalMiscUploads = 0,
    totalSuccessRecords = 0,
    totalFailureRecords = 0,
    activeUsers = 0,
    dailyTrend = [],
    recentActivity = [],
  } = data

  const successRate =
    totalSuccessRecords + totalFailureRecords > 0
      ? Math.round((totalSuccessRecords / (totalSuccessRecords + totalFailureRecords)) * 100)
      : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Inventory Uploads" value={totalInventoryUploads} icon="📦" colorClass="bg-blue-500" />
        <StatCard title="Misc Receipt Uploads" value={totalMiscUploads} icon="🧾" colorClass="bg-purple-500" />
        <StatCard title="Success Rate" value={`${successRate}%`} icon="✅" colorClass="bg-green-500" subtitle={`${totalSuccessRecords} succeeded`} />
        <StatCard title="Failed Records" value={totalFailureRecords} icon="❌" colorClass="bg-red-500" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Upload trend line chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Upload Trends (Last 30 Days)</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="inventorySuccess" name="Inv. Success" stroke="#3b82f6" dot={false} />
              <Line type="monotone" dataKey="inventoryFail" name="Inv. Failure" stroke="#ef4444" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Success vs Failure bar chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Success vs Failure (Last 30 Days)</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="inventorySuccess" name="Success" fill="#22c55e" />
              <Bar dataKey="inventoryFail" name="Failure" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Recent Activity</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-left">Details</th>
                <th className="px-4 py-2 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentActivity.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No activity yet</td></tr>
              )}
              {recentActivity.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{log.user?.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                      {log.actionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{log.actionDetails}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
