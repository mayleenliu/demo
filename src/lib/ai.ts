// Deterministic "simulated AI" recommendation engine.
// Every number in a response is computed from the in-app synthetic dataset; no external LLM is called.

import { AS_OF, CAPACITY_THRESHOLD, INVENTORY, REGIONS, regionById, workloadById } from '../data/model'
import type { Initiative } from '../data/program'
import {
  OPPORTUNITIES,
  LOW_CONFIDENCE,
  RIGHTSIZE_TARGET,
  filterOpps,
  filterRows,
  forecastUsed,
  regionComputeBaseline,
  regionStats,
  simulate,
  sum,
  type Filters,
  type Level,
  type OppStatus,
  type Opportunity,
} from './calc'
import { addMonths, fmtDate, fmtNum, fmtPct, fmtUSD } from './format'
import { crossTeamDependencies, nextMilestone, programFinancials, programHealth, upcomingDecisions } from './program'

export type WorkflowId = 'efficiency' | 'capacity' | 'executive' | 'prioritize' | 'unknown'

export interface Section {
  heading: string
  text?: string
  bullets?: string[]
  table?: { columns: string[]; rows: (string | number)[][] }
  callout?: { tone: 'risk' | 'info' | 'ok'; text: string }
}

export interface AIResponse {
  id: string
  workflow: WorkflowId
  question: string
  title: string
  summary: string
  sections: Section[]
  sourceMetrics: { label: string; value: string; source: string }[]
  calculations: { label: string; formula: string; result: string }[]
  assumptions: string[]
  confidence: number
  confidenceNote: string
  dataSources: string[]
  scope: string
  /** Opportunity ids the user may push into the human approval workflow. */
  actionableOppIds?: string[]
}

export interface AIContext {
  filters: Filters
  oppStatus: Record<string, OppStatus>
  initiatives: Initiative[]
}

export const SUGGESTED_PROMPTS: { workflow: WorkflowId; label: string; prompt: string }[] = [
  { workflow: 'efficiency', label: 'Efficiency analysis', prompt: 'Where are our biggest infrastructure efficiency opportunities?' },
  { workflow: 'capacity', label: 'Capacity planning', prompt: 'Will US East have sufficient capacity over the next six months?' },
  { workflow: 'executive', label: 'Executive update', prompt: "Generate an executive update for this month's capacity optimization program." },
  { workflow: 'prioritize', label: 'Prioritization', prompt: 'Which three initiatives should we prioritize this quarter?' },
]

export function detectWorkflow(q: string): WorkflowId {
  const s = q.toLowerCase()
  if (/(executive|exec update|status update|report|summary for leadership|update for)/.test(s)) return 'executive'
  if (/(prioriti|which three|top three|rank|this quarter|focus on)/.test(s)) return 'prioritize'
  if (/(capacity|sufficient|run out|exhaust|headroom|enough|forecast)/.test(s) && !/(efficien|waste|sav)/.test(s)) return 'capacity'
  if (/(efficien|opportunit|waste|saving|cost|underutil|idle|overprovision)/.test(s)) return 'efficiency'
  if (REGIONS.some((r) => s.includes(r.name.toLowerCase()))) return 'capacity'
  return 'unknown'
}

function detectRegion(q: string, fallback: string): string {
  const s = q.toLowerCase()
  const exact = REGIONS.find((r) => s.includes(r.name.toLowerCase()) || s.includes(r.id))
  if (exact) return exact.id
  if (/\beast\b/.test(s) && /\bus\b/.test(s)) return 'us-east'
  if (/\bwest\b/.test(s) && /\bus\b/.test(s)) return 'us-west'
  if (/(apac|asia|singapore|southeast)/.test(s)) return 'ap-southeast'
  if (/(frankfurt|central)/.test(s)) return 'eu-central'
  if (/(ireland|eu west|europe)/.test(s)) return 'eu-west'
  return fallback
}

function scopeLabel(f: Filters) {
  const parts = [
    f.region === 'all' ? 'all regions' : regionById(f.region).name,
    f.type === 'all' ? 'all infra types' : f.type,
    f.workload === 'all' ? 'all workloads' : workloadById(f.workload).short,
  ]
  return parts.join(' · ')
}

const LEVEL_SCORE: Record<Level, number> = { Low: 1, Medium: 0.6, High: 0.25 }

