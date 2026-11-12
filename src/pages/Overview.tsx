import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CalendarClock, Gauge, Inbox, Network, Zap } from 'lucide-react'
import { GENS, PLANNING_THRESHOLD } from '../data/fleet'
import { STATUS_LABEL, fleetBreakdown, fleetKpis, monthLabel, regionStats, type RegionStatus } from '../lib/capacity'
import { fmtPct, fmtUSD } from '../lib/format'
import { useStore } from '../state/store'
import { Badge, Card, CardTitle, ChartTooltip, Kpi, cx } from '../components/ui'

export function heatColor(u: number) {
  if (u >= 0.9) return { bg: '#e60023', fg: '#fff' }
  if (u >= PLANNING_THRESHOLD) return { bg: '#ff8a9a', fg: '#4a0010' }
  if (u >= 0.6) return { bg: '#ececec', fg: '#111' }
  if (u >= 0.45) return { bg: '#f5f5f5', fg: '#333' }
  return { bg: '#dbeafe', fg: '#1e3a8a' }
}

const STATUS_TONE: Record<RegionStatus, 'red' | 'amber' | 'green' | 'blue'> = { risk: 'red', watch: 'amber', healthy: 'green', under: 'blue' }

export default function Overview() {
  const { plan, region } = useStore()
  const k = useMemo(() => fleetKpis(plan, region), [plan, region])
  const regions = useMemo(() => regionStats(plan, region), [plan, region])
  const fleet = useMemo(() => fleetBreakdown(plan, region), [plan, region])
  const breaching = regions.filter((r) => r.status === 'risk' || r.status === 'watch')

  return (
    <div className="space-y-6">
      <div id="demo-kpis" className="grid scroll-mt-28 grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Racks deployed" value={k.total.toLocaleString()} sub={<span>{k.racks.gen6} Gen6 · {k.racks.gen8.toLocaleString()} Gen8</span>} icon={<Network size={14} />} />
        <Kpi label="Utilization" value={fmtPct(k.util, 0)} sub={<span>headroom {Math.round(k.capacity * PLANNING_THRESHOLD - k.provisioned).toLocaleString()} racks to {PLANNING_THRESHOLD * 100}%</span>} icon={<Gauge size={14} />} tone={k.util >= PLANNING_THRESHOLD ? 'red' : 'neutral'} />
        <Kpi label="Regions at risk" value={breaching.length} sub={<span>{breaching.map((r) => r.name).join(', ') || 'none'}</span>} icon={<AlertTriangle size={14} />} tone={breaching.length ? 'red' : 'neutral'} />
        <Kpi label="Power" value={`${(k.kwUsed / 1000).toFixed(1)} MW`} sub={<span>of {(k.kwBudget / 1000).toFixed(1)} MW</span>} icon={<Zap size={14} />} />
        <Kpi label="Gen6 EOL" value={`${Math.round(k.gen6MonthsToEol)} mo`} sub={<span>{k.racks.gen6} racks · Sep '28</span>} icon={<CalendarClock size={14} />} tone="red" />
        <Kpi label="Open requests" value={k.openRequests} sub={<span>{k.openRacks} racks</span>} icon={<Inbox size={14} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card id="demo-deployed" className="xl:col-span-2">
          <CardTitle title="Deployed" right={fleet.pendingRacks ? <Badge>+{fleet.pendingRacks} racks on order</Badge> : undefined} />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="pb-2 text-left font-semibold">Gen</th>
                <th className="pb-2 text-right font-semibold">Racks</th>
                <th className="pb-2 text-right font-semibold">Util</th>
                <th className="pb-2 text-right font-semibold">MW</th>
                <th className="pb-2 text-right font-semibold">Book value</th>
                <th className="pb-2 text-right font-semibold">EOL</th>
              </tr>
            </thead>
            <tbody>
              {fleet.byGen.map((g) => (
                <tr key={g.gen.id} className="border-t border-line/70">
                  <td className="py-2.5">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="h-2 w-2 rounded-full" style={{ background: g.gen.color }} />
                      {g.gen.name}
                    </span>
                  </td>
                  <td className="tabular py-2.5 text-right">{g.racks.toLocaleString()}</td>
                  <td className="tabular py-2.5 text-right">{g.racks ? fmtPct(g.provisioned / g.racks, 0) : '—'}</td>
                  <td className="tabular py-2.5 text-right">{g.mw.toFixed(1)}</td>
                  <td className="tabular py-2.5 text-right">{fmtUSD(g.bookValue)}</td>
                  <td className="tabular py-2.5 text-right">{monthLabel(g.eol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted">Racks docked by year</div>
          <div className="mt-2 h-44">
            <ResponsiveContainer>
              <BarChart data={fleet.byYear} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="year" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${v} racks`} />} cursor={{ fill: '#f5f5f5' }} />
                <Legend iconType="circle" iconSize={8} />
                {GENS.filter((g) => g.id !== 'gen11').map((g) => (
                  <Bar key={g.id} dataKey={g.id} name={g.name} stackId="a" fill={g.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card id="demo-regions" className="xl:col-span-3">
          <CardTitle title="Regions" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted">
                  <th className="pb-2 text-left font-semibold">Region</th>
                  <th className="pb-2 text-left font-semibold">Racks</th>
                  <th className="pb-2 text-center font-semibold">Now</th>
                  <th className="pb-2 text-center font-semibold">+6 mo</th>
                  <th className="pb-2 text-center font-semibold">+12 mo</th>
                  <th className="pb-2 text-right font-semibold">Power</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => {
                  const total = r.racks.gen6 + r.racks.gen8 + r.racks.gen11
                  return (
                    <tr key={r.id} className="border-t border-line/70">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{r.name}</div>
                        <Badge tone={STATUS_TONE[r.status]} className="mt-0.5">
                          {STATUS_LABEL[r.status]}
                          {r.overDate && ` · ${monthLabel(r.overDate)}`}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="tabular text-xs font-medium">
                          {total} racks
                        </div>
                        <div className="mt-1 flex h-1.5 w-32 overflow-hidden rounded-full bg-neutral-100">
                          {GENS.map((g) => (
                            <div key={g.id} style={{ width: `${(r.racks[g.id] / total) * 100}%`, background: g.color }} title={`${g.name}: ${r.racks[g.id]} racks`} />
                          ))}
                        </div>
                      </td>
                      {[r.util, r.util6, r.util12].map((u, i) => {
                        const c = heatColor(u)
                        return (
                          <td key={i} className="px-1 py-2.5">
                            <div className="tabular mx-auto flex h-9 w-16 items-center justify-center rounded-md text-xs font-semibold" style={{ background: c.bg, color: c.fg }}>
                              {Math.round(u * 100)}%
                            </div>
                          </td>
                        )
                      })}
                      <td className={cx('tabular py-2.5 text-right text-xs', r.powerUsed / r.powerBudget > 0.95 && 'font-semibold text-pin')}>
                        {(r.powerUsed / 1000).toFixed(1)} / {(r.powerBudget / 1000).toFixed(1)} MW
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10.5px] text-muted">
            {GENS.map((g) => (
              <span key={g.id} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                {g.name}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
