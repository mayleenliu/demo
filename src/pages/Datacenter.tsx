import { useMemo, useState, type ReactNode } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, Building2, Gauge, Leaf, PlugZap, Recycle, ShieldCheck, Sparkles, TrendingDown, Unplug, Zap } from 'lucide-react'
import { AS_OF, FAILOVER_UTIL_LIMIT, KW_PER_RACK, PUE_TARGET, RECLAIM_KW_PER_RACK, REGIONS } from '../data/fleet'
import { monthLabel } from '../lib/capacity'
import { dcStats, dcTrend } from '../lib/datacenter'
import { fmtPct, fmtUSD } from '../lib/format'
import { useStore } from '../state/store'
import { Badge, CHART, Card, CardTitle, ChartTooltip, Kpi, Segmented, Select, Td, Th, cx } from '../components/ui'

const mw = (kw: number) => `${(kw / 1000).toFixed(1)} MW`

/* ---------------- Space, power, trend ---------------- */

export function DatacenterCapacity() {
  const { plan, region } = useStore()
  const s = useMemo(() => dcStats(plan, region), [plan, region])

  return (
    <div id="demo-dc" className="scroll-mt-28 space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Space" value={fmtPct(s.spaceUtil, 0)} sub={<span>{s.racks.toLocaleString()} of {s.positions.toLocaleString()} positions</span>} icon={<Building2 size={14} />} />
        <Kpi label="Power allocated" value={fmtPct(s.powerAllocPct, 0)} sub={<span>{mw(s.allocKw)} of {mw(s.budgetKw)}</span>} icon={<Zap size={14} />} tone={s.powerAllocPct >= 0.9 ? 'red' : 'neutral'} />
        <Kpi label="Power drawn" value={fmtPct(s.powerDrawPct, 0)} sub={<span>{mw(s.avgKw)} average</span>} icon={<Activity size={14} />} />
        <Kpi label="Stranded power" value={mw(s.strandedKw)} sub={<span>allocated, never drawn</span>} icon={<Unplug size={14} />} tone="red" />
        <Kpi label="PUE" value={s.pue.toFixed(2)} sub={<span>target {PUE_TARGET.toFixed(2)}</span>} icon={<Leaf size={14} />} tone={s.pue > PUE_TARGET ? 'red' : 'green'} />
        <Kpi
          label="First region full"
          value={s.firstFull ? monthLabel(s.firstFull.fullDate!) : '—'}
          sub={s.firstFull ? <span>{s.firstFull.name} · {s.firstFull.binding}</span> : <span>none in 4 years</span>}
          icon={<Gauge size={14} />}
          tone={s.firstFull ? 'red' : 'neutral'}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <CapacityForecast />
        <RegionDc />
      </div>
    </div>
  )
}

