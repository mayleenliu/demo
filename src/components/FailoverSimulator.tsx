import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ServerCrash, ShieldCheck, ShieldAlert } from 'lucide-react'
import { REGIONS, regionById } from '../data/model'
import { FAILOVER_CEILING, PROTECT_LABEL, SEVERITY_LABEL, simulateFailover, worstCaseFailover, type FailoverSeverity, type ProtectScope } from '../lib/calc'
import { fmtNum, fmtPct, fmtUSD } from '../lib/format'
import { Badge, Card, CardTitle, CHART, ChartTooltip, Segmented, Select, Td, Th, cx } from './ui'

const SEV_TONE: Record<FailoverSeverity, 'green' | 'red' | 'amber' | 'neutral'> = { ok: 'green', outage: 'red', degraded: 'amber', deferrable: 'neutral' }

export default function FailoverSimulator({ defaultRegion }: { defaultRegion: string }) {
  const [region, setRegion] = useState(defaultRegion === 'all' ? 'eu-central' : defaultRegion)
  const reg = regionById(region)
  const [failedAz, setFailedAz] = useState<string>('worst')
  const [ceiling, setCeiling] = useState(FAILOVER_CEILING)
  const [protect, setProtect] = useState<ProtectScope>('tier01')

  const worst = useMemo(() => worstCaseFailover(region, ceiling, protect), [region, ceiling, protect])
  const az = failedAz === 'worst' || !reg.azs.includes(failedAz) ? worst.failedAz : failedAz
  const sim = useMemo(() => simulateFailover({ region, failedAz: az, ceiling, protect }), [region, az, ceiling, protect])
  const perAz = useMemo(() => reg.azs.map((a) => simulateFailover({ region, failedAz: a, ceiling, protect })), [reg, region, ceiling, protect])

  const chart = sim.azs.map((a) => ({
    az: a.failed ? `${a.az} (failed)` : a.az,
    before: a.before,
    existing: a.failed ? 0 : a.before,
    absorbed: a.failed ? 0 : a.after - a.before,
    failed: a.failed,
  }))
  const unplacedProtected = sim.pools.filter((p) => p.protected).reduce((s, p) => s + p.shortfall, 0)
  const fungibleFits = sim.fungibleShortfall === 0

  return (
    <Card>
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <ServerCrash size={16} className="text-pin" /> Availability-zone failover simulator
          </span>
        }
        subtitle="Fail one AZ, move its load to the same hardware pool in the surviving AZs (up to the failover ceiling), and see what doesn't fit"
        right={<Badge tone="dark">Reliability model</Badge>}
      />

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
        <span className="font-semibold">Why the 85% planning threshold isn't an N+1 guarantee: </span>
        losing one of three equal AZs raises survivor load by 1.5×, so even fully interchangeable capacity has to stay at or below{' '}
        <b>{fmtPct(ceiling * (2 / 3), 0)}</b> steady-state to stay under a {fmtPct(ceiling, 0)} ceiling. Unequal AZ sizes lower that limit (losing {reg.name}'s largest AZ allows only{' '}
        <b>{fmtPct(Math.min(...perAz.map((p) => p.maxSteadyUtil)), 0)}</b>). Capacity also isn't interchangeable in practice: GPU and Tier 0 pools can only fail over into the same pool.
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Region</div>
            <Select
              value={region}
              onChange={(v) => {
                setRegion(v)
                setFailedAz('worst')
              }}
              options={REGIONS.map((r) => ({ value: r.id, label: r.name }))}
              className="w-full"
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">AZ to fail</div>
            <Select value={failedAz} onChange={setFailedAz} options={[{ value: 'worst', label: `Worst case (${worst.failedAz})` }, ...reg.azs.map((a) => ({ value: a, label: a }))]} className="w-full" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-muted">Max utilization during failover</span>
              <span className="tabular font-semibold">{Math.round(ceiling * 100)}%</span>
            </div>
            <input type="range" min={75} max={100} step={1} value={ceiling * 100} onChange={(e) => setCeiling(Number(e.target.value) / 100)} className="w-full accent-[#e60023]" />
            <div className="text-[11px] text-muted">How hot survivors may run during the incident</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Capacity must protect</div>
            <Segmented value={protect} onChange={setProtect} options={(Object.keys(PROTECT_LABEL) as ProtectScope[]).map((k) => ({ value: k, label: k === 'tier0' ? 'Tier 0' : k === 'tier01' ? 'Tier 0+1' : 'All' }))} />
            <div className="mt-1 text-[11px] text-muted">Unprotected tiers may degrade (Tier 1) or defer (Tier 2 batch) during the event</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Each AZ in {reg.name}</div>
            <div className="space-y-1.5">
              {perAz.map((p) => (
                <button key={p.failedAz} onClick={() => setFailedAz(p.failedAz)} className={cx('flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-neutral-50', p.failedAz === az && 'bg-neutral-100')}>
                  <span>
                    Lose <b>{p.failedAz}</b> <span className="text-muted">({fmtPct(p.failedShare, 0)} of supply)</span>
                  </span>
                  {p.sufficient ? <Badge tone="green">Survives</Badge> : <Badge tone="red">+{fmtNum(p.unitsNeeded)}</Badge>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Steady-state utilization" value={fmtPct(sim.aggregateUtil, 0)} sub={`AZs at ${sim.azs.map((a) => fmtPct(a.before, 0)).join(' / ')}`} />
            <Stat
              label="If capacity were interchangeable"
              value={fmtPct(sim.fungibleUtil, 0)}
              sub={fungibleFits ? `fits under ${fmtPct(ceiling, 0)}, but misleading` : `${fmtNum(sim.fungibleShortfall)} units over ceiling`}
              tone={fungibleFits ? undefined : 'red'}
            />
            <Stat
              label="Pool-level result"
              value={sim.sufficient ? 'Sufficient' : 'Insufficient'}
              sub={sim.sufficient ? 'all protected pools fit' : `${fmtNum(unplacedProtected)} protected units can't be placed`}
              tone={sim.sufficient ? 'green' : 'red'}
              icon={sim.sufficient ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
            />
            <Stat label="Additional capacity required" value={`${fmtNum(sim.unitsNeeded)} units`} sub={`${fmtUSD(sim.monthlyInvestment)}/mo at ${fmtUSD(sim.unitCost)}/unit`} tone={sim.unitsNeeded ? 'red' : 'green'} />
          </div>

          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barGap={4}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="az" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, (max: number) => Math.max(1, Math.ceil(max * 10) / 10)]} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v)} />} />
                <Legend iconType="circle" iconSize={8} />
                <ReferenceLine y={ceiling} stroke={CHART.red} strokeDasharray="4 4" label={{ value: `${Math.round(ceiling * 100)}% ceiling`, position: 'insideTopRight', fontSize: 10, fill: CHART.red }} />
                <Bar dataKey="before" name="Before failure" fill={CHART.light} radius={[4, 4, 0, 0]} maxBarSize={44} />
                <Bar dataKey="existing" name="After: existing load" stackId="after" fill={CHART.ink} maxBarSize={44} />
                <Bar dataKey="absorbed" name="After: absorbed from failed AZ" stackId="after" fill={CHART.red} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px]">
              <thead className="bg-neutral-50">
                <tr>
                  <Th className="pl-4">Workload pool</Th>
                  <Th>Tier</Th>
                  <Th className="text-right">Displaced</Th>
                  <Th className="text-right">Survivor spare</Th>
                  <Th className="text-right">Can't place</Th>
                  <Th className="text-right">Survivor util</Th>
                  <Th>Impact</Th>
                  <Th className="pr-4 text-right">Units to add</Th>
                </tr>
              </thead>
              <tbody>
                {sim.pools.map((p) => (
                  <tr key={p.workload}>
                    <Td className="pl-4 font-medium">{p.name}</Td>
                    <Td className="text-xs text-muted">{p.tier}</Td>
                    <Td className="tabular text-right">{fmtNum(p.displaced)}</Td>
                    <Td className="tabular text-right">{fmtNum(p.survivorSpare)}</Td>
                    <Td className={cx('tabular text-right', p.shortfall >= 1 && 'font-semibold text-pin')}>{fmtNum(p.shortfall)}</Td>
                    <Td className={cx('tabular text-right', p.postUtil > ceiling && 'text-pin')}>{fmtPct(p.postUtil, 0)}</Td>
                    <Td>
                      <Badge tone={SEV_TONE[p.severity]}>{SEVERITY_LABEL[p.severity]}</Badge>
                      {p.shortfall >= 1 && !p.protected && <span className="ml-1 text-[10px] text-muted">accepted</span>}
                    </Td>
                    <Td className="tabular pr-4 text-right font-semibold">{p.unitsNeeded ? fmtNum(p.unitsNeeded) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-ink-2">
            <summary className="cursor-pointer font-medium">Show calculation</summary>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              <div>for each pool: displaced = load in {az}; spare = Σ max(0, {ceiling} × prov − used) over surviving AZs</div>
              <div>absorbed = min(displaced, spare), spread across survivors in proportion to spare; can't place = displaced − absorbed</div>
              <div>units to add = ceil(can't place ÷ {ceiling}) for protected tiers ({PROTECT_LABEL[protect]})</div>
              <div>
                interchangeable view = {fmtNum(sim.azs.reduce((s, a) => s + a.used, 0))} used ÷ {fmtNum(sim.azs.filter((a) => !a.failed).reduce((s, a) => s + a.provisioned, 0))} surviving = {fmtPct(sim.fungibleUtil)}
              </div>
              <div>
                N+1-safe steady state = ceiling × (1 − failed AZ share) = {ceiling} × (1 − {sim.failedShare.toFixed(2)}) = {fmtPct(sim.maxSteadyUtil)}
              </div>
            </div>
          </details>
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: 'red' | 'green'; icon?: React.ReactNode }) {
  return (
    <div className={cx('rounded-xl border p-3', tone === 'red' ? 'border-pin/30 bg-pin-soft' : tone === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-line')}>
      <div className="flex items-center gap-1 text-[11px] font-medium text-muted">
        {icon}
        {label}
      </div>
      <div className={cx('tabular mt-1 text-lg font-semibold leading-tight', tone === 'red' && 'text-pin-dark')}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}
