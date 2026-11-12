import {
  AS_OF,
  CAPEX_PER_RACK,
  DOCK_TO_LIVE_WEEKS,
  DONOR_MAX_UTIL,
  EARLY_RETIRE_DATE,
  KW_PER_RACK,
  MOVE_WEEKS,
  ORDERS,
  ORDER_TO_DOCK_WEEKS,
  PLANNING_THRESHOLD,
  RACKS,
  REGIONS,
  REQUESTS,
  SWAP_RACKS_PER_MONTH,
  BRIDGE_BUFFER_MONTHS,
  USEFUL_LIFE_YEARS,
  continentOf,
  genById,
  regionById,
  type CapacityRequest,
  type GenId,
  type Rack,
} from '../data/fleet'

/* ------------------------------------------------------------------ */
/* Plan state                                                          */
/* ------------------------------------------------------------------ */

export type Strategy = 'gen11' | 'hybrid' | 'gen8'
export type DecomChoice = 'plan' | 'early' | 'noReplace'
export type ReqStatus = 'Pending' | 'Approved' | 'Phased' | 'Escalated' | 'Deferred' | 'Rejected'

export interface Move {
  id: string
  fromRegion: string
  toRegion: string
  racks: number
  live: string
}

export interface NewOrder {
  id: string
  region: string
  gen: GenId
  racks: number
  live: string
  reqId?: string
}

export interface Plan {
  strategy: Strategy
  /** Months Gen11 GA slips past plan. */
  gen11Slip: number
  decom: Record<string, DecomChoice>
  moves: Move[]
  orders: NewOrder[]
  requests: Record<string, ReqStatus>
  /** Racks committed now for a phased request (rest follows when capacity lands). */
  phasedRacks: Record<string, number>
}

