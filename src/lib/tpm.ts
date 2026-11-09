// Deterministic TPM assistant: drafts are generated from the program tracker. A human must approve before anything is "communicated".

import { AS_OF, regionById } from '../data/model'
import type { Initiative } from '../data/program'
import { fmtDate, fmtUSD } from './format'
import { assessRisk, atRiskMilestones, crossTeamDependencies, nextMilestone, overdueMilestones, programFinancials, programHealth, scheduleGap, upcomingDecisions } from './program'

export type TpmTask = 'weekly' | 'atRisk' | 'followUp' | 'notes' | 'dependencies' | 'execSummary'

export interface TpmDraft {
  task: TpmTask
  title: string
  text: string
  sources: string[]
  confidence: number
  notes: string[]
}

export const TPM_TASKS: { id: TpmTask; label: string; description: string }[] = [
  { id: 'weekly', label: 'Weekly status report', description: 'Roll up status, progress and changes for every initiative.' },
  { id: 'atRisk', label: 'Identify at-risk projects', description: 'Score initiatives on overdue milestones, blockers and schedule gap.' },
  { id: 'followUp', label: 'Draft stakeholder follow-up', description: 'Draft a follow-up to owners of open items on one initiative.' },
  { id: 'notes', label: 'Summarize meeting notes', description: 'Extract action items, decisions and risks from raw notes.' },
  { id: 'dependencies', label: 'Dependencies that could delay delivery', description: 'Find blocked / at-risk dependencies with little slack.' },
  { id: 'execSummary', label: 'Executive summary of program health', description: 'One-paragraph health summary for leadership.' },
]

const weekOf = () => fmtDate(AS_OF)
const statusIcon = (s: string) => (s === 'On Track' || s === 'Completed' ? '🟢' : s === 'At Risk' ? '🟡' : s === 'Off Track' ? '🔴' : '⚪')

function weekly(inits: Initiative[]): TpmDraft {
  const fin = programFinancials(inits)
  const lines = [
    `Infrastructure Capacity & Efficiency Program — Weekly Status (week of ${weekOf()})`,
    '',
    `Overall: ${programHealth(inits)} · ${fmtUSD(fin.totalSavings)}/mo committed savings · ${fmtUSD(fin.atRiskSavings)}/mo at risk`,
    '',
  ]
  for (const i of inits) {
    const g = scheduleGap(i)
    const m = nextMilestone(i)
    const r = assessRisk(i)
    lines.push(`${statusIcon(i.status)} ${i.name} — ${i.status} · ${i.progress}% (plan ${g.expected}%)`)
    lines.push(`   Owner: ${i.programOwner} | Eng: ${i.engOwner} | Target: ${fmtDate(i.target)}`)
    if (m) lines.push(`   Next: ${m.name} — ${m.owner}, due ${fmtDate(m.due)}`)
    if (r.reasons.length) lines.push(`   Watch: ${r.reasons[0]}`)
    lines.push('')
  }
  const decisions = upcomingDecisions(inits).slice(0, 3)
  if (decisions.length) {
    lines.push('Decisions needed:')
    decisions.forEach((d) => lines.push(`- ${d.question} (${d.owner}, by ${fmtDate(d.due)})`))
  }
  return { task: 'weekly', title: `Weekly status — ${weekOf()}`, text: lines.join('\n'), sources: ['Program tracker'], confidence: 0.9, notes: ['Direct roll-up of tracker fields; verify narrative before sending.'] }
}

function atRisk(inits: Initiative[]): TpmDraft {
  const ranked = inits.map(assessRisk).filter((r) => r.score > 0).sort((a, b) => b.score - a.score)
  const lines = [`At-risk project scan (${weekOf()})`, '', 'Risk score = 30/overdue milestone + 25/blocked dependency + 12/at-risk dependency + schedule gap (pts) + status adjustment.', '']
  ranked.forEach((r) => {
    lines.push(`${r.level === 'High' ? '🔴' : r.level === 'Medium' ? '🟡' : '🟢'} ${r.initiative.name} — ${r.level} risk (score ${r.score})`)
    r.reasons.forEach((x) => lines.push(`   • ${x}`))
    lines.push('')
  })
  if (!ranked.length) lines.push('No initiatives currently show risk signals.')
  return { task: 'atRisk', title: 'At-risk projects', text: lines.join('\n'), sources: ['Program tracker: milestones, dependencies'], confidence: 0.85, notes: ['Rule-based scoring; does not capture risks not recorded in the tracker.'] }
}

