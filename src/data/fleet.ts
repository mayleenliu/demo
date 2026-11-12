// Synthetic SDN appliance fleet. Sites, racks and numbers are illustrative.

export const AS_OF = new Date('2026-11-09T12:00:00')

/** Keep racks in use (NIC utilization) at or below this share of racks deployed. */
export const PLANNING_THRESHOLD = 0.75
export const KW_PER_RACK = 10
export const CAPEX_PER_RACK = 200_000
export const USEFUL_LIFE_YEARS = 6
export const ORDER_TO_DOCK_WEEKS = 3
export const DOCK_TO_LIVE_WEEKS = 4
export const MOVE_WEEKS = 8
/** Donor regions stay at or below this utilization after giving up racks. */
export const DONOR_MAX_UTIL = 0.7
export const EARLY_RETIRE_DATE = '2027-01-31'
/** Fleet-wide Gen6 rack swaps the deployment team can complete per month. */
export const SWAP_RACKS_PER_MONTH = 120
/** Gen8 bridge swaps are scheduled to finish this many months before Gen6 EOL. */
export const BRIDGE_BUFFER_MONTHS = 6

/** Rack power draw model: idle share of the 10 kW allocation plus a share that scales with utilization. */
export const IDLE_DRAW_SHARE = 0.35
export const LOAD_DRAW_SHARE = 0.45
/** Peak draw over average draw. */
export const PEAK_FACTOR = 1.2
/** Proposed per-rack power allocation: peak draw at 75% utilization plus margin. */
export const RECLAIM_KW_PER_RACK = 8.5
export const PUE_TARGET = 1.25
export const POWER_COST_PER_KWH = 0.08
/** A region should stay under this utilization (12 months out) after losing one cluster. */
export const FAILOVER_UTIL_LIMIT = 0.85

export type GenId = 'gen6' | 'gen8' | 'gen11'

export interface Gen {
  id: GenId
  name: string
  /** First date racks of this generation can go live. */
  ga: string
  eol: string
  color: string
}

export const GENS: Gen[] = [
  { id: 'gen6', name: 'Gen6', ga: '2019-01-01', eol: '2028-09-30', color: '#c4c4c4' },
  { id: 'gen8', name: 'Gen8', ga: '2025-01-01', eol: '2032-12-31', color: '#3d3d3d' },
  { id: 'gen11', name: 'Gen11', ga: '2028-03-01', eol: '2035-12-31', color: '#e60023' },
]

export interface Region {
  id: string
  name: string
  geo: 'Americas' | 'Europe'
  /** Datacenter sites, used in cluster names. */
  sites: string[]
  /** Customer codes hosted here, used in cluster names. */
  tenants: string[]
  /** Monthly growth of racks in use. */
  growth: number
  powerBudgetKw: number
  /** Floor positions allocated to SDN racks. */
  rackPositions: number
  pue: number
}

export const REGIONS: Region[] = [
  { id: 'westus3', name: 'West US 3', geo: 'Americas', sites: ['phx23', 'phx21'], tenants: ['oci', 'gh'], growth: 0.03, powerBudgetKw: 8000, rackPositions: 860, pue: 1.38 },
  { id: 'centralus', name: 'Central US', geo: 'Americas', sites: ['dsm10', 'dsm12'], tenants: ['ntx', 'oci'], growth: 0.008, powerBudgetKw: 4500, rackPositions: 480, pue: 1.22 },
  { id: 'southcentralus', name: 'South Central US', geo: 'Americas', sites: ['sn4', 'sn5'], tenants: ['nap', 'gh'], growth: 0.035, powerBudgetKw: 4000, rackPositions: 300, pue: 1.35 },
  { id: 'westeurope', name: 'West Europe', geo: 'Europe', sites: ['ams23', 'ams21'], tenants: ['nap', 'oci'], growth: 0.025, powerBudgetKw: 4300, rackPositions: 520, pue: 1.19 },
  { id: 'northeurope', name: 'North Europe', geo: 'Europe', sites: ['db5', 'db6'], tenants: ['ntx', 'nap'], growth: 0.008, powerBudgetKw: 3000, rackPositions: 360, pue: 1.12 },
]

export interface Rack {
  id: string
  cluster: string
  region: string
  gen: GenId
  docked: string
  /** NIC utilization on this rack (provisioned ÷ capacity). */
  util: number
}

