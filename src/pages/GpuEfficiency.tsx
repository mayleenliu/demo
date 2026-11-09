import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Check, ChevronDown, Cpu, Info, X } from 'lucide-react'
import { regionById } from '../data/model'
import { GPU_RATE } from '../data/gpu'
import { BACKFILL_CAPTURE, BOTTLENECK_FIX, gpuFleet, hourlyProfile, NO_LEVERS, type Bottleneck, type GpuLevers, type JobAnalysis } from '../lib/gpu'
import { fmtNum, fmtPct, fmtUSD } from '../lib/format'
import { useOpportunities, useStore } from '../state/store'
import { Badge, Button, Card, CardTitle, CHART, ChartTooltip, Kpi, MeasuredTag, Td, Th, statusTone, cx } from '../components/ui'
import type { PageId } from '../App'

const SEGMENTS = [
  { key: 'useful', label: 'Useful compute', color: CHART.ink },
  { key: 'dataStall', label: 'Waiting on data', color: CHART.red },
  { key: 'underfilled', label: 'Underfilled (small batch / low occupancy)', color: '#ff8a9a' },
  { key: 'comm', label: 'Communication / checkpoint', color: CHART.amber },
  { key: 'idleReserved', label: 'Reserved but idle (notebooks)', color: '#c4b5fd' },
  { key: 'unallocated', label: 'Unallocated (no job scheduled)', color: CHART.light },
] as const

const BOTTLENECK_TONE: Record<Bottleneck, 'red' | 'amber' | 'blue' | 'ai' | 'neutral' | 'green'> = {
  'Input pipeline stall': 'red',
  'Idle reservation': 'ai',
  'Unbatched requests': 'amber',
  'Underfilled GPU': 'amber',
  'Poor multi-GPU scaling': 'blue',
  'Scheduler queueing': 'neutral',
  Healthy: 'green',
}

type CheckKey = keyof JobAnalysis['checks']
const QUESTIONS: { key: CheckKey; q: string; rule: string }[] = [
  { key: 'waitingOnData', q: 'Are jobs waiting on data?', rule: 'data-wait ≥ 20% of runtime' },
  { key: 'memoryUnderused', q: 'Is GPU memory underutilized?', rule: 'GPU memory < 45%' },
  { key: 'canBatch', q: 'Can jobs or requests be batched / packed?', rule: 'unbatched inference, or low memory use on batch jobs' },
  { key: 'schedulingIssue', q: 'Could scheduling be more efficient?', rule: 'queue wait ≥ 6 h or always-on reservation' },
  { key: 'overprovisioned', q: 'Are GPUs over-provisioned?', rule: 'multi-GPU scaling efficiency < 70%, or idle reservation' },
]

