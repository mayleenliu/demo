import { useState } from 'react'
import { LayoutDashboard, Gauge, PiggyBank, Cpu, Sparkles, KanbanSquare, ShieldCheck, RotateCcw, Menu, X, FlaskConical } from 'lucide-react'
import { AS_OF_LABEL, INFRA_TYPES, REGIONS, WORKLOADS } from './data/model'
import { DEFAULT_FILTERS } from './lib/calc'
import { ROLES, useStore, type Role } from './state/store'
import { Select, cx } from './components/ui'
import Overview from './pages/Overview'
import Capacity from './pages/Capacity'
import CostOptimization from './pages/CostOptimization'
import AIRecommendations from './pages/AIRecommendations'
import ProgramExecution from './pages/ProgramExecution'
import GpuEfficiency from './pages/GpuEfficiency'
import Governance from './pages/Governance'

export type PageId = 'overview' | 'capacity' | 'cost' | 'gpu' | 'ai' | 'program' | 'governance'

const NAV: { id: PageId; label: string; icon: typeof Gauge; title: string; subtitle: string }[] = [
  { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard, title: 'Executive Overview', subtitle: 'Fleet-wide capacity, spend and efficiency at a glance' },
  { id: 'capacity', label: 'Capacity & Utilization', icon: Gauge, title: 'Capacity & Utilization', subtitle: 'Inventory, utilization, headroom and forecasting simulator' },
  { id: 'cost', label: 'Cost Optimization', icon: PiggyBank, title: 'Cost Optimization & FinOps', subtitle: 'Detected inefficiencies, prioritization and approval workflow' },
  { id: 'gpu', label: 'GPU Efficiency', icon: Cpu, title: 'AI / GPU Efficiency', subtitle: 'GPU utilization, idle time, training-job economics and scheduling' },
  { id: 'ai', label: 'AI Recommendations', icon: Sparkles, title: 'AI Recommendations Engine', subtitle: 'Grounded analysis with inspectable sources, calculations and confidence' },
  { id: 'program', label: 'Program Execution', icon: KanbanSquare, title: 'Program Execution', subtitle: 'Initiatives, milestones, dependencies and the TPM assistant' },
  { id: 'governance', label: 'AI Governance', icon: ShieldCheck, title: 'AI Governance & Audit', subtitle: 'Traceability, human review and access controls for AI output' },
]

export default function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [navOpen, setNavOpen] = useState(false)
  const { filters, setFilters, role, setRole, reset, audit } = useStore()
  const current = NAV.find((n) => n.id === page)!
  const pending = audit.filter((a) => a.status === 'Pending review').length
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)
  const showFilters = page !== 'governance'

  const go = (p: PageId) => {
    setPage(p)
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="flex min-h-full">
      {navOpen && <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setNavOpen(false)} />}
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-white transition-transform lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pin text-white">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 18v-6M12 18V6M18 18v-4" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">Control Tower</div>
            <div className="text-[11px] text-muted">Capacity & Efficiency</div>
          </div>
          <button className="ml-auto rounded-full p-1 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition', page === n.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-neutral-100')}
            >
              <n.icon size={17} className={page === n.id ? 'text-white' : n.id === 'ai' ? 'text-ai' : 'text-muted'} />
              <span className="flex-1">{n.label}</span>
              {n.id === 'governance' && pending > 0 && <span className={cx('rounded-full px-1.5 text-[10px] font-semibold', page === n.id ? 'bg-white text-ink' : 'bg-pin text-white')}>{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="space-y-3 border-t border-line p-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Viewing as</div>
            <Select<Role> value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r.id, label: r.label }))} className="w-full" />
            <p className="mt-1.5 text-[11px] leading-snug text-muted">{ROLES.find((r) => r.id === role)!.description}</p>
          </div>
          <button onClick={reset} className="flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-ink">
            <RotateCcw size={12} /> Reset demo data
          </button>
          <div className="flex items-start gap-1.5 rounded-lg bg-neutral-50 p-2 text-[10.5px] leading-snug text-muted">
            <FlaskConical size={12} className="mt-0.5 shrink-0" />
            Portfolio demo. All data is synthetic and illustrative; not affiliated with or representing any company's internal systems.
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 lg:px-8">
            <button className="rounded-full p-1.5 hover:bg-neutral-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu size={20} />
            </button>
            <div className="min-w-[280px] flex-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">{current.title}</h1>
              <p className="text-xs text-muted">
                {current.subtitle} · Data as of {AS_OF_LABEL} · <span className="font-medium text-pin">Synthetic data</span>
              </p>
            </div>
            {showFilters && (
              <div className="flex flex-wrap items-center gap-2">
                <Select label="Region" value={filters.region} onChange={(v) => setFilters({ region: v })} options={[{ value: 'all', label: 'All regions' }, ...REGIONS.map((r) => ({ value: r.id, label: r.name }))]} />
                <Select label="Type" value={filters.type} onChange={(v) => setFilters({ type: v })} options={[{ value: 'all' as const, label: 'All types' }, ...INFRA_TYPES.map((t) => ({ value: t.id, label: t.name }))]} />
                <Select label="Workload" value={filters.workload} onChange={(v) => setFilters({ workload: v })} options={[{ value: 'all', label: 'All workloads' }, ...WORKLOADS.map((w) => ({ value: w.id, label: w.short }))]} />
                <Select label="Period" value={filters.period} onChange={(v) => setFilters({ period: v })} options={[{ value: 3 as const, label: '3 months' }, { value: 6 as const, label: '6 months' }, { value: 12 as const, label: '12 months' }]} />
                {filtersActive && (
                  <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 px-5 py-6 lg:px-8">
          {page === 'overview' && <Overview go={go} />}
          {page === 'capacity' && <Capacity />}
          {page === 'cost' && <CostOptimization go={go} />}
          {page === 'gpu' && <GpuEfficiency go={go} />}
          {page === 'ai' && <AIRecommendations go={go} />}
          {page === 'program' && <ProgramExecution />}
          {page === 'governance' && <Governance />}
        </main>
      </div>
    </div>
  )
}
