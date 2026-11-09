import { useMemo, useState } from 'react'
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, ReferenceArea, Bar, BarChart } from 'recharts'
import { ArrowRight, Calculator, Check, ChevronRight, Lock, Plus, ShieldAlert } from 'lucide-react'
import { regionById, workloadById } from '../data/model'
import { filterOpps, LOW_CONFIDENCE, OPP_STATUSES, type OppCategory, type OppStatus } from '../lib/calc'
import { fmtPct, fmtUSD } from '../lib/format'
import { useOpportunities, useStore, type OppWithStatus } from '../state/store'
import { Badge, Button, Card, CardTitle, CHART, Drawer, Kpi, LowConfidenceTag, MeasuredTag, Segmented, Td, Th, statusTone, cx, AITag } from '../components/ui'
import type { PageId } from '../App'

const CATEGORIES: OppCategory[] = ['Underutilized compute', 'Storage inefficiency', 'Networking inefficiency', 'Stranded capacity']
const CAT_LETTER: Record<OppCategory, string> = { 'Underutilized compute': 'A', 'Storage inefficiency': 'B', 'Networking inefficiency': 'C', 'Stranded capacity': 'D' }
const CAT_COLOR: Record<OppCategory, string> = { 'Underutilized compute': CHART.red, 'Storage inefficiency': CHART.slate, 'Networking inefficiency': CHART.amber, 'Stranded capacity': CHART.teal }
const LEVEL_ORDER = { Low: 1, Medium: 2, High: 3 }

type SortKey = 'priority' | 'savings' | 'effort' | 'confidence'

