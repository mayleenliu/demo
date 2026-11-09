import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, ChevronDown, Clock, GitBranch, Gavel, Lock, Send, Sparkles, Users } from 'lucide-react'
import { AS_OF, regionById } from '../data/model'
import { SAMPLE_MEETING_NOTES, type InitStatus, type Initiative, type MilestoneStatus } from '../data/program'
import { daysBetween, fmtDate, fmtDateShort, fmtUSD, toDate } from '../lib/format'
import { assessRisk, atRiskMilestones, crossTeamDependencies, overdueMilestones, programFinancials, programHealth, scheduleGap, upcomingDecisions } from '../lib/program'
import { generate, TPM_TASKS, type TpmDraft, type TpmTask } from '../lib/tpm'
import { useStore } from '../state/store'
import { AITag, Badge, Button, Card, CardTitle, Kpi, Progress, Segmented, Select, statusTone, cx, Empty } from '../components/ui'

const INIT_STATUSES: InitStatus[] = ['Not Started', 'On Track', 'At Risk', 'Off Track', 'Completed']
const MS_STATUSES: MilestoneStatus[] = ['Not Started', 'In Progress', 'At Risk', 'Done']

export default function ProgramExecution() {
  const { initiatives: allInits, filters } = useStore()
  const inits = useMemo(() => allInits.filter((i) => filters.region === 'all' || i.region === filters.region), [allInits, filters.region])
  const [view, setView] = useState<'tracker' | 'timeline'>('tracker')
  const fin = programFinancials(inits)
  const health = programHealth(inits)
  const overdue = overdueMilestones(inits)
  const atRisk = atRiskMilestones(inits)
  const deps = crossTeamDependencies(inits).filter((d) => d.status !== 'Resolved')
  const decisions = upcomingDecisions(inits)

  return (
    <div className="space-y-6">
      {filters.region !== 'all' && (
        <div className="rounded-xl bg-neutral-100 px-4 py-2 text-xs text-ink-2">
          Showing initiatives for <b>{regionById(filters.region).name}</b> ({inits.length} of {allInits.length}). Clear the region filter to see the full program.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Program health" value={<span className={health === 'Red' ? 'text-pin' : health === 'Yellow' ? 'text-amber-600' : 'text-emerald-700'}>{health}</span>} sub={<span>{inits.length} initiatives</span>} />
        <Kpi label="Committed savings" value={`${fmtUSD(fin.totalSavings)}/mo`} sub={<span>{fmtUSD(fin.annualSavings)}/yr</span>} tone="green" />
        <Kpi label="Delivered (est.)" value={`${fmtUSD(fin.delivered)}/mo`} sub={<span>progress-weighted</span>} />
        <Kpi label="Savings at risk" value={`${fmtUSD(fin.atRiskSavings)}/mo`} sub={<span>At Risk / Off Track</span>} tone={fin.atRiskSavings ? 'red' : 'neutral'} />
        <Kpi label="Capacity investment" value={`${fmtUSD(fin.investment)}/mo`} sub={<span>planned expansion</span>} />
        <Kpi label="Overdue / at-risk milestones" value={`${overdue.length} / ${atRisk.length}`} sub={<span>next 21 days</span>} tone={overdue.length ? 'red' : 'neutral'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardTitle title={<span className="flex items-center gap-1.5"><AlertTriangle size={14} className="text-pin" /> Overdue tasks</span>} />
          <ListOr empty="Nothing overdue.">
            {overdue.map((m) => (
              <Row key={m.initiativeId + m.id} title={m.name} sub={`${m.initiativeName} · ${m.owner}`} right={<Badge tone="red">{m.daysLate}d late</Badge>} />
            ))}
          </ListOr>
        </Card>
        <Card>
          <CardTitle title={<span className="flex items-center gap-1.5"><Clock size={14} className="text-amber-600" /> At-risk milestones</span>} />
          <ListOr empty="No at-risk milestones in the next 21 days.">
            {atRisk.map((m) => (
              <Row key={m.initiativeId + m.id} title={m.name} sub={`${m.initiativeName} · ${m.owner}`} right={<Badge tone={m.status === 'At Risk' ? 'red' : 'amber'}>{m.daysUntil === 0 ? 'today' : `in ${m.daysUntil}d`}</Badge>} />
            ))}
          </ListOr>
        </Card>
        <Card>
          <CardTitle title={<span className="flex items-center gap-1.5"><GitBranch size={14} /> Cross-team dependencies</span>} />
          <ListOr empty="No open dependencies.">
            {deps
              .sort((a, b) => (a.status === 'Blocked' ? -1 : b.status === 'Blocked' ? 1 : a.daysUntil - b.daysUntil))
              .slice(0, 6)
              .map((d) => (
                <Row key={d.initiativeId + d.id} title={d.team} sub={`${d.description} → ${d.initiativeName}`} right={<Badge tone={statusTone(d.status)}>{d.status}</Badge>} />
              ))}
          </ListOr>
        </Card>
        <Card>
          <CardTitle title={<span className="flex items-center gap-1.5"><Gavel size={14} /> Upcoming decisions</span>} />
          <ListOr empty="No pending decisions.">
            {decisions.map((d) => (
              <Row key={d.initiativeId + d.id} title={d.question} sub={`${d.owner} · ${d.initiativeName}`} right={<Badge tone={d.daysUntil < 0 ? 'red' : d.daysUntil <= 7 ? 'amber' : 'neutral'}>{d.daysUntil < 0 ? `${-d.daysUntil}d overdue` : fmtDateShort(d.due)}</Badge>} />
            ))}
          </ListOr>
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <div>
            <h3 className="text-[15px] font-semibold">Initiatives</h3>
            <p className="text-xs text-muted">Approved opportunities added from Cost Optimization appear here automatically.</p>
          </div>
          <Segmented value={view} onChange={setView} options={[{ value: 'tracker', label: 'Tracker' }, { value: 'timeline', label: 'Timeline' }]} />
        </div>
        {view === 'tracker' ? <Tracker inits={inits} /> : <Timeline inits={inits} />}
      </Card>

      <TpmAssistant inits={inits} />
    </div>
  )
}

function ListOr({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  return <div className="space-y-2.5">{children.length ? children : <div className="text-xs text-muted">{empty}</div>}</div>
}

function Row({ title, sub, right }: { title: string; sub: string; right: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm leading-snug">{title}</div>
        <div className="truncate text-[11px] text-muted">{sub}</div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  )
}

function Tracker({ inits }: { inits: Initiative[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const { can, setInitiativeStatus, setMilestoneStatus } = useStore()
  const editable = can('editProgram')
  return (
    <div className="divide-y divide-line border-t border-line">
      {inits.map((i) => {
        const r = assessRisk(i)
        const g = scheduleGap(i)
        const isOpen = open === i.id
        return (
          <div key={i.id}>
            <div className="grid cursor-pointer grid-cols-1 items-center gap-3 px-5 py-4 hover:bg-neutral-50 md:grid-cols-[1.6fr_1fr_0.9fr_1fr_0.7fr_24px]" onClick={() => setOpen(isOpen ? null : i.id)}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.name}</span>
                  {i.sourceOppId && <Badge tone="blue">from opportunity</Badge>}
                  {r.level === 'High' && i.status !== 'Completed' && <Badge tone="red">high risk</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {regionById(i.region).name} · {i.category}
                </div>
              </div>
              <div className="text-xs">
                <div className="flex items-center gap-1 text-muted">
                  <Users size={11} /> {i.programOwner}
                </div>
                <div className="truncate text-muted">{i.engOwner}</div>
                <div className="truncate text-muted">{i.financePartner}</div>
              </div>
              <div className="text-xs">
                <div className="tabular font-semibold">{i.monthlySavings ? `${fmtUSD(i.monthlySavings)}/mo saved` : `${fmtUSD(i.monthlyInvestment)}/mo invest`}</div>
                <div className="text-muted">Target {fmtDate(i.target)}</div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-muted">
                  <span>{i.progress}%</span>
                  <span>plan {g.expected}%</span>
                </div>
                <Progress value={i.progress} tone={i.status === 'Off Track' ? 'red' : i.status === 'At Risk' ? 'amber' : i.status === 'Completed' ? 'green' : 'ink'} />
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                {editable ? (
                  <Select<InitStatus> value={i.status} onChange={(s) => setInitiativeStatus(i.id, s)} options={INIT_STATUSES.map((s) => ({ value: s, label: s }))} />
                ) : (
                  <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                )}
              </div>
              <ChevronDown size={16} className={cx('text-muted transition', isOpen && 'rotate-180')} />
            </div>
            {isOpen && (
              <div className="grid gap-5 bg-neutral-50/60 px-5 pb-5 pt-1 lg:grid-cols-3">
                <div className="lg:col-span-3 text-sm text-ink-2">{i.description}</div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Milestones</div>
                  <div className="space-y-2">
                    {i.milestones.map((m) => {
                      const late = m.status !== 'Done' && toDate(m.due) < AS_OF
                      return (
                        <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2">
                          <div className="min-w-0">
                            <div className={cx('text-xs', m.status === 'Done' && 'text-muted line-through')}>{m.name}</div>
                            <div className={cx('text-[10px]', late ? 'font-semibold text-pin' : 'text-muted')}>
                              {m.owner} · due {fmtDateShort(m.due)}
                              {late && ' · overdue'}
                            </div>
                          </div>
                          {editable ? (
                            <select value={m.status} onChange={(e) => setMilestoneStatus(i.id, m.id, e.target.value as MilestoneStatus)} className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px]">
                              {MS_STATUSES.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Engineering dependencies</div>
                  <div className="space-y-2">
                    {i.dependencies.map((d) => (
                      <div key={d.id} className="rounded-lg bg-white px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{d.team}</span>
                          <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                        </div>
                        <div className="text-[11px] text-muted">
                          {d.description} · due {fmtDateShort(d.due)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Risks & blockers</div>
                  <ul className="space-y-1.5 text-xs">
                    {i.risks.map((x) => (
                      <li key={x} className="flex gap-1.5">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
                        {x}
                      </li>
                    ))}
                    {r.reasons.map((x) => (
                      <li key={x} className="flex gap-1.5 text-muted">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                        {x}
                      </li>
                    ))}
                  </ul>
                  {i.decisions.length > 0 && (
                    <>
                      <div className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Decisions</div>
                      {i.decisions.map((d) => (
                        <div key={d.id} className="text-xs">
                          {d.question} <span className="text-muted">— {d.owner}, {fmtDateShort(d.due)}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {!inits.length && <div className="p-8 text-center text-sm text-muted">No initiatives in this region.</div>}
    </div>
  )
}

function Timeline({ inits }: { inits: Initiative[] }) {
  const start = new Date(2026, 7, 1)
  const end = new Date(2027, 4, 31)
  const total = daysBetween(start, end)
  const pos = (d: Date) => `${Math.max(0, Math.min(100, (daysBetween(start, d) / total) * 100))}%`
  const months: Date[] = []
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d)
  return (
    <div className="overflow-x-auto border-t border-line px-5 py-4">
      <div className="min-w-[900px]">
        <div className="relative ml-[220px] h-6 border-b border-line">
          {months.map((m) => (
            <div key={m.toISOString()} className="absolute top-0 text-[10px] text-muted" style={{ left: pos(m) }}>
              {m.toLocaleDateString('en-US', { month: 'short' })} {String(m.getFullYear()).slice(2)}
            </div>
          ))}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute bottom-0 top-0 z-10 ml-[220px] w-[calc(100%-220px)]">
            <div className="absolute bottom-0 top-0 w-px bg-pin" style={{ left: pos(AS_OF) }}>
              <span className="absolute -top-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-pin px-1 text-[9px] font-semibold text-white">Today</span>
            </div>
          </div>
          {inits.map((i) => {
            const s = toDate(i.start)
            const e = toDate(i.target)
            const color = i.status === 'Off Track' ? '#e60023' : i.status === 'At Risk' ? '#f59e0b' : i.status === 'Completed' ? '#059669' : '#111'
            return (
              <div key={i.id} className="flex h-14 items-center border-b border-line/60">
                <div className="w-[220px] shrink-0 pr-3">
                  <div className="truncate text-xs font-medium">{i.name}</div>
                  <Badge tone={statusTone(i.status)} className="mt-0.5">
                    {i.status}
                  </Badge>
                </div>
                <div className="relative h-full flex-1">
                  <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-20" style={{ left: pos(s), width: `calc(${pos(e)} - ${pos(s)})`, background: color }} />
                  <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ left: pos(s), width: `calc((${pos(e)} - ${pos(s)}) * ${i.progress / 100})`, background: color }} />
                  {i.milestones.map((m) => {
                    const late = m.status !== 'Done' && toDate(m.due) < AS_OF
                    return (
                      <div
                        key={m.id}
                        title={`${m.name} — ${m.status} · due ${fmtDate(m.due)}${late ? ' (overdue)' : ''}`}
                        className={cx('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-white', m.status === 'Done' ? 'bg-emerald-600' : late || m.status === 'At Risk' ? 'bg-pin' : m.status === 'In Progress' ? 'bg-amber-500' : 'bg-neutral-400')}
                        style={{ left: pos(toDate(m.due)) }}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="ml-[220px] mt-3 flex flex-wrap gap-4 text-[11px] text-muted">
          {[
            ['bg-emerald-600', 'Done'],
            ['bg-amber-500', 'In progress'],
            ['bg-neutral-400', 'Not started'],
            ['bg-pin', 'At risk / overdue'],
          ].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className={cx('h-2.5 w-2.5 rotate-45', c)} />
              {l}
            </span>
          ))}
          <span>· bar fill = progress</span>
        </div>
      </div>
    </div>
  )
}

function TpmAssistant({ inits }: { inits: Initiative[] }) {
  const { logAudit, updateAudit, can, person } = useStore()
  const [task, setTask] = useState<TpmTask>('weekly')
  const [initId, setInitId] = useState<string>('')
  const [notes, setNotes] = useState(SAMPLE_MEETING_NOTES)
  const [draft, setDraft] = useState<(TpmDraft & { original: string; auditId: string; state: 'Draft' | 'Approved' | 'Communicated' }) | null>(null)

  const run = () => {
    const d = generate(task, inits, { initiativeId: initId || undefined, notes })
    const auditId = logAudit({ kind: 'AI report', title: d.title, generatedBy: 'Simulated TPM assistant', dataSources: d.sources, confidence: d.confidence, reviewer: null, status: 'Pending review', changes: [], content: d.text })
    setDraft({ ...d, original: d.text, auditId, state: 'Draft' })
  }

  const approve = () => {
    if (!draft) return
    const edited = draft.text !== draft.original
    updateAudit(draft.auditId, { status: edited ? 'Approved with edits' : 'Approved', reviewer: person, content: draft.text, changes: edited ? ['Human edited AI draft before approval'] : [] })
    setDraft({ ...draft, state: 'Approved' })
  }
  const markSent = () => {
    if (!draft) return
    updateAudit(draft.auditId, { status: 'Communicated', reviewer: person })
    setDraft({ ...draft, state: 'Communicated' })
  }
  const edited = draft && draft.text !== draft.original

  return (
    <Card className="border-ai/20">
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-ai" /> AI TPM assistant
          </span>
        }
        subtitle="Drafts are generated from the program tracker. You can edit them, and a person has to approve before anything is marked as communicated."
        right={<AITag label="Simulated · deterministic" />}
      />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2">
          {TPM_TASKS.map((t) => (
            <button key={t.id} onClick={() => setTask(t.id)} className={cx('w-full rounded-xl border px-3 py-2.5 text-left transition', task === t.id ? 'border-ai bg-ai-soft' : 'border-line hover:bg-neutral-50')}>
              <div className="text-sm font-medium">{t.label}</div>
              <div className="text-[11px] text-muted">{t.description}</div>
            </button>
          ))}
          {task === 'followUp' && (
            <Select value={initId} onChange={setInitId} className="w-full" options={[{ value: '', label: 'Auto: highest-risk initiative' }, ...inits.map((i) => ({ value: i.id, label: i.name }))]} />
          )}
          {task === 'notes' && <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-48 w-full rounded-xl border border-line p-2.5 text-xs outline-none focus:border-ai" />}
          <Button variant="ai" className="w-full" onClick={run} disabled={!inits.length && task !== 'notes'}>
            <Sparkles size={14} /> Generate draft
          </Button>
        </div>
        <div className="min-w-0">
          {!draft ? (
            <Empty>Choose a task and generate a draft. Generated content is editable and logged to the AI audit trail.</Empty>
          ) : (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{draft.title}</span>
                <Badge tone={draft.state === 'Draft' ? 'amber' : 'green'}>{draft.state === 'Draft' ? 'Draft · pending human review' : draft.state}</Badge>
                <Badge>Confidence {Math.round(draft.confidence * 100)}%</Badge>
                {edited && <Badge tone="blue">Edited by human</Badge>}
              </div>
              <textarea
                value={draft.text}
                readOnly={draft.state !== 'Draft'}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                className={cx('h-[380px] w-full rounded-xl border p-3 font-mono text-xs leading-relaxed outline-none', draft.state === 'Draft' ? 'border-line focus:border-ai' : 'border-transparent bg-neutral-50')}
              />
              <div className="mt-2 text-[11px] text-muted">
                Sources: {draft.sources.join(', ')} · {draft.notes.join(' ')}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {draft.state === 'Draft' &&
                  (can('reviewAI') ? (
                    <>
                      <Button variant="dark" size="sm" onClick={approve}>
                        <Check size={13} /> Approve {edited ? 'edited ' : ''}draft
                      </Button>
                      {edited && (
                        <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, text: draft.original })}>
                          Revert edits
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Lock size={12} /> Your role cannot approve AI drafts
                    </span>
                  ))}
                {draft.state === 'Approved' && (
                  <Button variant="primary" size="sm" onClick={markSent}>
                    <Send size={13} /> Mark as communicated
                  </Button>
                )}
                {draft.state === 'Communicated' && (
                  <span className="flex items-center gap-1 text-xs text-emerald-700">
                    <CalendarClock size={12} /> Recorded as communicated by {person}. The send itself happens outside this demo.
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(draft.text)}>
                  Copy
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

