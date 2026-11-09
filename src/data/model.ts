// Synthetic, deterministic infrastructure dataset. Nothing here reflects any real company's infrastructure.

export type InfraType = 'compute' | 'storage' | 'network'

export interface Region {
  id: string
  name: string
  azs: string[]
  computeProv: number
  computeUsed: number
  monthlySpend: number
  monthlyBudget: number
  /** Baseline monthly compute demand growth rate. */
  growth: number
  /** Capacity added in the past: fraction added and how many months ago. */
  capacityStep: { monthsAgo: number; added: number } | null
  /** Procurement lead time in months for new capacity. */
  leadTimeMonths: number
  /** Share of each pool's provisioned compute placed in each AZ (same order as azs). */
  azWeights: number[]
  /** Per-AZ utilization skew relative to the pool average (load is rarely balanced). */
  azSkew: number[]
}

export interface Workload {
  id: string
  name: string
  short: string
  weight: number
  util: number
  growthAdj: number
  tier: 'Tier 0' | 'Tier 1' | 'Tier 2'
  reservedRatio: number
  priceFactor: number
  coldDataPct: number
  storageWeight: number
  networkWeight: number
  isAI: boolean
  /** Why this workload matters to the business. */
  productRole: string
  /** Dominant infrastructure cost / capacity challenge. */
  challenge: string
  /** Primary optimization levers. */
  lever: string
}

export interface AzSlice {
  az: string
  provisioned: number
  used: number
}

export interface InventoryRow {
  id: string
  region: string
  az: string
  workload: string
  type: InfraType
  hardware: string
  unit: string
  provisioned: number
  used: number
  reserved: number
  /** Monthly cost in USD. */
  monthlyCost: number
  /** Monthly demand growth rate. */
  growth: number
  cpuUtil: number
  memUtil: number
  /** Std-dev of daily utilization over 90 days (0-1). Drives recommendation confidence. */
  utilVolatility: number
  /** Storage only: share of bytes not accessed in 90 days. */
  coldPct: number
  /** Compute only: how the pool is spread across availability zones. */
  azSplit?: AzSlice[]
}

export const AS_OF = new Date('2026-11-09T12:00:00')
export const AS_OF_LABEL = 'Nov 9, 2026'
export const CAPACITY_THRESHOLD = 0.85

export const REGIONS: Region[] = [
  { id: 'us-east', name: 'US East', azs: ['use-az1', 'use-az2', 'use-az4'], computeProv: 10000, computeUsed: 7200, monthlySpend: 1_200_000, monthlyBudget: 1_150_000, growth: 0.03, capacityStep: { monthsAgo: 5, added: 0.12 }, leadTimeMonths: 3, azWeights: [0.4, 0.32, 0.28], azSkew: [1.12, 0.93, 0.9] },
  { id: 'us-west', name: 'US West', azs: ['usw-az1', 'usw-az2', 'usw-az3'], computeProv: 8000, computeUsed: 4800, monthlySpend: 950_000, monthlyBudget: 990_000, growth: 0.014, capacityStep: { monthsAgo: 10, added: 0.1 }, leadTimeMonths: 3, azWeights: [0.34, 0.33, 0.33], azSkew: [1.02, 1.0, 0.98] },
  { id: 'eu-west', name: 'EU West', azs: ['euw-az1', 'euw-az2', 'euw-az3'], computeProv: 6000, computeUsed: 5400, monthlySpend: 800_000, monthlyBudget: 760_000, growth: 0.022, capacityStep: null, leadTimeMonths: 4, azWeights: [0.36, 0.34, 0.3], azSkew: [1.02, 1.0, 0.97] },
  { id: 'eu-central', name: 'EU Central', azs: ['euc-az1', 'euc-az2', 'euc-az3'], computeProv: 5000, computeUsed: 3000, monthlySpend: 650_000, monthlyBudget: 680_000, growth: 0.011, capacityStep: null, leadTimeMonths: 4, azWeights: [0.34, 0.33, 0.33], azSkew: [1.55, 0.74, 0.72] },
  { id: 'ap-southeast', name: 'AP Southeast', azs: ['aps-az1', 'aps-az2', 'aps-az3'], computeProv: 4000, computeUsed: 2200, monthlySpend: 500_000, monthlyBudget: 470_000, growth: 0.038, capacityStep: { monthsAgo: 8, added: 0.2 }, leadTimeMonths: 5, azWeights: [0.5, 0.3, 0.2], azSkew: [1.08, 0.94, 0.9] },
]

