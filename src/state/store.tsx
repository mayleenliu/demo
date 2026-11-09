import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AS_OF } from '../data/model'
import { INITIATIVES, type Initiative, type InitStatus, type MilestoneStatus } from '../data/program'
import { DEFAULT_FILTERS, OPPORTUNITIES, LOW_CONFIDENCE, type Filters, type OppStatus, type Opportunity } from '../lib/calc'
import { workloadById, regionById } from '../data/model'
import { addMonths } from '../lib/format'

export type Role = 'TPM' | 'Finance' | 'Engineering' | 'Viewer'

export const ROLES: { id: Role; label: string; person: string; description: string }[] = [
  { id: 'TPM', label: 'Infra TPM', person: 'You (Infra TPM)', description: 'Full access. Can review AI output, approve opportunities and manage programs.' },
  { id: 'Finance', label: 'Finance partner', person: 'Erin Walsh (FinOps)', description: 'Can approve financial decisions and review AI output. Cannot edit programs.' },
  { id: 'Engineering', label: 'Engineering lead', person: 'Diego Alvarez (Eng)', description: 'Can move opportunities through review / execution, but cannot approve spend.' },
  { id: 'Viewer', label: 'Read-only viewer', person: 'Guest viewer', description: 'Read-only. AZ, hardware and per-workload cost details are redacted.' },
]

export type Permission = 'approveFinancial' | 'changeOppStatus' | 'editProgram' | 'reviewAI' | 'viewSensitive'
const PERMS: Record<Role, Permission[]> = {
  TPM: ['approveFinancial', 'changeOppStatus', 'editProgram', 'reviewAI', 'viewSensitive'],
  Finance: ['approveFinancial', 'changeOppStatus', 'reviewAI', 'viewSensitive'],
  Engineering: ['changeOppStatus', 'reviewAI', 'viewSensitive'],
  Viewer: [],
}

export type AuditStatus = 'Pending review' | 'Approved' | 'Approved with edits' | 'Rejected' | 'Communicated' | 'Recorded'

export interface AuditEntry {
  id: string
  timestamp: string
  kind: 'AI recommendation' | 'AI report' | 'Status change' | 'Program update' | 'Access'
  title: string
  generatedBy: string
  dataSources: string[]
  confidence: number | null
  reviewer: string | null
  status: AuditStatus
  changes: string[]
  content?: string
}

interface PersistedState {
  filters: Filters
  role: Role
  oppStatus: Record<string, OppStatus>
  oppValidated: Record<string, boolean>
  oppInitiative: Record<string, string>
  initiatives: Initiative[]
  audit: AuditEntry[]
}

const STORAGE_KEY = 'infra-control-tower-v1'

function seedAudit(): AuditEntry[] {
  const ts = (daysAgo: number, h: number) => {
    const d = new Date(AS_OF)
    d.setDate(d.getDate() - daysAgo)
    d.setHours(h, 12)
    return d.toISOString()
  }
  return [
    {
      id: 'a-seed-1',
      timestamp: ts(12, 10),
      kind: 'AI recommendation',
      title: 'Efficiency analysis: top opportunities (all regions)',
      generatedBy: 'Simulated AI engine',
      dataSources: ['Inventory: compute fleet', 'Utilization telemetry (90-day p95)', 'Billing: monthly cost allocation'],
      confidence: 0.81,
      reviewer: 'You (Infra TPM)',
      status: 'Approved',
      changes: [],
    },
    {
      id: 'a-seed-2',
      timestamp: ts(9, 15),
      kind: 'AI report',
      title: 'Executive update — October capacity optimization program',
      generatedBy: 'Simulated AI engine',
      dataSources: ['Program tracker', 'Opportunity pipeline', 'Capacity forecast model'],
      confidence: 0.86,
      reviewer: 'You (Infra TPM)',
      status: 'Communicated',
      changes: ['Softened EU West risk wording', 'Added owner for network renewal'],
    },
    {
      id: 'a-seed-3',
      timestamp: ts(6, 11),
      kind: 'AI recommendation',
      title: 'Reallocate stranded reserved capacity in AP Southeast',
      generatedBy: 'Simulated AI engine',
      dataSources: ['Inventory: reservations', 'Capacity forecast model'],
      confidence: 0.42,
      reviewer: 'Erin Walsh (FinOps)',
      status: 'Rejected',
      changes: ['Flagged low confidence — requires 30 more days of utilization data before review'],
    },
    {
      id: 'a-seed-4',
      timestamp: ts(3, 9),
      kind: 'Status change',
      title: 'Storage tier optimization → In Progress',
      generatedBy: 'You (Infra TPM)',
      dataSources: ['Opportunity pipeline'],
      confidence: null,
      reviewer: 'You (Infra TPM)',
      status: 'Recorded',
      changes: [],
    },
  ]
}

