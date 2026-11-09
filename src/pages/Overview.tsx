import { useMemo } from 'react'
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { Server, Activity, Boxes, Wallet, PiggyBank, AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, CircleDot } from 'lucide-react'
import { CAPACITY_THRESHOLD, INFRA_TYPES, REGIONS, monthLabel } from '../data/model'
import { budgetFor, capacityType, filterOpps, filterRows, forecastSeries, forecastUsed, historySeries, regionStats, sum, LOW_CONFIDENCE, type Filters } from '../lib/calc'
import { fmtCompact, fmtNum, fmtPct, fmtUSD } from '../lib/format'
import { programFinancials } from '../lib/program'
import { useOpportunities, useStore } from '../state/store'
import { Badge, Button, Card, CardTitle, CHART, ChartTooltip, Kpi, MeasuredTag, REGION_STATUS_LABEL, statusTone, cx } from '../components/ui'
import type { PageId } from '../App'

export function heatColor(u: number) {
  if (u >= 0.95) return { bg: '#e60023', fg: '#fff' }
  if (u >= CAPACITY_THRESHOLD) return { bg: '#ff8a9a', fg: '#4a0010' }
  if (u >= 0.7) return { bg: '#ececec', fg: '#111' }
  if (u >= 0.5) return { bg: '#f5f5f5', fg: '#333' }
  return { bg: '#dbeafe', fg: '#1e3a8a' }
}

