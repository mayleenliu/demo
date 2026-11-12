import { AS_OF } from '../data/fleet'

export function fmtUSD(n: number, digits = 1): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(digits)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : digits)}K`
  return `${sign}$${Math.round(abs)}`
}

export const fmtNum = (n: number) => Math.round(n).toLocaleString()
export const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`

export function fmtCompact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

export function fmtDate(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')) : iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateShort(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')) : iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Date that is `months` (fractional) after AS_OF. */
export function addMonths(months: number, from: Date = AS_OF) {
  const d = new Date(from)
  d.setDate(d.getDate() + Math.round(months * 30.44))
  return d
}

export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000)
export const toDate = (iso: string) => new Date(iso + 'T12:00:00')

