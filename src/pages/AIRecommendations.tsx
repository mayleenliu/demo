import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Calculator, Check, ClipboardList, Database, Edit3, Lock, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import { answer, diffSummary, responseToText, SUGGESTED_PROMPTS, type AIResponse, type Section } from '../lib/ai'
import { LOW_CONFIDENCE, OPPORTUNITIES } from '../lib/calc'
import { fmtPct } from '../lib/format'
import { useStore, type AuditStatus } from '../state/store'
import { AITag, Badge, Button, Card, Collapsible, MeasuredTag, statusTone, cx } from '../components/ui'
import type { PageId } from '../App'

interface Turn {
  response: AIResponse
  auditId: string
  review: AuditStatus
  edited?: string
}

export default function AIRecommendations({ go }: { go: (p: PageId) => void }) {
  const store = useStore()
  const { filters, oppStatus, initiatives, logAudit, updateAudit, can, person, setOppStatus } = store
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [thinking, setThinking] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, thinking])

  const ask = (q: string) => {
    if (!q.trim() || thinking) return
    setInput('')
    setThinking(true)
    // Short delay so the "analyzing" step is visible; the answer itself is computed synchronously from app data.
    setTimeout(() => {
      const response = answer(q, { filters, oppStatus, initiatives })
      const auditId =
        response.workflow === 'unknown'
          ? ''
          : logAudit({
              kind: response.workflow === 'executive' ? 'AI report' : 'AI recommendation',
              title: response.title,
              generatedBy: 'Simulated AI engine',
              dataSources: response.dataSources,
              confidence: response.confidence,
              reviewer: null,
              status: 'Pending review',
              changes: response.confidence < LOW_CONFIDENCE ? ['Auto-flagged: low confidence — further investigation required'] : [],
              content: responseToText(response),
            })
      setTurns((t) => [...t, { response, auditId, review: 'Pending review' }])
      setThinking(false)
    }, 650)
  }

  const review = (i: number, status: AuditStatus, edited?: string) => {
    const t = turns[i]
    const changes = edited ? diffSummary(responseToText(t.response), edited) : []
    setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, review: status, edited: edited ?? x.edited } : x)))
    if (t.auditId) {
      updateAudit(t.auditId, {
        status,
        reviewer: person,
        ...(edited ? { content: edited, changes: [...(t.response.confidence < LOW_CONFIDENCE ? ['Auto-flagged: low confidence'] : []), ...changes] } : {}),
      })
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <Card className="border-ai/20 bg-gradient-to-br from-white to-ai-soft/60">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-ai text-white">
                  <Sparkles size={16} />
                </div>
                <h2 className="text-lg font-semibold tracking-tight">Infrastructure AI Assistant</h2>
                <AITag label="Simulated · deterministic" />
              </div>
              <p className="mt-2 text-sm text-ink-2">
                Answers are computed from the in-app synthetic dataset, scoped to the current filters (no LLM is called). Every answer shows the source metrics, calculations, assumptions and confidence it used. The assistant can recommend but <span className="font-semibold">cannot execute infrastructure changes</span>. A person has to review every output.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {SUGGESTED_PROMPTS.map((p, i) => (
              <button key={p.workflow} onClick={() => ask(p.prompt)} disabled={thinking} className="group rounded-xl border border-line bg-white p-3 text-left transition hover:border-ai/50 hover:shadow-sm disabled:opacity-50">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ai">
                  Workflow {i + 1} · {p.label}
                </div>
                <div className="mt-1 text-sm text-ink">"{p.prompt}"</div>
              </button>
            ))}
          </div>
        </Card>

        {turns.length === 0 && !thinking && (
          <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
            <Sparkles className="mx-auto text-ai" />
            <div className="mt-2 text-sm font-medium">Pick a workflow above or ask a question below</div>
            <div className="mt-1 text-xs text-muted">Try "Will EU West have sufficient capacity over the next six months?" or set the Region filter first to scope the analysis.</div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={t.response.id} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-xl rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-white">{t.response.question}</div>
            </div>
            <ResponseCard
              turn={t}
              canReview={can('reviewAI')}
              canAct={can('changeOppStatus')}
              onReview={(s, e) => review(i, s, e)}
              onSendToReview={(ids) => ids.forEach((id) => oppStatus[id] === 'Proposed' && setOppStatus(id, 'Under Review'))}
              oppStatus={oppStatus}
              go={go}
            />
          </div>
        ))}

        {thinking && (
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-muted">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ai [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ai [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ai" />
            </span>
            Analyzing inventory, utilization, billing and program data…
          </div>
        )}
        <div ref={endRef} />

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="sticky bottom-4 flex items-center gap-2 rounded-full border border-line bg-white p-1.5 pl-5 shadow-lg"
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about efficiency, regional capacity, executive updates or priorities…" className="flex-1 bg-transparent text-sm outline-none" />
          <Button type="submit" variant="ai" disabled={!input.trim() || thinking}>
            <Send size={14} /> Ask
          </Button>
        </form>
      </div>

      <aside className="space-y-4 self-start xl:sticky xl:top-28">
        <Card>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={16} className="text-emerald-700" /> Guardrails in effect
          </div>
          <ul className="mt-3 space-y-2.5 text-xs text-ink-2">
            {[
              'Recommend-only: no action can change infrastructure.',
              'Every claim links to source metrics and a calculation trace.',
              'Measured data and AI-generated content are labeled separately.',
              `Confidence < ${LOW_CONFIDENCE * 100}% is flagged for investigation and blocks approval until validated.`,
              'Outputs are logged to the AI audit trail as "Pending review".',
              'Approvals and edits are attributed to the reviewing user.',
            ].map((g) => (
              <li key={g} className="flex gap-2">
                <Check size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                {g}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="text-sm font-semibold">Analysis scope</div>
          <p className="mt-1 text-xs text-muted">Global filters bound what data the assistant can see.</p>
          <dl className="mt-3 grid grid-cols-[80px_1fr] gap-y-1.5 text-xs">
            <dt className="text-muted">Region</dt>
            <dd className="font-medium">{filters.region === 'all' ? 'All regions' : filters.region}</dd>
            <dt className="text-muted">Type</dt>
            <dd className="font-medium">{filters.type === 'all' ? 'All types' : filters.type}</dd>
            <dt className="text-muted">Workload</dt>
            <dd className="font-medium">{filters.workload === 'all' ? 'All workloads' : filters.workload}</dd>
          </dl>
        </Card>
        <Card>
          <div className="text-sm font-semibold">Session review queue</div>
          <div className="mt-3 space-y-2">
            {turns.filter((t) => t.auditId).length === 0 && <div className="text-xs text-muted">No AI outputs yet.</div>}
            {turns
              .filter((t) => t.auditId)
              .map((t) => (
                <div key={t.response.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{t.response.title}</span>
                  <Badge tone={statusTone(t.review)}>{t.review}</Badge>
                </div>
              ))}
          </div>
          <button onClick={() => go('governance')} className="mt-3 flex items-center gap-1 text-xs font-medium text-ai hover:underline">
            Open full audit trail <ArrowRight size={12} />
          </button>
        </Card>
      </aside>
    </div>
  )
}

function ResponseCard({
  turn,
  canReview,
  canAct,
  onReview,
  onSendToReview,
  oppStatus,
  go,
}: {
  turn: Turn
  canReview: boolean
  canAct: boolean
  onReview: (s: AuditStatus, edited?: string) => void
  onSendToReview: (ids: string[]) => void
  oppStatus: Record<string, string>
  go: (p: PageId) => void
}) {
  const r = turn.response
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const low = r.confidence < LOW_CONFIDENCE
  const isUnknown = r.workflow === 'unknown'
  const proposed = (r.actionableOppIds ?? []).filter((id) => oppStatus[id] === 'Proposed')

  return (
    <Card className="border-ai/25">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AITag />
            {!isUnknown && (
              <Badge tone={low ? 'amber' : 'neutral'}>
                Confidence {fmtPct(r.confidence, 0)}
                {low && ' · low'}
              </Badge>
            )}
            <Badge>Scope: {r.scope}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold tracking-tight">{r.title}</h3>
        </div>
        {!isUnknown && <Badge tone={statusTone(turn.review)}>{turn.review}</Badge>}
      </div>

      {low && !isUnknown && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Low-confidence output. Investigate the underlying data before acting on it.
        </div>
      )}

      {turn.edited ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Human-edited version</div>
          <pre className="whitespace-pre-wrap rounded-xl bg-neutral-50 p-3 font-sans text-sm text-ink-2">{turn.edited}</pre>
        </div>
      ) : editing ? (
        <div className="mt-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="h-80 w-full rounded-xl border border-line p-3 font-mono text-xs outline-none focus:border-ai" />
          <div className="mt-2 flex gap-2">
            <Button
              variant="ai"
              size="sm"
              onClick={() => {
                onReview('Approved with edits', draft)
                setEditing(false)
              }}
            >
              <Check size={13} /> Save edits & approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-ink">{r.summary}</p>
          <div className="mt-4 space-y-4">
            {r.sections.map((s) => (
              <SectionView key={s.heading} s={s} />
            ))}
          </div>
        </>
      )}

      {!isUnknown && (
        <div className="mt-5 space-y-2">
          <Collapsible
            title={
              <>
                <Database size={14} /> Source metrics ({r.sourceMetrics.length})
              </>
            }
            right={<MeasuredTag />}
            defaultOpen
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {r.sourceMetrics.map((m) => (
                <div key={m.label} className="rounded-lg bg-neutral-50 px-3 py-2">
                  <div className="text-[11px] text-muted">{m.label}</div>
                  <div className="tabular text-sm font-semibold">{m.value}</div>
                  <div className="text-[10px] text-muted">{m.source}</div>
                </div>
              ))}
            </div>
          </Collapsible>
          <Collapsible
            title={
              <>
                <Calculator size={14} /> Inspect calculations ({r.calculations.length})
              </>
            }
          >
            <table className="w-full text-xs">
              <tbody>
                {r.calculations.map((c, i) => (
                  <tr key={i} className="border-b border-line/70 last:border-0">
                    <td className="py-1.5 pr-3 align-top font-medium">{c.label}</td>
                    <td className="py-1.5 pr-3 align-top font-mono text-[11px] text-muted">{c.formula}</td>
                    <td className="tabular py-1.5 text-right align-top font-semibold">{c.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Collapsible>
          <Collapsible
            title={
              <>
                <ClipboardList size={14} /> Assumptions & confidence
              </>
            }
          >
            <ul className="list-disc space-y-1 pl-4 text-xs text-ink-2">
              {r.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-muted">
              <span className="font-medium text-ink">Confidence {fmtPct(r.confidence, 0)}:</span> {r.confidenceNote}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {r.dataSources.map((d) => (
                <Badge key={d}>{d}</Badge>
              ))}
            </div>
          </Collapsible>
        </div>
      )}

      {!isUnknown && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {turn.review === 'Pending review' ? (
            canReview ? (
              <>
                <Button size="sm" variant="dark" onClick={() => onReview('Approved')}>
                  <Check size={13} /> Approve recommendation
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDraft(responseToText(r))
                    setEditing(true)
                  }}
                >
                  <Edit3 size={13} /> Edit before approving
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onReview('Rejected')}>
                  <X size={13} /> Reject
                </Button>
              </>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Lock size={12} /> Your role cannot review AI output
              </span>
            )
          ) : (
            <span className="text-xs text-muted">Reviewed — logged to audit trail.</span>
          )}
          {proposed.length > 0 && (turn.review === 'Approved' || turn.review === 'Approved with edits') && canAct && (
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => onSendToReview(proposed)}>
              Submit {proposed.length} opportunit{proposed.length > 1 ? 'ies' : 'y'} to approval workflow <ArrowRight size={13} />
            </Button>
          )}
          {(r.actionableOppIds?.length ?? 0) > 0 && proposed.length === 0 && (turn.review === 'Approved' || turn.review === 'Approved with edits') && (
            <button className="ml-auto text-xs font-medium text-ai hover:underline" onClick={() => go('cost')}>
              Track in Cost Optimization →
            </button>
          )}
        </div>
      )}
      {!isUnknown && r.actionableOppIds && (
        <p className="mt-2 text-[11px] text-muted">
          Referenced opportunities: {r.actionableOppIds.map((id) => `${OPPORTUNITIES.find((o) => o.id === id)?.title} (${oppStatus[id]})`).join(' · ')}
        </p>
      )}
    </Card>
  )
}

function SectionView({ s }: { s: Section }) {
  return (
    <div>
      <h4 className="mb-1.5 text-sm font-semibold">{s.heading}</h4>
      {s.callout && <div className={cx('mb-2 rounded-xl px-3 py-2 text-sm', s.callout.tone === 'risk' ? 'bg-pin-soft text-pin-dark' : s.callout.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')}>{s.callout.text}</div>}
      {s.text && <p className="text-sm text-ink-2">{s.text}</p>}
      {s.bullets && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2 marker:text-neutral-300">
          {s.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {s.table && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50">
              <tr>
                {s.table.columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((row, i) => (
                <tr key={i} className="border-t border-line/70">
                  {row.map((cell, j) => (
                    <td key={j} className={cx('px-3 py-2 align-top', j === 0 && 'font-medium')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