export default function Overview({ go }: { go: (p: PageId) => void }) {
  const { filters, initiatives } = useStore()
  const opps = useOpportunities()
  const type = capacityType(filters)
  const unit = INFRA_TYPES.find((t) => t.id === type)!.unit

  const d = useMemo(() => {
    const capRows = filterRows({ ...filters, type })
    const costRows = filterRows(filters)
    const prov = sum(capRows, 'provisioned')
    const used = sum(capRows, 'used')
    const hist = historySeries(filters)
    const avgUtil = hist.reduce((s, p) => s + p.utilization, 0) / hist.length
    const spend = sum(costRows, 'monthlyCost')
    const budget = budgetFor(costRows)
    const regions = regionStats(filters)
    const scoped = filterOpps(filters).map((o) => opps.find((x) => x.id === o.id)!)
    const open = scoped.filter((o) => o.status !== 'Completed')
    const savings = open.reduce((s, o) => s + o.monthlySavings, 0)
    return { prov, used, hist, avgUtil, spend, budget, regions, open, savings, forecast: forecastSeries(filters), capRows, costRows }
  }, [filters, type, opps])

  const constrained = d.regions.filter((r) => r.status === 'risk' || r.status === 'watch')
  const util = d.used / d.prov
  const first = d.hist[0]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={`Provisioned ${type} capacity`} value={`${fmtCompact(d.prov)}`} sub={<span>{unit} · {d.regions.length} regions</span>} icon={<Server size={14} />} />
        <Kpi
          label={`Actual ${type} utilization`}
          value={fmtPct(util)}
          sub={<span>{filters.period}-mo avg {fmtPct(d.avgUtil)}</span>}
          icon={<Activity size={14} />}
          tone={util >= CAPACITY_THRESHOLD ? 'red' : 'neutral'}
          delta={{ text: `${util - first.utilization >= 0 ? '+' : ''}${((util - first.utilization) * 100).toFixed(1)} pts`, good: util - first.utilization < 0.08 }}
        />
        <Kpi label="Available capacity" value={fmtCompact(d.prov - d.used)} sub={<span>{unit} · {fmtPct(1 - util)} of fleet</span>} icon={<Boxes size={14} />} />
        <Kpi
          label="Monthly infrastructure spend"
          value={fmtUSD(d.spend)}
          sub={<span>budget {fmtUSD(d.budget)}</span>}
          icon={<Wallet size={14} />}
          delta={{ text: `${d.spend > d.budget ? '+' : ''}${fmtPct((d.spend - d.budget) / d.budget)} vs budget`, good: d.spend <= d.budget }}
        />
        <Kpi label="Savings opportunity" value={`${fmtUSD(d.savings)}/mo`} sub={<span>{d.open.length} open · {fmtUSD(d.savings * 12, 1)}/yr</span>} icon={<PiggyBank size={14} />} tone="green" />
        <Kpi
          label="Regions near constraint"
          value={constrained.length}
          sub={<span>{constrained.map((r) => r.name).join(', ') || 'none'} </span>}
          icon={<AlertTriangle size={14} />}
          tone={constrained.length ? 'red' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle title={`${type[0].toUpperCase() + type.slice(1)} utilization trend`} subtitle={`Past ${filters.period} months · provisioned vs used (${unit})`} right={<MeasuredTag />} />
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={d.hist} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis yAxisId="u" tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v, k) => (k === 'utilization' ? fmtPct(v) : `${fmtNum(v)} ${unit}`)} />} />
                <Legend iconType="circle" iconSize={8} />
                <Area yAxisId="u" type="stepAfter" dataKey="provisioned" name="Provisioned" stroke={CHART.gray} fill="#f4f4f4" strokeWidth={1.5} />
                <Area yAxisId="u" type="monotone" dataKey="used" name="Used" stroke={CHART.ink} fill="#d4d4d4" fillOpacity={0.6} strokeWidth={1.5} />
                <Line yAxisId="p" type="monotone" dataKey="utilization" name="Utilization %" stroke={CHART.red} strokeWidth={2} dot={false} />
                <ReferenceLine yAxisId="p" y={CAPACITY_THRESHOLD} stroke={CHART.red} strokeDasharray="4 4" strokeOpacity={0.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardTitle title="Monthly spend vs budget" subtitle={`Past ${filters.period} months · all infra types in scope`} right={<MeasuredTag />} />
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={d.hist} margin={{ top: 5, right: 5, left: -5, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => fmtUSD(v, 1)} tickLine={false} axisLine={false} domain={[(min: number) => min * 0.85, 'auto']} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtUSD(v, 2)} />} />
                <Legend iconType="circle" iconSize={8} />
                <Bar dataKey="spend" name="Actual spend" fill={CHART.ink} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line type="monotone" dataKey="budget" name="Budget" stroke={CHART.red} strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardTitle
            title="Capacity demand forecast"
            subtitle={`Next 6 months · stacked demand by region vs provisioned supply (${unit})`}
            info="Demand compounds monthly at each workload's trailing growth rate. Dashed line marks the 85% planning threshold."
            right={<Badge tone="ai">Forecast model</Badge>}
          />
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={d.forecast} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${fmtNum(v)} ${unit}`} />} />
                <Legend iconType="circle" iconSize={8} />
                {REGIONS.filter((r) => d.forecast[0][r.id] !== undefined).map((r) => (
                  <Area key={r.id} type="monotone" dataKey={r.id} name={r.name} stackId="1" stroke={CHART.regions[REGIONS.indexOf(r)]} fill={CHART.regions[REGIONS.indexOf(r)]} fillOpacity={0.18} />
                ))}
                <Line type="stepAfter" dataKey="capacity" name="Provisioned" stroke={CHART.ink} strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="threshold" name="85% threshold" stroke={CHART.red} strokeDasharray="5 4" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardTitle title="Regional capacity heatmap" subtitle="Utilization today and forecast; colored by risk band" right={<MeasuredTag />} />
          <RegionHeatmap filters={filters} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardTitle
            title="Top 5 efficiency opportunities"
            subtitle="Ranked by priority score = financial impact × confidence × feasibility"
            right={
              <Button size="sm" variant="ghost" onClick={() => go('cost')}>
                All opportunities <ArrowRight size={13} />
              </Button>
            }
          />
          <div className="divide-y divide-line">
            {[...d.open].sort((a, b) => b.priority - a.priority).slice(0, 5).map((o, i) => (
              <div key={o.id} className="flex items-center gap-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold">{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>{o.category}</span>·<span>{o.observedUtil.split(',')[0]}</span>
                    {o.confidence < LOW_CONFIDENCE && <Badge tone="amber">low confidence</Badge>}
                  </div>
                </div>
                <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                <div className="w-24 text-right">
                  <div className="tabular text-sm font-semibold">{fmtUSD(o.monthlySavings)}/mo</div>
                  <div className="text-[11px] text-muted">score {o.priority}</div>
                </div>
              </div>
            ))}
            {!d.open.length && <div className="py-6 text-center text-sm text-muted">No open opportunities in this scope.</div>}
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardTitle title="Infrastructure health indicators" subtitle="Computed from fleet inventory, reservations and program tracker" />
          <HealthIndicators capRows={d.capRows} spend={d.spend} budget={d.budget} regions={d.regions} programSavingsAtRisk={programFinancials(initiatives).atRiskSavings} />
        </Card>
      </div>
    </div>
  )
}

function RegionHeatmap({ filters }: { filters: Filters }) {
  const cols: { key: string; label: string }[] = [
    { key: 'now', label: 'Now' },
    { key: 'f3', label: `+3 mo` },
    { key: 'f6', label: `+6 mo` },
    { key: 'storage', label: 'Storage' },
    { key: 'network', label: 'Network' },
  ]
  const rows = REGIONS.filter((r) => filters.region === 'all' || r.id === filters.region).map((reg) => {
    const f = { ...filters, region: reg.id }
    const comp = filterRows({ ...f, type: filters.type === 'all' ? 'compute' : filters.type })
    const p = sum(comp, 'provisioned')
    const cell = (t: 'storage' | 'network') => {
      const rr = filterRows({ ...f, type: t })
      return rr.length ? sum(rr, 'used') / sum(rr, 'provisioned') : null
    }
    const vals: Record<string, number | null> = {
      now: p ? sum(comp, 'used') / p : null,
      f3: p ? comp.reduce((s, r) => s + forecastUsed(r, 3), 0) / p : null,
      f6: p ? comp.reduce((s, r) => s + forecastUsed(r, 6), 0) / p : null,
      storage: cell('storage'),
      network: cell('network'),
    }
    const status = regionStats({ ...f, type: filters.type === 'all' ? 'compute' : filters.type })[0]?.status
    return { reg, vals, status }
  })
  return (
    <div>
      <div className="grid grid-cols-[1.3fr_repeat(5,1fr)] gap-1 text-[11px]">
        <div />
        {cols.map((c) => (
          <div key={c.key} className="pb-1 text-center font-medium text-muted">
            {c.label}
          </div>
        ))}
        {rows.map(({ reg, vals, status }) => (
          <div key={reg.id} className="contents">
            <div className="flex flex-col justify-center pr-1">
              <span className="text-xs font-medium">{reg.name}</span>
              {status && <span className={cx('text-[10px]', status === 'risk' ? 'text-pin' : status === 'waste' ? 'text-sky-700' : 'text-muted')}>{REGION_STATUS_LABEL[status]}</span>}
            </div>
            {cols.map((c) => {
              const v = vals[c.key]
              const col = v === null ? { bg: '#fafafa', fg: '#bbb' } : heatColor(v)
              return (
                <div key={c.key} className="tabular flex h-10 items-center justify-center rounded-md text-xs font-semibold" style={{ background: col.bg, color: col.fg }} title={v === null ? 'n/a' : `${reg.name} · ${c.label}: ${fmtPct(v)}`}>
                  {v === null ? '—' : `${Math.round(v * 100)}%`}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-muted">
        {[
          ['#dbeafe', '<50% underutilized'],
          ['#f5f5f5', '50–70%'],
          ['#ececec', '70–85% healthy'],
          ['#ff8a9a', '85–95% at threshold'],
          ['#e60023', '≥95% critical'],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-muted">
        Columns Now / +3 / +6 show {filters.type === 'all' ? 'compute' : filters.type} utilization. Forecast through {monthLabel(6)}.
      </p>
    </div>
  )
}

function HealthIndicators({ capRows, spend, budget, regions, programSavingsAtRisk }: { capRows: ReturnType<typeof filterRows>; spend: number; budget: number; regions: ReturnType<typeof regionStats>; programSavingsAtRisk: number }) {
  const provTotal = sum(capRows, 'provisioned')
  const healthyBand = capRows.filter((r) => r.used / r.provisioned >= 0.5 && r.used / r.provisioned < CAPACITY_THRESHOLD).reduce((s, r) => s + r.provisioned, 0) / Math.max(1, provTotal)
  const reserved = sum(capRows, 'reserved')
  const stranded = capRows.reduce((s, r) => s + Math.max(0, r.reserved - r.used), 0)
  const coverage = reserved / Math.max(1, sum(capRows, 'used'))
  const firstConstraint = regions.map((r) => r.monthsToThreshold).filter((m): m is number => m !== null).sort((a, b) => a - b)[0]
  const items: { label: string; value: string; state: 'good' | 'warn' | 'bad'; note: string }[] = [
    { label: 'Capacity in healthy band (50–85%)', value: fmtPct(healthyBand, 0), state: healthyBand > 0.6 ? 'good' : healthyBand > 0.4 ? 'warn' : 'bad', note: 'Share of provisioned capacity neither idle nor constrained' },
    { label: 'Stranded reserved capacity', value: fmtPct(stranded / Math.max(1, reserved), 0), state: stranded / reserved < 0.05 ? 'good' : stranded / reserved < 0.12 ? 'warn' : 'bad', note: `${fmtNum(stranded)} reserved units not consumed` },
    { label: 'Reservation coverage of usage', value: fmtPct(coverage, 0), state: coverage >= 0.8 && coverage <= 1.05 ? 'good' : 'warn', note: 'Target 80–100% of steady-state usage' },
    { label: 'Spend vs budget', value: `${spend > budget ? '+' : ''}${fmtPct((spend - budget) / budget)}`, state: spend <= budget ? 'good' : (spend - budget) / budget < 0.03 ? 'warn' : 'bad', note: `${fmtUSD(spend)} actual vs ${fmtUSD(budget)} budget` },
    { label: 'Time to first regional constraint', value: firstConstraint === undefined ? '> 36 mo' : firstConstraint === 0 ? 'Now' : `${firstConstraint.toFixed(1)} mo`, state: firstConstraint === undefined || firstConstraint > 9 ? 'good' : firstConstraint > 4 ? 'warn' : 'bad', note: 'Earliest crossing of the 85% planning threshold' },
    { label: 'Program savings at risk', value: `${fmtUSD(programSavingsAtRisk)}/mo`, state: programSavingsAtRisk === 0 ? 'good' : programSavingsAtRisk < 30_000 ? 'warn' : 'bad', note: 'Savings tied to At Risk / Off Track initiatives' },
  ]
  const Icon = { good: CheckCircle2, warn: CircleDot, bad: CircleAlert }
  const color = { good: 'text-emerald-600', warn: 'text-amber-500', bad: 'text-pin' }
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const I = Icon[it.state]
        return (
          <div key={it.label} className="flex items-start gap-3">
            <I size={16} className={cx('mt-0.5 shrink-0', color[it.state])} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{it.label}</span>
                <span className="tabular text-sm font-semibold">{it.value}</span>
              </div>
              <div className="text-[11px] text-muted">{it.note}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