/** Deployment waves used to generate rack inventory: [region, gen, racks, first dock month, avg util]. */
const WAVES: [string, GenId, number, string, number][] = [
  ['westeurope', 'gen6', 100, '2020-03', 0.6],
  ['westus3', 'gen6', 90, '2021-02', 0.52],
  ['westeurope', 'gen6', 160, '2022-01', 0.6],
  ['westus3', 'gen6', 20, '2022-02', 0.54],
  ['westus3', 'gen6', 150, '2022-05', 0.55],
  ['centralus', 'gen6', 80, '2022-10', 0.32],
  ['northeurope', 'gen6', 50, '2023-04', 0.28],
  ['southcentralus', 'gen6', 10, '2023-04', 0.48],
  ['southcentralus', 'gen6', 40, '2024-01', 0.5],
  ['southcentralus', 'gen8', 150, '2025-01', 0.5],
  ['westus3', 'gen8', 220, '2025-02', 0.55],
  ['northeurope', 'gen8', 120, '2025-04', 0.3],
  ['centralus', 'gen8', 240, '2025-06', 0.3],
  ['westeurope', 'gen8', 160, '2025-09', 0.6],
  ['northeurope', 'gen8', 80, '2025-12', 0.28],
  ['westus3', 'gen8', 150, '2026-02', 0.53],
  ['centralus', 'gen8', 80, '2026-05', 0.5],
]
/** Racks docked per month during a wave. */
const DOCK_RATE = 40

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Racks per cluster when a wave is split into clusters. */
export const CLUSTER_SIZE = 40

function buildRacks(): Rack[] {
  const rand = mulberry32(611)
  const clusterSeq: Record<string, number> = {}
  const regionClusters: Record<string, number> = {}
  const out: Rack[] = []
  for (const [region, gen, n, start, util] of WAVES) {
    const reg = REGIONS.find((r) => r.id === region)!
    const [y, m] = start.split('-').map(Number)
    let cluster = ''
    let inCluster = 0
    for (let i = 0; i < n; i++) {
      if (i % CLUSTER_SIZE === 0) {
        // Cluster name: <site>prd<customer><nn>, e.g. phx23prdoci01.
        const idx = (regionClusters[region] = (regionClusters[region] ?? -1) + 1)
        const site = reg.sites[idx % reg.sites.length]
        const tenant = reg.tenants[idx % reg.tenants.length]
        const key = site + tenant
        clusterSeq[key] = (clusterSeq[key] ?? 0) + 1
        cluster = `${site}prd${tenant}${String(clusterSeq[key]).padStart(2, '0')}`
        inCluster = 0
      }
      inCluster++
      const d = new Date(Date.UTC(y, m - 1, 1) + Math.floor((i / DOCK_RATE) * 30.44 + rand() * 25) * 86_400_000)
      // Per-rack utilization varies around the wave average; the mean is preserved.
      const u = Math.min(0.95, Math.max(0.05, util + (rand() - 0.5) * 0.3))
      out.push({ id: `${cluster}-r${String(inCluster).padStart(2, '0')}`, cluster, region, gen, docked: d.toISOString().slice(0, 10), util: +u.toFixed(2) })
    }
  }
  return out
}

export const RACKS: Rack[] = buildRacks()

export interface Order {
  id: string
  region: string
  gen: GenId
  racks: number
  live: string
  note: string
}

export const ORDERS: Order[] = [{ id: 'PO-8812', region: 'southcentralus', gen: 'gen8', racks: 60, live: '2027-01-04', note: 'Region expansion' }]

export interface CapacityRequest {
  id: string
  customer: string
  purpose: string
  region: string
  cluster: string
  racks: number
  neededBy: string
  priority: 'P0' | 'P1' | 'P2'
}

export const REQUESTS: CapacityRequest[] = [
  { id: 'REQ-2101', customer: 'Oracle', purpose: 'Interconnect expansion', region: 'westus3', cluster: 'phx23prdoci01', racks: 12, neededBy: '2027-02-15', priority: 'P1' },
  { id: 'REQ-2104', customer: 'NetApp', purpose: 'Storage service expansion', region: 'southcentralus', cluster: 'sn4prdnap01', racks: 10, neededBy: '2027-04-01', priority: 'P1' },
  { id: 'REQ-2107', customer: 'Nutanix', purpose: 'Cluster growth', region: 'centralus', cluster: 'dsm10prdntx01', racks: 200, neededBy: '2027-01-15', priority: 'P2' },
  { id: 'REQ-2110', customer: 'GitHub', purpose: 'Runner fleet growth', region: 'westus3', cluster: 'phx21prdgh01', racks: 100, neededBy: '2027-06-30', priority: 'P1' },
]

export const genById = (id: GenId) => GENS.find((g) => g.id === id)!
export const regionById = (id: string) => REGIONS.find((r) => r.id === id)!
export const continentOf = (region: string) => regionById(region).geo