const NEXT_STEPS: Record<Opportunity['category'], string[]> = {
  'Underutilized compute': ['Confirm 90-day p95/p99 with workload owner', 'Lower autoscaling floor in canary AZ', 'Bin-pack and release surplus at next reservation renewal'],
  'Storage inefficiency': ['Confirm legal-hold / retention exclusions', 'Apply lifecycle policy to a pilot prefix', 'Verify tier transition costs in next billing cycle'],
  'Networking inefficiency': ['Validate failover (AZ-evacuation) peak with SRE', 'Prepare renewal brief for Procurement', 'Reduce commitment at renewal'],
  'Stranded capacity': ['Identify region-agnostic batch / training jobs', 'Run data-residency & egress review', 'Pilot migration of one job family'],
}

let seq = 0
const rid = () => `r-${Date.now().toString(36)}-${(seq++).toString(36)}`

/* ---------------- Workflow 1: efficiency analysis ---------------- */
function efficiency(q: string, ctx: AIContext): AIResponse {
  const f = ctx.filters
  const scoped = filterOpps(f)
  const opps = scoped.filter((o) => ['Proposed', 'Under Review', 'Approved'].includes(ctx.oppStatus[o.id]))
  const inFlight = scoped.filter((o) => ctx.oppStatus[o.id] === 'In Progress')
  const inFlightSavings = inFlight.reduce((s, o) => s + o.monthlySavings, 0)
  const rows = filterRows(f)
  const spend = sum(rows, 'monthlyCost')
  const cap = rows.filter((r) => r.type === 'compute')
  const top = [...opps].sort((a, b) => b.monthlySavings - a.monthlySavings).slice(0, 3)
  const totalSavings = opps.reduce((s, o) => s + o.monthlySavings, 0)
  const byCat = new Map<string, number>()
  opps.forEach((o) => byCat.set(o.category, (byCat.get(o.category) ?? 0) + o.monthlySavings))

  if (!top.length) {
    return base(q, 'efficiency', 'No untapped efficiency opportunities in this scope', 'Every opportunity in this scope is already in execution or completed. Broaden the filters to analyze more of the fleet.', ctx, {
      confidence: 0.9,
    })
  }

  const conf = top.reduce((s, o) => s + o.confidence * o.monthlySavings, 0) / top.reduce((s, o) => s + o.monthlySavings, 0)
  const sections: Section[] = top.map((o, i) => ({
    heading: `${i + 1}. ${o.title}`,
    bullets: [
      `Why it's inefficient: ${o.observedUtil} on ${o.currentConfig}.${o.category === 'Underutilized compute' ? ` Target is ${RIGHTSIZE_TARGET * 100}% utilization.` : ''}`,
      `Proposed: ${o.proposed}.`,
      `Expected savings: ${fmtUSD(o.monthlySavings)}/mo (${fmtUSD(o.monthlySavings * 12)}/yr) · confidence ${fmtPct(o.confidence, 0)}${o.confidence < LOW_CONFIDENCE ? ' ⚠ low — investigate before approval' : ''}.`,
      `Risks: ${o.risk} implementation risk, ${o.effort.toLowerCase()} effort. ${o.considerations}`,
      `Next steps: ${NEXT_STEPS[o.category].join(' → ')}.`,
    ],
  }))
  sections.push({
    heading: 'Opportunity mix in scope',
    table: {
      columns: ['Category', 'Monthly savings', 'Share'],
      rows: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, fmtUSD(v), fmtPct(v / totalSavings, 0)]),
    },
  })
  sections.push({
    heading: 'Recommended next steps',
    bullets: [
      `Move the top ${top.length} opportunities to "Under Review" and assign engineering owners this week.`,
      `Ask Finance to validate the ${fmtUSD(top.reduce((s, o) => s + o.monthlySavings, 0))}/mo estimate against billing before approval.`,
      'Bundle same-region compute items into a single rightsizing program to share rollout and SLO guardrails.',
    ],
  })

  return {
    id: rid(),
    workflow: 'efficiency',
    question: q,
    title: 'Top infrastructure efficiency opportunities',
    summary: `Across ${scopeLabel(f)}, I found ${opps.length} opportunities not yet in execution, worth ${fmtUSD(totalSavings)}/mo (${fmtPct(totalSavings / spend)} of ${fmtUSD(spend)} monthly spend). The three largest — ${top.map((o) => o.title).join('; ')} — account for ${fmtUSD(top.reduce((s, o) => s + o.monthlySavings, 0))}/mo.${inFlight.length ? ` A further ${fmtUSD(inFlightSavings)}/mo across ${inFlight.length} item(s) is already in execution and excluded.` : ''}`,
    sections,
    sourceMetrics: [
      { label: 'Monthly spend in scope', value: fmtUSD(spend), source: 'Billing: monthly cost allocation' },
      { label: 'Compute utilization', value: cap.length ? fmtPct(sum(cap, 'used') / sum(cap, 'provisioned')) : 'n/a', source: 'Utilization telemetry' },
      { label: 'Opportunities not yet in execution', value: String(opps.length), source: 'Opportunity pipeline' },
      { label: 'Already in execution', value: `${inFlight.length} · ${fmtUSD(inFlightSavings)}/mo`, source: 'Opportunity pipeline' },
      ...top.map((o) => ({ label: `${o.title} — observed`, value: fmtPct(o.observedUtilValue), source: o.sources[1] ?? o.sources[0] })),
    ],
    calculations: top.flatMap((o) => o.calc.map((c) => ({ ...c, label: `${o.title} · ${c.label}` }))),
    assumptions: [
      `Rightsizing targets ${RIGHTSIZE_TARGET * 100}% steady-state utilization, preserving headroom for AZ failover.`,
      'Unit prices are held flat at current blended rates; savings are realized only after reservations roll off.',
      'Savings estimates include haircuts for reservation lock-in, egress and migration effort.',
      'Utilization is measured as 90-day p95; seasonality beyond 90 days is not captured.',
    ],
    confidence: conf,
    confidenceNote: 'Savings-weighted mean of per-opportunity confidence (driven by 90-day utilization volatility).',
    dataSources: ['Inventory', 'Utilization telemetry (90-day p95)', 'Billing: monthly cost allocation', 'Opportunity pipeline'],
    scope: scopeLabel(f),
    actionableOppIds: top.map((o) => o.id),
  }
}

