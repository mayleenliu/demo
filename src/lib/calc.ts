import {
  CAPACITY_THRESHOLD,
  INVENTORY,
  REGIONS,
  WORKLOADS,
  monthLabel,
  regionById,
  workloadById,
  type InfraType,
  type InventoryRow,
} from '../data/model'
import { GPU_ANALYSIS, BOTTLENECK_FIX, type Bottleneck } from './gpu'
import { GPU_RATE } from '../data/gpu'

export interface Filters {
  region: string // 'all' or region id
  type: 'all' | InfraType
  workload: string // 'all' or workload id
  period: 3 | 6 | 12
}

export const DEFAULT_FILTERS: Filters = { region: 'all', type: 'all', workload: 'all', period: 12 }

export function filterRows(f: Filters, rows: InventoryRow[] = INVENTORY, opts: { ignoreType?: boolean } = {}) {
  return rows.filter(
    (r) =>
      (f.region === 'all' || r.region === f.region) &&
      (opts.ignoreType || f.type === 'all' || r.type === f.type) &&
      (f.workload === 'all' || r.workload === f.workload),
  )
}

/** The infra type used for capacity KPIs: compute unless the user filtered to another type. */
export const capacityType = (f: Filters): InfraType => (f.type === 'all' ? 'compute' : f.type)

export const sum = (rows: InventoryRow[], key: 'provisioned' | 'used' | 'reserved' | 'monthlyCost') =>
  rows.reduce((s, r) => s + r[key], 0)

export function forecastUsed(r: InventoryRow, monthsAhead: number) {
  return r.used * Math.pow(1 + r.growth, monthsAhead)
}

/** Historical provisioned capacity (accounts for capacity added in the past). */
export function provisionedAt(r: InventoryRow, monthsAgo: number) {
  const step = regionById(r.region).capacityStep
  if (r.type === 'compute' && step && monthsAgo >= step.monthsAgo) return r.provisioned / (1 + step.added)
  return r.provisioned
}

function seasonal(monthsAgo: number, seed: number) {
  return 1 + 0.018 * Math.sin((monthsAgo + seed) * 1.3) + 0.01 * Math.cos(monthsAgo * 2.1 + seed)
}

export function usedAt(r: InventoryRow, monthsAgo: number) {
  if (monthsAgo === 0) return r.used
  const seed = r.region.length + r.workload.length
  return Math.min(provisionedAt(r, monthsAgo) * 0.98, (r.used / Math.pow(1 + r.growth, monthsAgo)) * seasonal(monthsAgo, seed))
}

export function costAt(r: InventoryRow, monthsAgo: number) {
  const provRatio = provisionedAt(r, monthsAgo) / r.provisioned
  const usedRatio = usedAt(r, monthsAgo) / Math.max(1, r.used)
  return r.monthlyCost * (0.72 * provRatio + 0.28 * usedRatio)
}

export function budgetFor(rows: InventoryRow[]) {
  // Regional budget allocated to rows in proportion to their current cost.
  return rows.reduce((s, r) => {
    const region = regionById(r.region)
    return s + (r.monthlyCost / region.monthlySpend) * region.monthlyBudget
  }, 0)
}

export interface TrendPoint {
  month: string
  provisioned: number
  used: number
  utilization: number
  spend: number
  budget: number
}

export function historySeries(f: Filters): TrendPoint[] {
  const capRows = filterRows({ ...f, type: capacityType(f) })
  const costRows = filterRows(f)
  const budget = budgetFor(costRows)
  const pts: TrendPoint[] = []
  for (let m = f.period - 1; m >= 0; m--) {
    const provisioned = capRows.reduce((s, r) => s + provisionedAt(r, m), 0)
    const used = capRows.reduce((s, r) => s + usedAt(r, m), 0)
    pts.push({
      month: monthLabel(-m),
      provisioned: Math.round(provisioned),
      used: Math.round(used),
      utilization: provisioned ? used / provisioned : 0,
      spend: Math.round(costRows.reduce((s, r) => s + costAt(r, m), 0)),
      budget: Math.round(budget),
    })
  }
  return pts
}

export interface ForecastPoint {
  month: string
  demand: number
  capacity: number
  threshold: number
  [region: string]: number | string
}

export function forecastSeries(f: Filters, months = 6): ForecastPoint[] {
  const rows = filterRows({ ...f, type: capacityType(f) })
  const pts: ForecastPoint[] = []
  for (let m = 0; m <= months; m++) {
    const capacity = sum(rows, 'provisioned')
    const p: ForecastPoint = {
      month: monthLabel(m),
      demand: Math.round(rows.reduce((s, r) => s + forecastUsed(r, m), 0)),
      capacity,
      threshold: Math.round(capacity * CAPACITY_THRESHOLD),
    }
    for (const reg of REGIONS) {
      const rr = rows.filter((r) => r.region === reg.id)
      if (rr.length) p[reg.id] = Math.round(rr.reduce((s, r) => s + forecastUsed(r, m), 0))
    }
    pts.push(p)
  }
  return pts
}

