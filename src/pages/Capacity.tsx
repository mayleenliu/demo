import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Calculator, Check, Clock, Shuffle, X } from 'lucide-react'
import { GENS, PLANNING_THRESHOLD, REGIONS, REQUESTS, genById, regionById, type CapacityRequest } from '../data/fleet'
import { VERDICT_LABEL, buildPlan, decideRequest, gen11Ga, monthLabel, rebalanceOptions, toDate, type ReqStatus, type Verdict } from '../lib/capacity'
import { fmtDate, fmtUSD } from '../lib/format'
import { useStore } from '../state/store'
import { DatacenterCapacity, Optimize } from './Datacenter'
import { Badge, Button, Card, CardTitle, CHART, ChartTooltip, Drawer, Segmented, Select, Td, Th, cx } from '../components/ui'

const VERDICT_TONE: Record<Verdict, 'green' | 'blue' | 'amber' | 'red'> = { fits: 'green', order: 'blue', phase: 'amber', escalate: 'red', defer: 'red' }
const STATUS_TONE: Record<ReqStatus, 'neutral' | 'green' | 'amber' | 'red'> = { Pending: 'neutral', Approved: 'green', Phased: 'amber', Escalated: 'red', Deferred: 'red', Rejected: 'red' }

export default function Capacity() {
  const { region } = useStore()
  return (
    <div className="space-y-6">
      <DatacenterCapacity />
      <RequestQueue />
      <OrderTimeline key={region} />
      <Optimize />
      <Rebalance />
    </div>
  )
}

/* ---------------- Requests ---------------- */