export default function CostOptimization({ go }: { go: (p: PageId) => void }) {
  const { filters } = useStore()
  const all = useOpportunities()
  const [cat, setCat] = useState<'all' | OppCategory>('all')
  const [statusF, setStatusF] = useState<'all' | OppStatus>('all')
  const [sort, setSort] = useState<SortKey>('priority')
  const [selected, setSelected] = useState<string | null>(null)

  const scoped = useMemo(() => {
    const ids = new Set(filterOpps(filters).map((o) => o.id))
    return all.filter((o) => ids.has(o.id))
  }, [all, filters])

  const list = useMemo(() => {
    const l = scoped.filter((o) => (cat === 'all' || o.category === cat) && (statusF === 'all' || o.status === statusF))
    const k: Record<SortKey, (o: OppWithStatus) => number> = {
      priority: (o) => -o.priority,
      savings: (o) => -o.monthlySavings,
      effort: (o) => LEVEL_ORDER[o.effort] * 1e7 - o.monthlySavings,
      confidence: (o) => -o.confidence,
    }
    return [...l].sort((a, b) => k[sort](a) - k[sort](b))
  }, [scoped, cat, statusF, sort])

  const open = scoped.filter((o) => o.status !== 'Completed')
  const totalOpen = open.reduce((s, o) => s + o.monthlySavings, 0)
  const approved = scoped.filter((o) => ['Approved', 'In Progress', 'Completed'].includes(o.status)).reduce((s, o) => s + o.monthlySavings, 0)
  const low = open.filter((o) => o.confidence < LOW_CONFIDENCE)
  const byCat = CATEGORIES.map((c) => ({ name: c, letter: CAT_LETTER[c], savings: open.filter((o) => o.category === c).reduce((s, o) => s + o.monthlySavings, 0), count: open.filter((o) => o.category === c).length }))
  const sel = all.find((o) => o.id === selected) ?? null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Identified savings (open)" value={`${fmtUSD(totalOpen)}/mo`} sub={<span>{fmtUSD(totalOpen * 12)}/yr · {open.length} opportunities</span>} tone="green" />
        <Kpi label="Approved or in execution" value={`${fmtUSD(approved)}/mo`} sub={<span>{fmtPct(approved / Math.max(1, totalOpen + scoped.filter((o) => o.status === 'Completed').reduce((s, o) => s + o.monthlySavings, 0)), 0)} of pipeline</span>} />
        <Kpi label="Awaiting review" value={scoped.filter((o) => o.status === 'Proposed' || o.status === 'Under Review').length} sub={<span>Proposed + Under Review</span>} />
        <Kpi label="Low-confidence flags" value={low.length} sub={<span>confidence &lt; {LOW_CONFIDENCE * 100}% · {fmtUSD(low.reduce((s, o) => s + o.monthlySavings, 0))}/mo</span>} tone={low.length ? 'red' : 'neutral'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardTitle
            title="Prioritization matrix"
            subtitle="x = feasibility (effort × risk) · y = monthly savings · bubble = priority score · click a bubble to inspect"
            info="Priority score = financial impact ($K/mo) × confidence × feasibility. Top-right quadrant = quick wins."
          />
          <div className="h-80">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 15, left: 0, bottom: 10 }}>
                <CartesianGrid stroke="#f0f0f0" />
                <ReferenceArea x1={0.6} x2={1} y1={15000} ifOverflow="extendDomain" fill="#e60023" fillOpacity={0.04} label={{ value: 'Quick wins', position: 'insideTopRight', fontSize: 11, fill: CHART.red }} />
                <XAxis type="number" dataKey="feasibility" name="Feasibility" domain={[0.3, 1]} tickFormatter={(v) => v.toFixed(1)} tickLine={false} label={{ value: 'Feasibility →', position: 'insideBottomRight', offset: -5, fontSize: 11, fill: '#767676' }} />
                <YAxis type="number" dataKey="monthlySavings" name="Savings" tickFormatter={(v) => fmtUSD(v, 0)} tickLine={false} width={55} />
                <ZAxis type="number" dataKey="priority" range={[40, 600]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    const o = payload?.[0]?.payload as OppWithStatus | undefined
                    if (!o) return null
                    return (
                      <div className="max-w-xs rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-lg">
                        <div className="font-semibold">{o.title}</div>
                        <div className="mt-1 text-muted">
                          {fmtUSD(o.monthlySavings)}/mo · conf {fmtPct(o.confidence, 0)} · feas {o.feasibility} · score {o.priority}
                        </div>
                      </div>
                    )
                  }}
                />
                {CATEGORIES.map((c) => (
                  <Scatter key={c} name={c} data={list.filter((o) => o.category === c)} fill={CAT_COLOR[c]} onClick={(p: unknown) => setSelected((p as { payload?: OppWithStatus }).payload?.id ?? (p as OppWithStatus).id)} className="cursor-pointer">
                    {list
                      .filter((o) => o.category === c)
                      .map((o) => (
                        <Cell key={o.id} fillOpacity={o.confidence < LOW_CONFIDENCE ? 0.25 : 0.75} stroke={o.id === selected ? CHART.ink : CAT_COLOR[c]} strokeWidth={o.id === selected ? 2 : 1} />
                      ))}
                  </Scatter>
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
            {CATEGORIES.map((c) => (
              <span key={c} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLOR[c] }} />
                {CAT_LETTER[c]}. {c}
              </span>
            ))}
            <span>· faded = low confidence</span>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardTitle title="Savings by opportunity type" subtitle="Open opportunities in scope" right={<MeasuredTag />} />
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart data={byCat} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="letter" width={20} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => `${fmtUSD(Number(v))}/mo`} labelFormatter={(l) => byCat.find((b) => b.letter === l)?.name} />
                <Bar dataKey="savings" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, formatter: (v: unknown) => fmtUSD(Number(v)) }}>
                  {byCat.map((b) => (
                    <Cell key={b.name} fill={CAT_COLOR[b.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-1.5">
            {byCat.map((b) => (
              <button key={b.name} onClick={() => setCat(cat === b.name ? 'all' : b.name)} className={cx('flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-50', cat === b.name && 'bg-neutral-100')}>
                <span>
                  <span className="font-semibold">{b.letter}.</span> {b.name}
                </span>
                <span className="text-muted">{b.count} items</span>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Pipeline scoped={scoped} onPick={(s) => setStatusF(statusF === s ? 'all' : s)} active={statusF} />
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <div>
            <h3 className="text-[15px] font-semibold">Optimization opportunities</h3>
            <p className="text-xs text-muted">
              {list.length} shown{cat !== 'all' ? ` · ${cat}` : ''}
              {statusF !== 'all' ? ` · ${statusF}` : ''} · click a row for full detail, calculations and approval
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(cat !== 'all' || statusF !== 'all') && (
              <button
                className="text-xs text-muted hover:text-ink"
                onClick={() => {
                  setCat('all')
                  setStatusF('all')
                }}
              >
                Clear table filters
              </button>
            )}
            <span className="text-xs text-muted">Sort by</span>
            <Segmented<SortKey>
              value={sort}
              onChange={setSort}
              options={[
                { value: 'priority', label: 'Priority' },
                { value: 'savings', label: 'Savings' },
                { value: 'effort', label: 'Effort' },
                { value: 'confidence', label: 'Confidence' },
              ]}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr>
                <Th className="pl-5">Opportunity</Th>
                <Th>Observed</Th>
                <Th className="text-right">Monthly</Th>
                <Th className="text-right">Annual</Th>
                <Th>Effort</Th>
                <Th>Risk</Th>
                <Th>Confidence</Th>
                <Th className="text-right">Priority</Th>
                <Th className="pr-5">Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} onClick={() => setSelected(o.id)} className={cx('cursor-pointer hover:bg-neutral-50', selected === o.id && 'bg-neutral-50')}>
                  <Td className="pl-5">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: CAT_COLOR[o.category] }}>
                        {CAT_LETTER[o.category]}
                      </span>
                      <div>
                        <div className="font-medium">{o.title}</div>
                        <div className="text-[11px] text-muted">{o.proposed.length > 90 ? o.proposed.slice(0, 90) + '…' : o.proposed}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="max-w-[220px] text-xs text-muted">{o.observedUtil}</Td>
                  <Td className="tabular text-right font-semibold">{fmtUSD(o.monthlySavings)}</Td>
                  <Td className="tabular text-right text-muted">{fmtUSD(o.monthlySavings * 12)}</Td>
                  <Td>
                    <Badge tone={statusTone(o.effort)}>{o.effort}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(o.risk)}>{o.risk}</Badge>
                  </Td>
                  <Td>
                    <span className={cx('tabular text-sm', o.confidence < LOW_CONFIDENCE && 'font-semibold text-amber-700')}>{fmtPct(o.confidence, 0)}</span>
                    {o.confidence < LOW_CONFIDENCE && <ShieldAlert size={12} className="ml-1 inline text-amber-600" />}
                  </Td>
                  <Td className="tabular text-right font-semibold">{o.priority}</Td>
                  <Td className="pr-5">
                    <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <div className="p-8 text-center text-sm text-muted">No opportunities match the current filters.</div>}
        </div>
      </Card>

      <OpportunityDrawer opp={sel} onClose={() => setSelected(null)} go={go} />
    </div>
  )
}