function initialState(): PersistedState {
  const oppStatus: Record<string, OppStatus> = {}
  const oppInitiative: Record<string, string> = {}
  for (const o of OPPORTUNITIES) oppStatus[o.id] = 'Proposed'
  for (const i of INITIATIVES) {
    if (i.sourceOppId && oppStatus[i.sourceOppId]) {
      oppStatus[i.sourceOppId] = 'In Progress'
      oppInitiative[i.sourceOppId] = i.id
    }
  }
  // A few realistic in-flight review states.
  const seeds: [string, OppStatus][] = [
    ['opp-sto-us-east-data-platform', 'Approved'],
    ['opp-cmp-us-west-media', 'Under Review'],
    ['opp-cmp-us-west-data-platform', 'Under Review'],
    ['opp-str-eu-central', 'Under Review'],
  ]
  for (const [id, s] of seeds) if (oppStatus[id]) oppStatus[id] = s
  return { filters: DEFAULT_FILTERS, role: 'TPM', oppStatus, oppValidated: {}, oppInitiative, initiatives: INITIATIVES, audit: seedAudit() }
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...initialState(), ...JSON.parse(raw) }
  } catch {
    /* ignore corrupt state */
  }
  return initialState()
}

interface Store extends PersistedState {
  setFilters: (f: Partial<Filters>) => void
  setRole: (r: Role) => void
  can: (p: Permission) => boolean
  person: string
  setOppStatus: (id: string, s: OppStatus) => void
  validateOpp: (id: string) => void
  addOppToProgram: (opp: Opportunity) => string
  setInitiativeStatus: (id: string, s: InitStatus) => void
  setMilestoneStatus: (initId: string, mId: string, s: MilestoneStatus) => void
  logAudit: (e: Omit<AuditEntry, 'id' | 'timestamp'>) => string
  updateAudit: (id: string, patch: Partial<AuditEntry>) => void
  reset: () => void
}

const Ctx = createContext<Store | null>(null)