/* ---------------- Workflow 2: capacity planning ---------------- */
function capacity(q: string, ctx: AIContext): AIResponse {
  const regionId = detectRegion(q, ctx.filters.region === 'all' ? 'us-east' : ctx.filters.region)
  const reg = regionById(regionId)
  const b = regionComputeBaseline(regionId)
  const sim6 = simulate({ region: regionId, demandAdj: 0, growth: b.growth, threshold: CAPACITY_THRESHOLD, horizon: 6, optimizeFirst: false })
  const util = b.used / b.provisioned
  const f6 = b.used * Math.pow(1 + b.growth, 6)
  const crossM = sim6.crossMonth
  const exhaustM = Math.log(b.provisioned / b.used) / Math.log(1 + b.growth)
  const crossDate = crossM === null ? null : addMonths(crossM)
  const exhaustDate = addMonths(exhaustM)
  const needUnits = Math.max(0, Math.ceil(f6 / CAPACITY_THRESHOLD - b.provisioned))
  const sufficient = needUnits === 0
  const orderBy = crossM === null ? null : addMonths(Math.max(0, crossM - b.leadTime))

  // Supply options.
  const reclaim = b.reclaimable
  const donors = REGIONS.filter((r) => r.id !== regionId)
    .map((r) => {
      const rows = INVENTORY.filter((x) => x.region === r.id && x.type === 'compute')
      const f6u = rows.reduce((s, x) => s + forecastUsed(x, 6), 0) / sum(rows, 'provisioned')
      const spare = Math.max(0, sum(rows, 'provisioned') * CAPACITY_THRESHOLD - rows.reduce((s, x) => s + forecastUsed(x, 6), 0))
      return { r, f6u, spare, residencyBlocked: r.id.startsWith('eu') !== regionId.startsWith('eu') }
    })
    .filter((d) => d.spare > 100)
  const eligibleDonors = donors.filter((d) => !d.residencyBlocked)
  const portable = b.used * (b.aiShare + 0.1) // AI training + part of batch is region-agnostic
  const realloc = Math.min(portable * 0.5, eligibleDonors.reduce((s, d) => s + d.spare, 0))
  const buyUnits = Math.max(0, needUnits - reclaim - realloc)

  const opts: (string | number)[][] = [
    ['Rightsize in-region fleets', fmtNum(reclaim), '≈ $0 (saves spend)', '4–8 weeks', 'Low–Med: Tier 0 latency guardrails'],
    ['Reallocate portable batch / AI jobs', fmtNum(realloc), fmtUSD(realloc * b.unitCost * 0.25) + '/mo egress', '6–10 weeks', 'Med: data residency, egress, job latency'],
    ['Purchase new capacity', fmtNum(needUnits), fmtUSD(needUnits * b.unitCost) + '/mo', `${b.leadTime} mo lead time`, 'Low technical; High financial commitment'],
    ['Demand shaping (defer / off-peak batch)', fmtNum(b.used * 0.04), '≈ $0', '2–4 weeks', 'Med: slower pipelines for data consumers'],
  ]

  const sections: Section[] = [
    {
      heading: 'Assessment',
      callout: sufficient
        ? { tone: 'ok', text: `${reg.name} stays under the ${CAPACITY_THRESHOLD * 100}% threshold through ${fmtDate(addMonths(6))} (forecast ${fmtPct(f6 / b.provisioned)}).` }
        : { tone: 'risk', text: `${reg.name} ${crossM === 0 ? 'is already above' : `crosses`} the ${CAPACITY_THRESHOLD * 100}% planning threshold${crossDate && crossM! > 0 ? ` around ${fmtDate(crossDate)}` : ''}, and ${exhaustM <= 0 ? 'is at' : 'reaches'} 100% physical capacity ${exhaustM <= 0 ? 'now' : `around ${fmtDate(exhaustDate)}`}. Additional ${fmtNum(needUnits)} units are needed to hold a ${100 - CAPACITY_THRESHOLD * 100}% buffer at month 6.` },
      bullets: [
        `Current: ${fmtNum(b.used)} of ${fmtNum(b.provisioned)} units used (${fmtPct(util)}).`,
        `Forecast demand in 6 months: ${fmtNum(f6)} units (${fmtPct(f6 / b.provisioned)} of today's supply) at ${fmtPct(b.growth)} compounded monthly growth.`,
        `AI / ML workloads are ${fmtPct(b.aiShare, 0)} of regional demand and the fastest-growing segment.`,
        !sufficient && orderBy ? `Procurement lead time is ${b.leadTime} months → order decision needed by ${fmtDate(orderBy)}${orderBy <= AS_OF ? ' (already past — escalate)' : ''}.` : 'No procurement decision required within the 6-month horizon.',
      ],
    },
    ...(sufficient ? [] : [{ heading: 'Options to close the gap', table: { columns: ['Option', 'Units gained', 'Cost', 'Time to effect', 'Risk / tradeoff'], rows: opts } }]),
    {
      heading: 'Recommendation',
      bullets: sufficient
        ? ['No purchase required. Re-run the forecast monthly and keep rightsizing to maintain the buffer.', `Consider lending spare capacity to constrained regions (see EU West).`]
        : [
            buyUnits > 0
              ? `Optimize first: rightsizing recovers ~${fmtNum(reclaim)} units and reallocation ~${fmtNum(realloc)} units, cutting the purchase to ~${fmtNum(buyUnits)} units (${fmtUSD(buyUnits * b.unitCost)}/mo vs ${fmtUSD(needUnits * b.unitCost)}/mo).`
              : `Optimize first: rightsizing recovers ~${fmtNum(reclaim)} units${realloc ? ` and reallocation ~${fmtNum(realloc)} units` : ''}, which covers the ${fmtNum(needUnits)}-unit gap and avoids ${fmtUSD(needUnits * b.unitCost)}/mo of new spend.`,
            buyUnits > 0
              ? `Place a ${orderBy && orderBy <= AS_OF ? 'expedited' : 'scheduled'} order for the residual ${fmtNum(buyUnits)} units to protect Tier 0 services.`
              : `No purchase is needed if optimization lands on time. Pre-negotiate a contingency order for ${fmtNum(Math.ceil(needUnits * 0.5))} units by ${orderBy ? fmtDate(orderBy) : 'next quarter'} in case rightsizing or reallocation slips.`,
            eligibleDonors.length ? `Candidate donor regions (residency-compatible): ${eligibleDonors.map((d) => `${d.r.name} (${fmtNum(d.spare)} spare)`).join(', ')}.` : 'No residency-compatible donor region has spare capacity; reallocation is limited.',
          ],
    },
    {
      heading: 'Tradeoffs',
      bullets: [
        'Buying capacity is lowest-risk technically but locks in spend; over-buying by 10% wastes ≈ ' + fmtUSD(b.provisioned * 0.1 * b.unitCost) + '/mo.',
        'Optimization defers spend but depends on engineering bandwidth; slippage pushes the region past the threshold with no buffer.',
        'Reallocation uses sunk reserved capacity but adds egress and residency review.',
      ],
    },
  ]

  return {
    id: rid(),
    workflow: 'capacity',
    question: q,
    title: `${reg.name} 6-month capacity outlook`,
    summary: sufficient
      ? `Yes — ${reg.name} has sufficient compute capacity for the next six months. Forecast utilization peaks at ${fmtPct(f6 / b.provisioned)}, below the ${CAPACITY_THRESHOLD * 100}% threshold.`
      : `No — ${reg.name} will not hold the required ${100 - CAPACITY_THRESHOLD * 100}% buffer. Demand grows from ${fmtPct(util)} to ${fmtPct(f6 / b.provisioned)} of supply by ${fmtDate(addMonths(6))}; ~${fmtNum(needUnits)} additional units are needed, of which ~${fmtNum(Math.min(needUnits, reclaim + realloc))} can come from optimization.`,
    sections,
    sourceMetrics: [
      { label: 'Provisioned compute', value: `${fmtNum(b.provisioned)} units`, source: 'Inventory: compute fleet' },
      { label: 'Used compute', value: `${fmtNum(b.used)} units`, source: 'Utilization telemetry' },
      { label: 'Blended growth (monthly)', value: fmtPct(b.growth, 2), source: 'Capacity forecast model' },
      { label: 'Unit cost', value: `${fmtUSD(b.unitCost)}/unit/mo`, source: 'Billing: monthly cost allocation' },
      { label: 'Procurement lead time', value: `${b.leadTime} months`, source: 'Supply chain / provider SLA' },
    ],
    calculations: [
      { label: '6-month demand', formula: `${fmtNum(b.used)} × (1 + ${fmtPct(b.growth, 2)})^6`, result: `${fmtNum(f6)} units` },
      { label: 'Threshold crossing', formula: `ln(${CAPACITY_THRESHOLD} × ${fmtNum(b.provisioned)} ÷ ${fmtNum(b.used)}) ÷ ln(1 + g)`, result: crossM === null ? '> 36 months' : crossM === 0 ? 'already crossed' : `${crossM.toFixed(1)} months` },
      { label: 'Physical exhaustion', formula: `ln(${fmtNum(b.provisioned)} ÷ ${fmtNum(b.used)}) ÷ ln(1 + g)`, result: `${exhaustM.toFixed(1)} months` },
      { label: 'Required additional capacity', formula: `max(0, ${fmtNum(f6)} ÷ ${CAPACITY_THRESHOLD} − ${fmtNum(b.provisioned)})`, result: `${fmtNum(needUnits)} units` },
      { label: 'Purchase cost (unoptimized)', formula: `${fmtNum(needUnits)} × ${fmtUSD(b.unitCost)}`, result: `${fmtUSD(needUnits * b.unitCost)}/mo` },
    ],
    assumptions: [
      'Growth compounds monthly at the trailing blended rate by workload; no step-change launches modeled (use the simulator for what-ifs).',
      `Planning threshold is ${CAPACITY_THRESHOLD * 100}% to preserve N+1 AZ failover headroom.`,
      'Cross-region reallocation excluded where EU / non-EU data residency would be violated.',
      'Portable demand estimated as AI share + 10% of batch.',
    ],
    confidence: Math.max(0.55, 0.88 - Math.abs(b.growth) * 4),
    confidenceNote: 'Higher growth rates widen forecast error bands; confidence decays with growth volatility.',
    dataSources: ['Inventory: compute fleet', 'Utilization telemetry', 'Capacity forecast model', 'Billing'],
    scope: `${reg.name} · compute · all workloads`,
  }
}

