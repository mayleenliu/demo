import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { AS_OF, CAPEX_PER_RACK, EARLY_RETIRE_DATE, GENS, REGIONS, SWAP_RACKS_PER_MONTH, regionById, type GenId } from '../data/fleet'
import { STRATEGY_LABEL, eolOf, gen11Ga, monthLabel, rackRows, roadmap, strategyMetrics, toDate, type RackRec, type RackRow, type Strategy } from '../lib/capacity'
import { fmtPct, fmtUSD } from '../lib/format'
import { useStore } from '../state/store'
import { Badge, Button, Card, CardTitle, CHART, ChartTooltip, Segmented, Select, Td, Th, cx } from '../components/ui'

const REC_TONE: Record<RackRec, 'red' | 'amber' | 'blue' | 'neutral'> = { 'Replace before EOL': 'red', "Don't replace at EOL": 'amber', "Move, don't write off": 'blue', 'Keep to EOL': 'neutral' }
const RECS = Object.keys(REC_TONE) as RackRec[]
const PAGE = 50

export default function Lifecycle() {
  return (
    <div className="space-y-6">
      <RefreshStrategy />
      <Roadmap />
      <RackTable />
    </div>
  )
}

/* ---------------- Gen6 refresh strategy ---------------- */

function RefreshStrategy() {
  const { plan, setStrategy, setSlip } = useStore()
  const all = (['gen11', 'hybrid', 'gen8'] as Strategy[]).map((s) => strategyMetrics(plan, s))
  return (
    <Card id="demo-refresh">
      <CardTitle
        title={`Gen6 refresh: ${all[0].gen8Racks + all[0].gen11Racks} racks, EOL ${monthLabel(eolOf('gen6'))}`}
        right={
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium text-muted">Gen11 GA slip</span>
            <Segmented value={String(plan.gen11Slip)} onChange={(v) => setSlip(Number(v))} options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: n ? `+${n} mo` : 'On time' }))} />
          </div>
        }
      />
      <div className="grid gap-3 lg:grid-cols-3">
        {all.map((m) => {
          const active = plan.strategy === m.strategy
          const late = m.pastEolRacks > 0
          return (
            <div key={m.strategy} className={cx('flex flex-col rounded-xl border p-4', active ? 'border-ink ring-1 ring-ink' : 'border-line')}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold">{STRATEGY_LABEL[m.strategy]}</div>
                {active && <Badge tone="dark">Current plan</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted">
                {[m.gen8Racks ? `${m.gen8Racks} Gen8` : '', m.gen11Racks ? `${m.gen11Racks} Gen11` : ''].filter(Boolean).join(' + ')} racks
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-muted">Done by</dt>
                <dd className={cx('tabular text-right font-semibold', late && 'text-pin')}>{m.lastLive ? monthLabel(m.lastLive) : '—'}</dd>
                <dt className="text-muted">Buffer to EOL</dt>
                <dd className={cx('tabular text-right font-semibold', late ? 'text-pin' : m.bufferMonths < 2 && 'text-amber-700')}>{late ? `${m.pastEolRacks} racks past EOL` : `${m.bufferMonths.toFixed(1)} mo`}</dd>
                <dt className="text-muted">Gen6 write-off at swap</dt>
                <dd className="tabular text-right font-semibold">{fmtUSD(m.gen6WriteOff)}</dd>
                <dt className="text-muted">Gen8 write-off at EOL</dt>
                <dd className={cx('tabular text-right font-semibold', m.gen8WriteOff > 0 && 'text-pin')}>{m.gen8WriteOff ? fmtUSD(m.gen8WriteOff) : '$0'}</dd>
                <dt className="text-muted">First order by</dt>
                <dd className="tabular text-right font-semibold">{m.firstOrderBy ? monthLabel(m.firstOrderBy) : '—'}</dd>
                <dt className="text-muted">Refresh again</dt>
                <dd className="tabular text-right font-semibold">{m.refreshAgain ? `${m.refreshAgain} racks by Dec '32` : "Gen11 EOL '35"}</dd>
              </dl>
              <div className="mt-auto pt-4">
                {active ? (
                  <div className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <Check size={13} /> Selected
                  </div>
                ) : (
                  <Button size="sm" onClick={() => setStrategy(m.strategy)}>
                    Use this plan
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 text-xs text-muted">
        Gen11 GA {monthLabel(gen11Ga(plan))} · {SWAP_RACKS_PER_MONTH} rack swaps / month · capex {fmtUSD(all[0].capex)} in every option
      </div>
    </Card>
  )
}

/* ---------------- Roadmap ---------------- */

function Roadmap() {
  const { plan, region } = useStore()
  const data = useMemo(() => roadmap(region, plan), [plan, region])
  const near = (d: Date) => data.reduce((b, p) => (Math.abs(p.date.getTime() - d.getTime()) < Math.abs(b.date.getTime() - d.getTime()) ? p : b), data[0]).q
  return (
    <Card id="demo-roadmap">
      <CardTitle title="Racks by generation" right={<Badge tone="dark">{region === 'all' ? 'All regions' : regionById(region).name}</Badge>} />
      <div className="h-72">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="q" tickLine={false} axisLine={false} interval={3} />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v) => `${Math.round(v).toLocaleString()} racks`} />} />
            <Legend iconType="circle" iconSize={8} />
            {GENS.map((g) => (
              <Area key={g.id} type="stepAfter" dataKey={g.id} name={g.name} stackId="s" stroke={g.color} fill={g.color} fillOpacity={g.id === 'gen11' ? 0.45 : 0.6} />
            ))}
            <Line type="monotone" dataKey="required" name="Racks needed (24-mo forecast)" stroke={CHART.red} strokeWidth={2.5} strokeDasharray="6 4" dot={false} />
            <ReferenceLine x={near(AS_OF)} stroke="#999" label={{ value: 'Today', position: 'top', fontSize: 10, fill: '#767676' }} />
            <ReferenceLine x={near(gen11Ga(plan))} stroke={CHART.red} strokeOpacity={0.4} label={{ value: 'Gen11 GA', position: 'top', fontSize: 10, fill: CHART.red }} />
            <ReferenceLine x={near(eolOf('gen6'))} stroke="#999" strokeDasharray="3 3" label={{ value: 'Gen6 EOL', position: 'insideTopRight', fontSize: 10, fill: '#767676' }} />
            <ReferenceLine x={near(eolOf('gen8'))} stroke="#999" strokeDasharray="3 3" label={{ value: 'Gen8 EOL', position: 'insideTopLeft', fontSize: 10, fill: '#767676' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

/* ---------------- Racks ---------------- */

type SortKey = 'id' | 'docked' | 'util' | 'bookValue' | 'retire' | 'writeOff'

function RackTable() {
  const { plan, region, setDecom } = useStore()
  const rows = useMemo(() => rackRows(plan), [plan])
  const [q, setQ] = useState('')
  const [gen, setGen] = useState<'all' | GenId>('all')
  const [rec, setRec] = useState<'all' | RackRec>('all')
  const [regionF, setRegionF] = useState<string>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'docked', dir: 1 })
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const effRegion = region !== 'all' ? region : regionF

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const val = (r: RackRow): string | number =>
      sort.key === 'id' ? r.rack.id : sort.key === 'docked' ? r.rack.docked : sort.key === 'util' ? r.rack.util : sort.key === 'bookValue' ? r.bookValue : sort.key === 'retire' ? r.retire.getTime() : r.writeOff
    return rows
      .filter((r) => (effRegion === 'all' || r.rack.region === effRegion) && (gen === 'all' || r.rack.gen === gen) && (rec === 'all' || r.rec === rec) && (!s || r.rack.id.toLowerCase().includes(s)))
      .sort((a, b) => {
        const x = val(a)
        const y = val(b)
        return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir
      })
  }, [rows, effRegion, gen, rec, q, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const p = Math.min(page, pages - 1)
  const view = filtered.slice(p * PAGE, p * PAGE + PAGE)
  const early = rows.filter((r) => r.choice !== 'plan')
  const writeOff = early.reduce((s, r) => s + r.writeOff, 0)
  const capexAvoided = early.filter((r) => r.rack.gen === 'gen6').length * CAPEX_PER_RACK
  const selRows = filtered.filter((r) => sel.has(r.rack.id))
  const allOnPage = view.length > 0 && view.every((r) => sel.has(r.rack.id))
  const toggle = (ids: string[], on: boolean) =>
    setSel((s) => {
      const n = new Set(s)
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
      return n
    })
  const th = (key: SortKey, label: string, cls?: string) => (
    <Th className={cls} active={sort.key === key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}>
      {label} {sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : ''}
    </Th>
  )

  return (
    <Card id="demo-decom" pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <h3 className="text-[15px] font-semibold">Racks</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5">
            <Search size={13} className="text-muted" />
            <input value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder="Rack or cluster" className="w-36 bg-transparent text-sm outline-none" />
          </label>
          {region === 'all' && <Select value={regionF} onChange={(v) => (setRegionF(v), setPage(0))} options={[{ value: 'all', label: 'All regions' }, ...REGIONS.map((r) => ({ value: r.id, label: r.name }))]} />}
          <Select value={gen} onChange={(v) => (setGen(v), setPage(0))} options={[{ value: 'all' as const, label: 'All gens' }, ...GENS.filter((g) => g.id !== 'gen11').map((g) => ({ value: g.id, label: g.name }))]} />
          <Select value={rec} onChange={(v) => (setRec(v), setPage(0))} options={[{ value: 'all' as const, label: 'All recommendations' }, ...RECS.map((r) => ({ value: r, label: r }))]} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-y border-line bg-neutral-50 px-5 py-2.5 text-xs">
        <span className="font-medium">
          {selRows.length ? `${selRows.length} selected` : `${filtered.length.toLocaleString()} racks`}
          {selRows.length > 0 && <span className="text-muted"> · book value {fmtUSD(selRows.reduce((s, r) => s + r.bookValue, 0))}</span>}
        </span>
        {selRows.length > 0 && (
          <>
            {selRows.some((r) => r.rack.gen === 'gen6') && (
              <Button size="sm" variant="dark" onClick={() => (setDecom(selRows.filter((r) => r.rack.gen === 'gen6').map((r) => r.rack.id), 'noReplace'), setSel(new Set()))}>
                Don't replace at EOL
              </Button>
            )}
            <Button size="sm" onClick={() => (setDecom(selRows.map((r) => r.rack.id), 'early'), setSel(new Set()))}>
              Retire {monthLabel(toDate(EARLY_RETIRE_DATE))}
            </Button>
            <Button size="sm" onClick={() => (setDecom(selRows.map((r) => r.rack.id), 'plan'), setSel(new Set()))}>
              Back to plan
            </Button>
            <button className="text-muted hover:text-ink" onClick={() => setSel(new Set())}>
              Clear
            </button>
          </>
        )}
        {!selRows.length && filtered.length > 0 && (
          <button className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => toggle(filtered.map((r) => r.rack.id), true)}>
            Select all {filtered.length}
          </button>
        )}
        {early.length > 0 && (
          <span className="ml-auto flex gap-4">
            <span>
              Off plan: <b>{early.length}</b>
            </span>
            <span>
              Write-off: <b className={writeOff ? 'text-pin' : ''}>{fmtUSD(writeOff)}</b>
            </span>
            <span>
              Replacement capex avoided: <b className="text-emerald-700">{fmtUSD(capexAvoided)}</b>
            </span>
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr>
              <Th className="w-10 pl-5">
                <input type="checkbox" checked={allOnPage} onChange={(e) => toggle(view.map((r) => r.rack.id), e.target.checked)} className="accent-[#e60023]" />
              </Th>
              {th('id', 'Rack')}
              <Th>Gen</Th>
              {th('docked', 'Docked')}
              {th('util', 'Util', 'text-right')}
              {th('bookValue', 'Book value', 'text-right')}
              <Th>Recommendation</Th>
              {th('retire', 'Retires')}
              {th('writeOff', 'Write-off', 'pr-5 text-right')}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const pastEol = r.replacement && r.replacement.pastEolMonths > 0
              return (
                <tr key={r.rack.id} className={cx('hover:bg-neutral-50', r.choice !== 'plan' && 'bg-amber-50/50')}>
                  <Td className="pl-5">
                    <input type="checkbox" checked={sel.has(r.rack.id)} onChange={(e) => toggle([r.rack.id], e.target.checked)} className="accent-[#e60023]" />
                  </Td>
                  <Td className="whitespace-nowrap font-medium">
                    {r.rack.id}
                    <div className="text-[11px] font-normal text-muted">{regionById(r.rack.region).name}</div>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: GENS.find((g) => g.id === r.rack.gen)!.color }} />
                      {GENS.find((g) => g.id === r.rack.gen)!.name}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {monthLabel(toDate(r.rack.docked))}
                    <div className="text-[11px] text-muted">{r.age.toFixed(1)} y</div>
                  </Td>
                  <Td className={cx('tabular text-right', r.rack.util < 0.4 && 'text-sky-700')}>{fmtPct(r.rack.util, 0)}</Td>
                  <Td className="tabular text-right">{fmtUSD(r.bookValue)}</Td>
                  <Td>
                    <Badge tone={REC_TONE[r.rec]}>{r.rec}</Badge>
                  </Td>
                  <Td className={cx('whitespace-nowrap text-xs', pastEol && 'font-semibold text-pin')}>
                    {monthLabel(r.retire)}
                    {r.choice === 'early' ? <span className="ml-1 text-amber-700">early</span> : r.choice === 'noReplace' ? <span className="ml-1 text-amber-700">no replacement</span> : r.replacement ? <span className="ml-1 text-muted">→ {r.replacement.gen === 'gen8' ? 'Gen8' : 'Gen11'}</span> : null}
                    {pastEol && <AlertTriangle size={11} className="ml-1 inline" />}
                  </Td>
                  <Td className={cx('tabular pr-5 text-right', r.writeOff > 0 && 'font-semibold text-pin')}>{r.writeOff > 0 ? fmtUSD(r.writeOff) : '$0'}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-5 py-3 text-xs text-muted">
        <span>
          {filtered.length ? `${p * PAGE + 1}–${Math.min(filtered.length, (p + 1) * PAGE)} of ${filtered.length.toLocaleString()}` : 'No racks match'}
        </span>
        <span className="flex items-center gap-1">
          <button disabled={p === 0} onClick={() => setPage(p - 1)} className="rounded-full p-1 hover:bg-neutral-100 disabled:opacity-30" aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          {p + 1} / {pages}
          <button disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="rounded-full p-1 hover:bg-neutral-100 disabled:opacity-30" aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </span>
      </div>
    </Card>
  )
}