function followUp(inits: Initiative[], initId?: string): TpmDraft {
  const i = inits.find((x) => x.id === initId) ?? inits.map(assessRisk).sort((a, b) => b.score - a.score)[0].initiative
  const overdue = overdueMilestones([i])
  const soon = atRiskMilestones([i])
  const deps = i.dependencies.filter((d) => d.status === 'Blocked' || d.status === 'At Risk')
  const owners = [...new Set([...overdue.map((m) => m.owner), ...soon.map((m) => m.owner), ...deps.map((d) => d.team)])].filter((o) => o !== i.programOwner)
  const lines = [
    `To: ${owners.join(', ') || i.engOwner}`,
    `Cc: ${i.financePartner}`,
    `Subject: [${i.status}] ${i.name} — follow-ups needed by ${fmtDate(new Date(AS_OF.getTime() + 4 * 86_400_000))}`,
    '',
    'Hi all,',
    '',
    `Quick follow-up on ${i.name} (${regionById(i.region).name}). We're at ${i.progress}% against a ${fmtDate(i.target)} target${i.monthlySavings ? `, with ${fmtUSD(i.monthlySavings)}/mo in savings tied to this work` : ''}. A few items need attention:`,
    '',
  ]
  overdue.forEach((m) => lines.push(`• ${m.owner}: "${m.name}" was due ${fmtDate(m.due)} (${m.daysLate} days late). Can you share a revised date and what's blocking?`))
  soon.forEach((m) => lines.push(`• ${m.owner}: "${m.name}" is due ${fmtDate(m.due)}. Please confirm we're on track or flag risk.`))
  deps.forEach((d) => lines.push(`• ${d.team}: ${d.description} is ${d.status.toLowerCase()} (needed by ${fmtDate(d.due)}). What do you need from us to unblock?`))
  if (!overdue.length && !soon.length && !deps.length) lines.push('• No open issues — thanks for keeping this on track. Please confirm the next milestone date.')
  lines.push('', 'If any of these need a decision from leadership, reply here and I will add it to Thursday\'s capacity review.', '', 'Thanks,', i.programOwner)
  return { task: 'followUp', title: `Follow-up: ${i.name}`, text: lines.join('\n'), sources: ['Program tracker'], confidence: 0.88, notes: ['Tone and recipients should be confirmed by the TPM.'] }
}

const ACTION_RE = /\b([A-Z][a-z]+)\s+(will|to|needs to|should|owns|is going to)\s+(.+)/
const DUE_RE = /\b(?:by|before|due)\s+((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|EOD|EOW|end of (?:day|week|month)|next week|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2})/i

export function summarizeNotes(raw: string): TpmDraft {
  const lines = raw.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean)
  const actions: string[] = []
  const decisions: string[] = []
  const risks: string[] = []
  const info: string[] = []
  for (const l of lines) {
    if (/^attendees:/i.test(l) || /sync|meeting|–|—/.test(l) && lines.indexOf(l) === 0) continue
    if (/\b(decided|agreed|approved|decision)\b/i.test(l)) {
      decisions.push(l)
      continue
    }
    const a = l.match(ACTION_RE)
    if (a) {
      const due = l.match(DUE_RE)?.[1]
      actions.push(`${a[1]} — ${a[3].replace(DUE_RE, '').replace(/\s+,/g, ',').replace(/[.,\s]+$/, '')}${due ? ` (due ${due})` : ' (due: TBD — confirm)'}`)
      if (/\b(blocked|risk|delay|unresponsive)/i.test(l)) risks.push(`${a[1]}: ${l.match(/\b(blocked[^.;]*|risk[^.;]*|delay[^.;]*|unresponsive[^.;]*)/i)?.[1] ?? l}`)
      continue
    }
    if (/\b(risk|blocked|blocker|delay|concern|unresponsive|slip|pending)\b/i.test(l)) {
      risks.push(l)
      continue
    }
    info.push(l)
  }
  const out = ['Meeting summary', '', 'Action items:']
  actions.forEach((a) => out.push(`☐ ${a}`))
  if (!actions.length) out.push('— none detected')
  out.push('', 'Decisions:')
  decisions.forEach((d) => out.push(`✓ ${d}`))
  if (!decisions.length) out.push('— none detected')
  out.push('', 'Risks / blockers:')
  risks.forEach((r) => out.push(`⚠ ${r}`))
  if (!risks.length) out.push('— none detected')
  if (info.length) {
    out.push('', 'Context:')
    info.forEach((i) => out.push(`• ${i}`))
  }
  return {
    task: 'notes',
    title: 'Meeting notes → action items',
    text: out.join('\n'),
    sources: ['Pasted meeting notes'],
    confidence: actions.length ? 0.75 : 0.5,
    notes: ['Pattern-based extraction ("<Name> will/to …", "by <date>"). Items without a clear owner or date are flagged for confirmation.'],
  }
}

