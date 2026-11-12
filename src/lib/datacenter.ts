// Datacenter view of the fleet: space, power, PUE, stranded capacity, over-provisioning and failover.

import {
  AS_OF,
  CAPEX_PER_RACK,
  CLUSTER_SIZE,
  FAILOVER_UTIL_LIMIT,
  IDLE_DRAW_SHARE,
  KW_PER_RACK,
  LOAD_DRAW_SHARE,
  PEAK_FACTOR,
  POWER_COST_PER_KWH,
  PUE_TARGET,
  RACKS,
  RECLAIM_KW_PER_RACK,
  REGIONS,
  REQUESTS,
  type Region,
} from '../data/fleet'
import { T, calMonth, demand, monthLabel, supply, toDate, type Plan } from './capacity'

const regionsIn = (region: string) => REGIONS.filter((r) => region === 'all' || r.id === region)
const HOURS_PER_YEAR = 8760

/** Average IT draw (kW) for a set of racks with the given racks-in-use. */
export const drawKw = (racks: number, inUse: number) => KW_PER_RACK * (IDLE_DRAW_SHARE * racks + LOAD_DRAW_SHARE * inUse)

/** First month (0 = today) in which racks required at 75% exceed `cap`, searching `months` ahead. */
function fullAt(r: Region, plan: Plan, cap: number, months = 48) {
  for (let m = 0; m <= months; m++) {
    const d = m === 0 ? AS_OF : calMonth(AS_OF, m)
    if (demand(r.id, d, plan) / T > cap) return d
  }
  return null
}

export type Binding = 'power' | 'space'

export function dcRegion(r: Region, plan: Plan) {
  const racks = supply(r.id, AS_OF, plan)
  const inUse = demand(r.id, AS_OF, plan)
  const powerRacks = Math.floor(r.powerBudgetKw / KW_PER_RACK)
  const powerRacksReclaimed = Math.floor(r.powerBudgetKw / RECLAIM_KW_PER_RACK)
  const allocKw = racks * KW_PER_RACK
  const avgKw = drawKw(racks, inUse)
  const peakKw = avgKw * PEAK_FACTOR

  // Over-provisioning counts pending requests too: racks a request in the queue will use aren't excess.
  const pending = REQUESTS.filter((q) => q.region === r.id && (plan.requests[q.id] ?? 'Pending') === 'Pending').reduce((s, q) => s + q.racks, 0)
  let inUse12 = 0
  for (let m = 0; m <= 12; m++) inUse12 = Math.max(inUse12, demand(r.id, m === 0 ? AS_OF : calMonth(AS_OF, m), plan))
  const excessRacks = Math.max(0, racks - Math.ceil((inUse12 + pending) / T))

  const cap = Math.min(r.rackPositions, powerRacks)
  const capReclaimed = Math.min(r.rackPositions, powerRacksReclaimed)

  return {
    id: r.id,
    name: r.name,
    racks,
    inUse,
    util: inUse / racks,
    positions: r.rackPositions,
    spaceUtil: racks / r.rackPositions,
    powerBudgetKw: r.powerBudgetKw,
    allocKw,
    powerAllocPct: allocKw / r.powerBudgetKw,
    avgKw,
    peakKw,
    powerDrawPct: avgKw / r.powerBudgetKw,
    /** Allocated to racks but never drawn, even at peak. */
    strandedKw: Math.max(0, allocKw - peakKw),
    /** Floor positions with no power behind them. */
    strandedPositions: Math.max(0, r.rackPositions - powerRacks),
    /** Power with no floor positions to use it. */
    strandedPowerKw: Math.max(0, powerRacks - r.rackPositions) * KW_PER_RACK,
    reclaimKw: racks * (KW_PER_RACK - RECLAIM_KW_PER_RACK),
    reclaimRacks: capReclaimed - cap,
    binding: (powerRacks <= r.rackPositions ? 'power' : 'space') as Binding,
    bindingReclaimed: (powerRacksReclaimed <= r.rackPositions ? 'power' : 'space') as Binding,
    fullDate: fullAt(r, plan, cap),
    fullDateReclaimed: fullAt(r, plan, capReclaimed),
    excessRacks,
    excessCapex: excessRacks * CAPEX_PER_RACK,
    /** Utilization in 12 months, on planned racks, if one cluster is lost. */
    clusterLossUtil: inUse12 / (supply(r.id, calMonth(AS_OF, 12), plan) - CLUSTER_SIZE),
    pue: r.pue,
    facilityKw: avgKw * r.pue,
    pueSavingsPerYear: Math.max(0, r.pue - PUE_TARGET) * avgKw * HOURS_PER_YEAR * POWER_COST_PER_KWH,
    pueFacilityKwSaved: Math.max(0, r.pue - PUE_TARGET) * avgKw,
  }
}