export interface RegionStat {
  id: string
  name: string
  provisioned: number
  used: number
  reserved: number
  available: number
  utilization: number
  forecast6: number
  forecastUtil6: number
  headroom6: number
  monthlySpend: number
  growth: number
  monthsToThreshold: number | null
  status: 'risk' | 'watch' | 'healthy' | 'waste'
}

/** Months until demand crosses `threshold` × capacity, with compounding growth. Null if > 36 months. */
export function monthsToThreshold(used: number, capacity: number, growth: number, threshold = CAPACITY_THRESHOLD) {
  if (capacity <= 0) return null
  if (used >= capacity * threshold) return 0
  if (growth <= 0) return null
  const m = Math.log((capacity * threshold) / used) / Math.log(1 + growth)
  return m > 36 ? null : m
}

export function classify(util: number, forecastUtil: number): RegionStat['status'] {
  if (forecastUtil >= 0.95 || util >= CAPACITY_THRESHOLD) return 'risk'
  if (forecastUtil >= CAPACITY_THRESHOLD) return 'watch'
  if (util < 0.6) return 'waste'
  return 'healthy'
}

export function regionStats(f: Filters): RegionStat[] {
  const type = capacityType(f)
  return REGIONS.filter((r) => f.region === 'all' || r.id === f.region)
    .map((reg) => {
      const rows = filterRows({ ...f, region: reg.id, type })
      const costRows = filterRows({ ...f, region: reg.id })
      if (!rows.length) return null
      const provisioned = sum(rows, 'provisioned')
      const used = sum(rows, 'used')
      const forecast6 = rows.reduce((s, r) => s + forecastUsed(r, 6), 0)
      const growth = Math.pow(forecast6 / used, 1 / 6) - 1
      const utilization = used / provisioned
      const forecastUtil6 = forecast6 / provisioned
      return {
        id: reg.id,
        name: reg.name,
        provisioned,
        used,
        reserved: sum(rows, 'reserved'),
        available: provisioned - used,
        utilization,
        forecast6,
        forecastUtil6,
        headroom6: provisioned - forecast6,
        monthlySpend: sum(costRows, 'monthlyCost'),
        growth,
        monthsToThreshold: monthsToThreshold(used, provisioned, growth),
        status: classify(utilization, forecastUtil6),
      } satisfies RegionStat
    })
    .filter((x): x is RegionStat => x !== null)
}

export function workloadStats(f: Filters) {
  const type = capacityType(f)
  return WORKLOADS.filter((w) => f.workload === 'all' || w.id === f.workload)
    .map((w) => {
      const rows = filterRows({ ...f, workload: w.id, type })
      const provisioned = sum(rows, 'provisioned')
      const used = sum(rows, 'used')
      const forecast6 = rows.reduce((s, r) => s + forecastUsed(r, 6), 0)
      return {
        id: w.id,
        name: w.short,
        provisioned,
        used,
        available: provisioned - used,
        utilization: provisioned ? used / provisioned : 0,
        forecast6,
        forecastUtil6: provisioned ? forecast6 / provisioned : 0,
      }
    })
    .filter((w) => w.provisioned > 0)
}

/* ------------------------------------------------------------------ */
/* Optimization opportunities                                          */
/* ------------------------------------------------------------------ */

export type OppCategory = 'Underutilized compute' | 'Storage inefficiency' | 'Networking inefficiency' | 'Stranded capacity'
export type Level = 'Low' | 'Medium' | 'High'
export type OppStatus = 'Proposed' | 'Under Review' | 'Approved' | 'In Progress' | 'Completed'
export const OPP_STATUSES: OppStatus[] = ['Proposed', 'Under Review', 'Approved', 'In Progress', 'Completed']

export interface Opportunity {
  id: string
  category: OppCategory
  title: string
  region: string
  workloads: string[]
  type: InfraType
  rowIds: string[]
  currentConfig: string
  observedUtil: string
  observedUtilValue: number
  proposed: string
  monthlySavings: number
  effort: Level
  risk: Level
  customerImpact: Level
  considerations: string
  confidence: number
  feasibility: number
  priority: number
  calc: { label: string; formula: string; result: string }[]
  sources: string[]
}

/** Default ceiling for surviving AZs during a single-AZ failure. */
export const FAILOVER_CEILING = 0.9
/**
 * Rightsizing target by tier. Tier 0 must survive losing one of three AZs at the failover ceiling,
 * so its steady-state target is ceiling × 2/3 = 60%. Tier 1/2 can degrade or defer during an AZ event.
 */