let counter = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const person = ROLES.find((r) => r.id === state.role)!.person
  const can = useCallback((p: Permission) => PERMS[state.role].includes(p), [state.role])

  const logAudit = useCallback((e: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    const id = newId('a')
    setState((s) => ({ ...s, audit: [{ ...e, id, timestamp: new Date().toISOString() }, ...s.audit] }))
    return id
  }, [])

  const store = useMemo<Store>(
    () => ({
      ...state,
      person,
      can,
      logAudit,
      setFilters: (f) => setState((s) => ({ ...s, filters: { ...s.filters, ...f } })),
      setRole: (role) => {
        setState((s) => ({ ...s, role }))
        logAudit({ kind: 'Access', title: `Role switched to ${ROLES.find((r) => r.id === role)!.label}`, generatedBy: ROLES.find((r) => r.id === role)!.person, dataSources: [], confidence: null, reviewer: null, status: 'Recorded', changes: [] })
      },
      setOppStatus: (id, next) => {
        const opp = OPPORTUNITIES.find((o) => o.id === id)!
        const prev = state.oppStatus[id]
        setState((s) => ({ ...s, oppStatus: { ...s.oppStatus, [id]: next } }))
        logAudit({
          kind: 'Status change',
          title: `${opp.title}: ${prev} → ${next}`,
          generatedBy: person,
          dataSources: opp.sources,
          confidence: opp.confidence,
          reviewer: person,
          status: 'Recorded',
          changes: opp.confidence < LOW_CONFIDENCE && next === 'Approved' ? ['Low-confidence recommendation approved after manual data validation'] : [],
        })
      },
      validateOpp: (id) => setState((s) => ({ ...s, oppValidated: { ...s.oppValidated, [id]: true } })),
      addOppToProgram: (opp) => {
        const existing = state.oppInitiative[opp.id]
        if (existing) return existing
        const id = newId('init')
        const reg = regionById(opp.region)
        const due = (m: number) => addMonths(m).toISOString().slice(0, 10)
        const init: Initiative = {
          id,
          name: opp.title,
          region: opp.region,
          category: opp.category,
          description: `${opp.proposed}. Created from approved optimization opportunity (${opp.id}).`,
          programOwner: 'You (Infra TPM)',
          engOwner: `TBD · ${opp.workloads.map((w) => workloadById(w).short).join(', ')} owners`,
          financePartner: 'Erin Walsh · FinOps',
          start: AS_OF.toISOString().slice(0, 10),
          target: due(opp.effort === 'High' ? 5 : opp.effort === 'Medium' ? 3 : 2),
          monthlySavings: opp.monthlySavings,
          monthlyInvestment: 0,
          status: 'Not Started',
          progress: 0,
          risks: [opp.considerations],
          milestones: [
            { id: 'm1', name: 'Kickoff & owner alignment', due: due(0.25), status: 'Not Started', owner: 'You (Infra TPM)' },
            { id: 'm2', name: 'Engineering design & risk review', due: due(0.75), status: 'Not Started', owner: 'Engineering owner' },
            { id: 'm3', name: `Staged rollout in ${reg.name}`, due: due(opp.effort === 'High' ? 3.5 : 1.5), status: 'Not Started', owner: 'Engineering owner' },
            { id: 'm4', name: 'Savings verified in billing', due: due(opp.effort === 'High' ? 5 : opp.effort === 'Medium' ? 3 : 2), status: 'Not Started', owner: 'Erin Walsh' },
          ],
          dependencies: [{ id: 'd1', team: opp.workloads.map((w) => workloadById(w).short).join(' / ') + ' team', description: 'Confirm rollout window and SLO guardrails', due: due(0.5), status: 'On Track' }],
          decisions: [],
          sourceOppId: opp.id,
        }
        setState((s) => ({ ...s, initiatives: [...s.initiatives, init], oppInitiative: { ...s.oppInitiative, [opp.id]: id } }))
        logAudit({ kind: 'Program update', title: `Added to Program Execution: ${opp.title}`, generatedBy: person, dataSources: opp.sources, confidence: opp.confidence, reviewer: person, status: 'Recorded', changes: [] })
        return id
      },
      setInitiativeStatus: (id, st) => {
        const init = state.initiatives.find((i) => i.id === id)!
        setState((s) => ({ ...s, initiatives: s.initiatives.map((i) => (i.id === id ? { ...i, status: st, progress: st === 'Completed' ? 100 : i.progress } : i)) }))
        logAudit({ kind: 'Program update', title: `${init.name}: ${init.status} → ${st}`, generatedBy: person, dataSources: ['Program tracker'], confidence: null, reviewer: person, status: 'Recorded', changes: [] })
      },
      setMilestoneStatus: (initId, mId, st) =>
        setState((s) => ({
          ...s,
          initiatives: s.initiatives.map((i) => {
            if (i.id !== initId) return i
            const milestones = i.milestones.map((m) => (m.id === mId ? { ...m, status: st, completedOn: st === 'Done' ? new Date().toISOString().slice(0, 10) : undefined } : m))
            const done = milestones.filter((m) => m.status === 'Done').length
            const active = milestones.filter((m) => m.status === 'In Progress').length
            return { ...i, milestones, progress: i.status === 'Completed' ? 100 : Math.round(((done + active * 0.5) / milestones.length) * 100) }
          }),
        })),
      updateAudit: (id, patch) => setState((s) => ({ ...s, audit: s.audit.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      reset: () => {
        localStorage.removeItem(STORAGE_KEY)
        setState(initialState())
      },
    }),
    [state, person, can, logAudit],
  )

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

/** Opportunities merged with their workflow status. */
export function useOpportunities() {
  const { oppStatus } = useStore()
  return useMemo(() => OPPORTUNITIES.map((o) => ({ ...o, status: oppStatus[o.id] ?? 'Proposed' })), [oppStatus])
}
export type OppWithStatus = Opportunity & { status: OppStatus }
