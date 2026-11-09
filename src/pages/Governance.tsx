import { useMemo, useState } from 'react'
import { Check, Eye, Lock, ShieldCheck, ShieldAlert, X, FileSearch, UserCheck, Ban, Database } from 'lucide-react'
import { LOW_CONFIDENCE } from '../lib/calc'
import { fmtDateTime, fmtPct } from '../lib/format'
import { ROLES, useStore, type AuditEntry } from '../state/store'
import { Badge, Button, Card, CardTitle, Drawer, Kpi, Segmented, Td, Th, statusTone, cx } from '../components/ui'

const PRINCIPLES = [
  { icon: Ban, title: 'Recommend, never execute', text: 'The assistant has no write path to infrastructure. Its output is advisory text and status proposals that a person acts on.' },
  { icon: Database, title: 'Traceable to source data', text: 'Every recommendation lists its data sources, source metrics and a step-by-step calculation trace.' },
  { icon: UserCheck, title: 'Human review required', text: 'Approving spend, marking work complete, and communicating reports all need an authorized human reviewer.' },
  { icon: ShieldAlert, title: 'Low confidence is flagged', text: `Outputs below ${LOW_CONFIDENCE * 100}% confidence are auto-flagged and can't be approved until a reviewer validates the data.` },
  { icon: Lock, title: 'Access controls', text: 'Sensitive infrastructure details (AZ, hardware, configs) are redacted for roles without access; approvals are role-gated.' },
]

const PERM_MATRIX: { label: string; roles: Record<string, boolean> }[] = [
  { label: 'View aggregated metrics & charts', roles: { TPM: true, Finance: true, Engineering: true, Viewer: true } },
  { label: 'View AZ / hardware / configuration detail', roles: { TPM: true, Finance: true, Engineering: true, Viewer: false } },
  { label: 'Review & approve AI output', roles: { TPM: true, Finance: true, Engineering: true, Viewer: false } },
  { label: 'Move opportunities through review / execution', roles: { TPM: true, Finance: true, Engineering: true, Viewer: false } },
  { label: 'Approve financial decisions (Approve / Complete)', roles: { TPM: true, Finance: true, Engineering: false, Viewer: false } },
  { label: 'Edit program tracker', roles: { TPM: true, Finance: false, Engineering: false, Viewer: false } },
  { label: 'Execute infrastructure changes', roles: { TPM: false, Finance: false, Engineering: false, Viewer: false } },
]