export const rightsizeTarget = (tier: string) => (tier === 'Tier 0' ? +(FAILOVER_CEILING * (2 / 3)).toFixed(2) : 0.65)
const RIGHTSIZE_HOW: Record<string, string> = {
  'data-platform': 'shift backfills to off-peak windows and bin-pack Spark executors',
  media: 'bin-pack resize / transcode workers and autoscale on queue depth',
  'home-feed': 'autoscale to the diurnal traffic curve instead of a flat peak floor',
  search: 'autoscale per region and lower the floor outside regional peak hours',
  ads: 'autoscale on auction QPS and right-size instance shape',
  'core-api': 'lower the autoscaling floor while keeping N+1 AZ headroom',
  'ml-training': 'consolidate inference replicas and batch requests',
}
const FEAS_BY_EFFORT: Record<Level, number> = { Low: 0.9, Medium: 0.7, High: 0.45 }
const RISK_PENALTY: Record<Level, number> = { Low: 1, Medium: 0.9, High: 0.75 }
export const LOW_CONFIDENCE = 0.6

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`
const pctS = (n: number) => `${(n * 100).toFixed(1)}%`

function finalize(o: Omit<Opportunity, 'feasibility' | 'priority'>): Opportunity {
  const feasibility = +(FEAS_BY_EFFORT[o.effort] * RISK_PENALTY[o.risk]).toFixed(2)
  const impact = o.monthlySavings / 1000
  const priority = +(impact * o.confidence * feasibility).toFixed(1)
  return {
    ...o,
    confidence: +o.confidence.toFixed(2),
    feasibility,
    priority,
    calc: [
      ...o.calc,
      { label: 'Feasibility', formula: `effort factor (${o.effort} = ${FEAS_BY_EFFORT[o.effort]}) × risk factor (${o.risk} = ${RISK_PENALTY[o.risk]})`, result: feasibility.toFixed(2) },
      { label: 'Priority score', formula: `financial impact ($K/mo ${impact.toFixed(1)}) × confidence (${o.confidence.toFixed(2)}) × feasibility (${feasibility.toFixed(2)})`, result: priority.toFixed(1) },
    ],
  }
}

function buildOpportunities(): Opportunity[] {
  const opps: Opportunity[] = []
  const rightsized = new Set<string>()

  // A. Underutilized compute
  for (const r of INVENTORY.filter((x) => x.type === 'compute')) {
    const util = r.used / r.provisioned
    if (util >= 0.58) continue
    const w = workloadById(r.workload)
    const reg = regionById(r.region)
    const target = rightsizeTarget(w.tier)
    const targetProv = Math.ceil(r.used / target)
    const reducible = r.provisioned - targetProv
    const unitCost = r.monthlyCost / r.provisioned
    const savings = reducible * unitCost * 0.85
    if (savings < 5000) continue
    rightsized.add(r.id)
    const tier0 = w.tier === 'Tier 0'
    const effort: Level = w.isAI ? 'High' : tier0 ? 'Medium' : 'Low'
    opps.push(
      finalize({
        id: `opp-cmp-${r.region}-${r.workload}`,
        category: 'Underutilized compute',
        title: `Rightsize ${w.short} compute in ${reg.name}`,
        region: r.region,
        workloads: [r.workload],
        type: 'compute',
        rowIds: [r.id],
        currentConfig: `${r.provisioned.toLocaleString()} units of ${r.hardware} across ${r.az}`,
        observedUtil: `CPU p95 ${pctS(r.cpuUtil)}, memory ${pctS(r.memUtil)}, allocation ${pctS(util)}`,
        observedUtilValue: util,
        proposed: `Consolidate to ${targetProv.toLocaleString()} units (target ${Math.round(target * 100)}% utilization${tier0 ? ', N+1-safe' : ''}); ${RIGHTSIZE_HOW[r.workload]}; release ${reducible.toLocaleString()} units`,
        monthlySavings: Math.round(savings),
        effort,
        risk: tier0 ? 'Medium' : 'Low',
        customerImpact: tier0 ? 'Medium' : 'Low',
        considerations: tier0
          ? 'Tier 0 serving path — stage via canary, keep N+1 AZ redundancy and validate p99 latency SLO.'
          : 'Batch / async workload — schedule-tolerant; validate peak backfill windows before releasing capacity.',
        confidence: Math.max(0.4, 0.95 - r.utilVolatility * 2.2),
        calc: [
          { label: 'Current utilization', formula: `${r.used.toLocaleString()} used ÷ ${r.provisioned.toLocaleString()} provisioned`, result: pctS(util) },
          { label: 'Target capacity', formula: `ceil(${r.used.toLocaleString()} ÷ ${target}) — ${tier0 ? `Tier 0 target = ${FAILOVER_CEILING * 100}% failover ceiling × 2/3 surviving AZs` : 'Tier 1/2 target 65%'}`, result: `${targetProv.toLocaleString()} units` },
          { label: 'Unit cost', formula: `${usd(r.monthlyCost)} ÷ ${r.provisioned.toLocaleString()} units`, result: `${usd(unitCost)}/unit/mo` },
          { label: 'Monthly savings', formula: `${reducible.toLocaleString()} units × ${usd(unitCost)} × 0.85 (reservation & overhead haircut)`, result: usd(savings) },
          { label: 'Confidence', formula: `0.95 − 2.2 × 90-day utilization volatility (${pctS(r.utilVolatility)})`, result: Math.max(0.4, 0.95 - r.utilVolatility * 2.2).toFixed(2) },
        ],
        sources: ['Inventory: compute fleet', 'Utilization telemetry (90-day p95)', 'Billing: monthly cost allocation'],
      }),
    )
  }

  // B. Storage inefficiency (oversized allocation + cold-data tiering)
  for (const r of INVENTORY.filter((x) => x.type === 'storage')) {
    const util = r.used / r.provisioned
    const w = workloadById(r.workload)
    const reg = regionById(r.region)
    const unitCost = r.monthlyCost / r.provisioned
    const reclaimTB = util < 0.7 ? Math.max(0, r.provisioned - Math.ceil(r.used / 0.8)) : 0
    const coldTB = Math.round(r.used * r.coldPct)
    const tierSavings = coldTB * unitCost * 0.6
    const reclaimSavings = reclaimTB * unitCost * 0.9
    const savings = tierSavings + reclaimSavings
    if (savings < 10000) continue
    opps.push(
      finalize({
        id: `opp-sto-${r.region}-${r.workload}`,
        category: 'Storage inefficiency',
        title: `${coldTB > reclaimTB ? 'Tier cold data' : 'Reclaim oversized volumes'} for ${w.short} in ${reg.name}`,
        region: r.region,
        workloads: [r.workload],
        type: 'storage',
        rowIds: [r.id],
        currentConfig: `${r.provisioned.toLocaleString()} TB ${r.hardware}`,
        observedUtil: `${pctS(util)} allocated used; ${pctS(r.coldPct)} of bytes not read in 90 days`,
        observedUtilValue: util,
        proposed: `${coldTB.toLocaleString()} TB → infrequent-access tier via lifecycle policy${reclaimTB ? `; shrink allocation by ${reclaimTB.toLocaleString()} TB to 80% fill` : ''}`,
        monthlySavings: Math.round(savings),
        effort: 'Low',
        risk: w.tier === 'Tier 0' ? 'Medium' : 'Low',
        customerImpact: 'Low',
        considerations: 'Retrieval latency rises for tiered objects; exclude hot-restore paths and confirm retention / legal-hold policies.',
        confidence: Math.max(0.5, 0.92 - r.utilVolatility * 2),
        calc: [
          { label: 'Cold data', formula: `${r.used.toLocaleString()} TB used × ${pctS(r.coldPct)} cold`, result: `${coldTB.toLocaleString()} TB` },
          { label: 'Tiering savings', formula: `${coldTB.toLocaleString()} TB × ${usd(unitCost)}/TB × 60% price delta`, result: usd(tierSavings) },
          { label: 'Reclaim savings', formula: `${reclaimTB.toLocaleString()} TB × ${usd(unitCost)}/TB × 0.9`, result: usd(reclaimSavings) },
          { label: 'Monthly savings', formula: 'tiering + reclaim', result: usd(savings) },
        ],
        sources: ['Inventory: storage allocations', 'Object access logs (90-day)', 'Billing: storage SKUs'],
      }),
    )
  }

  // C. Networking inefficiency
  // Image serving: origin egress is cut by CDN cache-hit and smaller image formats, not by shrinking links.
  for (const r of INVENTORY.filter((x) => x.type === 'network' && x.workload === 'media')) {
    const reg = regionById(r.region)
    const hitBefore = 0.88
    const hitAfter = 0.94
    const bytesCut = 0.25
    const originShare = (1 - hitAfter) / (1 - hitBefore) * (1 - bytesCut)
    const savings = r.monthlyCost * (1 - originShare) * 0.55
    if (savings < 5000) continue
    opps.push(
      finalize({
        id: `opp-cdn-${r.region}`,
        category: 'Networking inefficiency',
        title: `Raise CDN cache-hit & serve AVIF/WebP for Image Serving in ${reg.name}`,
        region: r.region,
        workloads: ['media'],
        type: 'network',
        rowIds: [r.id],
        currentConfig: `${r.provisioned} Gbps ${r.hardware}; CDN cache-hit ${pctS(hitBefore)}; JPEG-heavy derivatives`,
        observedUtil: `Origin egress ${pctS(r.used / r.provisioned)} of provisioned; ${pctS(1 - hitBefore)} of image requests miss the CDN`,
        observedUtilValue: r.used / r.provisioned,
        proposed: `Tiered caching + longer TTLs for immutable Pin images (hit ${pctS(hitBefore)} → ${pctS(hitAfter)}); serve AVIF/WebP derivatives (~${bytesCut * 100}% fewer bytes)`,
        monthlySavings: Math.round(savings),
        effort: 'Medium',
        risk: 'Low',
        customerImpact: 'Low',
        considerations: 'Images also load faster for users. Needs a one-time re-encode backfill (CPU), visual-quality checks (SSIM), and JPEG fallback for older clients.',
        confidence: 0.8,
        calc: [
          { label: 'Origin traffic after', formula: `(1 − ${hitAfter}) ÷ (1 − ${hitBefore}) × (1 − ${bytesCut})`, result: pctS(originShare) },
          { label: 'Monthly savings', formula: `${usd(r.monthlyCost)} × (1 − ${pctS(originShare)}) × 0.55 (committed-egress & CDN fee offset)`, result: usd(savings) },
        ],
        sources: ['CDN logs (cache-hit, bytes served)', 'Flow telemetry (origin egress)', 'Billing: egress'],
      }),
    )
  }
  for (const r of INVENTORY.filter((x) => x.type === 'network' && x.workload !== 'media')) {
    const util = r.used / r.provisioned
    if (util >= 0.42) continue
    const w = workloadById(r.workload)
    const reg = regionById(r.region)
    const target = Math.ceil(r.used / 0.6)
    const reducible = r.provisioned - target
    const unitCost = r.monthlyCost / r.provisioned
    const excessReserved = Math.max(0, r.reserved - target)
    const savings = reducible * unitCost * 0.7
    if (savings < 5500) continue
    opps.push(
      finalize({
        id: `opp-net-${r.region}-${r.workload}`,
        category: 'Networking inefficiency',
        title: `Consolidate ${w.short} network capacity in ${reg.name}`,
        region: r.region,
        workloads: [r.workload],
        type: 'network',
        rowIds: [r.id],
        currentConfig: `${r.provisioned} Gbps ${r.hardware}; ${r.reserved} Gbps committed`,
        observedUtil: `p95 throughput ${pctS(util)} of provisioned`,
        observedUtilValue: util,
        proposed: `Reduce to ${target} Gbps (60% p95 target)${excessReserved ? `; drop ${excessReserved} Gbps of reserved commitment at renewal` : ''}`,
        monthlySavings: Math.round(savings),
        effort: 'Medium',
        risk: w.tier === 'Tier 0' ? 'High' : 'Medium',
        customerImpact: w.tier === 'Tier 0' ? 'Medium' : 'Low',
        considerations: 'Preserve burst headroom for failover (AZ evacuation doubles cross-AZ traffic). Align with commitment renewal dates.',
        confidence: Math.max(0.4, 0.85 - r.utilVolatility * 1.8),
        calc: [
          { label: 'Target bandwidth', formula: `ceil(${r.used} Gbps ÷ 0.60)`, result: `${target} Gbps` },
          { label: 'Monthly savings', formula: `${reducible} Gbps × ${usd(unitCost)}/Gbps × 0.7 (commitment lock-in haircut)`, result: usd(savings) },
        ],
        sources: ['Inventory: network capacity', 'Flow telemetry (p95 throughput)', 'Contracts: bandwidth commitments'],
      }),
    )
  }

  // D. Stranded capacity: reserved-but-unused compute, reallocated to the most constrained region.
  const constrained = [...REGIONS].sort((a, b) => b.computeUsed / b.computeProv - a.computeUsed / a.computeProv)[0]
  const constrainedRows = INVENTORY.filter((r) => r.region === constrained.id && r.type === 'compute')
  const constrainedNeed = Math.max(
    0,
    constrainedRows.reduce((s, r) => s + forecastUsed(r, 6), 0) - sum(constrainedRows, 'provisioned') * CAPACITY_THRESHOLD,
  )
  // Donor regions must have their own 6-month headroom; the shortfall is allocated across donors once (no double counting).
  const donors = REGIONS.filter((reg) => reg.id !== constrained.id)
    .map((reg) => {
      const all = INVENTORY.filter((r) => r.region === reg.id && r.type === 'compute')
      const rows = all.filter((r) => !rightsized.has(r.id))
      const stranded = rows.map((r) => ({ r, s: Math.max(0, r.reserved - r.used) })).filter((x) => x.s > 20)
      const total = stranded.reduce((s, x) => s + x.s, 0)
      const f6Util = all.reduce((s, r) => s + forecastUsed(r, 6), 0) / sum(all, 'provisioned')
      return { reg, rows, stranded, total, f6Util }
    })
    .filter((d) => d.total >= 120 && d.f6Util < CAPACITY_THRESHOLD)
    .sort((a, b) => a.f6Util - b.f6Util)
  let remainingNeed = constrainedNeed
  for (const { reg, rows, stranded, total } of donors) {
    const reallocatable = Math.min(total, remainingNeed)
    if (reallocatable < 100) continue
    remainingNeed -= reallocatable
    const unitCost = sum(rows, 'monthlyCost') / sum(rows, 'provisioned')
    const savings = reallocatable * unitCost * 0.55
    const vol = stranded.reduce((s, x) => s + x.r.utilVolatility * x.s, 0) / total
    const conf = Math.max(0.35, 0.78 - vol * 2.5 - (reg.id.startsWith('ap') ? 0.1 : 0))
    opps.push(
      finalize({
        id: `opp-str-${reg.id}`,
        category: 'Stranded capacity',
        title: `Reallocate stranded reserved capacity in ${reg.name}`,
        region: reg.id,
        workloads: stranded.map((x) => x.r.workload),
        type: 'compute',
        rowIds: stranded.map((x) => x.r.id),
        currentConfig: `${Math.round(total).toLocaleString()} reserved units unconsumed across ${stranded.length} workloads`,
        observedUtil: `Reserved ${sum(rows, 'reserved').toLocaleString()} vs used ${sum(rows, 'used').toLocaleString()} units`,
        observedUtilValue: sum(rows, 'used') / sum(rows, 'reserved'),
        proposed: `Migrate ~${Math.round(reallocatable).toLocaleString()} units of region-agnostic ${constrained.name} demand (batch / AI training) here instead of purchasing new ${constrained.name} capacity`,
        monthlySavings: Math.round(savings),
        effort: 'High',
        risk: 'Medium',
        customerImpact: 'Low',
        considerations: `Data residency (EU ↔ non-EU moves need privacy review), cross-region egress and added latency for data-local jobs.`,
        confidence: conf,
        calc: [
          { label: 'Stranded reserved', formula: 'Σ max(0, reserved − used) for non-rightsized workloads', result: `${Math.round(total).toLocaleString()} units` },
          { label: `${constrained.name} 6-mo shortfall`, formula: `forecast demand − ${CAPACITY_THRESHOLD * 100}% × capacity`, result: `${Math.round(constrainedNeed).toLocaleString()} units` },
          { label: 'Reallocatable', formula: 'min(stranded, shortfall not already absorbed by lower-utilization donor regions)', result: `${Math.round(reallocatable).toLocaleString()} units` },
          { label: 'Avoided spend', formula: `${Math.round(reallocatable)} × ${usd(unitCost)}/unit × 0.55 (net of egress & migration cost)`, result: usd(savings) },
        ],
        sources: ['Inventory: reservations', 'Capacity forecast model', 'Billing: commitment ledger'],
      }),
    )
  }

  // A (GPU). Underutilized GPUs: allocated but doing little useful work.
  const GPU_META: Partial<Record<Bottleneck, { short: string; effort: Level; risk: Level; conf: number }>> = {
    'Idle reservation': { short: 'Reclaim idle notebook GPUs', effort: 'Low', risk: 'Low', conf: 0.86 },
    'Unbatched requests': { short: 'Enable dynamic batching', effort: 'Medium', risk: 'Medium', conf: 0.76 },
    'Input pipeline stall': { short: 'Fix input-pipeline stalls', effort: 'Medium', risk: 'Low', conf: 0.8 },
    'Poor multi-GPU scaling': { short: 'Right-size GPU count', effort: 'Low', risk: 'Low', conf: 0.72 },
    'Underfilled GPU': { short: 'Batch / pack underfilled GPUs', effort: 'Medium', risk: 'Low', conf: 0.7 },
  }
  for (const j of GPU_ANALYSIS) {
    const meta = GPU_META[j.bottleneck]
    if (!meta || j.savings < 5000) continue
    const reg = regionById(j.region)
    opps.push(
      finalize({
        id: `opp-gpu-${j.id}`,
        category: 'Underutilized compute',
        title: `${meta.short}: ${j.name} (${reg.name})`,
        region: j.region,
        workloads: ['ml-training'],
        type: 'compute',
        rowIds: [`${j.region}:ml-training:compute`],
        currentConfig: `${j.kind === 'Training' ? `${j.gpus} × ${GPU_RATE.Training.type} per run, ${j.runsPerMonth} runs/mo` : `${j.gpus} × ${GPU_RATE.Inference.type} replicas`}; ${Math.round(j.gpuHours).toLocaleString()} GPU-hrs/mo`,
        observedUtil: `GPU SM ${pctS(j.smUtil)}, GPU memory ${pctS(j.memUtil)}, data-wait ${pctS(j.dataWait)}`,
        observedUtilValue: j.smUtil,
        proposed: BOTTLENECK_FIX[j.bottleneck],
        monthlySavings: Math.round(j.savings),
        effort: meta.effort,
        risk: meta.risk,
        customerImpact: j.kind === 'Inference' ? 'Medium' : 'Low',
        considerations: j.tradeoff,
        confidence: meta.conf,
        calc: j.calc,
        sources: ['GPU telemetry (30-day SM / memory)', 'Scheduler logs', 'Billing: GPU spend'],
      }),
    )
  }

  return opps.sort((a, b) => b.priority - a.priority)
}

export const OPPORTUNITIES: Opportunity[] = buildOpportunities()

export function filterOpps(f: Filters, opps: Opportunity[] = OPPORTUNITIES) {
  return opps.filter(
    (o) =>
      (f.region === 'all' || o.region === f.region) &&
      (f.type === 'all' || o.type === f.type) &&
      (f.workload === 'all' || o.workloads.includes(f.workload)),
  )
}

/* ------------------------------------------------------------------ */
/* Capacity simulator                                                  */
/* ------------------------------------------------------------------ */

export interface SimInput {
  region: string
  demandAdj: number // e.g. 0.1 = +10% step change in demand today
  growth: number // monthly growth
  threshold: number
  horizon: number
  optimizeFirst: boolean
}

export function regionComputeBaseline(regionId: string) {
  const rows = INVENTORY.filter((r) => r.region === regionId && r.type === 'compute')
  const provisioned = sum(rows, 'provisioned')
  const used = sum(rows, 'used')
  const f6 = rows.reduce((s, r) => s + forecastUsed(r, 6), 0)
  const growth = Math.pow(f6 / used, 1 / 6) - 1
  const unitCost = sum(rows, 'monthlyCost') / provisioned
  const aiRows = rows.filter((r) => workloadById(r.workload).isAI)
  const aiShare = sum(aiRows, 'used') / used
  // Only fleet rightsizing frees schedulable units; GPU fixes free GPU-hours inside the AI pool instead.
  const reclaimable = OPPORTUNITIES.filter((o) => o.region === regionId && o.id.startsWith('opp-cmp-')).reduce((s, o) => {
    const r = rows.find((x) => x.id === o.rowIds[0])!
    return s + Math.max(0, r.provisioned - Math.ceil(r.used / rightsizeTarget(workloadById(r.workload).tier)))
  }, 0)
  return { provisioned, used, growth, unitCost, aiShare, reclaimable, leadTime: regionById(regionId).leadTimeMonths }
}

export function simulate(input: SimInput) {
  const base = regionComputeBaseline(input.region)
  const reclaimed = input.optimizeFirst ? base.reclaimable : 0
  // Rightsizing frees capacity for other workloads in the same pool, effectively raising usable supply.
  const capacity = base.provisioned
  const effectiveCapacity = capacity + reclaimed
  const startDemand = base.used * (1 + input.demandAdj)
  const series = []
  let crossMonth: number | null = null
  for (let m = 0; m <= input.horizon; m++) {
    const demand = startDemand * Math.pow(1 + input.growth, m)
    if (crossMonth === null && demand >= effectiveCapacity * input.threshold) crossMonth = m
    series.push({
      month: monthLabel(m),
      demand: Math.round(demand),
      capacity: Math.round(effectiveCapacity),
      threshold: Math.round(effectiveCapacity * input.threshold),
    })
  }
  const exactCross = monthsToThreshold(startDemand, effectiveCapacity, input.growth, input.threshold)
  const endDemand = startDemand * Math.pow(1 + input.growth, input.horizon)
  const unitsNeeded = Math.max(0, Math.ceil(endDemand / input.threshold - effectiveCapacity))
  const monthlyInvestment = unitsNeeded * base.unitCost
  const orderBy = exactCross === null ? null : exactCross - base.leadTime
  return { base, series, crossMonth: exactCross, unitsNeeded, monthlyInvestment, annualInvestment: monthlyInvestment * 12, reclaimed, effectiveCapacity, endDemand, orderBy }
}

export function scenarioComparison(regionId: string, horizon: number, threshold: number) {
  const base = regionComputeBaseline(regionId)
  const aiGrowth = base.growth + base.aiShare * 0.045
  const scenarios = [
    { key: 'bau', name: 'Business-as-usual growth', growth: base.growth, optimizeFirst: false },
    { key: 'ai', name: 'Accelerated AI workload growth', growth: aiGrowth, optimizeFirst: false },
    { key: 'opt', name: 'Optimize before purchasing (AI growth)', growth: aiGrowth, optimizeFirst: true },
  ] as const
  return scenarios.map((s) => {
    const r = simulate({ region: regionId, demandAdj: 0, growth: s.growth, threshold, horizon, optimizeFirst: s.optimizeFirst })
    return { ...s, ...r }
  })
}

/* ------------------------------------------------------------------ */
/* Availability-zone failover                                          */
/* ------------------------------------------------------------------ */

export type ProtectScope = 'tier0' | 'tier01' | 'all'
export const PROTECT_LABEL: Record<ProtectScope, string> = { tier0: 'Tier 0 only', tier01: 'Tier 0 + Tier 1', all: 'All workloads' }
const isProtected = (tier: string, scope: ProtectScope) => scope === 'all' || tier === 'Tier 0' || (scope === 'tier01' && tier === 'Tier 1')

export type FailoverSeverity = 'ok' | 'outage' | 'degraded' | 'deferrable'
export const SEVERITY_LABEL: Record<FailoverSeverity, string> = { ok: 'Fits', outage: 'Outage risk', degraded: 'Degraded', deferrable: 'Deferrable (batch)' }

export interface FailoverInput {
  region: string
  failedAz: string
  ceiling: number
  protect: ProtectScope
  workload?: string
}

export interface PoolResult {
  workload: string
  name: string
  tier: string
  displaced: number
  survivorSpare: number
  absorbed: number
  shortfall: number
  postUtil: number
  severity: FailoverSeverity
  protected: boolean
  unitsNeeded: number
}

export function simulateFailover(input: FailoverInput) {
  const reg = regionById(input.region)
  const rows = INVENTORY.filter((r) => r.region === input.region && r.type === 'compute' && (!input.workload || input.workload === 'all' || r.workload === input.workload))
  const survivors = reg.azs.filter((a) => a !== input.failedAz)
  const absorbedByAz: Record<string, number> = Object.fromEntries(survivors.map((a) => [a, 0]))

  const pools: PoolResult[] = rows.map((r) => {
    const w = workloadById(r.workload)
    const slices = r.azSplit!
    const failed = slices.find((s) => s.az === input.failedAz)!
    const surv = slices.filter((s) => s.az !== input.failedAz)
    // Displaced load can only land in the same hardware pool, and only up to the failover ceiling.
    const spare = surv.map((s) => Math.max(0, input.ceiling * s.provisioned - s.used))
    const totalSpare = spare.reduce((a, b) => a + b, 0)
    const absorbed = Math.min(failed.used, totalSpare)
    surv.forEach((s, i) => (absorbedByAz[s.az] += totalSpare ? (absorbed * spare[i]) / totalSpare : 0))
    const shortfall = failed.used - absorbed
    const survProv = surv.reduce((a, s) => a + s.provisioned, 0)
    const postUtil = (surv.reduce((a, s) => a + s.used, 0) + failed.used) / survProv
    const prot = isProtected(w.tier, input.protect)
    const severity: FailoverSeverity = shortfall < 1 ? 'ok' : w.tier === 'Tier 0' ? 'outage' : w.tier === 'Tier 1' ? 'degraded' : 'deferrable'
    return {
      workload: r.workload,
      name: w.short,
      tier: w.tier,
      displaced: failed.used,
      survivorSpare: totalSpare,
      absorbed,
      shortfall,
      postUtil,
      severity,
      protected: prot,
      // Extra capacity in surviving AZs so the shortfall fits under the ceiling.
      unitsNeeded: prot && shortfall >= 1 ? Math.ceil(shortfall / input.ceiling) : 0,
    }
  })

  const azs = reg.azs.map((az) => {
    const prov = rows.reduce((s, r) => s + r.azSplit!.find((x) => x.az === az)!.provisioned, 0)
    const used = rows.reduce((s, r) => s + r.azSplit!.find((x) => x.az === az)!.used, 0)
    const failed = az === input.failedAz
    const absorbed = failed ? 0 : absorbedByAz[az]
    return { az, failed, provisioned: prov, used, before: prov ? used / prov : 0, after: failed ? 0 : prov ? (used + absorbed) / prov : 0, absorbed }
  })

  const totalProv = azs.reduce((s, a) => s + a.provisioned, 0)
  const totalUsed = azs.reduce((s, a) => s + a.used, 0)
  const failedAz = azs.find((a) => a.failed)!
  const survProv = totalProv - failedAz.provisioned
  // Fungible view: pretends any surviving capacity can run any workload.
  const fungibleUtil = totalUsed / survProv
  const fungibleShortfall = Math.max(0, totalUsed - input.ceiling * survProv)
  const shortfall = pools.reduce((s, p) => s + p.shortfall, 0)
  const unitsNeeded = pools.reduce((s, p) => s + p.unitsNeeded, 0)
  const unitCost = rows.reduce((s, r) => s + r.monthlyCost, 0) / Math.max(1, totalProv)
  const failedShare = failedAz.provisioned / totalProv
  return {
    region: reg,
    failedAz: input.failedAz,
    pools,
    azs,
    aggregateUtil: totalUsed / totalProv,
    fungibleUtil,
    fungibleShortfall,
    displaced: failedAz.used,
    shortfall,
    unitsNeeded,
    monthlyInvestment: unitsNeeded * unitCost,
    unitCost,
    sufficient: unitsNeeded === 0,
    failedShare,
    /** Highest steady-state utilization that still survives losing this AZ (perfectly fungible capacity). */
    maxSteadyUtil: input.ceiling * (1 - failedShare),
  }
}

export type FailoverResult = ReturnType<typeof simulateFailover>

export function worstCaseFailover(region: string, ceiling = FAILOVER_CEILING, protect: ProtectScope = 'tier01', workload?: string) {
  const all = regionById(region).azs.map((az) => simulateFailover({ region, failedAz: az, ceiling, protect, workload }))
  return all.reduce((worst, r) => (r.unitsNeeded > worst.unitsNeeded || (r.unitsNeeded === worst.unitsNeeded && r.shortfall > worst.shortfall) ? r : worst), all[0])
}