function RequestQueue() {
  const { plan, region } = useStore()
  const [open, setOpen] = useState<string | null>(null)
  const rows = REQUESTS.filter((r) => region === 'all' || r.region === region).map((r) => ({ req: r, d: decideRequest(r, plan), status: plan.requests[r.id] ?? 'Pending' }))
  const sel = rows.find((r) => r.req.id === open)

  return (
    <Card id="demo-requests" pad={false}>
      <div className="p-5 pb-3">
        <h3 className="text-[15px] font-semibold">Capacity requests</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr>
              <Th className="pl-5">Customer</Th>
              <Th>Region</Th>
              <Th className="text-right">Racks</Th>
              <Th>Need by</Th>
              <Th>Priority</Th>
              <Th>Recommendation</Th>
              <Th className="pr-5">Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ req, d, status }) => (
              <tr key={req.id} onClick={() => setOpen(req.id)} className="cursor-pointer hover:bg-neutral-50">
                <Td className="pl-5">
                  <div className="font-medium">{req.customer}</div>
                  <div className="text-[11px] text-muted">
                    {req.cluster} · {req.purpose}
                  </div>
                </Td>
                <Td>{regionById(req.region).name}</Td>
                <Td className="tabular text-right font-semibold">{req.racks}</Td>
                <Td className="whitespace-nowrap">{fmtDate(req.neededBy)}</Td>
                <Td>
                  <Badge tone={req.priority === 'P0' ? 'red' : req.priority === 'P1' ? 'amber' : 'neutral'}>{req.priority}</Badge>
                </Td>
                <Td>{status === 'Pending' ? <Badge tone={VERDICT_TONE[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge> : <span className="text-xs text-muted">—</span>}</Td>
                <Td className="pr-5">
                  <Badge tone={STATUS_TONE[status]}>{status === 'Phased' ? `Phased · ${plan.phasedRacks[req.id] ?? 0} now` : status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={!!sel} onClose={() => setOpen(null)} title={sel ? `${sel.req.customer} · ${sel.req.racks} racks · ${sel.req.cluster} (${regionById(sel.req.region).name})` : ''}>
        {sel && <RequestDetail req={sel.req} />}
      </Drawer>
    </Card>
  )
}

function RequestDetail({ req }: { req: CapacityRequest }) {
  const { plan, decide } = useStore()
  const d = decideRequest(req, plan)
  const status = plan.requests[req.id] ?? 'Pending'
  const primary = (() => {
    switch (d.verdict) {
      case 'fits':
        return { label: 'Approve', run: () => decide(req.id, 'Approved') }
      case 'order':
        return { label: `Approve + order ${d.order!.racks} ${genById(d.order!.gen).name} racks`, run: () => decide(req.id, 'Approved', { order: d.order }) }
      case 'phase':
        return { label: `Approve ${d.nowRacks} racks now${d.order ? ` + order ${d.order.racks}` : ''}`, run: () => decide(req.id, 'Phased', { order: d.order, nowRacks: d.nowRacks }) }
      case 'escalate':
        return { label: 'Escalate for power', run: () => decide(req.id, 'Escalated') }
      default:
        return { label: `Defer to ${monthLabel(d.laterDate!)}`, run: () => decide(req.id, 'Deferred') }
    }
  })()

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Requested" value={`${req.racks} racks`} />
        <Stat label="Need by" value={fmtDate(req.neededBy)} />
        <Stat label="Headroom" value={`${Math.max(0, Math.floor(d.headroom))} racks`} tone={d.headroom < req.racks ? 'red' : 'green'} />
      </div>

      <div className={cx('rounded-xl border p-4', d.verdict === 'fits' || d.verdict === 'order' ? 'border-emerald-200 bg-emerald-50' : d.verdict === 'phase' ? 'border-amber-200 bg-amber-50' : 'border-pin/30 bg-pin-soft')}>
        <div className="text-base font-semibold">{VERDICT_LABEL[d.verdict]}</div>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
          {d.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
              {r}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-line">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-sm font-medium">
          <Calculator size={14} /> Math
        </div>
        <table className="w-full text-xs">
          <tbody>
            {d.calc.map((c) => (
              <tr key={c.label} className="border-b border-line/70 last:border-0">
                <td className="px-3 py-2 font-medium">{c.label}</td>
                <td className="px-3 py-2 text-muted">{c.formula}</td>
                <td className="tabular whitespace-nowrap px-3 py-2 text-right font-semibold">{c.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {status === 'Pending' ? (
          <>
            <Button variant="primary" onClick={primary.run}>
              <Check size={14} /> {primary.label}
            </Button>
            {d.verdict !== 'defer' && <Button onClick={() => decide(req.id, 'Deferred')}>Defer</Button>}
            <Button variant="ghost" onClick={() => decide(req.id, 'Rejected')}>
              <X size={14} /> Reject
            </Button>
          </>
        ) : (
          <>
            <span className="self-center text-sm text-muted">{status}.</span>
            <Button variant="ghost" onClick={() => decide(req.id, 'Pending')}>
              Undo
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' | 'amber' }) {
  return (
    <div className={cx('rounded-xl border p-3', tone === 'red' ? 'border-pin/30 bg-pin-soft' : tone === 'green' ? 'border-emerald-200 bg-emerald-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-line')}>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className={cx('tabular mt-1 text-lg font-semibold leading-tight', tone === 'red' && 'text-pin-dark')}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

/* ---------------- Order timeline ---------------- */

function OrderTimeline() {
  const { plan, region: filterRegion } = useStore()
  const [region, setRegion] = useState(filterRegion === 'all' ? 'westus3' : filterRegion)
  const reg = regionById(region)
  const [growthPct, setGrowthPct] = useState<number | null>(null)
  const [extra, setExtra] = useState(0)
  const [horizon, setHorizon] = useState(12)
  const growth = growthPct === null ? reg.growth : growthPct / 100
  const bp = useMemo(() => buildPlan(region, plan, { horizon, growth, extra }), [region, plan, horizon, growth, extra])
  const data = bp.pts
  const near = (d: Date | null) => (d ? data.reduce((b, p) => (Math.abs(p.date.getTime() - d.getTime()) < Math.abs(b.date.getTime() - d.getTime()) ? p : b), data[0]).month : null)

  return (
    <Card id="demo-order">
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <Clock size={16} className="text-pin" /> When do we order and dock?
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[240px_1fr]">
        <div className="space-y-4">
          <Select
            value={region}
            onChange={(v) => {
              setRegion(v)
              setGrowthPct(null)
            }}
            options={REGIONS.map((r) => ({ value: r.id, label: r.name }))}
            className="w-full"
          />
          <Slider label="Monthly growth" value={+(growth * 100).toFixed(1)} min={0} max={6} step={0.1} fmt={(v) => `${v.toFixed(1)}%`} onChange={setGrowthPct} />
          <Slider label="Extra demand" value={extra} min={0} max={200} step={5} fmt={(v) => `+${v} racks`} onChange={setExtra} />
          <Segmented value={String(horizon)} onChange={(v) => setHorizon(Number(v))} options={[{ value: '12', label: '12 mo' }, { value: '18', label: '18 mo' }, { value: '24', label: '24 mo' }]} />
        </div>
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Hits 75%" value={bp.liveBy ? monthLabel(bp.liveBy) : '—'} tone={bp.liveBy && bp.over! <= 6 ? 'red' : undefined} />
            <Stat label="Order by" value={bp.orderBy ? (bp.overdue ? 'Overdue' : fmtDate(bp.orderBy)) : '—'} sub={bp.dockBy ? `dock ${fmtDate(bp.dockBy)}` : undefined} tone={bp.overdue ? 'red' : bp.orderBy ? 'amber' : undefined} />
            <Stat label="Build" value={bp.racks ? `${bp.racks} ${genById(bp.gen).name} racks` : '—'} sub={bp.racks ? `${fmtUSD(bp.capex)} · ${(bp.kwNeeded / 1000).toFixed(2)} MW` : undefined} />
            <Stat
              label={bp.powerShortRacks ? 'Power' : 'Write-off at Gen8 EOL'}
              value={bp.powerShortRacks ? `${bp.powerShortRacks} racks short` : bp.writeOffAtEol ? fmtUSD(bp.writeOffAtEol) : '—'}
              sub={bp.powerShortRacks ? 'escalate' : bp.gen === 'gen8' && bp.racks ? `Gen11 GA ${monthLabel(gen11Ga(plan))}` : undefined}
              tone={bp.powerShortRacks ? 'red' : bp.writeOffAtEol ? 'amber' : undefined}
            />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${Math.round(v).toLocaleString()} racks`} />} />
                <Legend iconType="circle" iconSize={8} />
                {GENS.map((g) => (
                  <Area key={g.id} type="stepAfter" dataKey={g.id} name={g.name} stackId="s" stroke={g.color} fill={g.color} fillOpacity={g.id === 'gen11' ? 0.45 : 0.6} />
                ))}
                <Line type="stepAfter" dataKey="usable" name={`${PLANNING_THRESHOLD * 100}% line`} stroke={CHART.ink} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="demand" name="Racks in use" stroke={CHART.red} strokeWidth={2.5} dot={false} />
                {[
                  { d: bp.orderBy, label: 'Order' },
                  { d: bp.liveBy, label: 'Live' },
                ].map((m) => {
                  const x = near(m.d)
                  return x && m.d! >= data[0].date ? <ReferenceLine key={m.label} x={x} stroke={CHART.red} strokeOpacity={0.5} label={{ value: m.label, position: 'top', fontSize: 10, fill: CHART.red }} /> : null
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-muted">{label}</span>
        <span className="tabular font-semibold">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#e60023]" />
    </div>
  )
}

/* ---------------- Rebalance ---------------- */

function Rebalance() {
  const { plan, region, addMove, removeMove } = useStore()
  const options = rebalanceOptions(plan, region)
  return (
    <Card id="demo-rebalance">
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <Shuffle size={16} /> Rebalance racks
          </span>
        }
      />
      <div className="space-y-3">
        {options.map((o) => {
          const planned = plan.moves.some((m) => m.id === o.move.id)
          return (
            <div key={o.move.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-3">
              <div className="min-w-[200px] flex-1 text-sm font-medium">
                <span className="flex items-center gap-2">
                  {regionById(o.from).name} <ArrowRight size={14} /> {regionById(o.to).name}
                </span>
                <span className="text-xs font-normal text-muted">lowest-utilization Gen8 racks</span>
              </div>
              <Mini label="Racks" value={String(o.racks)} />
              <Mini label="Live" value={monthLabel(o.live)} />
              <div className="w-36 text-right">
                {planned ? (
                  <Button size="sm" variant="ghost" onClick={() => removeMove(o.move.id)}>
                    Planned · undo
                  </Button>
                ) : (
                  <Button size="sm" variant="dark" onClick={() => addMove(o.move)}>
                    Plan move
                  </Button>
                )}
              </div>
            </div>
          )
        })}
        {!options.length && <div className="py-4 text-center text-sm text-muted">No rebalancing opportunities.</div>}
        {plan.moves.length > 0 && (
          <div className="pt-1 text-xs text-muted">
            Planned: {plan.moves.map((m) => `${m.racks} racks ${regionById(m.fromRegion).name} → ${regionById(m.toRegion).name} (${monthLabel(toDate(m.live))})`).join(' · ')}
          </div>
        )}
      </div>
    </Card>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="w-24">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tabular text-sm font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}
