import { useState } from 'react'
import { LayoutDashboard, Gauge, Recycle, RotateCcw, Menu, X, FlaskConical } from 'lucide-react'
import { REGIONS } from './data/fleet'
import { useStore } from './state/store'
import { Select, cx } from './components/ui'
import Overview from './pages/Overview'
import Capacity from './pages/Capacity'
import Lifecycle from './pages/Lifecycle'

export type PageId = 'overview' | 'capacity' | 'lifecycle'

const NAV: { id: PageId; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'capacity', label: 'Capacity & Demand', icon: Gauge },
  { id: 'lifecycle', label: 'Hardware Lifecycle', icon: Recycle },
]

export default function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [navOpen, setNavOpen] = useState(false)
  const { region, setRegion, reset } = useStore()
  const current = NAV.find((n) => n.id === page)!

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
            <div className="text-[15px] font-semibold tracking-tight">SDN Capacity</div>
            <div className="text-[11px] text-muted">Network appliance fleet</div>
          </div>
          <button className="ml-auto rounded-full p-1 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => go(n.id)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition', page === n.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-neutral-100')}>
              <n.icon size={17} className={page === n.id ? 'text-white' : 'text-muted'} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="space-y-3 border-t border-line p-4">
          <button onClick={reset} className="flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-ink">
            <RotateCcw size={12} /> Reset decisions
          </button>
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <FlaskConical size={12} /> Synthetic data
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 lg:px-8">
            <button className="rounded-full p-1.5 hover:bg-neutral-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu size={20} />
            </button>
            <h1 className="min-w-[200px] flex-1 truncate text-xl font-semibold tracking-tight">{current.label}</h1>
            <Select label="Region" value={region} onChange={setRegion} options={[{ value: 'all', label: 'All regions' }, ...REGIONS.map((r) => ({ value: r.id, label: r.name }))]} />
          </div>
        </header>
        <main className="flex-1 px-5 py-6 lg:px-8">
          {page === 'overview' && <Overview />}
          {page === 'capacity' && <Capacity />}
          {page === 'lifecycle' && <Lifecycle />}
        </main>
      </div>
    </div>
  )
}
