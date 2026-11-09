import { AS_OF } from '../data/model'
import type { Initiative, Milestone, Dependency } from '../data/program'
import { daysBetween, toDate } from './format'

export interface MilestoneRef extends Milestone {
  initiativeId: string
  initiativeName: string
  daysLate: number
  daysUntil: number
}

export function overdueMilestones(inits: Initiative[]): MilestoneRef[] {
  return inits.flatMap((i) =>
    i.milestones
      .filter((m) => m.status !== 'Done' && toDate(m.due) < AS_OF)
      .map((m) => ({ ...m, initiativeId: i.id, initiativeName: i.name, daysLate: daysBetween(toDate(m.due), AS_OF), daysUntil: -daysBetween(toDate(m.due), AS_OF) })),
  )
}

/** Milestones due within `window` days that are at risk or not yet started. */
export function atRiskMilestones(inits: Initiative[], window = 21): MilestoneRef[] {
  return inits.flatMap((i) =>
    i.milestones
      .filter((m) => {
        if (m.status === 'Done') return false
        const d = daysBetween(AS_OF, toDate(m.due))
        return d >= 0 && (m.status === 'At Risk' || (d <= window && m.status === 'Not Started') || (d <= 7 && m.status === 'In Progress'))
      })
      .map((m) => ({ ...m, initiativeId: i.id, initiativeName: i.name, daysLate: 0, daysUntil: daysBetween(AS_OF, toDate(m.due)) })),
  )
}

export function scheduleGap(i: Initiative) {
  const start = toDate(i.start)
  const end = toDate(i.target)
  const elapsed = Math.min(1, Math.max(0, daysBetween(start, AS_OF) / Math.max(1, daysBetween(start, end))))
  const expected = Math.round(elapsed * 100)
  return { expected, actual: i.progress, gap: expected - i.progress }
}

export interface RiskAssessment {
  initiative: Initiative
  score: number
  level: 'High' | 'Medium' | 'Low'
  reasons: string[]
}

export function assessRisk(i: Initiative): RiskAssessment {
  if (i.status === 'Completed') return { initiative: i, score: 0, level: 'Low', reasons: [] }
  const reasons: string[] = []
  let score = 0
  const overdue = overdueMilestones([i])
  if (overdue.length) {
    score += 30 * overdue.length
    overdue.forEach((m) => reasons.push(`Milestone "${m.name}" is ${m.daysLate} days overdue`))
  }
  const blocked = i.dependencies.filter((d) => d.status === 'Blocked')
  const atRiskDeps = i.dependencies.filter((d) => d.status === 'At Risk')
  if (blocked.length) {
    score += 25 * blocked.length
    blocked.forEach((d) => reasons.push(`Blocked on ${d.team}: ${d.description}`))
  }
  if (atRiskDeps.length) {
    score += 12 * atRiskDeps.length
    atRiskDeps.forEach((d) => reasons.push(`Dependency at risk — ${d.team}: ${d.description}`))
  }
  const g = scheduleGap(i)
  if (g.gap > 15) {
    score += g.gap
    reasons.push(`Progress ${g.actual}% vs ${g.expected}% expected for elapsed time`)
  }
  if (i.status === 'Off Track') score += 20
  if (i.status === 'At Risk') score += 10
  const level = score >= 50 ? 'High' : score >= 20 ? 'Medium' : 'Low'
  return { initiative: i, score, level, reasons }
}

export interface DepRef extends Dependency {
  initiativeId: string
  initiativeName: string
  daysUntil: number
  slackToTarget: number
}

export function crossTeamDependencies(inits: Initiative[]): DepRef[] {
  return inits
    .filter((i) => i.status !== 'Completed')
    .flatMap((i) =>
      i.dependencies.map((d) => ({
        ...d,
        initiativeId: i.id,
        initiativeName: i.name,
        daysUntil: daysBetween(AS_OF, toDate(d.due)),
        slackToTarget: daysBetween(toDate(d.due), toDate(i.target)),
      })),
    )
}

export function upcomingDecisions(inits: Initiative[]) {
  return inits
    .filter((i) => i.status !== 'Completed')
    .flatMap((i) => i.decisions.map((d) => ({ ...d, initiativeId: i.id, initiativeName: i.name, daysUntil: daysBetween(AS_OF, toDate(d.due)) })))
    .sort((a, b) => a.daysUntil - b.daysUntil)
}

export function programFinancials(inits: Initiative[]) {
  const active = inits.filter((i) => i.status !== 'Completed')
  const totalSavings = inits.reduce((s, i) => s + i.monthlySavings, 0)
  const delivered = inits.reduce((s, i) => s + i.monthlySavings * (i.progress / 100), 0)
  const atRiskSavings = active.filter((i) => i.status === 'At Risk' || i.status === 'Off Track').reduce((s, i) => s + i.monthlySavings, 0)
  const investment = inits.reduce((s, i) => s + i.monthlyInvestment, 0)
  return { totalSavings, delivered, atRiskSavings, investment, annualSavings: totalSavings * 12 }
}

export function programHealth(inits: Initiative[]): 'Green' | 'Yellow' | 'Red' {
  const active = inits.filter((i) => i.status !== 'Completed')
  if (active.some((i) => i.status === 'Off Track') || active.filter((i) => i.status === 'At Risk').length >= 3) return 'Red'
  if (active.some((i) => i.status === 'At Risk')) return 'Yellow'
  return 'Green'
}

export function nextMilestone(i: Initiative) {
  return i.milestones.find((m) => m.status !== 'Done')
}