function dependencies(inits: Initiative[]): TpmDraft {
  const deps = crossTeamDependencies(inits)
    .filter((d) => d.status !== 'Resolved')
    .map((d) => ({ ...d, severity: (d.status === 'Blocked' ? 3 : d.status === 'At Risk' ? 2 : 0) + (d.daysUntil < 0 ? 2 : d.daysUntil < 14 ? 1 : 0) + (d.slackToTarget < 60 ? 1 : 0) }))
    .filter((d) => d.severity >= 2)
    .sort((a, b) => b.severity - a.severity)
  const lines = [`Dependencies that could delay delivery (${weekOf()})`, '', 'Severity = status (Blocked 3, At Risk 2) + due-date pressure (overdue 2, <14 days 1) + low slack to target (<60 days 1).', '']
  deps.forEach((d) => {
    lines.push(`${d.status === 'Blocked' ? '⛔' : '⚠'} ${d.team} → ${d.initiativeName}`)
    lines.push(`   ${d.description}`)
    lines.push(`   Due ${fmtDate(d.due)} (${d.daysUntil < 0 ? `${-d.daysUntil} days overdue` : `in ${d.daysUntil} days`}); ${d.slackToTarget} days of slack before target · severity ${d.severity}`)
    lines.push(`   Suggested action: ${d.status === 'Blocked' ? 'escalate to the owning director and request a dated commitment' : 'confirm date in next sync and identify a fallback'}`)
    lines.push('')
  })
  const chain = inits.flatMap((i) => i.dependencies.filter((d) => inits.some((o) => o.name.toLowerCase() === d.team.toLowerCase())).map((d) => `${i.name} depends on ${d.team} (${d.status})`))
  if (chain.length) {
    lines.push('Cross-initiative chains:')
    chain.forEach((c) => lines.push(`- ${c}`))
  }
  return { task: 'dependencies', title: 'Delivery-critical dependencies', text: lines.join('\n'), sources: ['Program tracker: dependencies'], confidence: 0.82, notes: ['Only dependencies recorded in the tracker are evaluated.'] }
}

function execSummary(inits: Initiative[]): TpmDraft {
  const fin = programFinancials(inits)
  const health = programHealth(inits)
  const risky = inits.map(assessRisk).filter((r) => r.level === 'High')
  const decisions = upcomingDecisions(inits)
  const text = [
    `Program health: ${health}.`,
    '',
    `The capacity & efficiency program is tracking ${inits.length} initiatives with ${fmtUSD(fin.totalSavings)}/mo (${fmtUSD(fin.annualSavings)}/yr) in committed savings, an estimated ${fmtUSD(fin.delivered)}/mo delivered to date, and ${fmtUSD(fin.investment)}/mo of planned capacity investment. ${risky.length ? `${risky.map((r) => r.initiative.name).join(' and ')} ${risky.length > 1 ? 'are' : 'is'} high risk, driven by ${risky.map((r) => r.reasons[0]?.toLowerCase()).filter(Boolean).join('; ')}.` : 'No initiatives are high risk.'} ${fmtUSD(fin.atRiskSavings)}/mo of savings is exposed if at-risk work slips.`,
    '',
    decisions.length ? `Leadership asks: ${decisions.slice(0, 3).map((d) => `${d.question} (${d.owner}, ${fmtDate(d.due)})`).join('; ')}.` : 'No leadership decisions required this week.',
  ].join('\n')
  return { task: 'execSummary', title: 'Executive summary — program health', text, sources: ['Program tracker', 'Risk scoring'], confidence: 0.86, notes: ['Summarizes tracker data only; add qualitative context before sending.'] }
}

export function generate(task: TpmTask, inits: Initiative[], opts: { initiativeId?: string; notes?: string } = {}): TpmDraft {
  switch (task) {
    case 'weekly':
      return weekly(inits)
    case 'atRisk':
      return atRisk(inits)
    case 'followUp':
      return followUp(inits, opts.initiativeId)
    case 'notes':
      return summarizeNotes(opts.notes ?? '')
    case 'dependencies':
      return dependencies(inits)
    case 'execSummary':
      return execSummary(inits)
  }
}