export const WORKLOADS: Workload[] = [
  { id: 'home-feed', name: 'Home Feed Ranking', short: 'Home Feed', weight: 0.2, util: 0.78, growthAdj: 0.003, tier: 'Tier 0', reservedRatio: 0.82, priceFactor: 1.1, coldDataPct: 0.18, storageWeight: 0.12, networkWeight: 0.2, isAI: false, productRole: 'Primary discovery surface; every app open triggers ranking', challenge: 'Compute-intensive recommendation requests with a strong daily traffic cycle', lever: 'Compute rightsizing, autoscaling to diurnal traffic' },
  { id: 'search', name: 'Search & Discovery', short: 'Search', weight: 0.13, util: 0.7, growthAdj: 0.002, tier: 'Tier 0', reservedRatio: 0.8, priceFactor: 1.0, coldDataPct: 0.22, storageWeight: 0.1, networkWeight: 0.14, isAI: false, productRole: 'Captures user intent across text and visual search', challenge: 'Latency-sensitive queries; capacity must sit close to users', lever: 'Regional capacity optimization and placement' },
  { id: 'ads', name: 'Ads Serving', short: 'Ads', weight: 0.16, util: 0.8, growthAdj: 0.005, tier: 'Tier 0', reservedRatio: 0.85, priceFactor: 1.05, coldDataPct: 0.2, storageWeight: 0.1, networkWeight: 0.18, isAI: false, productRole: 'Monetization; revenue scales with served impressions', challenge: 'High-throughput, latency-sensitive auctions', lever: 'Compute and network efficiency per auction' },
  { id: 'ml-training', name: 'ML Training & Inference (AI)', short: 'AI / ML', weight: 0.17, util: 0.86, growthAdj: 0.016, tier: 'Tier 1', reservedRatio: 0.78, priceFactor: 2.6, coldDataPct: 0.34, storageWeight: 0.16, networkWeight: 0.16, isAI: true, productRole: 'Powers recommendations, ads relevance and visual search', challenge: 'Expensive GPU consumption for training and inference', lever: 'GPU utilization, job scheduling, batching' },
  { id: 'media', name: 'Image Serving & Processing', short: 'Image Serving', weight: 0.12, util: 0.5, growthAdj: 0.0, tier: 'Tier 1', reservedRatio: 0.8, priceFactor: 1.2, coldDataPct: 0.56, storageWeight: 0.28, networkWeight: 0.12, isAI: false, productRole: 'Every Pin is an image; served in many sizes worldwide', challenge: 'High storage and network (egress) demand', lever: 'Image compression, CDN caching, cold-tiering originals' },
  { id: 'data-platform', name: 'Data Platform (Batch / Spark)', short: 'Data Platform', weight: 0.14, util: 0.4, growthAdj: -0.002, tier: 'Tier 2', reservedRatio: 0.76, priceFactor: 0.9, coldDataPct: 0.62, storageWeight: 0.18, networkWeight: 0.1, isAI: false, productRole: 'Analytics, experimentation and ML training data', challenge: 'Large batch processing and long data retention', lever: 'Off-peak scheduling, storage tiering' },
  { id: 'core-api', name: 'Core API & Services', short: 'Core API', weight: 0.08, util: 0.6, growthAdj: 0.001, tier: 'Tier 0', reservedRatio: 0.84, priceFactor: 1.0, coldDataPct: 0.15, storageWeight: 0.06, networkWeight: 0.1, isAI: false, productRole: 'Shared backbone: users, Pins, boards and graph APIs', challenge: 'Fan-out from every product surface; must stay up', lever: 'Rightsizing that preserves N+1 AZ headroom' },
]

export const INFRA_TYPES: { id: InfraType; name: string; unit: string }[] = [
  { id: 'compute', name: 'Compute', unit: 'units' },
  { id: 'storage', name: 'Storage', unit: 'TB' },
  { id: 'network', name: 'Network', unit: 'Gbps' },
]

