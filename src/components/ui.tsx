import { useState, type ReactNode } from 'react'
import { ChevronDown, Info, Sparkles, Database, AlertTriangle, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const CHART = {
  red: '#e60023',
  ink: '#111111',
  gray: '#9b9b9b',
  light: '#e5e5e5',
  slate: '#4a5d73',
  teal: '#0f7b6c',
  amber: '#c27c0e',
  ai: '#5b4bdb',
  regions: ['#e60023', '#4a5d73', '#0f7b6c', '#c27c0e', '#a3a3a3'],
}

export function Card({ children, className, pad = true, id }: { children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <div id={id} className={cx('scroll-mt-28 rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]', pad && 'p-5', className)}>
      {children}
    </div>
  )
}

/** Secondary content hidden by default to keep each page focused on its main story. */
export function MoreDetails({ children, label = 'details' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 text-xs font-medium text-muted hover:text-ink">
        <span className="h-px flex-1 bg-line" />
        <span className="flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1">
          {open ? 'Hide' : 'Show more'} {label}
          <ChevronDown size={13} className={cx('transition', open && 'rotate-180')} />
        </span>
        <span className="h-px flex-1 bg-line" />
      </button>
      {open && <div className="mt-6 space-y-6">{children}</div>}
    </div>
  )
}

export function CardTitle({ title, subtitle, right, info }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; info?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-ink">
          {title}
          {info && (
            <span title={info} className="cursor-help text-muted">
              <Info size={13} />
            </span>
          )}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

type Tone = 'neutral' | 'red' | 'green' | 'amber' | 'blue' | 'ai' | 'dark'
const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-ink-2',
  red: 'bg-pin-soft text-pin-dark',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-800',
  blue: 'bg-sky-50 text-sky-800',
  ai: 'bg-ai-soft text-ai',
  dark: 'bg-ink text-white',
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[tone], className)}>{children}</span>
}

export const statusTone = (s: string): Tone => {
  switch (s) {
    case 'risk':
    case 'Off Track':
    case 'Blocked':
    case 'High':
    case 'Rejected':
      return 'red'
    case 'watch':
    case 'At Risk':
    case 'Medium':
    case 'Under Review':
    case 'Pending review':
      return 'amber'
    case 'healthy':
    case 'On Track':
    case 'Done':
    case 'Resolved':
    case 'Low':
    case 'Completed':
    case 'Approved':
    case 'Approved with edits':
    case 'Communicated':
      return 'green'
    case 'waste':
    case 'In Progress':
      return 'blue'
    default:
      return 'neutral'
  }
}

export const REGION_STATUS_LABEL: Record<string, string> = { risk: 'Capacity risk', watch: 'Watch', healthy: 'Healthy buffer', waste: 'Underutilized' }

export function MeasuredTag({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" className={cx('border border-line bg-white', className)}>
      <Database size={10} /> Measured data
    </Badge>
  )
}

export function AITag({ label = 'AI-generated · simulated', className }: { label?: string; className?: string }) {
  return (
    <Badge tone="ai" className={className}>
      <Sparkles size={10} /> {label}
    </Badge>
  )
}

export function LowConfidenceTag() {
  return (
    <Badge tone="amber">
      <AlertTriangle size={10} /> Low confidence · investigate
    </Badge>
  )
}

export function Kpi({ label, value, sub, tone, icon, delta }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'green' | 'neutral'; icon?: ReactNode; delta?: { text: string; good: boolean } }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        {icon && <span className={cx('rounded-lg p-1.5', tone === 'red' ? 'bg-pin-soft text-pin' : tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-ink-2')}>{icon}</span>}
      </div>
      <div className="tabular mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {delta && <span className={cx('font-medium', delta.good ? 'text-emerald-700' : 'text-pin')}>{delta.text}</span>}
        {sub}
      </div>
    </Card>
  )
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  className,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'dark' | 'ai'
  size?: 'sm' | 'md'
  disabled?: boolean
  title?: string
  className?: string
  type?: 'button' | 'submit'
}) {
  const v = {
    primary: 'bg-pin text-white hover:bg-pin-dark',
    secondary: 'bg-white text-ink border border-line hover:bg-neutral-50',
    ghost: 'text-ink-2 hover:bg-neutral-100',
    dark: 'bg-ink text-white hover:bg-neutral-800',
    ai: 'bg-ai text-white hover:opacity-90',
  }[variant]
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm',
        v,
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Select<T extends string | number>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string; className?: string }) {
  return (
    <label className={cx('relative inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-1.5 pl-3 pr-2 hover:border-neutral-300 focus-within:border-ink', className)}>
      {label && <span className="whitespace-nowrap text-[11px] font-medium text-muted">{label}</span>}
      <select
        value={String(value)}
        onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-5 text-sm font-medium text-ink outline-none"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-muted" />
    </label>
  )
}

export function Progress({ value, tone = 'ink', className }: { value: number; tone?: 'ink' | 'red' | 'green' | 'amber'; className?: string }) {
  const c = { ink: 'bg-ink', red: 'bg-pin', green: 'bg-emerald-600', amber: 'bg-amber-500' }[tone]
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-neutral-100', className)}>
      <div className={cx('h-full rounded-full transition-all', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function UtilBar({ value, threshold = 0.85 }: { value: number; threshold?: number }) {
  const tone = value >= threshold ? 'bg-pin' : value < 0.5 ? 'bg-sky-500' : 'bg-ink'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-neutral-100">
        <div className={cx('h-full', tone)} style={{ width: `${Math.min(100, value * 100)}%` }} />
        <div className="absolute top-0 h-full w-px bg-neutral-400" style={{ left: `${threshold * 100}%` }} />
      </div>
      <span className="tabular w-11 text-right text-xs">{(value * 100).toFixed(0)}%</span>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-full bg-neutral-100 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cx('rounded-full px-3 py-1 text-xs font-medium transition', value === o.value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Collapsible({ title, children, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-neutral-50">
        <span className="flex items-center gap-2">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown size={14} className={cx('transition', open && 'rotate-180')} />
        </span>
      </button>
      {open && <div className="border-t border-line px-3 py-3">{children}</div>}
    </div>
  )
}

export function Drawer({ open, onClose, title, children, width = 'max-w-2xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className={cx('relative flex h-full w-full flex-col bg-white shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="text-base font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-neutral-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

export function Th({ children, className, onClick, active }: { children?: ReactNode; className?: string; onClick?: () => void; active?: boolean }) {
  return (
    <th onClick={onClick} className={cx('whitespace-nowrap border-b border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted', onClick && 'cursor-pointer select-none hover:text-ink', active && 'text-ink', className)}>
      {children}
    </th>
  )
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('border-b border-line/70 px-3 py-2.5 align-top text-sm', className)}>
      {children}
    </td>
  )
}

export function ChartTooltip({ active, payload, label, formatter }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string; formatter?: (v: number, key: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular font-medium text-ink">{formatter ? formatter(p.value, p.dataKey) : p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>
}
