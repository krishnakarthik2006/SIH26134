import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export default function DemandChart({ data = [] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#eee" />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#a8adb8', fontSize: 9 }} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#b4b7bf', fontSize: 9 }} />
        <Tooltip cursor={{ fill: '#fafafa' }} contentStyle={{ border: '1px solid #e7e7e5', borderRadius: 8, fontSize: 11 }} />
        <Bar dataKey="demand" fill="#f28d78" radius={[4, 4, 1, 1]} barSize={13} />
        <Bar dataKey="supply" fill="#78c5ae" radius={[4, 4, 1, 1]} barSize={13} />
      </BarChart>
    </ResponsiveContainer>
  )
}