export const DEFAULT_PLAN: Plan = { strategy: 'gen11', gen11Slip: 0, decom: {}, moves: [], orders: [], requests: {}, phasedRacks: {} }

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
export const T = PLANNING_THRESHOLD
export const LEAD_WEEKS = ORDER_TO_DOCK_WEEKS + DOCK_TO_LIVE_WEEKS
/** Usable capacity one new rack adds while staying under the planning line. */
export const USABLE_PER_RACK = T
export const toDate = (s: string) => new Date(s + 'T12:00:00')
export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
export const addWeeks = (d: Date, n: number) => addDays(d, n * 7)
export const addMonths = (d: Date, m: number) => addDays(d, m * 30.44)
export const monthsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (30.44 * DAY)
export const yearsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (365.25 * DAY)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthLabel = (d: Date) => `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
export const calMonth = (d: Date, m: number) => new Date(d.getFullYear(), d.getMonth() + m, 1, 12)

export const EARLIEST_LIVE = addWeeks(AS_OF, LEAD_WEEKS)
export const gen11Ga = (plan: Plan) => calMonth(toDate(genById('gen11').ga), plan.gen11Slip)
export const genForLive = (d: Date, plan: Plan): GenId => (d >= gen11Ga(plan) ? 'gen11' : 'gen8')
export const eolOf = (gen: GenId) => toDate(genById(gen).eol)
/** Book value of `racks` racks docked on `docked`, valued at `at`. */
export const nbv = (racks: number, docked: Date, at: Date) => racks * CAPEX_PER_RACK * Math.max(0, 1 - yearsBetween(docked, at) / USEFUL_LIFE_YEARS)

/* ------------------------------------------------------------------ */
/* Gen6 refresh schedule (per rack)                                    */
/* ------------------------------------------------------------------ */

export const STRATEGY_LABEL: Record<Strategy, string> = { gen11: 'Wait for Gen11', hybrid: 'Hybrid: pre-2022 racks on Gen8, rest Gen11', gen8: 'Bridge everything on Gen8' }

export interface Replacement {
  rack: Rack
  gen: GenId
  live: Date
  pastEolMonths: number
}

const GEN6 = RACKS.filter((r) => r.gen === 'gen6').sort((a, b) => a.docked.localeCompare(b.docked))

/** Rack-for-rack swaps of Gen6, oldest first, limited by fleet swap throughput. */
export function replacementSchedule(plan: Plan, strategy: Strategy = plan.strategy): Replacement[] {
  const racks = GEN6.filter((r) => (plan.decom[r.id] ?? 'plan') === 'plan')
  const isGen8 = (r: Rack) => strategy === 'gen8' || (strategy === 'hybrid' && r.docked < '2022-01-01')
  const eol = eolOf('gen6')
  // Gen8 bridge runs just in time: finish BRIDGE_BUFFER_MONTHS before EOL, but no earlier than racks can land.
  const n8Total = racks.filter(isGen8).length
  const jit = addMonths(eol, -(n8Total / SWAP_RACKS_PER_MONTH + BRIDGE_BUFFER_MONTHS))
  const earliest = calMonth(EARLIEST_LIVE, 1)
  const g8Start = jit > earliest ? jit : earliest
  const g11Start = gen11Ga(plan)
  let n8 = 0
  let n11 = 0
  return racks.map((rack) => {
    const gen: GenId = isGen8(rack) ? 'gen8' : 'gen11'
    const live = gen === 'gen8' ? addMonths(g8Start, ++n8 / SWAP_RACKS_PER_MONTH) : addMonths(g11Start, ++n11 / SWAP_RACKS_PER_MONTH)
    return { rack, gen, live, pastEolMonths: Math.max(0, monthsBetween(eol, live)) }
  })
}

/* ------------------------------------------------------------------ */
/* In-service intervals (cached per plan)                              */
/* ------------------------------------------------------------------ */

interface Span {
  region: string
  gen: GenId
  from: number
  to: number
  count: number
}

const spanCache = new WeakMap<Plan, Map<Strategy, { spans: Span[]; sched: Replacement[]; retire: Map<string, Date> }>>()

function model(plan: Plan, strategy: Strategy = plan.strategy) {
  let byStrat = spanCache.get(plan)
  if (!byStrat) spanCache.set(plan, (byStrat = new Map()))
  const hit = byStrat.get(strategy)
  if (hit) return hit

  const sched = replacementSchedule(plan, strategy)
  const replLive = new Map(sched.map((s) => [s.rack.id, s.live]))
  const retire = new Map<string, Date>()
  for (const r of RACKS) {
    const c = plan.decom[r.id] ?? 'plan'
    if (c === 'early') retire.set(r.id, toDate(EARLY_RETIRE_DATE))
    else if (r.gen === 'gen6' && c === 'plan') retire.set(r.id, replLive.get(r.id)!)
    else retire.set(r.id, eolOf(r.gen))
  }

  // Moves take the lowest-utilization Gen8 racks from the donor region.
  const movedTo = new Map<string, { toRegion: string; live: number }>()
  for (const m of plan.moves) {
    const pool = RACKS.filter((r) => r.region === m.fromRegion && r.gen === 'gen8' && !movedTo.has(r.id)).sort((a, b) => a.util - b.util)
    for (const r of pool.slice(0, m.racks)) movedTo.set(r.id, { toRegion: m.toRegion, live: toDate(m.live).getTime() })
  }

  const spans: Span[] = []
  const now = AS_OF.getTime()
  for (const r of RACKS) {
    const from = toDate(r.docked).getTime()
    const to = retire.get(r.id)!.getTime()
    const mv = movedTo.get(r.id)
    if (mv) {
      spans.push({ region: r.region, gen: r.gen, from, to: Math.min(to, now), count: 1 })
      spans.push({ region: mv.toRegion, gen: r.gen, from: mv.live, to, count: 1 })
    } else spans.push({ region: r.region, gen: r.gen, from, to, count: 1 })
  }
  for (const s of sched) spans.push({ region: s.rack.region, gen: s.gen, from: s.live.getTime(), to: eolOf(s.gen).getTime(), count: 1 })
  for (const o of [...ORDERS, ...plan.orders]) spans.push({ region: o.region, gen: o.gen, from: toDate(o.live).getTime(), to: eolOf(o.gen).getTime(), count: o.racks })

  const out = { spans, sched, retire }
  byStrat.set(strategy, out)
  return out
}

export const retireDate = (r: Rack, plan: Plan) => model(plan).retire.get(r.id)!

/* ------------------------------------------------------------------ */
/* Supply, demand, power                                               */
/* ------------------------------------------------------------------ */

const inRegion = (region: string, r: string) => region === 'all' || region === r

export function racksByGen(region: string, d: Date, plan: Plan, strategy?: Strategy): Record<GenId, number> {
  const out: Record<GenId, number> = { gen6: 0, gen8: 0, gen11: 0 }
  const t = d.getTime()
  for (const s of model(plan, strategy).spans) if (s.from <= t && t < s.to && inRegion(region, s.region)) out[s.gen] += s.count
  return out
}

export const totalRacks = (r: Record<GenId, number>) => r.gen6 + r.gen8 + r.gen11
export const supply = (region: string, d: Date, plan: Plan) => totalRacks(racksByGen(region, d, plan))
export const powerUsed = (region: string, d: Date, plan: Plan) => totalRacks(racksByGen(region, d, plan)) * KW_PER_RACK
export const powerBudget = (region: string) => REGIONS.filter((r) => inRegion(region, r.id)).reduce((s, r) => s + r.powerBudgetKw, 0)
export const freePowerRacks = (region: string, d: Date, plan: Plan) => Math.floor((powerBudget(region) - powerUsed(region, d, plan)) / KW_PER_RACK)

const BASE = new Map(REGIONS.map((r) => [r.id, RACKS.filter((x) => x.region === r.id).reduce((s, x) => s + x.util, 0)]))
export const baseRacks = (region: string) => REGIONS.filter((r) => inRegion(region, r.id)).reduce((s, r) => s + BASE.get(r.id)!, 0)

/** Racks a request consumes once its need-by date passes. */
export function committedRacks(req: CapacityRequest, plan: Plan) {
  const s = plan.requests[req.id]
  if (s === 'Approved') return req.racks
  if (s === 'Phased') return plan.phasedRacks[req.id] ?? 0
  return 0
}

export function demand(region: string, d: Date, plan: Plan, opts: { exclude?: string; growth?: number; extra?: number } = {}) {
  const m = Math.max(0, monthsBetween(AS_OF, d))
  let total = 0
  for (const r of REGIONS) {
    if (!inRegion(region, r.id)) continue
    const g = opts.growth !== undefined && region !== 'all' ? opts.growth : r.growth
    total += BASE.get(r.id)! * Math.pow(1 + g, m)
  }
  for (const req of REQUESTS) {
    if (req.id === opts.exclude || !inRegion(region, req.region) || toDate(req.neededBy) > d) continue
    total += committedRacks(req, plan)
  }
  return total + (opts.extra ?? 0)
}

/* ------------------------------------------------------------------ */
/* Forecast & regional status                                          */
/* ------------------------------------------------------------------ */

export interface ForecastPoint {
  date: Date
  month: string
  gen6: number
  gen8: number
  gen11: number
  supply: number
  usable: number
  demand: number
  required: number
}

export function forecast(region: string, plan: Plan, months = 12, opts: { growth?: number; extra?: number } = {}) {
  const pts: ForecastPoint[] = []
  for (let m = 0; m <= months; m++) {
    const date = m === 0 ? AS_OF : calMonth(AS_OF, m)
    const r = racksByGen(region, date, plan)
    const s = totalRacks(r)
    const dm = demand(region, date, plan, opts)
    pts.push({ date, month: monthLabel(date), gen6: r.gen6, gen8: r.gen8, gen11: r.gen11, supply: s, usable: s * T, demand: dm, required: dm / T })
  }
  return pts
}

/** Index of the first forecast month where provisioned racks exceed 75% of capacity. */
export const firstOver = (pts: ForecastPoint[]) => {
  const i = pts.findIndex((p) => p.demand > p.usable)
  return i === -1 ? null : i
}

export type RegionStatus = 'risk' | 'watch' | 'healthy' | 'under'
export const STATUS_LABEL: Record<RegionStatus, string> = { risk: 'Hits 75% < 6 mo', watch: 'Hits 75% < 12 mo', healthy: 'Healthy', under: 'Underutilized' }

export function regionStats(plan: Plan, region = 'all') {
  return REGIONS.filter((r) => inRegion(region, r.id)).map((r) => {
    const pts = forecast(r.id, plan, 12)
    const now = pts[0]
    const over = firstOver(pts)
    const util = now.demand / now.supply
    const status: RegionStatus = over !== null && over <= 6 ? 'risk' : over !== null ? 'watch' : util < 0.45 ? 'under' : 'healthy'
    return {
      id: r.id,
      name: r.name,
      supply: now.supply,
      provisioned: now.demand,
      util,
      util6: pts[6].demand / pts[6].supply,
      util12: pts[12].demand / pts[12].supply,
      racks: racksByGen(r.id, AS_OF, plan),
      powerUsed: powerUsed(r.id, AS_OF, plan),
      powerBudget: r.powerBudgetKw,
      over,
      overDate: over === null ? null : pts[over].date,
      status,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Build plan                                                          */
/* ------------------------------------------------------------------ */

export function buildPlan(region: string, plan: Plan, opts: { horizon?: number; growth?: number; extra?: number } = {}) {
  const pts = forecast(region, plan, opts.horizon ?? 12, opts)
  const needRacks = Math.max(0, ...pts.map((p) => p.required - p.supply))
  const racks = Math.ceil(needRacks)
  const over = firstOver(pts)
  const liveBy = over === null ? null : pts[over].date
  const dockBy = liveBy ? addWeeks(liveBy, -DOCK_TO_LIVE_WEEKS) : null
  const orderBy = dockBy ? addWeeks(dockBy, -ORDER_TO_DOCK_WEEKS) : null
  const landing = liveBy && liveBy > EARLIEST_LIVE ? liveBy : EARLIEST_LIVE
  const gen = genForLive(landing, plan)
  const powerRacks = Math.min(...pts.filter((p) => p.date >= landing).map((p) => freePowerRacks(region, p.date, plan)), freePowerRacks(region, landing, plan))
  return {
    region,
    pts,
    over,
    liveBy,
    dockBy,
    orderBy,
    overdue: !!orderBy && orderBy < AS_OF,
    needRacks,
    racks,
    gen,
    kwNeeded: racks * KW_PER_RACK,
    powerRacks: Math.max(0, powerRacks),
    powerShortRacks: Math.max(0, racks - Math.max(0, powerRacks)),
    capex: racks * CAPEX_PER_RACK,
    writeOffAtEol: gen === 'gen8' ? nbv(racks, landing, eolOf('gen8')) : 0,
  }
}
export type BuildPlan = ReturnType<typeof buildPlan>

/* ------------------------------------------------------------------ */
/* Rebalancing (separate from request approval)                        */
/* ------------------------------------------------------------------ */

export function rebalanceOptions(plan: Plan, region = 'all') {
  const out: { from: string; to: string; racks: number; live: Date; move: Move }[] = []
  for (const to of REGIONS.filter((r) => inRegion(region, r.id))) {
    const bp = buildPlan(to.id, plan)
    if (!bp.racks) continue
    const powerRacks = Math.min(freePowerRacks(to.id, addWeeks(AS_OF, MOVE_WEEKS), plan), bp.powerRacks)
    if (powerRacks <= 0) continue
    for (const from of REGIONS.filter((r) => r.id !== to.id && continentOf(r.id) === continentOf(to.id))) {
      let removable = Infinity
      for (let m = 0; m <= 12; m++) {
        const d = calMonth(AS_OF, m)
        removable = Math.min(removable, supply(from.id, d, plan) - demand(from.id, d, plan) / DONOR_MAX_UTIL)
      }
      const gen8 = racksByGen(from.id, AS_OF, plan).gen8
      const racks = Math.min(Math.floor(removable), bp.racks, powerRacks, Math.floor(gen8 * 0.5))
      if (racks < 5) continue
      const live = addWeeks(AS_OF, MOVE_WEEKS)
      out.push({ from: from.id, to: to.id, racks, live, move: { id: `MV-${from.id}-${to.id}`, fromRegion: from.id, toRegion: to.id, racks, live: iso(live) } })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Capacity request decisions                                          */
/* ------------------------------------------------------------------ */

export type Verdict = 'fits' | 'order' | 'phase' | 'escalate' | 'defer'
export const VERDICT_LABEL: Record<Verdict, string> = {
  fits: 'Approve: fits today',
  order: 'Approve: order racks',
  phase: 'Phase it',
  escalate: 'Escalate for power',
  defer: 'Defer',
}

export interface Decision {
  req: CapacityRequest
  verdict: Verdict
  headroom: number
  reasons: string[]
  calc: { label: string; formula: string; result: string }[]
  order?: NewOrder & { orderBy: Date; writeOff: number }
  nowRacks?: number
  laterDate?: Date
  powerShortRacks?: number
}

function minHeadroom(region: string, needBy: Date, plan: Plan, exclude?: string) {
  const start = needBy < AS_OF ? AS_OF : needBy
  let min = Infinity
  for (let m = 0; m <= 3; m++) {
    const d = addMonths(start, m)
    min = Math.min(min, supply(region, d, plan) * T - demand(region, d, plan, { exclude }))
  }
  return min
}

const k = (n: number) => Math.round(n).toLocaleString()
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`)
/** "1 rack", "12 racks" */
const rk = (n: number) => `${Math.round(n).toLocaleString()} rack${Math.round(n) === 1 ? '' : 's'}`
/** Power for n racks: kW below 1 MW, MW above. */
const pw = (racks: number) => (racks * KW_PER_RACK >= 1000 ? `${((racks * KW_PER_RACK) / 1000).toFixed(1)} MW` : `${racks * KW_PER_RACK} kW`)