export type DcRegion = ReturnType<typeof dcRegion>

export function dcStats(plan: Plan, region = 'all') {
  const rows = regionsIn(region).map((r) => dcRegion(r, plan))
  const sum = (f: (x: DcRegion) => number) => rows.reduce((s, x) => s + f(x), 0)
  const racks = sum((x) => x.racks)
  const positions = sum((x) => x.positions)
  const budget = sum((x) => x.powerBudgetKw)
  const avgKw = sum((x) => x.avgKw)
  const facilityKw = sum((x) => x.facilityKw)
  const atRisk = rows.filter((x) => x.clusterLossUtil > FAILOVER_UTIL_LIMIT)
  return {
    rows,
    racks,
    positions,
    spaceUtil: racks / positions,
    budgetKw: budget,
    allocKw: sum((x) => x.allocKw),
    powerAllocPct: sum((x) => x.allocKw) / budget,
    avgKw,
    powerDrawPct: avgKw / budget,
    pue: facilityKw / avgKw,
    strandedKw: sum((x) => x.strandedKw),
    strandedPositions: sum((x) => x.strandedPositions),
    strandedPowerKw: sum((x) => x.strandedPowerKw),
    reclaimKw: sum((x) => x.reclaimKw),
    reclaimRacks: sum((x) => x.reclaimRacks),
    excessRacks: sum((x) => x.excessRacks),
    excessCapex: sum((x) => x.excessCapex),
    pueSavingsPerYear: sum((x) => x.pueSavingsPerYear),
    pueFacilityKwSaved: sum((x) => x.pueFacilityKwSaved),
    failoverAtRisk: atRisk,
    firstFull: rows.filter((x) => x.fullDate).sort((a, b) => a.fullDate!.getTime() - b.fullDate!.getTime())[0] ?? null,
  }
}

export interface TrendPoint {
  month: string
  /** Racks deployed (history) or planned (forecast). */
  racks: number
  /** Racks needed to keep utilization at 75%; forecast only. */
  required: number | null
  positions: number
  powerRacks: number
  powerRacksReclaimed: number
  space: number
  powerAlloc: number
  powerDraw: number
  util: number
}

/** Monthly space / power / utilization: `back` months of history and `fwd` months of forecast. */
export function dcTrend(plan: Plan, region = 'all', back = 12, fwd = 30): TrendPoint[] {
  const regs = regionsIn(region)
  const positions = regs.reduce((s, r) => s + r.rackPositions, 0)
  const budget = regs.reduce((s, r) => s + r.powerBudgetKw, 0)
  const base = new Map(regs.map((r) => [r.id, RACKS.filter((x) => x.region === r.id).reduce((s, x) => s + x.util, 0)]))
  const pts: TrendPoint[] = []
  for (let m = -back; m <= fwd; m++) {
    const d = m === 0 ? AS_OF : calMonth(AS_OF, m)
    let racks = 0
    let inUse = 0
    for (const r of regs) {
      if (m < 0) {
        const docked = RACKS.filter((x) => x.region === r.id && toDate(x.docked) <= d).length
        racks += docked
        // Back-cast racks in use with the region's growth rate, capped at what was docked.
        inUse += Math.min(docked * 0.95, base.get(r.id)! * Math.pow(1 + r.growth, m))
      } else {
        racks += supply(r.id, d, plan)
        inUse += demand(r.id, d, plan)
      }
    }
    pts.push({
      month: monthLabel(d),
      racks,
      required: m >= 0 ? inUse / T : null,
      positions,
      powerRacks: Math.floor(budget / KW_PER_RACK),
      powerRacksReclaimed: Math.floor(budget / RECLAIM_KW_PER_RACK),
      space: racks / positions,
      powerAlloc: (racks * KW_PER_RACK) / budget,
      powerDraw: drawKw(racks, inUse) / budget,
      util: inUse / racks,
    })
  }
  return pts
}