export default function GpuEfficiency({ go }: { go: (p: PageId) => void }) {
  const { filters, initiatives } = useStore()
  const [levers, setLevers] = useState<GpuLevers>(NO_LEVERS)
  const [check, setCheck] = useState<CheckKey | null>(null)
  const fleet = useMemo(() => gpuFleet(filters.region, levers), [filters.region, levers])
  const profile = useMemo(() => hourlyProfile(fleet), [fleet])
  const aiInvestment = initiatives.find((i) => i.id === 'init-ai-readiness')?.monthlyInvestment ?? 0
  const offTopic = filters.workload !== 'all' && filters.workload !== 'ml-training'

  const breakdown = [fleet.training, fleet.inference].map((k) => ({
    name: `${k.kind} (${k.gpus} GPUs)`,
    ...Object.fromEntries(SEGMENTS.map((s) => [s.key, k.segs[s.key] / Math.max(1, k.available)])),
  }))
  const jobs = [...fleet.jobs].filter((j) => !check || j.checks[check]).sort((a, b) => b.savings - a.savings || b.gpuHours - a.gpuHours)
  const idleCost = fleet.idleHours * (fleet.spend / fleet.available)

  return (
    <div className="space-y-6">
      {offTopic && <div className="rounded-xl bg-neutral-100 px-4 py-2 text-xs text-ink-2">The workload filter is set to a non-GPU workload. This page always shows the AI / ML GPU fleet{filters.region !== 'all' ? ` for ${regionById(filters.region).name}` : ''}.</div>}

      <Card className="border-ai/20 bg-gradient-to-br from-white to-ai-soft/50">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-white">
            <Cpu size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold tracking-tight">
              Allocated isn't the same as utilized. {fmtPct(fleet.allocRate, 0)} of GPU-hours are assigned to jobs, but only {fmtPct(fleet.effectiveUtil, 0)} do useful compute.
            </div>
            <p className="mt-1 text-sm text-ink-2">
              The capacity view counts a GPU as used once a job holds it. GPU telemetry shows most of that time is spent waiting on input data, running small batches, or sitting idle in reserved notebooks. That means about{' '}
              <b>{fmtUSD(idleCost)}/mo</b> of the {fmtUSD(fleet.spend)}/mo GPU bill pays for idle GPU time. Fix utilization before approving more GPU purchases.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="GPU fleet" value={fmtNum(fleet.gpus)} sub={<span>{fleet.training.gpus} training · {fleet.inference.gpus} inference</span>} icon={<Cpu size={14} />} />
        <Kpi label="Allocation rate" value={fmtPct(fleet.allocRate, 0)} sub={<span>GPU-hours held by jobs</span>} />
        <Kpi label="Effective GPU utilization" value={fmtPct(fleet.effectiveUtil, 0)} sub={<span>SM {fmtPct(fleet.smUtil, 0)} while allocated</span>} tone="red" />
        <Kpi label="GPU memory utilization" value={fmtPct(fleet.memUtil, 0)} sub={<span>hour-weighted average</span>} />
        <Kpi label="Idle GPU-hours / month" value={fmtNum(fleet.idleHours)} sub={<span>≈ {fmtNum(fleet.idleHours / 720)} GPUs doing nothing</span>} />
        <Kpi label="Cost per useful GPU-hour" value={`$${fleet.costPerUsefulHour.toFixed(2)}`} sub={<span>vs ${GPU_RATE.Training.perHour.toFixed(2)} H100 / ${GPU_RATE.Inference.perHour.toFixed(2)} L4 list rate</span>} tone="red" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardTitle title="Where GPU time goes" subtitle="Share of available GPU-hours per month, from scheduler logs + per-GPU telemetry" right={<MeasuredTag />} />
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }} barSize={30}>
                <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v)} />} cursor={{ fill: 'transparent' }} />
                {SEGMENTS.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={i === SEGMENTS.length - 1 ? [0, 6, 6, 0] : i === 0 ? [6, 0, 0, 6] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            {SEGMENTS.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardTitle title="24-hour utilization profile" subtitle="Inference follows user traffic; training dips overnight. Overnight gaps can absorb queued work" right={<MeasuredTag />} />
          <div className="h-52">
            <ResponsiveContainer>
              <AreaChart data={profile} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={5} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v, 0)} />} />
                <Legend iconType="circle" iconSize={8} />
                <Area type="monotone" dataKey="inferenceAllocated" name="Inference allocated" stroke={CHART.slate} fill={CHART.slate} fillOpacity={0.08} />
                <Area type="monotone" dataKey="trainingAllocated" name="Training allocated" stroke={CHART.ink} fill="none" />
                <Area type="monotone" dataKey="smUtil" name="SM utilization" stroke={CHART.red} fill={CHART.red} fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle title="Investigation: why is GPU utilization low?" subtitle="Each question is answered from job telemetry. Click one to filter the job table below" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {QUESTIONS.map((q) => {
            const hits = fleet.jobs.filter((j) => j.checks[q.key])
            const hrs = hits.reduce((s, j) => s + j.gpuHours, 0)
            const active = check === q.key
            return (
              <button key={q.key} onClick={() => setCheck(active ? null : q.key)} className={cx('rounded-xl border p-3 text-left transition hover:border-neutral-400', active ? 'border-ink bg-ink text-white' : 'border-line')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium leading-snug">{q.q}</div>
                  {hits.length ? <Check size={15} className={active ? 'text-white' : 'text-pin'} /> : <X size={15} className="text-neutral-300" />}
                </div>
                <div className={cx('tabular mt-2 text-lg font-semibold', !active && hits.length > 0 && 'text-pin-dark')}>{hits.length ? `Yes, ${hits.length} job${hits.length > 1 ? 's' : ''}` : 'No'}</div>
                <div className={cx('text-[11px]', active ? 'text-white/70' : 'text-muted')}>
                  {fmtNum(hrs)} GPU-hrs/mo · rule: {q.rule}
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      <JobTable jobs={jobs} filterLabel={check ? QUESTIONS.find((q) => q.key === check)!.q : null} onClear={() => setCheck(null)} go={go} />

      <Card>
        <CardTitle title="GPU optimization what-if" subtitle="Choose how much of each fix gets adopted. Results show the GPU capacity freed for the same amount of work" right={<Badge tone="dark">Interactive model</Badge>} />
        <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            {(
              [
                ['pipeline', 'Fix input-pipeline stalls', 'Cache decoded images, prefetch, parallel loaders'],
                ['batching', 'Batch & pack underfilled GPUs', 'Dynamic batching for inference; bigger batches / MIG for training'],
                ['rightsize', 'Right-size poorly scaling jobs', 'Fewer GPUs per run where added GPUs barely help'],
                ['idleRelease', 'Release idle notebook reservations', 'Auto-release after 30 min idle'],
                ['backfill', 'Scheduler backfill', `Run queued sweeps in unallocated hours (captures up to ${BACKFILL_CAPTURE * 100}%)`],
              ] as [keyof GpuLevers, string, string][]
            ).map(([k, label, hint]) => (
              <div key={k}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-ink">{label}</span>
                  <span className="tabular font-semibold">{Math.round(levers[k] * 100)}% adopted</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={levers[k] * 100} onChange={(e) => setLevers({ ...levers, [k]: Number(e.target.value) / 100 })} className="w-full accent-[#e60023]" />
                <div className="text-[11px] text-muted">{hint}</div>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setLevers({ pipeline: 0.8, batching: 0.7, rightsize: 1, idleRelease: 1, backfill: 0.5 })}>
                Realistic plan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLevers(NO_LEVERS)}>
                Reset
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Big label="Effective GPU utilization" value={`${fmtPct(fleet.effectiveUtil, 0)} → ${fmtPct(fleet.whatIf.effectiveUtilAfter, 0)}`} />
              <Big label="GPU-equivalents freed" value={fmtNum(fleet.whatIf.gpusFreed)} sub={`${fmtNum(fleet.whatIf.freedHours)} GPU-hrs/mo`} />
              <Big label="Monthly value" value={`${fmtUSD(fleet.whatIf.monthlySavings)}/mo`} sub={`${fmtUSD(fleet.whatIf.monthlySavings * 12)}/yr`} tone="green" />
              <Big
                label="Offsets AI capacity purchase"
                value={aiInvestment ? fmtPct(Math.min(1, fleet.whatIf.monthlySavings / aiInvestment), 0) : '—'}
                sub={`of ${fmtUSD(aiInvestment)}/mo planned in "AI workload capacity readiness"`}
                tone={fleet.whatIf.monthlySavings > 0 ? 'green' : undefined}
              />
            </div>
            <div className="rounded-xl bg-ink p-3 text-xs text-white">
              <span className="font-semibold">TPM takeaway: </span>
              {fleet.whatIf.monthlySavings > 0
                ? `Adopting these fixes frees about ${fmtNum(fleet.whatIf.gpusFreed)} GPUs' worth of capacity. Fund the input-pipeline and batching work before the H1 GPU reservation, then size the reservation to the improved utilization instead of today's.`
                : 'Move the sliders (or choose "Realistic plan") to see how much GPU purchasing can be deferred by improving utilization first.'}
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-neutral-50 p-3 text-[11px] text-muted">
              <Info size={12} className="mt-0.5 shrink-0" />
              Value = freed GPU-hours × blended rate. Backfill doesn't reduce today's bill; it absorbs queued demand that would otherwise need new GPUs, so it's counted as avoided spend. Per-job math is in the job table.
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' }) {
  return (
    <div className={cx('rounded-xl border p-3', tone === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-line')}>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

function JobTable({ jobs, filterLabel, onClear, go }: { jobs: JobAnalysis[]; filterLabel: string | null; onClear: () => void; go: (p: PageId) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const opps = useOpportunities()
  const { can, setOppStatus } = useStore()
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h3 className="text-[15px] font-semibold">Training jobs & inference services</h3>
          <p className="text-xs text-muted">
            {jobs.length} shown{filterLabel ? ` · ${filterLabel}` : ''} · click a row to see the diagnosis, fix and math
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filterLabel && (
            <button className="text-xs text-muted hover:text-ink" onClick={onClear}>
              Clear filter
            </button>
          )}
          <MeasuredTag />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px]">
          <thead>
            <tr>
              <Th className="pl-5">Job / service</Th>
              <Th>Type</Th>
              <Th className="text-right">GPUs</Th>
              <Th className="text-right">Runs / mo</Th>
              <Th className="text-right">GPU-hrs / mo</Th>
              <Th className="text-right">SM util</Th>
              <Th className="text-right">GPU mem</Th>
              <Th className="text-right">Data wait</Th>
              <Th className="text-right">Cost / run</Th>
              <Th className="text-right">$ / useful GPU-hr</Th>
              <Th>Bottleneck</Th>
              <Th className="pr-5 text-right">Savings / mo</Th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const isOpen = open === j.id
              const opp = opps.find((o) => o.id === `opp-gpu-${j.id}`)
              return (
                <FragmentRow key={j.id}>
                  <tr className={cx('cursor-pointer hover:bg-neutral-50', isOpen && 'bg-neutral-50')} onClick={() => setOpen(isOpen ? null : j.id)}>
                    <Td className="pl-5">
                      <div className="flex items-center gap-1.5 font-medium">
                        <ChevronDown size={13} className={cx('shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                        {j.name}
                      </div>
                      <div className="pl-5 text-[11px] text-muted">
                        {j.team} · {regionById(j.region).name}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={j.kind === 'Training' ? 'dark' : 'neutral'}>{j.kind}</Badge>
                    </Td>
                    <Td className="tabular text-right">{j.gpus}</Td>
                    <Td className="tabular text-right">{j.runsPerMonth || '—'}</Td>
                    <Td className="tabular text-right">{fmtNum(j.gpuHours)}</Td>
                    <Td className={cx('tabular text-right', j.smUtil < 0.35 && 'font-semibold text-pin')}>{fmtPct(j.smUtil, 0)}</Td>
                    <Td className={cx('tabular text-right', j.memUtil < 0.45 && 'text-amber-700')}>{fmtPct(j.memUtil, 0)}</Td>
                    <Td className={cx('tabular text-right', j.dataWait >= 0.2 && 'font-semibold text-pin')}>{fmtPct(j.dataWait, 0)}</Td>
                    <Td className="tabular text-right">{j.costPerRun ? fmtUSD(j.costPerRun) : '—'}</Td>
                    <Td className="tabular text-right">${j.costPerUsefulHour.toFixed(2)}</Td>
                    <Td>
                      <Badge tone={BOTTLENECK_TONE[j.bottleneck]}>{j.bottleneck}</Badge>
                    </Td>
                    <Td className="tabular pr-5 text-right font-semibold">{j.savings ? fmtUSD(j.savings) : '—'}</Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-neutral-50/70">
                      <td colSpan={12} className="px-5 pb-5 pt-2">
                        <div className="grid gap-5 lg:grid-cols-3">
                          <div>
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Investigation checklist</div>
                            <ul className="space-y-1.5 text-xs">
                              {QUESTIONS.map((q) => (
                                <li key={q.key} className="flex items-start gap-2">
                                  {j.checks[q.key] ? <Check size={13} className="mt-0.5 shrink-0 text-pin" /> : <X size={13} className="mt-0.5 shrink-0 text-neutral-300" />}
                                  <span className={j.checks[q.key] ? 'text-ink' : 'text-muted'}>{q.q}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-3 text-[11px] text-muted">
                              Comm/checkpoint {fmtPct(j.commOverhead, 0)} · scaling efficiency {fmtPct(j.scalingEff, 0)} · median queue wait {j.queueWaitHrs} h
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Recommended fix</div>
                            <div className="text-sm">{BOTTLENECK_FIX[j.bottleneck]}</div>
                            {j.savedHours > 0 && (
                              <div className="mt-2 text-xs text-ink-2">
                                SM {fmtPct(j.smUtil, 0)} → {fmtPct(j.smAfter, 0)} · frees {fmtNum(j.savedHours)} GPU-hrs/mo ({fmtNum(j.savedHours / 720)} GPUs)
                              </div>
                            )}
                            <div className="mt-2 text-xs text-muted">Tradeoff: {j.tradeoff}</div>
                            {opp && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Badge tone={statusTone(opp.status)}>{opp.status}</Badge>
                                {opp.status === 'Proposed' && can('changeOppStatus') && (
                                  <Button size="sm" variant="primary" onClick={() => setOppStatus(opp.id, 'Under Review')}>
                                    Submit for review
                                  </Button>
                                )}
                                <button className="flex items-center gap-1 text-xs font-medium text-ink-2 hover:underline" onClick={() => go('cost')}>
                                  Approval workflow <ArrowRight size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Calculation</div>
                            <table className="w-full text-[11px]">
                              <tbody>
                                {j.calc.map((c) => (
                                  <tr key={c.label} className="border-b border-line/70 last:border-0">
                                    <td className="py-1 pr-2 align-top font-medium">{c.label}</td>
                                    <td className="py-1 pr-2 align-top font-mono text-muted">{c.formula}</td>
                                    <td className="tabular py-1 text-right align-top font-semibold">{c.result}</td>
                                  </tr>
                                ))}
                                <tr>
                                  <td className="py-1 pr-2 font-medium">$ / useful GPU-hr</td>
                                  <td className="py-1 pr-2 font-mono text-muted">
                                    ${j.rate.toFixed(2)} ÷ {fmtPct(j.smUtil, 0)} SM
                                  </td>
                                  <td className="tabular py-1 text-right font-semibold">${j.costPerUsefulHour.toFixed(2)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
