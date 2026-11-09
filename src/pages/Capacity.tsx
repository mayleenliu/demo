import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from 'recharts'
import { Lock, Search, Zap } from 'lucide-react'
import { CAPACITY_THRESHOLD, INFRA_TYPES, REGIONS, regionById, workloadById } from '../data/model'
import { capacityType, filterRows, forecastUsed, regionComputeBaseline, regionStats, scenarioComparison, simulate, workloadStats, type Filters } from '../lib/calc'
import { addMonths, fmtCompact, fmtDate, fmtNum, fmtPct, fmtUSD } from '../lib/format'
import { useStore } from '../state/store'
import { Badge, Card, CardTitle, CHART, ChartTooltip, MeasuredTag, REGION_STATUS_LABEL, Segmented, Select, statusTone, Td, Th, UtilBar, cx } from '../components/ui'

export default function Capacity() {
  const { filters } = useStore()
  const type = capacityType(filters)
  const unit = INFRA_TYPES.find((t) => t.id === type)!.unit
  const regions = useMemo(() => regionStats(filters), [filters])
  const workloads = useMemo(() => workloadStats(filters), [filters])

  const regionChart = regions.map((r) => ({ name: r.name, provisioned: r.provisioned, used: r.used, reserved: r.reserved, forecast6: Math.round(r.forecast6), utilization: r.utilization, headroom6: Math.round(r.headroom6), headroomPct: r.headroom6 / r.provisioned, status: r.status }))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle title="Provisioned vs consumed vs forecast" subtitle={`By region · ${type} (${unit}) · forecast = demand in 6 months`} right={<MeasuredTag />} />
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={regionChart} margin={{ top: 5, right: 5, left: -10, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${fmtNum(v)} ${unit}`} />} />
                <Legend iconType="circle" iconSize={8} />
                <Bar dataKey="provisioned" name="Provisioned" fill={CHART.light} radius={[4, 4, 0, 0]} />
                <Bar dataKey="used" name="Consumed" fill={CHART.ink} radius={[4, 4, 0, 0]} />
                <Bar dataKey="forecast6" name="Forecast demand (+6 mo)" fill={CHART.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardTitle title="Capacity headroom by region (+6 months)" subtitle={`Supply minus forecast demand as % of supply · dashed line = 15% buffer; bars left of it breach the ${CAPACITY_THRESHOLD * 100}% threshold`} right={<Badge tone="ai">Forecast model</Badge>} />
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={regionChart} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} domain={[-0.15, 0.45]} ticks={[-0.15, 0, 0.15, 0.3, 0.45]} />
                <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v)} />} />
                <ReferenceLine x={1 - CAPACITY_THRESHOLD} stroke={CHART.red} strokeDasharray="4 4" />
                <ReferenceLine x={0} stroke="#999" />
                <Bar dataKey="headroomPct" name="Headroom (+6 mo)" radius={[0, 4, 4, 0]}>
                  {regionChart.map((r) => (
                    <Cell key={r.name} fill={r.headroomPct < 0 ? CHART.red : r.headroomPct < 1 - CAPACITY_THRESHOLD ? '#ff8a9a' : r.headroomPct > 0.4 ? '#93c5fd' : CHART.ink} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardTitle title="Utilization by region" subtitle="Today vs 6-month forecast, with status" right={<MeasuredTag />} />
          <div className="space-y-3">
            {regions.map((r) => (
              <div key={r.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={statusTone(r.status)}>{REGION_STATUS_LABEL[r.status]}</Badge>
                    <span className="tabular text-xs text-muted">
                      {fmtPct(r.utilization, 0)} → <span className={r.forecastUtil6 >= CAPACITY_THRESHOLD ? 'font-semibold text-pin' : ''}>{fmtPct(r.forecastUtil6, 0)}</span>
                    </span>
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-neutral-100">
                  <div className="absolute h-full rounded-full bg-pin/25" style={{ width: `${Math.min(100, r.forecastUtil6 * 100)}%` }} />
                  <div className={cx('absolute h-full rounded-full', r.utilization >= CAPACITY_THRESHOLD ? 'bg-pin' : 'bg-ink')} style={{ width: `${Math.min(100, r.utilization * 100)}%` }} />
                  <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${CAPACITY_THRESHOLD * 100}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {fmtNum(r.used)} / {fmtNum(r.provisioned)} {unit} · growth {fmtPct(r.growth, 1)}/mo ·{' '}
                  {r.monthsToThreshold === null ? 'no threshold breach within 36 mo' : r.monthsToThreshold === 0 ? 'above threshold now' : `crosses 85% ~${fmtDate(addMonths(r.monthsToThreshold))}`}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="xl:col-span-3">
          <CardTitle title="Utilization by workload" subtitle={`${type} · today vs +6 months forecast`} right={<MeasuredTag />} />
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={workloads} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, (max: number) => Math.max(1, Math.ceil(max * 10) / 10)]} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v)} />} />
                <Legend iconType="circle" iconSize={8} />
                <ReferenceLine y={CAPACITY_THRESHOLD} stroke={CHART.red} strokeDasharray="4 4" />
                <Bar dataKey="utilization" name="Utilization today" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {workloads.map((w) => (
                    <Cell key={w.id} fill={w.utilization >= CAPACITY_THRESHOLD ? CHART.red : w.utilization < 0.5 ? '#93c5fd' : CHART.ink} />
                  ))}
                </Bar>
                <Line dataKey="forecastUtil6" name="Forecast (+6 mo)" stroke={CHART.red} strokeWidth={0} dot={{ r: 4, fill: '#fff', stroke: CHART.red, strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Simulator filters={filters} />

      <Inventory filters={filters} />
    </div>
  )
}

function Simulator({ filters }: { filters: Filters }) {
  const [region, setRegion] = useState(filters.region === 'all' ? 'us-east' : filters.region)
  const base = useMemo(() => regionComputeBaseline(region), [region])
  const [demandAdj, setDemandAdj] = useState(0)
  const [growthPct, setGrowthPct] = useState<number | null>(null)
  const [threshold, setThreshold] = useState(CAPACITY_THRESHOLD)
  const [horizon, setHorizon] = useState(12)
  const [optimizeFirst, setOptimizeFirst] = useState(false)
  const growth = growthPct === null ? base.growth : growthPct / 100

  const sim = useMemo(() => simulate({ region, demandAdj, growth, threshold, horizon, optimizeFirst }), [region, demandAdj, growth, threshold, horizon, optimizeFirst])
  const scenarios = useMemo(() => scenarioComparison(region, horizon, threshold), [region, horizon, threshold])
  const reg = regionById(region)

  const scenarioChart = sim.series.map((p, i) => ({
    month: p.month,
    bau: scenarios[0].series[i].demand,
    ai: scenarios[1].series[i].demand,
    supply: Math.round(base.provisioned * threshold),
    supplyOpt: Math.round((base.provisioned + base.reclaimable) * threshold),
  }))

  return (
    <Card>
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <Zap size={16} className="text-pin" /> Capacity forecasting simulator
          </span>
        }
        subtitle="Compute capacity · adjust demand and growth to see when a region hits its threshold and what it costs to stay ahead"
        right={<Badge tone="dark">Interactive model</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">1. Region</div>
            <Select
              value={region}
              onChange={(v) => {
                setRegion(v)
                setGrowthPct(null)
              }}
              options={REGIONS.map((r) => ({ value: r.id, label: r.name }))}
              className="w-full"
            />
            <div className="mt-1 text-[11px] text-muted">
              {fmtNum(base.used)} / {fmtNum(base.provisioned)} units used · lead time {base.leadTime} mo
            </div>
          </div>
          <Slider label="2. Demand change today" value={demandAdj * 100} min={-30} max={50} step={1} fmt={(v) => `${v > 0 ? '+' : ''}${v}%`} onChange={(v) => setDemandAdj(v / 100)} hint="Step change, e.g. new launch or migration" />
          <Slider label="3. Monthly growth rate" value={+(growth * 100).toFixed(1)} min={-2} max={10} step={0.1} fmt={(v) => `${v.toFixed(1)}%/mo`} onChange={setGrowthPct} hint={`Baseline ${fmtPct(base.growth, 1)}/mo from trailing trend`} />
          <Slider label="Capacity threshold" value={threshold * 100} min={70} max={95} step={1} fmt={(v) => `${v}%`} onChange={(v) => setThreshold(v / 100)} hint="Planning ceiling preserving failover buffer" />
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Horizon</div>
            <Segmented value={String(horizon)} onChange={(v) => setHorizon(Number(v))} options={[{ value: '6', label: '6 mo' }, { value: '12', label: '12 mo' }, { value: '18', label: '18 mo' }]} />
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3">
            <input type="checkbox" checked={optimizeFirst} onChange={(e) => setOptimizeFirst(e.target.checked)} className="mt-0.5 accent-[#e60023]" />
            <span className="text-sm">
              <span className="font-medium">Optimize before purchasing</span>
              <span className="block text-[11px] text-muted">Apply in-region rightsizing first (reclaims {fmtNum(base.reclaimable)} units)</span>
            </span>
          </label>
          <button
            className="text-xs font-medium text-muted hover:text-ink"
            onClick={() => {
              setDemandAdj(0)
              setGrowthPct(null)
              setThreshold(CAPACITY_THRESHOLD)
              setOptimizeFirst(false)
            }}
          >
            Reset to baseline
          </button>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SimStat label="5. Threshold reached" value={sim.crossMonth === null ? 'Not in 36 mo' : sim.crossMonth === 0 ? 'Already' : fmtDate(addMonths(sim.crossMonth))} sub={sim.crossMonth === null ? '' : sim.crossMonth === 0 ? 'above threshold today' : `in ${sim.crossMonth.toFixed(1)} months`} tone={sim.crossMonth !== null && sim.crossMonth < 6 ? 'red' : undefined} />
            <SimStat label="Order capacity by" value={sim.orderBy === null ? '—' : sim.orderBy <= 0 ? 'Overdue' : fmtDate(addMonths(sim.orderBy))} sub={`${base.leadTime}-month procurement lead time`} tone={sim.orderBy !== null && sim.orderBy <= 0 ? 'red' : undefined} />
            <SimStat label="4. Additional capacity" value={`${fmtNum(sim.unitsNeeded)} units`} sub={`to stay ≤${Math.round(threshold * 100)}% at ${horizon} mo`} />
            <SimStat label="6. Investment required" value={`${fmtUSD(sim.monthlyInvestment)}/mo`} sub={`${fmtUSD(sim.annualInvestment)}/yr at ${fmtUSD(base.unitCost)}/unit`} tone={sim.unitsNeeded > 0 ? 'red' : 'green'} />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={sim.series} margin={{ top: 5, right: 5, left: -5, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${fmtNum(v)} units`} />} />
                <Legend iconType="circle" iconSize={8} />
                <Area type="monotone" dataKey="demand" name="Simulated demand" stroke={CHART.red} fill={CHART.red} fillOpacity={0.08} strokeWidth={2} />
                <Line type="stepAfter" dataKey="capacity" name={optimizeFirst ? 'Effective supply (after optimization)' : 'Provisioned supply'} stroke={CHART.ink} strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="threshold" name={`${Math.round(threshold * 100)}% threshold`} stroke={CHART.gray} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-ink-2">
            <summary className="cursor-pointer font-medium">Show calculation</summary>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              <div>start demand = {fmtNum(base.used)} × (1 + {fmtPct(demandAdj, 0)}) = {fmtNum(base.used * (1 + demandAdj))}</div>
              <div>
                effective supply = {fmtNum(base.provisioned)} + reclaimed {fmtNum(sim.reclaimed)} = {fmtNum(sim.effectiveCapacity)}
              </div>
              <div>
                months to threshold = ln({threshold} × supply ÷ demand) ÷ ln(1 + {fmtPct(growth, 2)}) = {sim.crossMonth === null ? '> 36' : sim.crossMonth.toFixed(2)}
              </div>
              <div>
                demand at {horizon} mo = {fmtNum(sim.endDemand)}; required = max(0, {fmtNum(sim.endDemand)} ÷ {threshold} − {fmtNum(sim.effectiveCapacity)}) = {fmtNum(sim.unitsNeeded)} units
              </div>
              <div>
                investment = {fmtNum(sim.unitsNeeded)} × {fmtUSD(base.unitCost)} = {fmtUSD(sim.monthlyInvestment)}/mo
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold">What-if scenarios · {reg.name}</h4>
          <span className="text-xs text-muted">
            AI growth adds {fmtPct(scenarios[1].growth - scenarios[0].growth, 2)}/mo (AI share {fmtPct(base.aiShare, 0)} of demand) · {horizon}-month horizon
          </span>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            {scenarios.map((s) => (
              <div key={s.key} className={cx('rounded-xl border p-3', s.key === 'opt' ? 'border-emerald-200 bg-emerald-50/50' : 'border-line')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{s.name}</div>
                  {s.key === 'opt' && <Badge tone="green">Recommended</Badge>}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted">Growth</div>
                    <div className="tabular font-semibold">{fmtPct(s.growth, 1)}/mo</div>
                  </div>
                  <div>
                    <div className="text-muted">Threshold hit</div>
                    <div className="tabular font-semibold">{s.crossMonth === null ? '—' : s.crossMonth === 0 ? 'Now' : `${s.crossMonth.toFixed(1)} mo`}</div>
                  </div>
                  <div>
                    <div className="text-muted">New spend</div>
                    <div className="tabular font-semibold">{fmtUSD(s.annualInvestment)}/yr</div>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {fmtNum(s.unitsNeeded)} units to buy{s.reclaimed ? ` after reclaiming ${fmtNum(s.reclaimed)}` : ''}
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-ink p-3 text-xs text-white">
              <span className="font-semibold">Takeaway: </span>
              {scenarios[1].annualInvestment - scenarios[2].annualInvestment > 0
                ? `Optimizing first avoids ${fmtUSD(scenarios[1].annualInvestment - scenarios[2].annualInvestment)}/yr of purchases under accelerated AI growth${scenarios[2].crossMonth !== null && scenarios[1].crossMonth !== null && scenarios[2].crossMonth > scenarios[1].crossMonth ? ` and buys ${(scenarios[2].crossMonth - scenarios[1].crossMonth).toFixed(1)} months of runway for procurement` : ''}.`
                : `${reg.name} has little reclaimable capacity — optimization alone will not avoid the purchase; prioritize procurement timing or reallocation from other regions.`}
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={scenarioChart} margin={{ top: 5, right: 5, left: -5, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${fmtNum(v)} units`} />} />
                <Legend iconType="circle" iconSize={8} />
                <Line type="monotone" dataKey="bau" name="BAU demand" stroke={CHART.ink} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ai" name="AI-accelerated demand" stroke={CHART.red} strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="supply" name="Usable supply today" stroke={CHART.gray} strokeDasharray="5 4" dot={false} />
                <Line type="stepAfter" dataKey="supplyOpt" name="Usable supply after optimization" stroke={CHART.teal} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Slider({ label, value, min, max, step, fmt, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-muted">{label}</span>
        <span className="tabular font-semibold">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#e60023]" />
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

function SimStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' }) {
  return (
    <div className={cx('rounded-xl border p-3', tone === 'red' ? 'border-pin/30 bg-pin-soft' : tone === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-line')}>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className={cx('tabular mt-1 text-lg font-semibold leading-tight', tone === 'red' && 'text-pin-dark')}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

type SortKey = 'region' | 'workload' | 'provisioned' | 'util' | 'headroom' | 'forecast'

function Inventory({ filters }: { filters: Filters }) {
  const { can } = useStore()
  const sensitive = can('viewSensitive')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'util', dir: -1 })
  const rows = useMemo(() => {
    const list = filterRows(filters).map((r) => {
      const f6 = forecastUsed(r, 6)
      return { ...r, util: r.used / r.provisioned, f6, headroom: (r.provisioned - f6) / r.provisioned }
    })
    const s = q.toLowerCase()
    const filtered = s ? list.filter((r) => [regionById(r.region).name, workloadById(r.workload).name, r.hardware, r.az, r.type].join(' ').toLowerCase().includes(s)) : list
    const val = (r: (typeof list)[number]) => (sort.key === 'region' ? regionById(r.region).name : sort.key === 'workload' ? workloadById(r.workload).short : sort.key === 'provisioned' ? r.provisioned : sort.key === 'util' ? r.util : sort.key === 'headroom' ? r.headroom : r.f6 / r.provisioned)
    return filtered.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir
    })
  }, [filters, q, sort])
  const th = (key: SortKey, label: string, cls?: string) => (
    <Th className={cls} active={sort.key === key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}>
      {label} {sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : ''}
    </Th>
  )
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h3 className="text-[15px] font-semibold">Infrastructure inventory</h3>
          <p className="text-xs text-muted">{rows.length} capacity pools · compute, storage and networking · click headers to sort</p>
        </div>
        <div className="flex items-center gap-2">
          {!sensitive && (
            <Badge tone="amber">
              <Lock size={10} /> AZ & hardware redacted for your role
            </Badge>
          )}
          <MeasuredTag />
          <label className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5">
            <Search size={13} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inventory" className="w-40 bg-transparent text-sm outline-none" />
          </label>
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[1100px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              {th('region', 'Region', 'pl-5')}
              <Th>AZ</Th>
              {th('workload', 'Workload')}
              <Th>Type</Th>
              <Th>Instance / hardware</Th>
              {th('provisioned', 'Provisioned', 'text-right')}
              <Th className="text-right">Reserved</Th>
              <Th className="text-right">Available</Th>
              {th('util', 'Utilization')}
              {th('forecast', 'Forecast +6 mo', 'text-right')}
              {th('headroom', 'Headroom +6 mo', 'pr-5 text-right')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td className="pl-5 font-medium">{regionById(r.region).name}</Td>
                <Td className="whitespace-nowrap text-muted">{sensitive ? r.az : '•••'}</Td>
                <Td>{workloadById(r.workload).short}</Td>
                <Td>
                  <Badge tone={r.type === 'compute' ? 'dark' : r.type === 'storage' ? 'blue' : 'neutral'}>{r.type}</Badge>
                </Td>
                <Td className="text-muted">{sensitive ? r.hardware : 'Restricted'}</Td>
                <Td className="tabular text-right">
                  {fmtNum(r.provisioned)} <span className="text-[11px] text-muted">{r.unit}</span>
                </Td>
                <Td className="tabular text-right">{fmtNum(r.reserved)}</Td>
                <Td className="tabular text-right">{fmtNum(r.provisioned - r.used)}</Td>
                <Td>
                  <UtilBar value={r.util} />
                </Td>
                <Td className="tabular text-right">{fmtNum(r.f6)}</Td>
                <Td className={cx('tabular pr-5 text-right font-medium', r.headroom < 0 ? 'text-pin' : r.headroom < 1 - CAPACITY_THRESHOLD ? 'text-amber-700' : '')}>{fmtPct(r.headroom, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