const HARDWARE: Record<InfraType, Record<string, string>> = {
  compute: {
    'home-feed': 'c7i.8xlarge',
    search: 'r7i.4xlarge',
    ads: 'c7g.8xlarge',
    'ml-training': 'p5.48xlarge (GPU)',
    media: 'g5.4xlarge (GPU)',
    'data-platform': 'm6i.8xlarge',
    'core-api': 'm7g.4xlarge',
  },
  storage: {
    'home-feed': 'Block SSD (gp3)',
    search: 'Block SSD (io2)',
    ads: 'Block SSD (gp3)',
    'ml-training': 'Object – Standard',
    media: 'Object – Standard',
    'data-platform': 'HDFS (d3en)',
    'core-api': 'Block SSD (gp3)',
  },
  network: {
    'home-feed': 'Transit + LB tier',
    search: 'Transit + LB tier',
    ads: 'Transit + LB tier',
    'ml-training': 'Cluster fabric 400G',
    media: 'CDN origin egress',
    'data-platform': 'Inter-AZ backbone',
    'core-api': 'Transit + LB tier',
  },
}

const COST_SPLIT: Record<InfraType, number> = { compute: 0.62, storage: 0.23, network: 0.15 }

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildInventory(): InventoryRow[] {
  const rand = mulberry32(20261109)
  const jitter = (spread: number) => 1 + (rand() * 2 - 1) * spread
  const rows: InventoryRow[] = []

  for (const region of REGIONS) {
    const regionRows: InventoryRow[] = []
    const regionUtil = region.computeUsed / region.computeProv

    // Compute: distribute provisioned by workload weight, then fit used to the region total.
    const weights = WORKLOADS.map((w) => w.weight * jitter(0.15))
    const wSum = weights.reduce((a, b) => a + b, 0)
    const prov = weights.map((w) => Math.round((region.computeProv * w) / wSum))
    prov[prov.length - 1] += region.computeProv - prov.reduce((a, b) => a + b, 0)

    let utils = WORKLOADS.map((w) => w.util * jitter(0.08))
    // Fit utilizations so total used matches the regional figure (iterative, capped at 97%).
    for (let iter = 0; iter < 8; iter++) {
      const used = utils.reduce((s, u, i) => s + u * prov[i], 0)
      const factor = (regionUtil * region.computeProv) / used
      utils = utils.map((u) => Math.min(0.97, u * factor))
    }
    const usedArr = utils.map((u, i) => Math.round(u * prov[i]))
    const lowest = usedArr.reduce((best, u, i) => (u / prov[i] < usedArr[best] / prov[best] ? i : best), 0)
    usedArr[lowest] += region.computeUsed - usedArr.reduce((a, b) => a + b, 0)

    WORKLOADS.forEach((w, i) => {
      const util = usedArr[i] / prov[i]
      regionRows.push({
        id: `${region.id}:${w.id}:compute`,
        region: region.id,
        az: region.azs[i % region.azs.length],
        workload: w.id,
        type: 'compute',
        hardware: HARDWARE.compute[w.id],
        unit: 'units',
        provisioned: prov[i],
        used: usedArr[i],
        reserved: Math.round(prov[i] * Math.min(0.95, w.reservedRatio * jitter(0.06))),
        monthlyCost: 0,
        growth: region.growth + w.growthAdj,
        cpuUtil: Math.min(0.98, util * 0.92 * jitter(0.05)),
        memUtil: Math.min(0.98, util * 1.04 * jitter(0.05)),
        utilVolatility: 0.03 + rand() * 0.12,
        coldPct: 0,
      })
    })

    // Storage (TB) and network (Gbps).
    const storageTotal = region.computeProv * 1.8
    const networkTotal = region.computeProv * 0.12
    WORKLOADS.forEach((w, i) => {
      const sProv = Math.round(storageTotal * w.storageWeight * jitter(0.12))
      const sUtil = Math.min(0.92, (0.48 + rand() * 0.38) * (region.id === 'eu-west' ? 1.15 : 1))
      regionRows.push({
        id: `${region.id}:${w.id}:storage`,
        region: region.id,
        az: region.azs[(i + 1) % region.azs.length],
        workload: w.id,
        type: 'storage',
        hardware: HARDWARE.storage[w.id],
        unit: 'TB',
        provisioned: sProv,
        used: Math.round(sProv * sUtil),
        reserved: Math.round(sProv * 0.6),
        monthlyCost: 0,
        growth: region.growth * 0.8 + w.growthAdj,
        cpuUtil: 0,
        memUtil: 0,
        utilVolatility: 0.02 + rand() * 0.05,
        coldPct: Math.min(0.8, w.coldDataPct * jitter(0.15)),
      })
      const nProv = Math.max(10, Math.round(networkTotal * w.networkWeight * jitter(0.12)))
      const nUtil = Math.min(0.9, (0.24 + rand() * 0.46) * (region.id === 'eu-west' ? 1.3 : 1))
      regionRows.push({
        id: `${region.id}:${w.id}:network`,
        region: region.id,
        az: region.azs[(i + 2) % region.azs.length],
        workload: w.id,
        type: 'network',
        hardware: HARDWARE.network[w.id],
        unit: 'Gbps',
        provisioned: nProv,
        used: Math.round(nProv * nUtil),
        reserved: Math.round(nProv * (0.7 + rand() * 0.2)),
        monthlyCost: 0,
        growth: region.growth * 0.9 + w.growthAdj * 0.5,
        cpuUtil: 0,
        memUtil: 0,
        utilVolatility: 0.05 + rand() * 0.15,
        coldPct: 0,
      })
    })

    // Allocate regional spend across rows, weighted by provisioned size and unit price.
    for (const type of ['compute', 'storage', 'network'] as InfraType[]) {
      const typed = regionRows.filter((r) => r.type === type)
      const weightOf = (r: InventoryRow) => r.provisioned * (type === 'compute' ? WORKLOADS.find((w) => w.id === r.workload)!.priceFactor : 1)
      const total = typed.reduce((s, r) => s + weightOf(r), 0)
      typed.forEach((r) => {
        r.monthlyCost = Math.round((region.monthlySpend * COST_SPLIT[type] * weightOf(r)) / total)
      })
    }
    rows.push(...regionRows)
  }
  return rows
}