export function decideRequest(req: CapacityRequest, fullPlan: Plan): Decision {
  // Evaluate as if undecided.
  const plan: Plan = { ...fullPlan, orders: fullPlan.orders.filter((o) => o.reqId !== req.id), requests: { ...fullPlan.requests, [req.id]: 'Pending' } }
  const reg = regionById(req.region)
  const needBy = toDate(req.neededBy)
  const h = minHeadroom(req.region, needBy, plan, req.id)
  const calc: Decision['calc'] = [{ label: 'Headroom', formula: `racks deployed × ${T * 100}% − forecast racks in use, need-by through +3 months`, result: `${rk(h)}` }]
  const base = { req, headroom: h, calc }

  if (req.racks <= h) return { ...base, verdict: 'fits', reasons: [`${reg.name} has ${rk(h)} of headroom; ${req.customer} needs ${req.racks}.`] }

  const short = req.racks - h
  const racks = Math.ceil(short / USABLE_PER_RACK)
  calc.push({ label: 'Racks needed', formula: `(${k(req.racks)} requested − ${k(Math.max(0, h))} headroom) ÷ ${T * 100}% planning line`, result: rk(racks) })
  const landing = needBy > EARLIEST_LIVE ? needBy : EARLIEST_LIVE
  const powerRacks = Math.max(0, freePowerRacks(req.region, landing, plan))
  calc.push({ label: 'Power', formula: `${(reg.powerBudgetKw / 1000).toFixed(1)} MW budget − racks in service × 10 kW`, result: `${rk(powerRacks)} free` })
  const gen = genForLive(landing, plan)
  const orderBy = addWeeks(landing, -LEAD_WEEKS)
  const mkOrder = (n: number): Decision['order'] => {
    const writeOff = gen === 'gen8' ? nbv(n, landing, eolOf('gen8')) : 0
    return { id: `PO-${req.id.slice(4)}`, region: req.region, gen, racks: n, live: iso(landing), reqId: req.id, orderBy, writeOff }
  }
  const gname = genById(gen).name
  const woNote = (o: NonNullable<Decision['order']>) =>
    gen === 'gen8' ? `Gen11 isn't GA until ${monthLabel(gen11Ga(plan))}, so it's Gen8. Gen8 EOL is Dec '32, leaving ${usd(o.writeOff)} of book value to write off.` : ''

  if (racks <= powerRacks && EARLIEST_LIVE <= needBy) {
    const o = mkOrder(racks)!
    calc.push({ label: 'Order by', formula: `need-by − ${LEAD_WEEKS} weeks (${ORDER_TO_DOCK_WEEKS} order→dock + ${DOCK_TO_LIVE_WEEKS} dock→live)`, result: monthLabel(orderBy) })
    if (o.writeOff) calc.push({ label: 'Write-off at Gen8 EOL', formula: `${racks} × $200K × (1 − age at Dec '32 ÷ 6 y)`, result: usd(o.writeOff) })
    return { ...base, verdict: 'order', order: o, reasons: [`${h >= 1 ? `Headroom covers ${rk(h)}; the other ${k(short)}` : `No headroom left; all ${k(req.racks)}`} need ${rk(racks)} of new capacity to stay at ${T * 100}%: order ${racks} ${gname} by ${monthLabel(orderBy)} (${usd(racks * CAPEX_PER_RACK)}, ${pw(racks)}).`, woNote(o)].filter(Boolean) }
  }

  const nowRacks = Math.max(0, Math.floor(h + Math.min(racks, powerRacks) * USABLE_PER_RACK))
  if (racks > powerRacks) {
    const shortRacks = racks - powerRacks
    calc.push({ label: 'Power short', formula: `${racks} − ${powerRacks}`, result: `${rk(shortRacks)} (${pw(shortRacks)})` })
    if (nowRacks > 0) {
      const o = powerRacks > 0 ? mkOrder(powerRacks) : undefined
      return {
        ...base,
        verdict: 'phase',
        order: o,
        nowRacks: Math.min(nowRacks, req.racks),
        powerShortRacks: shortRacks,
        reasons: [
          `${reg.name} has power for ${powerRacks} more racks. Approve ${rk(Math.min(nowRacks, req.racks))} now${o ? ` (order ${powerRacks} ${gname} by ${monthLabel(orderBy)})` : ''}.`,
          `The remaining ${rk(req.racks - Math.min(nowRacks, req.racks))} need ${pw(shortRacks)} more power. Escalate.`,
        ],
      }
    }
    return {
      ...base,
      verdict: 'escalate',
      powerShortRacks: shortRacks,
      reasons: [`${reg.name} is out of power: ${rk(powerRacks)} free, ${racks} needed.`, `Escalate for ${pw(shortRacks)} before committing to ${req.customer}.`],
    }
  }

  // Power is fine but racks can't land by the need-by date.
  if (nowRacks > 0 && h > 0) {
    const o = mkOrder(racks)!
    return {
      ...base,
      verdict: 'phase',
      order: o,
      nowRacks: Math.floor(h),
      laterDate: EARLIEST_LIVE,
      reasons: [`Approve ${rk(h)} now from headroom.`, `The rest lands ${monthLabel(EARLIEST_LIVE)}: order ${racks} ${gname} now.`],
    }
  }
  return { ...base, verdict: 'defer', laterDate: EARLIEST_LIVE, reasons: [`No headroom, and new racks can't land before ${monthLabel(EARLIEST_LIVE)}. Offer that date.`] }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export type RackRec = 'Replace before EOL' | "Don't replace at EOL" | "Move, don't write off" | 'Keep to EOL'

export interface RackRow {
  rack: Rack
  age: number
  bookValue: number
  eol: Date
  retire: Date
  replacement?: Replacement
  writeOff: number
  rec: RackRec
  choice: DecomChoice
}

/** One row per rack. Region-level spare capacity is computed once, then given to the least-utilized racks. */
export function rackRows(plan: Plan): RackRow[] {
  const m = model(plan)
  const repl = new Map(m.sched.map((s) => [s.rack.id, s]))
  const stats = regionStats(plan)
  const spareRacks = new Map<string, number>()
  for (const r of REGIONS) {
    let spare = Infinity
    for (let i = 0; i <= 24; i += 3) {
      const d = calMonth(AS_OF, i)
      spare = Math.min(spare, supply(r.id, d, plan) * T - demand(r.id, d, plan))
    }
    spareRacks.set(r.id, Math.max(0, Math.floor(spare / USABLE_PER_RACK)))
  }
  // Racks already leaving without replacement count toward that spare.
  for (const r of RACKS) if ((plan.decom[r.id] ?? 'plan') !== 'plan' && r.gen === 'gen6') spareRacks.set(r.region, spareRacks.get(r.region)! + 1)
  const retireNoReplace = new Set<string>()
  for (const r of REGIONS) {
    const gen6 = RACKS.filter((x) => x.region === r.id && x.gen === 'gen6').sort((a, b) => a.util - b.util)
    for (const x of gen6.slice(0, spareRacks.get(r.id))) retireNoReplace.add(x.id)
  }
  return RACKS.map((rack) => {
    const docked = toDate(rack.docked)
    const retire = m.retire.get(rack.id)!
    const choice = plan.decom[rack.id] ?? 'plan'
    const under = stats.find((s) => s.id === rack.region)!.status === 'under'
    let rec: RackRec
    if (rack.gen === 'gen6') rec = retireNoReplace.has(rack.id) ? "Don't replace at EOL" : 'Replace before EOL'
    else rec = under && rack.util < 0.4 ? "Move, don't write off" : 'Keep to EOL'
    return { rack, age: yearsBetween(docked, AS_OF), bookValue: nbv(1, docked, AS_OF), eol: eolOf(rack.gen), retire, replacement: repl.get(rack.id), writeOff: nbv(1, docked, retire), rec, choice }
  })
}

export function strategyMetrics(plan: Plan, strategy: Strategy) {
  const { sched } = model(plan, strategy)
  const gen8 = sched.filter((r) => r.gen === 'gen8')
  const gen11 = sched.filter((r) => r.gen === 'gen11')
  const past = sched.filter((r) => r.pastEolMonths > 0)
  const last = sched.reduce<Date | null>((a, r) => (!a || r.live > a ? r.live : a), null)
  const first = sched.reduce<Date | null>((a, r) => (!a || r.live < a ? r.live : a), null)
  return {
    strategy,
    gen8Racks: gen8.length,
    gen11Racks: gen11.length,
    lastLive: last,
    bufferMonths: last ? monthsBetween(last, eolOf('gen6')) : 0,
    pastEolRacks: past.length,
    pastEolRackMonths: past.reduce((s, r) => s + r.pastEolMonths, 0),
    gen6WriteOff: sched.reduce((s, r) => s + nbv(1, toDate(r.rack.docked), r.live), 0),
    gen8WriteOff: gen8.reduce((s, r) => s + nbv(1, r.live, eolOf('gen8')), 0),
    capex: sched.length * CAPEX_PER_RACK,
    firstOrderBy: first ? addWeeks(first, -LEAD_WEEKS) : null,
    refreshAgain: gen8.length,
  }
}
export type StrategyMetrics = ReturnType<typeof strategyMetrics>

/** Quarterly racks by generation, with racks needed over the 24-month forecast window. */
export function roadmap(region: string, plan: Plan, from = '2025-01-01', to = '2033-12-31') {
  const horizon = calMonth(AS_OF, 24)
  const pts: { q: string; date: Date; gen6: number; gen8: number; gen11: number; required: number | null }[] = []
  for (let d = toDate(from); d <= toDate(to); d = calMonth(d, 3)) {
    const r = racksByGen(region, d, plan)
    pts.push({ q: `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`, date: d, ...r, required: d <= horizon ? demand(region, d, plan) / T : null })
  }
  return pts
}

/* ------------------------------------------------------------------ */
/* KPIs & decisions                                                    */
/* ------------------------------------------------------------------ */

export function fleetKpis(plan: Plan, region = 'all') {
  const racks = racksByGen(region, AS_OF, plan)
  const total = totalRacks(racks)
  const cap = total
  const prov = demand(region, AS_OF, plan)
  const open = REQUESTS.filter((r) => inRegion(region, r.region) && (plan.requests[r.id] ?? 'Pending') === 'Pending')
  return {
    racks,
    total,
    capacity: cap,
    provisioned: prov,
    util: prov / cap,
    kwUsed: total * KW_PER_RACK,
    kwBudget: powerBudget(region),
    openRequests: open.length,
    openRacks: open.reduce((s, r) => s + r.racks, 0),
    gen6MonthsToEol: monthsBetween(AS_OF, eolOf('gen6')),
  }
}

/** What's deployed today, broken down by generation, region and dock year. */
export function fleetBreakdown(plan: Plan, region = 'all') {
  const racks = RACKS.filter((r) => inRegion(region, r.region))
  const byGen = (['gen6', 'gen8'] as GenId[]).map((g) => {
    const rs = racks.filter((r) => r.gen === g)
    return {
      gen: genById(g),
      racks: rs.length,
      nics: rs.length,
      provisioned: rs.reduce((s, r) => s + r.util, 0),
      mw: (rs.length * KW_PER_RACK) / 1000,
      bookValue: rs.reduce((s, r) => s + nbv(1, toDate(r.docked), AS_OF), 0),
      eol: eolOf(g),
    }
  })
  const years = [...new Set(racks.map((r) => r.docked.slice(0, 4)))].sort()
  const byYear = years.map((y) => ({ year: y, gen6: racks.filter((r) => r.gen === 'gen6' && r.docked.startsWith(y)).length, gen8: racks.filter((r) => r.gen === 'gen8' && r.docked.startsWith(y)).length }))
  const pending = [...ORDERS, ...plan.orders].filter((o) => inRegion(region, o.region) && toDate(o.live) > AS_OF)
  return { byGen, byYear, pendingRacks: pending.reduce((s, o) => s + o.racks, 0), pendingOrders: pending.length }
}
