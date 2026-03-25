/** Reusable stat/metric card component */
export default function StatCard({ title, value, subtitle, colorClass = 'bg-blue-500', icon }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 flex items-center gap-4">
      <div className={`${colorClass} text-white rounded-lg p-3 text-2xl flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}