function Pipeline({ scoped, onPick, active }: { scoped: OppWithStatus[]; onPick: (s: OppStatus) => void; active: 'all' | OppStatus }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Approval pipeline</div>
      <div className="flex items-stretch gap-1">
        {OPP_STATUSES.map((s, i) => {
          const items = scoped.filter((o) => o.status === s)
          return (
            <button key={s} onClick={() => onPick(s)} className={cx('flex-1 rounded-lg border px-1.5 py-2 text-center transition hover:border-neutral-400', active === s ? 'border-ink bg-ink text-white' : 'border-line')}>
              <div className="tabular text-base font-semibold">{items.length}</div>
              <div className={cx('text-[10px] leading-tight', active === s ? 'text-white/80' : 'text-muted')}>{s}</div>
              <div className={cx('tabular text-[10px]', active === s ? 'text-white/80' : 'text-muted')}>{fmtUSD(items.reduce((x, o) => x + o.monthlySavings, 0), 0)}</div>
              {i < OPP_STATUSES.length - 1 && null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const NEXT_ACTION: Partial<Record<OppStatus, { to: OppStatus; label: string; perm: 'changeOppStatus' | 'approveFinancial' }>> = {
  Proposed: { to: 'Under Review', label: 'Submit for review', perm: 'changeOppStatus' },
  'Under Review': { to: 'Approved', label: 'Approve', perm: 'approveFinancial' },
  Approved: { to: 'In Progress', label: 'Start execution', perm: 'changeOppStatus' },
  'In Progress': { to: 'Completed', label: 'Mark completed', perm: 'approveFinancial' },
}

export function OpportunityDrawer({ opp, onClose, go }: { opp: OppWithStatus | null; onClose: () => void; go: (p: PageId) => void }) {
  const { can, setOppStatus, oppInitiative, addOppToProgram, oppValidated, validateOpp, person } = useStore()
  if (!opp) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>
  const idx = OPP_STATUSES.indexOf(opp.status)
  const next = NEXT_ACTION[opp.status]
  const lowConf = opp.confidence < LOW_CONFIDENCE
  const blockedByConf = lowConf && next?.to === 'Approved' && !oppValidated[opp.id]
  const allowed = next ? can(next.perm) : false
  const initId = oppInitiative[opp.id]
  const canAdd = (opp.status === 'Approved' || opp.status === 'In Progress') && !initId && can('editProgram')
  const sensitive = can('viewSensitive')

  return (
    <Drawer open onClose={onClose} title={opp.title}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="dark">{opp.category}</Badge>
          <Badge>{regionById(opp.region).name}</Badge>
          {opp.workloads.map((w) => (
            <Badge key={w}>{workloadById(w).short}</Badge>
          ))}
          {lowConf && <LowConfidenceTag />}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Approval workflow · human decision required</div>
          <div className="flex items-center">
            {OPP_STATUSES.map((s, i) => (
              <div key={s} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <div className={cx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', i < idx ? 'bg-ink text-white' : i === idx ? 'bg-pin text-white ring-4 ring-pin/15' : 'bg-neutral-100 text-muted')}>{i < idx ? <Check size={14} /> : i + 1}</div>
                  <div className={cx('whitespace-nowrap text-[10px]', i === idx ? 'font-semibold text-ink' : 'text-muted')}>{s}</div>
                </div>
                {i < OPP_STATUSES.length - 1 && <div className={cx('mx-1 mb-4 h-0.5 flex-1', i < idx ? 'bg-ink' : 'bg-neutral-200')} />}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {next && (
              <Button variant="primary" disabled={!allowed || blockedByConf} onClick={() => setOppStatus(opp.id, next.to)} title={!allowed ? 'Your role cannot perform this step' : blockedByConf ? 'Validate source data first' : undefined}>
                {next.label} <ChevronRight size={14} />
              </Button>
            )}
            {idx > 0 && opp.status !== 'Completed' && can('changeOppStatus') && (
              <Button variant="ghost" onClick={() => setOppStatus(opp.id, OPP_STATUSES[idx - 1])}>
                Send back
              </Button>
            )}
            {canAdd && (
              <Button variant="dark" onClick={() => addOppToProgram(opp)}>
                <Plus size={14} /> Add to Program Execution
              </Button>
            )}
            {initId && (
              <Button variant="secondary" onClick={() => go('program')}>
                Tracked in Program Execution <ArrowRight size={14} />
              </Button>
            )}
            {!allowed && next && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Lock size={12} /> {next.perm === 'approveFinancial' ? 'Requires Finance or TPM approval' : 'Your role cannot change status'}
              </span>
            )}
          </div>
          {blockedByConf && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="font-semibold">Low-confidence recommendation ({fmtPct(opp.confidence, 0)})</div>
              Utilization is volatile or data coverage is thin. Governance policy requires a reviewer to confirm the source data before approval.
              <div className="mt-2">
                <Button size="sm" variant="secondary" disabled={!can('reviewAI')} onClick={() => validateOpp(opp.id)}>
                  I've validated the source data ({person})
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-neutral-50 p-3">
            <div className="text-[11px] text-muted">Monthly savings</div>
            <div className="tabular text-lg font-semibold">{fmtUSD(opp.monthlySavings)}</div>
          </div>
          <div className="rounded-xl bg-neutral-50 p-3">
            <div className="text-[11px] text-muted">Annualized</div>
            <div className="tabular text-lg font-semibold">{fmtUSD(opp.monthlySavings * 12)}</div>
          </div>
          <div className="rounded-xl bg-neutral-50 p-3">
            <div className="text-[11px] text-muted">Priority score</div>
            <div className="tabular text-lg font-semibold">{opp.priority}</div>
          </div>
        </div>

        <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted">Current configuration</dt>
          <dd>{sensitive ? opp.currentConfig : <span className="text-muted">Restricted for your role</span>}</dd>
          <dt className="text-muted">Observed utilization</dt>
          <dd>
            {opp.observedUtil} <MeasuredTag className="ml-1" />
          </dd>
          <dt className="text-muted">Proposed optimization</dt>
          <dd>{opp.proposed}</dd>
          <dt className="text-muted">Engineering effort</dt>
          <dd>
            <Badge tone={statusTone(opp.effort)}>{opp.effort}</Badge>
          </dd>
          <dt className="text-muted">Implementation risk</dt>
          <dd>
            <Badge tone={statusTone(opp.risk)}>{opp.risk}</Badge> <span className="ml-1 text-xs text-muted">customer impact {opp.customerImpact.toLowerCase()}</span>
          </dd>
          <dt className="text-muted">Performance / reliability</dt>
          <dd>{opp.considerations}</dd>
          <dt className="text-muted">Confidence</dt>
          <dd>
            <span className="tabular font-semibold">{fmtPct(opp.confidence, 0)}</span> <span className="text-xs text-muted">· based on 90-day utilization volatility</span>
          </dd>
          <dt className="text-muted">Data sources</dt>
          <dd className="flex flex-wrap gap-1">
            {opp.sources.map((s) => (
              <Badge key={s}>{s}</Badge>
            ))}
          </dd>
        </dl>

        <div className="rounded-xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Calculator size={14} /> Calculation trace
            </span>
            <AITag label="Rule-based detection" />
          </div>
          <table className="w-full text-xs">
            <tbody>
              {opp.calc.map((c) => (
                <tr key={c.label} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2 font-medium">{c.label}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted">{c.formula}</td>
                  <td className="tabular px-3 py-2 text-right font-semibold">{c.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>
  )
}
