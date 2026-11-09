// Synthetic program-management data. People and teams are fictional.

export type InitStatus = 'Not Started' | 'On Track' | 'At Risk' | 'Off Track' | 'Completed'
export type MilestoneStatus = 'Done' | 'In Progress' | 'Not Started' | 'At Risk'
export type DepStatus = 'Resolved' | 'On Track' | 'At Risk' | 'Blocked'

export interface Milestone {
  id: string
  name: string
  due: string
  status: MilestoneStatus
  owner: string
  completedOn?: string
}

export interface Dependency {
  id: string
  team: string
  description: string
  due: string
  status: DepStatus
}

export interface Decision {
  id: string
  question: string
  due: string
  owner: string
}

export interface Initiative {
  id: string
  name: string
  region: string
  category: string
  description: string
  programOwner: string
  engOwner: string
  financePartner: string
  start: string
  target: string
  monthlySavings: number
  /** Incremental monthly spend for capacity investments (positive number). */
  monthlyInvestment: number
  status: InitStatus
  progress: number
  risks: string[]
  milestones: Milestone[]
  dependencies: Dependency[]
  decisions: Decision[]
  sourceOppId?: string
}

export const INITIATIVES: Initiative[] = [
  {
    id: 'init-use-rightsize',
    name: 'US East compute rightsizing',
    region: 'us-east',
    category: 'Underutilized compute',
    description: 'Reduce autoscaling floors and bin-pack Data Platform and Media fleets in US East toward a 65% utilization target, then retire surplus reservations at renewal.',
    programOwner: 'Priya Raman',
    engOwner: 'Diego Alvarez · Compute Platform',
    financePartner: 'Erin Walsh · FinOps',
    start: '2026-08-15',
    target: '2027-01-31',
    monthlySavings: 41_300,
    monthlyInvestment: 0,
    status: 'On Track',
    progress: 55,
    risks: ['Peak-season (holiday) traffic may require temporary capacity re-expansion in December.'],
    milestones: [
      { id: 'm1', name: 'Utilization baseline & candidate list', due: '2026-09-05', status: 'Done', owner: 'Priya Raman', completedOn: '2026-09-03' },
      { id: 'm2', name: 'Batch autoscaling floor change (canary)', due: '2026-10-10', status: 'Done', owner: 'Diego Alvarez', completedOn: '2026-10-14' },
      { id: 'm3', name: 'Media fleet bin-packing rollout', due: '2026-11-20', status: 'In Progress', owner: 'Diego Alvarez' },
      { id: 'm4', name: 'Release surplus reservations at renewal', due: '2026-12-15', status: 'Not Started', owner: 'Erin Walsh' },
      { id: 'm5', name: 'Savings verified in billing', due: '2027-01-31', status: 'Not Started', owner: 'Erin Walsh' },
    ],
    dependencies: [
      { id: 'd1', team: 'Data Platform', description: 'Validate Spark backfill windows under lower floor', due: '2026-11-15', status: 'On Track' },
      { id: 'd2', team: 'SRE', description: 'Update capacity alerts for new utilization targets', due: '2026-11-25', status: 'On Track' },
    ],
    decisions: [{ id: 'dec1', question: 'Hold or release 400 reserved units through the holiday freeze?', due: '2026-11-21', owner: 'Erin Walsh' }],
    sourceOppId: 'opp-cmp-us-east-data-platform',
  },
  {
    id: 'init-euw-expansion',
    name: 'EU West capacity expansion',
    region: 'eu-west',
    category: 'Capacity expansion',
    description: 'Add ~1,800 compute units in EU West across two AZs to restore a 15% headroom buffer before forecast demand exceeds supply.',
    programOwner: 'Jordan Lee',
    engOwner: 'Hannah Kim · Capacity Engineering',
    financePartner: 'Noah Bennett · Infra Finance',
    start: '2026-09-01',
    target: '2027-02-28',
    monthlySavings: 0,
    monthlyInvestment: 152_000,
    status: 'At Risk',
    progress: 35,
    risks: [
      'EU West already above the 85% utilization threshold; any slip extends SLO risk for Tier 0 services.',
      'Incremental spend approval pending — procurement cannot place order until approved.',
    ],
    milestones: [
      { id: 'm1', name: 'Demand forecast signed off', due: '2026-09-20', status: 'Done', owner: 'Hannah Kim', completedOn: '2026-09-18' },
      { id: 'm2', name: 'Cloud quota request submitted', due: '2026-10-05', status: 'Done', owner: 'Hannah Kim', completedOn: '2026-10-07' },
      { id: 'm3', name: 'Finance approval of incremental spend', due: '2026-11-01', status: 'At Risk', owner: 'Noah Bennett' },
      { id: 'm4', name: 'Capacity delivered in euw-az1 / az2', due: '2027-01-15', status: 'Not Started', owner: 'Hannah Kim' },
      { id: 'm5', name: 'Traffic onboarding & headroom restored', due: '2027-02-28', status: 'Not Started', owner: 'Jordan Lee' },
    ],
    dependencies: [
      { id: 'd1', team: 'Cloud Provider (TAM)', description: 'Quota grant for 1,800 units in euw-az1/az2', due: '2026-11-30', status: 'At Risk' },
      { id: 'd2', team: 'Infra Finance', description: 'Approve $152K/mo incremental run-rate', due: '2026-11-01', status: 'Blocked' },
      { id: 'd3', team: 'Network Engineering', description: 'Provision additional transit capacity for new AZ footprint', due: '2026-12-20', status: 'On Track' },
    ],
    decisions: [
      { id: 'dec1', question: 'Approve full 1,800-unit expansion vs. phased 1,000 units + stranded-capacity reallocation?', due: '2026-11-14', owner: 'Noah Bennett' },
    ],
  },
  {
    id: 'init-storage-tier',
    name: 'Storage tier optimization',
    region: 'us-east',
    category: 'Storage inefficiency',
    description: 'Apply lifecycle policies to move cold Media and Data Platform objects to infrequent-access tiers and shrink oversized allocations.',
    programOwner: 'Alex Morgan',
    engOwner: 'Marcus Webb · Storage',
    financePartner: 'Erin Walsh · FinOps',
    start: '2026-09-10',
    target: '2026-12-20',
    monthlySavings: 61_800,
    monthlyInvestment: 0,
    status: 'On Track',
    progress: 70,
    risks: ['Legal-hold buckets must be excluded from tiering policies.'],
    milestones: [
      { id: 'm1', name: 'Access-pattern analysis complete', due: '2026-09-25', status: 'Done', owner: 'Marcus Webb', completedOn: '2026-09-24' },
      { id: 'm2', name: 'Data Platform lifecycle policy deployed', due: '2026-10-20', status: 'Done', owner: 'Marcus Webb', completedOn: '2026-10-18' },
      { id: 'm3', name: 'Media cold-tier pilot', due: '2026-10-31', status: 'Done', owner: 'Marcus Webb', completedOn: '2026-11-02' },
      { id: 'm4', name: 'Legal-hold exclusion review', due: '2026-11-14', status: 'In Progress', owner: 'Alex Morgan' },
      { id: 'm5', name: 'Full rollout & savings verification', due: '2026-12-20', status: 'Not Started', owner: 'Erin Walsh' },
    ],
    dependencies: [
      { id: 'd1', team: 'Legal & Privacy', description: 'Confirm retention / legal-hold exclusions', due: '2026-11-14', status: 'On Track' },
      { id: 'd2', team: 'Media Platform', description: 'Accept higher retrieval latency for >90-day assets', due: '2026-11-18', status: 'Resolved' },
    ],
    decisions: [],
    sourceOppId: 'opp-sto-us-east-media',
  },
  {
    id: 'init-net-consolidation',
    name: 'Network capacity consolidation',
    region: 'us-east',
    category: 'Networking inefficiency',
    description: 'Consolidate underused transit and load-balancer capacity and right-size bandwidth commitments at the Q1 renewal.',
    programOwner: 'Sam Okafor',
    engOwner: 'Lena Fischer · Network Engineering',
    financePartner: 'Noah Bennett · Infra Finance',
    start: '2026-10-01',
    target: '2027-03-31',
    monthlySavings: 23_600,
    monthlyInvestment: 0,
    status: 'Off Track',
    progress: 15,
    risks: ['Commitment renewal window closes Dec 15; missing it locks current bandwidth for 12 more months.', 'AZ-evacuation failover test not yet scheduled.'],
    milestones: [
      { id: 'm1', name: 'Traffic baseline (p95 / failover peaks)', due: '2026-10-20', status: 'Done', owner: 'Lena Fischer', completedOn: '2026-10-22' },
      { id: 'm2', name: 'Renewal negotiation brief to Procurement', due: '2026-10-31', status: 'Not Started', owner: 'Sam Okafor' },
      { id: 'm3', name: 'AZ-evacuation failover test', due: '2026-11-30', status: 'Not Started', owner: 'Lena Fischer' },
      { id: 'm4', name: 'Commitment renewal signed', due: '2026-12-15', status: 'Not Started', owner: 'Noah Bennett' },
      { id: 'm5', name: 'Decommission surplus LB tier', due: '2027-03-31', status: 'Not Started', owner: 'Lena Fischer' },
    ],
    dependencies: [
      { id: 'd1', team: 'Procurement', description: 'Renewal negotiation slot with carrier', due: '2026-11-20', status: 'Blocked' },
      { id: 'd2', team: 'SRE', description: 'Schedule AZ-evacuation game day', due: '2026-11-25', status: 'At Risk' },
    ],
    decisions: [{ id: 'dec1', question: 'Accept 1-year vs 3-year bandwidth commitment term?', due: '2026-12-01', owner: 'Noah Bennett' }],
    sourceOppId: 'opp-net-us-east-ads',
  },
  {
    id: 'init-ai-readiness',
    name: 'AI workload capacity readiness',
    region: 'us-east',
    category: 'Capacity readiness',
    description: 'Secure GPU capacity for H1 model-training roadmap; place region-agnostic training on stranded capacity before buying new GPUs.',
    programOwner: 'Taylor Brooks',
    engOwner: 'Ravi Patel · ML Platform',
    financePartner: 'Erin Walsh · FinOps',
    start: '2026-10-01',
    target: '2027-04-30',
    monthlySavings: 0,
    monthlyInvestment: 210_000,
    status: 'At Risk',
    progress: 25,
    risks: ['GPU allocation from provider is constrained through Q1.', 'Training data residency rules limit EU → US placement.'],
    milestones: [
      { id: 'm1', name: 'GPU demand intake from ML teams', due: '2026-10-25', status: 'Done', owner: 'Ravi Patel', completedOn: '2026-10-24' },
      { id: 'm2', name: 'GPU reservation plan & placement model', due: '2026-11-25', status: 'In Progress', owner: 'Taylor Brooks' },
      { id: 'm3', name: 'Training scheduler queue fairness', due: '2027-01-15', status: 'Not Started', owner: 'Ravi Patel' },
      { id: 'm4', name: 'Shift training to stranded US West / EU Central capacity', due: '2027-02-28', status: 'Not Started', owner: 'Hannah Kim' },
      { id: 'm5', name: 'H1 GPU capacity delivered', due: '2027-04-30', status: 'Not Started', owner: 'Taylor Brooks' },
    ],
    dependencies: [
      { id: 'd1', team: 'Cloud Provider (TAM)', description: 'H1 GPU allocation commitment', due: '2026-12-10', status: 'At Risk' },
      { id: 'd2', team: 'Legal & Privacy', description: 'Data residency review for cross-region training', due: '2026-12-15', status: 'On Track' },
      { id: 'd3', team: 'EU West capacity expansion', description: 'EU inference footprint relies on new EU West capacity', due: '2027-01-15', status: 'At Risk' },
    ],
    decisions: [{ id: 'dec1', question: 'Reserve GPUs for 1 year now, or wait for Q1 pricing at risk of allocation?', due: '2026-11-20', owner: 'Taylor Brooks' }],
  },
]

export const SAMPLE_MEETING_NOTES = `Weekly capacity sync – Nov 6
Attendees: Priya, Jordan, Hannah, Noah, Lena, Sam
- EU West is at 90% utilization; Hannah confirmed quota request still pending with the provider.
- Noah needs to finalize the incremental spend approval by Nov 14, blocked on updated forecast.
- Jordan will send the phased expansion option (1,000 units + reallocation) to Noah by Wednesday.
- Decided to keep 400 reserved units in US East through the holiday freeze.
- Lena to schedule the AZ-evacuation game day with SRE by Nov 20.
- Risk: carrier renewal slot not booked; Procurement is unresponsive and this could delay the network program.
- Sam will escalate the Procurement blocker to the infra director by Friday.
- Agreed that storage tiering rollout proceeds once legal-hold review is done.`