/* ---------------- Workflow 3: executive update ---------------- */
function executive(q: string, ctx: AIContext): AIResponse {
  const inits = ctx.initiatives
  const health = programHealth(inits)
  const fin = programFinancials(inits)
  const recentDone = inits.flatMap((i) => i.milestones.filter((m) => m.status === 'Done' && m.completedOn && (AS_OF.getTime() - new Date(m.completedOn).getTime()) / 86_400_000 <= 45).map((m) => `${i.name}: ${m.name} (${fmtDate(m.completedOn!)})`))
  const risks = regionStats({ region: 'all', type: 'compute', workload: 'all', period: 12 }).filter((r) => r.status === 'risk' || r.status === 'watch')
  const blockers = crossTeamDependencies(inits).filter((d) => d.status === 'Blocked' || d.status === 'At Risk')
  const decisions = upcomingDecisions(inits)
  const pipeline = OPPORTUNITIES.filter((o) => ['Approved', 'Under Review'].includes(ctx.oppStatus[o.id]))
  const pipeSavings = pipeline.reduce((s, o) => s + o.monthlySavings, 0)
  const statusCounts = inits.reduce<Record<string, number>>((m, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {})
  const month = AS_OF.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const sections: Section[] = [
    {
      heading: 'Overall program health',
      callout: { tone: health === 'Green' ? 'ok' : health === 'Yellow' ? 'info' : 'risk', text: `${health.toUpperCase()} — ${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(', ')}.` },
      text: health !== 'Green' ? `Primary drivers: ${inits.filter((i) => i.status === 'Off Track' || i.status === 'At Risk').map((i) => `${i.name} (${i.status})`).join('; ')}.` : 'All initiatives tracking to plan.',
    },
    { heading: 'Key accomplishments (last 45 days)', bullets: recentDone.length ? recentDone : ['No milestones completed in the period.'] },
    {
      heading: 'Financial impact',
      table: {
        columns: ['Metric', 'Value'],
        rows: [
          ['Committed run-rate savings (all initiatives)', `${fmtUSD(fin.totalSavings)}/mo · ${fmtUSD(fin.annualSavings)}/yr`],
          ['Delivered to date (progress-weighted est.)', `${fmtUSD(fin.delivered)}/mo`],
          ['Savings at risk (At Risk / Off Track)', `${fmtUSD(fin.atRiskSavings)}/mo`],
          ['Pipeline (Under Review + Approved)', `${fmtUSD(pipeSavings)}/mo across ${pipeline.length} opportunities`],
          ['Planned capacity investment', `${fmtUSD(fin.investment)}/mo`],
        ],
      },
    },
    { heading: 'Capacity risks', bullets: risks.length ? risks.map((r) => `${r.name}: ${fmtPct(r.utilization)} utilized today → ${fmtPct(r.forecastUtil6)} in 6 months${r.monthsToThreshold === 0 ? ' (above threshold now)' : r.monthsToThreshold !== null ? ` (crosses ${CAPACITY_THRESHOLD * 100}% in ~${r.monthsToThreshold.toFixed(1)} mo)` : ''}`) : ['No regions forecast to exceed threshold.'] },
    { heading: 'Blockers', bullets: blockers.length ? blockers.map((d) => `[${d.status}] ${d.initiativeName} ← ${d.team}: ${d.description} (due ${fmtDate(d.due)})`) : ['None.'] },
    { heading: 'Decisions required', bullets: decisions.length ? decisions.map((d) => `${d.question} — owner ${d.owner}, by ${fmtDate(d.due)}`) : ['None this period.'] },
    {
      heading: 'Next steps & owners',
      table: {
        columns: ['Initiative', 'Next milestone', 'Owner', 'Due'],
        rows: inits.filter((i) => i.status !== 'Completed').map((i) => {
          const m = nextMilestone(i)
          return [i.name, m?.name ?? '—', m?.owner ?? i.programOwner, m ? fmtDate(m.due) : '—']
        }),
      },
    },
  ]

  return {
    id: rid(),
    workflow: 'executive',
    question: q,
    title: `Executive update — ${month} capacity optimization program`,
    summary: `Program is ${health}. ${fmtUSD(fin.totalSavings)}/mo committed savings (${fmtUSD(fin.delivered)}/mo est. delivered); ${fmtUSD(fin.atRiskSavings)}/mo at risk. ${risks.length} region(s) carry capacity risk and ${decisions.length} decision(s) are needed from leadership.`,
    sections,
    sourceMetrics: [
      { label: 'Initiatives tracked', value: String(inits.length), source: 'Program tracker' },
      { label: 'Committed savings', value: `${fmtUSD(fin.totalSavings)}/mo`, source: 'Program tracker' },
      { label: 'Blocked / at-risk dependencies', value: String(blockers.length), source: 'Program tracker' },
      { label: 'Regions at / near threshold', value: String(risks.length), source: 'Capacity forecast model' },
    ],
    calculations: [
      { label: 'Program health', formula: 'Red if any Off Track or ≥3 At Risk; Yellow if any At Risk; else Green', result: health },
      { label: 'Delivered savings', formula: 'Σ monthly savings × progress %', result: `${fmtUSD(fin.delivered)}/mo` },
      { label: 'Savings at risk', formula: 'Σ savings of At Risk + Off Track initiatives', result: `${fmtUSD(fin.atRiskSavings)}/mo` },
    ],
    assumptions: ['"Delivered" savings are progress-weighted estimates until Finance verifies in billing.', 'Accomplishments include milestones completed in the trailing 45 days.'],
    confidence: 0.86,
    confidenceNote: 'Report content is a direct roll-up of tracker data; narrative framing should be reviewed before sending.',
    dataSources: ['Program tracker', 'Opportunity pipeline', 'Capacity forecast model'],
    scope: 'Capacity optimization program (all initiatives)',
  }
}

/* ---------------- Workflow 4: prioritization ---------------- */
export const PRIORITY_WEIGHTS = { financial: 0.4, effort: 0.2, risk: 0.2, customer: 0.2 }

export function rankForQuarter(ctx: AIContext) {
  const candidates = filterOpps(ctx.filters).filter((o) => ['Proposed', 'Under Review', 'Approved'].includes(ctx.oppStatus[o.id]))
  const maxSav = Math.max(1, ...candidates.map((o) => o.monthlySavings))
  return candidates
    .map((o) => {
      const fin = o.monthlySavings / maxSav
      const raw = PRIORITY_WEIGHTS.financial * fin + PRIORITY_WEIGHTS.effort * LEVEL_SCORE[o.effort] + PRIORITY_WEIGHTS.risk * LEVEL_SCORE[o.risk] + PRIORITY_WEIGHTS.customer * LEVEL_SCORE[o.customerImpact]
      const penalty = o.confidence < LOW_CONFIDENCE ? 0.7 : 1
      return { o, fin, raw, score: raw * penalty, penalty }
    })
    .sort((a, b) => b.score - a.score)
}

function prioritize(q: string, ctx: AIContext): AIResponse {
  const ranked = rankForQuarter(ctx)
  const top = ranked.slice(0, 3)
  const runners = ranked.slice(3, 6)
  if (!top.length) return base(q, 'prioritize', 'No candidates to rank', 'There are no Proposed / Under Review / Approved opportunities in the current scope.', ctx, { confidence: 0.9 })
  const topSav = top.reduce((s, x) => s + x.o.monthlySavings, 0)
  const sections: Section[] = [
    {
      heading: 'Ranking',
      table: {
        columns: ['#', 'Initiative', 'Savings/mo', 'Effort', 'Risk', 'Customer impact', 'Confidence', 'Score'],
        rows: ranked.slice(0, 6).map((x, i) => [i + 1, x.o.title, fmtUSD(x.o.monthlySavings), x.o.effort, x.o.risk, x.o.customerImpact, fmtPct(x.o.confidence, 0), x.score.toFixed(3)]),
      },
    },
    ...top.map((x, i) => ({
      heading: `Why #${i + 1}: ${x.o.title}`,
      bullets: [
        `Financial: ${fmtUSD(x.o.monthlySavings)}/mo (${fmtPct(x.fin, 0)} of the largest candidate).`,
        `Execution: ${x.o.effort} effort, ${x.o.risk} risk; customer impact ${x.o.customerImpact.toLowerCase()} — ${x.o.considerations}`,
        x.penalty < 1 ? '⚠ Confidence below threshold — 30% penalty applied; validate data before committing.' : `Confidence ${fmtPct(x.o.confidence, 0)} — data supports committing this quarter.`,
      ],
    })),
    {
      heading: 'Why not the others',
      bullets: runners.map((x) => {
        const why = x.o.effort === 'High' ? 'high engineering effort' : x.o.risk !== 'Low' ? `${x.o.risk.toLowerCase()} implementation risk` : x.penalty < 1 ? 'low confidence' : 'smaller financial impact'
        return `${x.o.title} (${fmtUSD(x.o.monthlySavings)}/mo) — deprioritized due to ${why}; revisit next quarter.`
      }),
    },
  ]
  return {
    id: rid(),
    workflow: 'prioritize',
    question: q,
    title: 'Recommended priorities for this quarter',
    summary: `Prioritize ${top.map((x) => x.o.title).join(', ')}. Together they deliver ${fmtUSD(topSav)}/mo (${fmtUSD(topSav * 12)}/yr) with ${top.every((x) => x.o.risk === 'Low') ? 'low' : 'manageable'} execution risk.`,
    sections,
    sourceMetrics: top.map((x) => ({ label: x.o.title, value: `${fmtUSD(x.o.monthlySavings)}/mo · ${x.o.observedUtil}`, source: x.o.sources[0] })),
    calculations: [
      { label: 'Composite score', formula: `${PRIORITY_WEIGHTS.financial} × financial (normalized) + ${PRIORITY_WEIGHTS.effort} × effort + ${PRIORITY_WEIGHTS.risk} × risk + ${PRIORITY_WEIGHTS.customer} × customer impact`, result: 'see ranking' },
      { label: 'Level scores', formula: 'Low = 1.0, Medium = 0.6, High = 0.25 (higher is better)', result: '—' },
      { label: 'Confidence penalty', formula: `× 0.7 when confidence < ${LOW_CONFIDENCE}`, result: `${ranked.filter((x) => x.penalty < 1).length} candidates penalized` },
      ...top.map((x) => ({ label: x.o.title, formula: `0.4×${x.fin.toFixed(2)} + 0.2×${LEVEL_SCORE[x.o.effort]} + 0.2×${LEVEL_SCORE[x.o.risk]} + 0.2×${LEVEL_SCORE[x.o.customerImpact]}${x.penalty < 1 ? ' × 0.7' : ''}`, result: x.score.toFixed(3) })),
    ],
    assumptions: ['Candidates are opportunities not yet In Progress or Completed within the current filter scope.', 'Weights reflect a savings-first quarter; adjust with Finance if reliability work takes precedence.', 'Customer impact reflects workload tier (Tier 0 = user-facing).'],
    confidence: top.reduce((s, x) => s + x.o.confidence, 0) / top.length,
    confidenceNote: 'Mean confidence of the three recommended initiatives.',
    dataSources: ['Opportunity pipeline', 'Inventory', 'Utilization telemetry', 'Billing'],
    scope: scopeLabel(ctx.filters),
    actionableOppIds: top.map((x) => x.o.id),
  }
}

function base(q: string, workflow: WorkflowId, title: string, summary: string, ctx: AIContext, extra: Partial<AIResponse>): AIResponse {
  return {
    id: rid(),
    workflow,
    question: q,
    title,
    summary,
    sections: [],
    sourceMetrics: [],
    calculations: [],
    assumptions: [],
    confidence: 0.5,
    confidenceNote: '',
    dataSources: [],
    scope: scopeLabel(ctx.filters),
    ...extra,
  }
}

export function answer(q: string, ctx: AIContext): AIResponse {
  switch (detectWorkflow(q)) {
    case 'efficiency':
      return efficiency(q, ctx)
    case 'capacity':
      return capacity(q, ctx)
    case 'executive':
      return executive(q, ctx)
    case 'prioritize':
      return prioritize(q, ctx)
    default:
      return base(q, 'unknown', "I can't answer that from the available data", 'This simulated assistant only answers questions it can ground in the in-app dataset. Try one of the supported workflows: efficiency opportunities, regional capacity outlook (name a region), executive program update, or quarterly prioritization.', ctx, {
        confidence: 1,
        confidenceNote: 'No analysis performed.',
        sections: [{ heading: 'Supported questions', bullets: SUGGESTED_PROMPTS.map((p) => p.prompt) }],
      })
  }
}

export function responseToText(r: AIResponse): string {
  const lines: string[] = [`# ${r.title}`, '', r.summary, '']
  for (const s of r.sections) {
    lines.push(`## ${s.heading}`)
    if (s.callout) lines.push(s.callout.text)
    if (s.text) lines.push(s.text)
    s.bullets?.forEach((b) => lines.push(`- ${b}`))
    if (s.table) {
      lines.push(s.table.columns.join(' | '))
      s.table.rows.forEach((row) => lines.push(row.join(' | ')))
    }
    lines.push('')
  }
  lines.push(`Confidence: ${fmtPct(r.confidence, 0)} — ${r.confidenceNote}`)
  lines.push(`Sources: ${r.dataSources.join(', ')}`)
  return lines.join('\n')
}

export function diffSummary(before: string, after: string): string[] {
  const a = new Set(before.split('\n').map((l) => l.trim()).filter(Boolean))
  const b = new Set(after.split('\n').map((l) => l.trim()).filter(Boolean))
  const added = [...b].filter((l) => !a.has(l))
  const removed = [...a].filter((l) => !b.has(l))
  const out: string[] = []
  if (added.length) out.push(`${added.length} line(s) added/edited (e.g. "${added[0].slice(0, 70)}${added[0].length > 70 ? '…' : ''}")`)
  if (removed.length) out.push(`${removed.length} line(s) removed/replaced`)
  return out
}