const AI_AZ_WEIGHTS = [0.6, 0.25, 0.15] // GPU supply is typically concentrated where it could be obtained

/** Spread each compute pool across AZs. Uses its own RNG so the base inventory stays stable. */
function splitAcrossAzs(rows: InventoryRow[]) {
  const rand = mulberry32(4242)
  for (const r of rows) {
    if (r.type !== 'compute') continue
    const region = REGIONS.find((x) => x.id === r.region)!
    const w = WORKLOADS.find((x) => x.id === r.workload)!.isAI ? AI_AZ_WEIGHTS : region.azWeights
    const prov = w.map((x) => Math.round(r.provisioned * x))
    prov[prov.length - 1] += r.provisioned - prov.reduce((a, b) => a + b, 0)
    const util = r.used / r.provisioned
    let used = region.azSkew.map((k, i) => prov[i] * Math.min(0.98, util * k * (1 + (rand() - 0.5) * 0.04)))
    for (let iter = 0; iter < 10; iter++) {
      const f = r.used / used.reduce((a, b) => a + b, 0)
      used = used.map((u, i) => Math.min(prov[i] * 0.98, u * f))
    }
    const rounded = used.map(Math.round)
    const room = rounded.map((u, i) => prov[i] - u)
    rounded[room.indexOf(Math.max(...room))] += r.used - rounded.reduce((a, b) => a + b, 0)
    r.azSplit = region.azs.map((az, i) => ({ az, provisioned: prov[i], used: rounded[i] }))
    r.az = `${region.azs.length} AZs`
  }
  return rows
}

export const INVENTORY: InventoryRow[] = splitAcrossAzs(buildInventory())

export const regionById = (id: string) => REGIONS.find((r) => r.id === id)!
export const workloadById = (id: string) => WORKLOADS.find((w) => w.id === id)!

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Label for a month offset relative to AS_OF (0 = current month, -1 = previous, +1 = next). */
export function monthLabel(offset: number): string {
  const d = new Date(AS_OF.getFullYear(), AS_OF.getMonth() + offset, 1)
  return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
}
export function monthDate(offset: number): Date {
  return new Date(AS_OF.getFullYear(), AS_OF.getMonth() + offset, 1)
}