export default function Governance() {
  const { audit, can, updateAudit, person, role } = useStore()
  const [filter, setFilter] = useState<'all' | 'ai' | 'pending' | 'low'>('all')
  const [selected, setSelected] = useState<AuditEntry | null>(null)

  const aiEntries = audit.filter((a) => a.kind === 'AI recommendation' || a.kind === 'AI report')
  const list = useMemo(
    () =>
      audit.filter((a) => {
        if (filter === 'ai') return a.kind === 'AI recommendation' || a.kind === 'AI report'
        if (filter === 'pending') return a.status === 'Pending review'
        if (filter === 'low') return a.confidence !== null && a.confidence < LOW_CONFIDENCE
        return true
      }),
    [audit, filter],
  )
  const reviewed = aiEntries.filter((a) => a.status !== 'Pending review')
  const edited = aiEntries.filter((a) => a.status === 'Approved with edits' || a.changes.some((c) => /edit|added|softened/i.test(c)))
  const rejected = aiEntries.filter((a) => a.status === 'Rejected')

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="AI outputs logged" value={aiEntries.length} sub={<span>recommendations + reports</span>} />
        <Kpi label="Pending human review" value={aiEntries.length - reviewed.length} tone={aiEntries.length - reviewed.length ? 'red' : 'neutral'} sub={<span>cannot be acted on yet</span>} />
        <Kpi label="Human review rate" value={fmtPct(reviewed.length / Math.max(1, aiEntries.length), 0)} sub={<span>{reviewed.length} reviewed</span>} />
        <Kpi label="Edited before approval" value={edited.length} sub={<span>human changes recorded</span>} />
        <Kpi label="Rejected" value={rejected.length} sub={<span>incl. low-confidence</span>} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardTitle title="Responsible AI principles" subtitle="Enforced in product behavior, not just policy" right={<ShieldCheck className="text-emerald-700" size={18} />} />
          <div className="grid gap-3 sm:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <p.icon size={15} className="text-pin" /> {p.title}
                </div>
                <p className="mt-1 text-xs text-ink-2">{p.text}</p>
              </div>
            ))}
            <div className="rounded-xl bg-neutral-50 p-3 text-xs text-muted">
              Synthetic data only. No credentials, production endpoints or private infrastructure information are used. The "AI" is a deterministic rules engine operating on the in-app dataset.
            </div>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardTitle title="Access control matrix" subtitle={`You are viewing as ${ROLES.find((r) => r.id === role)!.label}. Switch roles in the sidebar.`} />
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="pb-2 text-left font-medium text-muted">Capability</th>
                {ROLES.map((r) => (
                  <th key={r.id} className={cx('pb-2 text-center font-medium', r.id === role ? 'text-pin' : 'text-muted')}>
                    {r.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERM_MATRIX.map((p) => (
                <tr key={p.label} className="border-t border-line/70">
                  <td className="py-1.5 pr-2">{p.label}</td>
                  {ROLES.map((r) => (
                    <td key={r.id} className={cx('py-1.5 text-center', r.id === role && 'bg-pin-soft/50')}>
                      {p.roles[r.id] ? <Check size={13} className="mx-auto text-emerald-600" /> : <X size={13} className="mx-auto text-neutral-300" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <div>
            <h3 className="text-[15px] font-semibold">AI audit trail</h3>
            <p className="text-xs text-muted">Every AI output, human review, status change and access event in this session</p>
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All (${audit.length})` },
              { value: 'ai', label: 'AI outputs' },
              { value: 'pending', label: 'Pending' },
              { value: 'low', label: 'Low confidence' },
            ]}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                <Th className="pl-5">Timestamp</Th>
                <Th>Event</Th>
                <Th>Data sources</Th>
                <Th>Confidence</Th>
                <Th>Human reviewer</Th>
                <Th>Approval status</Th>
                <Th className="pr-5">Changes made</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => setSelected(a)}>
                  <Td className="tabular whitespace-nowrap pl-5 text-xs text-muted">{fmtDateTime(a.timestamp)}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={a.kind.startsWith('AI') ? 'ai' : 'neutral'}>{a.kind}</Badge>
                    </div>
                    <div className="mt-1 max-w-sm text-sm">{a.title}</div>
                    <div className="text-[11px] text-muted">by {a.generatedBy}</div>
                  </Td>
                  <Td className="max-w-[220px] text-xs text-muted">{a.dataSources.join(', ') || '—'}</Td>
                  <Td>
                    {a.confidence === null ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <span className={cx('tabular text-sm', a.confidence < LOW_CONFIDENCE && 'font-semibold text-amber-700')}>
                        {fmtPct(a.confidence, 0)}
                        {a.confidence < LOW_CONFIDENCE && <ShieldAlert size={12} className="ml-1 inline" />}
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs">{a.reviewer ?? <span className="text-muted">Unassigned</span>}</Td>
                  <Td>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </Td>
                  <Td className="max-w-[240px] pr-5 text-xs text-muted">{a.changes.length ? a.changes.join('; ') : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <div className="p-8 text-center text-sm text-muted">No audit events match.</div>}
        </div>
      </Card>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Audit record">
        {selected && (
          <AuditDetail
            entry={audit.find((a) => a.id === selected.id) ?? selected}
            canReview={can('reviewAI')}
            onDecision={(status) => updateAudit(selected.id, { status, reviewer: person })}
          />
        )}
      </Drawer>
    </div>
  )
}

function AuditDetail({ entry, canReview, onDecision }: { entry: AuditEntry; canReview: boolean; onDecision: (s: AuditEntry['status']) => void }) {
  const viewOnly = !canReview
  const sensitiveRedacted = viewOnly && entry.content
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={entry.kind.startsWith('AI') ? 'ai' : 'neutral'}>{entry.kind}</Badge>
        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
        {entry.confidence !== null && entry.confidence < LOW_CONFIDENCE && <Badge tone="amber">Low confidence</Badge>}
      </div>
      <h3 className="text-lg font-semibold">{entry.title}</h3>
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Recorded</dt>
        <dd>{fmtDateTime(entry.timestamp)}</dd>
        <dt className="text-muted">Generated by</dt>
        <dd>{entry.generatedBy}</dd>
        <dt className="text-muted">Data sources</dt>
        <dd className="flex flex-wrap gap-1">{entry.dataSources.length ? entry.dataSources.map((d) => <Badge key={d}>{d}</Badge>) : '—'}</dd>
        <dt className="text-muted">Confidence</dt>
        <dd>{entry.confidence === null ? '—' : fmtPct(entry.confidence, 0)}</dd>
        <dt className="text-muted">Human reviewer</dt>
        <dd>{entry.reviewer ?? 'Unassigned'}</dd>
        <dt className="text-muted">Changes made</dt>
        <dd>{entry.changes.length ? entry.changes.join('; ') : 'None'}</dd>
      </dl>
      {entry.content && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <FileSearch size={12} /> Recorded content
          </div>
          {sensitiveRedacted ? (
            <div className="flex items-center gap-2 rounded-xl bg-neutral-50 p-4 text-sm text-muted">
              <Eye size={14} /> Content restricted for read-only viewers.
            </div>
          ) : (
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-neutral-50 p-3 font-mono text-[11px] text-ink-2">{entry.content}</pre>
          )}
        </div>
      )}
      {entry.status === 'Pending review' && (
        <div className="flex gap-2 border-t border-line pt-4">
          {canReview ? (
            <>
              <Button variant="dark" size="sm" onClick={() => onDecision('Approved')}>
                <Check size={13} /> Approve
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDecision('Rejected')}>
                <X size={13} /> Reject
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Lock size={12} /> Your role cannot review AI output
            </span>
          )}
        </div>
      )}
    </div>
  )
}