function CapacityForecast() {
  const { plan, region: filter } = useStore()
  const [region, setRegion] = useState(filter === 'all' ? 'westeurope' : filter)
  const [view, setView] = useState<'racks' | 'pct'>('racks')
  const data = useMemo(() => dcTrend(plan, region), [plan, region])
  const today = monthLabel(AS_OF)
  const s = useMemo(() => dcStats(plan, region), [plan, region])
  const full = region === 'all' ? null : s.rows[0]
  const pctMax = Math.max(1, Math.ceil(Math.max(...data.map((p) => Math.max(p.space, p.powerAlloc, p.util))) * 4) / 4)
  const pctTicks = Array.from({ length: pctMax * 4 + 1 }, (_, i) => i / 4)

  return (
    <Card className="xl:col-span-3">
      <CardTitle
        title="Capacity trend and forecast"
        right={
          <div className="flex items-center gap-2">
            <Segmented value={view} onChange={setView} options={[{ value: 'racks', label: 'Racks' }, { value: 'pct', label: '% used' }]} />
            <Select value={region} onChange={setRegion} options={[{ value: 'all', label: 'All regions' }, ...REGIONS.map((r) => ({ value: r.id, label: r.name }))]} />
          </div>
        }
      />
      {full && (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <span>
            Full: <b className="text-ink">{full.fullDate ? monthLabel(full.fullDate) : 'not in 4 yrs'}</b> ({full.binding})
          </span>
          <span>
            With power reclaim: <b className="text-ink">{full.fullDateReclaimed ? monthLabel(full.fullDateReclaimed) : 'not in 4 yrs'}</b> ({full.bindingReclaimed})
          </span>
        </div>
      )}
      <div className="h-72">
        <ResponsiveContainer>
          {view === 'racks' ? (
            <ComposedChart data={data} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} interval={5} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip formatter={(v) => `${Math.round(v).toLocaleString()} racks`} />} />
              <Legend iconType="circle" iconSize={8} />
              <Area type="stepAfter" dataKey="racks" name="Racks deployed" stroke={CHART.gray} fill={CHART.light} fillOpacity={0.7} />
              <Line type="stepAfter" dataKey="positions" name="Floor positions" stroke={CHART.slate} strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="powerRacks" name={`Power (${KW_PER_RACK} kW/rack)`} stroke={CHART.ink} strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="powerRacksReclaimed" name={`Power (${RECLAIM_KW_PER_RACK} kW/rack)`} stroke={CHART.teal} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="required" name="Racks needed at 75%" stroke={CHART.red} strokeWidth={2.5} dot={false} connectNulls={false} />
              <ReferenceLine x={today} stroke={CHART.gray} strokeDasharray="3 3" label={{ value: 'Today', position: 'top', fontSize: 10, fill: CHART.gray }} />
            </ComposedChart>
          ) : (
            <ComposedChart data={data} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} interval={5} />
              <YAxis tickLine={false} axisLine={false} domain={[0, pctMax]} ticks={pctTicks} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
              <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v, 0)} />} />
              <Legend iconType="circle" iconSize={8} />
              <Line type="monotone" dataKey="space" name="Space" stroke={CHART.slate} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="powerAlloc" name="Power allocated" stroke={CHART.ink} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="powerDraw" name="Power drawn" stroke={CHART.teal} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="util" name="Utilization" stroke={CHART.red} strokeWidth={2.5} dot={false} />
              <ReferenceLine y={0.75} stroke={CHART.red} strokeOpacity={0.4} strokeDasharray="5 4" />
              <ReferenceLine x={today} stroke={CHART.gray} strokeDasharray="3 3" label={{ value: 'Today', position: 'top', fontSize: 10, fill: CHART.gray }} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function RegionDc() {
  const { plan, region } = useStore()
  const s = useMemo(() => dcStats(plan, region), [plan, region])
  return (
    <Card className="xl:col-span-2" pad={false}>
      <div className="p-5 pb-3">
        <h3 className="text-[15px] font-semibold">By region</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <Th className="pl-5">Region</Th>
              <Th className="text-right">Space</Th>
              <Th className="text-right">Power</Th>
              <Th className="text-right">PUE</Th>
              <Th className="pr-5">Full</Th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.id}>
                <Td className="pl-5 font-medium">{r.name}</Td>
                <Td className={cx('tabular text-right', r.binding === 'space' && 'font-semibold')}>{fmtPct(r.spaceUtil, 0)}</Td>
                <Td className={cx('tabular text-right', r.powerAllocPct >= 0.9 && 'font-semibold text-pin-dark')}>{fmtPct(r.powerAllocPct, 0)}</Td>
                <Td className={cx('tabular text-right', r.pue > PUE_TARGET && 'font-semibold text-pin-dark')}>{r.pue.toFixed(2)}</Td>
                <Td className="pr-5 whitespace-nowrap">
                  {r.fullDate ? (
                    <span className="text-xs">
                      <b>{monthLabel(r.fullDate)}</b> <span className="text-muted">{r.binding}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ---------------- Optimization ---------------- */

interface Opportunity {
  icon: ReactNode
  title: string
  value: string
  unit: string
  detail: string
  action: string
}

export function Optimize() {
  const { plan, region } = useStore()
  const s = useMemo(() => dcStats(plan, region), [plan, region])

  const ops: Opportunity[] = []
  const reclaimTop = [...s.rows].sort((a, b) => b.reclaimRacks - a.reclaimRacks)[0]
  const firstReclaim = s.rows.filter((r) => r.fullDate && r.fullDateReclaimed?.getTime() !== r.fullDate.getTime()).sort((a, b) => a.fullDate!.getTime() - b.fullDate!.getTime())[0]
  if (s.reclaimRacks > 0)
    ops.push({
      icon: <PlugZap size={16} />,
      title: 'Reclaim stranded power',
      value: `+${s.reclaimRacks}`,
      unit: 'racks of power',
      detail: `Racks peak at ${(s.rows.reduce((t, r) => t + r.peakKw, 0) / s.racks).toFixed(1)} kW but are allocated ${KW_PER_RACK} kW: ${mw(s.strandedKw)} is never drawn. Re-baselining to ${RECLAIM_KW_PER_RACK} kW frees ${mw(s.reclaimKw)}${reclaimTop ? `, most in ${reclaimTop.name} (+${reclaimTop.reclaimRacks})` : ''}.`,
      action: firstReclaim ? `${firstReclaim.name} full ${monthLabel(firstReclaim.fullDate!)} → ${firstReclaim.fullDateReclaimed ? monthLabel(firstReclaim.fullDateReclaimed) : 'beyond 4 yrs'}` : 'Defers power escalations',
    })
  const over = s.rows.filter((r) => r.excessRacks > 0)
  if (over.length)
    ops.push({
      icon: <TrendingDown size={16} />,
      title: 'Reduce over-provisioning',
      value: String(s.excessRacks),
      unit: 'racks beyond need',
      detail: `${over.map((r) => `${r.name}: ${r.excessRacks}`).join(', ')} more racks than 12-month demand and open requests need at 75%. ${fmtUSD(s.excessCapex)} of capex sitting idle.`,
      action: 'Rebalance Gen8; don’t replace Gen6 at EOL',
    })
  const strandedSpace = s.rows.filter((r) => r.strandedPositions > 0)
  const strandedPower = s.rows.filter((r) => r.strandedPowerKw > 0)
  if (strandedSpace.length || strandedPower.length)
    ops.push({
      icon: <Recycle size={16} />,
      title: 'Unlock stranded space and power',
      value: String(s.strandedPositions),
      unit: 'positions without power',
      detail: [
        strandedSpace.length ? `Positions with no power behind them: ${strandedSpace.map((r) => `${r.name} ${r.strandedPositions}`).join(', ')}.` : '',
        strandedPower.length ? `Power with no floor space: ${strandedPower.map((r) => `${r.name} ${mw(r.strandedPowerKw)}`).join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: strandedPower.length ? `Power reclaim fills empty positions; add positions in ${strandedPower.map((r) => r.name).join(', ')}` : 'Power reclaim fills empty positions',
    })
  const pueRegions = s.rows.filter((r) => r.pueSavingsPerYear > 0)
  if (pueRegions.length)
    ops.push({
      icon: <Leaf size={16} />,
      title: 'Improve PUE',
      value: fmtUSD(s.pueSavingsPerYear),
      unit: 'per year',
      detail: `${pueRegions.map((r) => `${r.name} ${r.pue.toFixed(2)}`).join(', ')} vs ${PUE_TARGET.toFixed(2)} target. Closing the gap saves ${mw(s.pueFacilityKwSaved)} of facility power.`,
      action: 'Raise supply air temp; add containment',
    })
  const fo = s.rows.filter((r) => r.clusterLossUtil > FAILOVER_UTIL_LIMIT)
  ops.push({
    icon: <ShieldCheck size={16} />,
    title: 'Protect availability',
    value: fo.length ? String(fo.length) : '0',
    unit: fo.length === 1 ? 'region at risk' : 'regions at risk',
    detail: fo.length
      ? `In 12 months, losing one cluster pushes ${fo.map((r) => `${r.name} to ${fmtPct(r.clusterLossUtil, 0)}`).join(', ')} (limit ${fmtPct(FAILOVER_UTIL_LIMIT, 0)}).`
      : `Every region stays under ${fmtPct(FAILOVER_UTIL_LIMIT, 0)} if it loses a cluster.`,
    action: fo.length ? `Point reclaim and rebalancing at ${fo.map((r) => r.name).join(', ')}` : 'Hold the 75% line',
  })

  return (
    <Card id="demo-optimize">
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-pin" /> Optimize
          </span>
        }
      />
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {ops.map((o) => (
          <div key={o.title} className="flex flex-col rounded-xl border border-line p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="rounded-lg bg-neutral-100 p-1.5 text-ink-2">{o.icon}</span>
              {o.title}
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="tabular text-2xl font-semibold">{o.value}</span>
              <span className="text-xs text-muted">{o.unit}</span>
            </div>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-2">{o.detail}</p>
            <div className="mt-3">
              <Badge tone="dark">{o.action}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
