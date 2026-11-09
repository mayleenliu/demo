import { INVENTORY, REGIONS, regionById } from '../data/model'
import { GPU_ALLOCATION, GPU_JOBS, GPU_RATE, GPU_SPEND_SPLIT, HOURS_PER_MONTH, type GpuJob, type GpuKind } from '../data/gpu'

export type Bottleneck = 'Idle reservation' | 'Unbatched requests' | 'Input pipeline stall' | 'Poor multi-GPU scaling' | 'Underfilled GPU' | 'Scheduler queueing' | 'Healthy'

export const BOTTLENECK_FIX: Record<Bottleneck, string> = {
  'Idle reservation': 'Auto-release notebooks idle for 30+ min and move them to a shared, preemptible pool',
  'Unbatched requests': 'Enable dynamic request batching on the model server (few-ms batching window)',
  'Input pipeline stall': 'Cache decoded/resized images, prefetch, add data-loader workers, move preprocessing off GPU hosts',
  'Poor multi-GPU scaling': 'Halve the GPU count per run; added GPUs barely speed this job up',
  'Underfilled GPU': 'Raise batch size and use mixed precision, or pack two jobs per GPU (MIG / fractional GPUs)',
  'Scheduler queueing': 'Gang-schedule and backfill into off-peak unallocated GPU-hours',
  Healthy: 'No action. Utilization is within the expected range for this job type',
}

export interface JobAnalysis extends GpuJob {
  gpuHours: number
  usefulHours: number
  runsPerMonth: number
  monthlyCost: number
  costPerRun: number
  costPerUsefulHour: number
  rate: number
  idle: { dataStall: number; comm: number; underfilled: number }
  checks: { waitingOnData: boolean; memoryUnderused: boolean; canBatch: boolean; schedulingIssue: boolean; overprovisioned: boolean }
  bottleneck: Bottleneck
  smAfter: number
  savedHours: number
  savings: number
  tradeoff: string
  calc: { label: string; formula: string; result: string }[]
}

export interface GpuPool {
  region: string
  kind: GpuKind
  gpus: number
  available: number
  allocated: number
  spend: number
}

function pools(): GpuPool[] {
  return REGIONS.flatMap((reg) => {
    const aiRow = INVENTORY.find((r) => r.region === reg.id && r.workload === 'ml-training' && r.type === 'compute')!
    return (['Training', 'Inference'] as GpuKind[]).map((kind) => {
      const spend = aiRow.monthlyCost * GPU_SPEND_SPLIT[kind]
      const gpus = Math.round(spend / (GPU_RATE[kind].perHour * HOURS_PER_MONTH))
      const available = gpus * HOURS_PER_MONTH
      return { region: reg.id, kind, gpus, available, allocated: available * GPU_ALLOCATION[reg.id][kind], spend: gpus * HOURS_PER_MONTH * GPU_RATE[kind].perHour }
    })
  })
}

export const GPU_POOLS = pools()

/** Named jobs plus a per-region long tail that fills the remaining allocated training hours. */
function withLongTail(): GpuJob[] {
  const tail: GpuJob[] = REGIONS.map((reg) => ({
    id: `j-tail-${reg.id}`,
    name: 'Long-tail jobs (< 8 GPUs each)',
    team: 'Various',
    region: reg.id,
    kind: 'Training',
    gpus: 0,
    hoursPerRun: 0,
    runsPerMonth: 0,
    smUtil: 0.46,
    memUtil: 0.52,
    dataWait: 0.1,
    commOverhead: 0.04,
    scalingEff: 0.92,
    queueWaitHrs: 3,
  }))
  return [...GPU_JOBS.filter((j) => j.kind === 'Training'), ...tail, ...GPU_JOBS.filter((j) => j.kind === 'Inference')]
}
const ALL_JOBS = withLongTail()
const namedHours = (j: GpuJob) => j.gpus * j.hoursPerRun * j.runsPerMonth

const pct = (n: number) => `${(n * 100).toFixed(0)}%`
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

function analyze(job: GpuJob): JobAnalysis {
  const pool = GPU_POOLS.find((p) => p.region === job.region && p.kind === job.kind)!
  const isTail = job.id.startsWith('j-tail-')
  const named = ALL_JOBS.filter((j) => j.region === job.region && j.kind === 'Training' && !j.id.startsWith('j-tail-')).reduce((s, j) => s + namedHours(j), 0)
  const gpuHours = job.kind === 'Inference' ? pool.allocated : isTail ? Math.max(0, pool.allocated - named) : namedHours(job)
  const rate = GPU_RATE[job.kind].perHour
  const gpus = job.kind === 'Inference' || isTail ? Math.max(1, Math.round(gpuHours / HOURS_PER_MONTH)) : job.gpus
  const runsPerMonth = job.kind === 'Training' && !isTail ? job.runsPerMonth : 0
  const usefulHours = gpuHours * job.smUtil
  const dataStall = gpuHours * job.dataWait
  const comm = gpuHours * job.commOverhead
  const underfilled = Math.max(0, gpuHours - usefulHours - dataStall - comm)

  const checks = {
    waitingOnData: job.dataWait >= 0.2,
    memoryUnderused: job.memUtil < 0.45,
    canBatch: !!job.unbatched || (job.memUtil < 0.45 && !job.interactive),
    schedulingIssue: job.queueWaitHrs >= 6 || !!job.interactive,
    overprovisioned: job.scalingEff < 0.7 || !!job.interactive,
  }

  let bottleneck: Bottleneck = 'Healthy'
  let smAfter = job.smUtil
  let saveFrac = 0
  let tradeoff = 'None'
  const calc: JobAnalysis['calc'] = [
    {
      label: 'GPU-hours / month',
      formula:
        job.kind === 'Inference'
          ? `${gpus} replicas × ${HOURS_PER_MONTH} hrs × ${pct(GPU_ALLOCATION[job.region].Inference)} allocated`
          : isTail
            ? `${Math.round(pool.allocated).toLocaleString()} allocated training GPU-hrs in ${regionById(job.region).name} − named jobs`
            : `${job.gpus} GPUs × ${job.hoursPerRun} hrs/run × ${job.runsPerMonth} runs`,
      result: Math.round(gpuHours).toLocaleString(),
    },
    { label: 'Useful GPU-hours', formula: `${Math.round(gpuHours).toLocaleString()} × SM utilization ${pct(job.smUtil)}`, result: Math.round(usefulHours).toLocaleString() },
  ]
  if (job.interactive) {
    bottleneck = 'Idle reservation'
    saveFrac = 0.55
    smAfter = job.smUtil / (1 - saveFrac)
    tradeoff = 'Notebook start-up takes ~2 min after idle release'
    calc.push({ label: 'Recoverable', formula: '55% of reserved hours are idle sessions (no kernel activity > 30 min)', result: pct(saveFrac) })
  } else if (job.unbatched) {
    bottleneck = 'Unbatched requests'
    smAfter = Math.min(0.65, job.smUtil * 1.6)
    saveFrac = 1 - job.smUtil / smAfter
    tradeoff = 'Adds 2–5 ms p99 latency from the batching window'
    calc.push({ label: 'SM after batching', formula: `min(65%, ${pct(job.smUtil)} × 1.6)`, result: pct(smAfter) })
  } else if (checks.waitingOnData) {
    bottleneck = 'Input pipeline stall'
    smAfter = job.smUtil / (1 - job.dataWait * 0.6)
    saveFrac = 1 - job.smUtil / smAfter
    tradeoff = 'Needs ~2 TB of SSD cache per training node'
    calc.push({ label: 'SM after fix', formula: `${pct(job.smUtil)} ÷ (1 − 60% of ${pct(job.dataWait)} data-wait recovered)`, result: pct(smAfter) })
  } else if (job.scalingEff < 0.7) {
    bottleneck = 'Poor multi-GPU scaling'
    const effAfter = Math.min(0.9, job.scalingEff + 0.25)
    saveFrac = 1 - job.scalingEff / effAfter
    smAfter = job.smUtil / (1 - saveFrac)
    tradeoff = `Each run takes ${((2 * job.scalingEff) / effAfter).toFixed(2)}× longer on half the GPUs`
    calc.push({ label: 'GPU-hours after halving GPUs', formula: `scaling efficiency ${pct(job.scalingEff)} → ${pct(effAfter)}; hours × ${job.scalingEff.toFixed(2)}/${effAfter.toFixed(2)}`, result: pct(1 - saveFrac) })
  } else if (checks.memoryUnderused && job.smUtil < 0.45) {
    bottleneck = 'Underfilled GPU'
    smAfter = Math.min(0.7, job.smUtil * 1.5)
    saveFrac = 1 - job.smUtil / smAfter
    tradeoff = 'Larger batches may need learning-rate retuning; validate model quality'
    calc.push({ label: 'SM after batching / packing', formula: `min(70%, ${pct(job.smUtil)} × 1.5)`, result: pct(smAfter) })
  } else if (checks.schedulingIssue) {
    bottleneck = 'Scheduler queueing'
    tradeoff = 'Runs shift to nights and weekends'
  }
  const savedHours = gpuHours * saveFrac
  const savings = savedHours * rate
  if (savedHours > 0) calc.push({ label: 'Monthly savings', formula: `${Math.round(gpuHours).toLocaleString()} GPU-hrs × (1 − ${pct(job.smUtil)} ÷ ${pct(smAfter)}) × $${rate.toFixed(2)}/GPU-hr`, result: usd(savings) })

  return {
    ...job,
    gpus,
    gpuHours,
    usefulHours,
    runsPerMonth,
    monthlyCost: gpuHours * rate,
    costPerRun: job.kind === 'Training' && !isTail ? job.gpus * job.hoursPerRun * rate : 0,
    costPerUsefulHour: rate / job.smUtil,
    rate,
    idle: { dataStall, comm, underfilled },
    checks,
    bottleneck,
    smAfter,
    savedHours,
    savings,
    tradeoff,
    calc,
  }
}

export const GPU_ANALYSIS: JobAnalysis[] = ALL_JOBS.map(analyze)

export interface GpuLevers {
  idleRelease: number
  batching: number
  pipeline: number
  rightsize: number
  backfill: number
}
export const NO_LEVERS: GpuLevers = { idleRelease: 0, batching: 0, pipeline: 0, rightsize: 0, backfill: 0 }

const LEVER_OF: Partial<Record<Bottleneck, keyof GpuLevers>> = {
  'Idle reservation': 'idleRelease',
  'Unbatched requests': 'batching',
  'Underfilled GPU': 'batching',
  'Input pipeline stall': 'pipeline',
  'Poor multi-GPU scaling': 'rightsize',
}

/** Share of unallocated training GPU-hours that queued jobs could realistically backfill. */
export const BACKFILL_CAPTURE = 0.6

export function gpuFleet(region: string, levers: GpuLevers = NO_LEVERS) {
  const ps = GPU_POOLS.filter((p) => region === 'all' || p.region === region)
  const jobs = GPU_ANALYSIS.filter((j) => region === 'all' || j.region === region)
  const sumP = (k: GpuKind | 'all', f: (p: GpuPool) => number) => ps.filter((p) => k === 'all' || p.kind === k).reduce((s, p) => s + f(p), 0)
  const gpus = sumP('all', (p) => p.gpus)
  const available = sumP('all', (p) => p.available)
  const allocated = sumP('all', (p) => p.allocated)
  const spend = sumP('all', (p) => p.spend)
  const useful = jobs.reduce((s, j) => s + j.usefulHours, 0)
  const memUtil = jobs.reduce((s, j) => s + j.memUtil * j.gpuHours, 0) / Math.max(1, allocated)
  const unallocTraining = sumP('Training', (p) => p.available - p.allocated)

  const byKind = (k: GpuKind) => {
    const kj = jobs.filter((j) => j.kind === k)
    const avail = sumP(k, (p) => p.available)
    const alloc = sumP(k, (p) => p.allocated)
    const segs = {
      useful: kj.reduce((s, j) => s + j.usefulHours, 0),
      dataStall: kj.reduce((s, j) => s + j.idle.dataStall, 0),
      comm: kj.reduce((s, j) => s + j.idle.comm, 0),
      underfilled: kj.filter((j) => !j.interactive).reduce((s, j) => s + j.idle.underfilled, 0),
      idleReserved: kj.filter((j) => j.interactive).reduce((s, j) => s + j.idle.underfilled, 0),
      unallocated: avail - alloc,
    }
    return { kind: k, gpus: sumP(k, (p) => p.gpus), available: avail, allocated: alloc, segs }
  }

  const leverSaved = jobs.reduce((s, j) => {
    const lever = LEVER_OF[j.bottleneck]
    return s + (lever ? j.savedHours * levers[lever] : 0)
  }, 0)
  const leverSavings = jobs.reduce((s, j) => {
    const lever = LEVER_OF[j.bottleneck]
    return s + (lever ? j.savings * levers[lever] : 0)
  }, 0)
  const backfillHours = unallocTraining * BACKFILL_CAPTURE * levers.backfill
  const freedHours = leverSaved + backfillHours
  const freedSavings = leverSavings + backfillHours * GPU_RATE.Training.perHour

  return {
    pools: ps,
    jobs,
    gpus,
    available,
    allocated,
    useful,
    spend,
    allocRate: allocated / available,
    smUtil: useful / allocated,
    effectiveUtil: useful / available,
    memUtil,
    idleHours: available - useful,
    costPerUsefulHour: spend / useful,
    training: byKind('Training'),
    inference: byKind('Inference'),
    unallocTraining,
    whatIf: {
      freedHours,
      gpusFreed: freedHours / HOURS_PER_MONTH,
      monthlySavings: freedSavings,
      effectiveUtilAfter: useful / Math.max(1, available - freedHours),
    },
  }
}

/** 24-hour utilization profile (synthetic diurnal shape scaled to the fleet's measured averages). */
export function hourlyProfile(fleet: ReturnType<typeof gpuFleet>) {
  const tAlloc = fleet.training.allocated / Math.max(1, fleet.training.available)
  const iAlloc = fleet.inference.allocated / Math.max(1, fleet.inference.available)
  const sm = fleet.smUtil
  return Array.from({ length: 24 }, (_, h) => {
    const day = Math.sin(((h - 7) / 24) * 2 * Math.PI) // peaks mid-afternoon
    const work = h >= 9 && h <= 18 ? 1 : 0
    const train = Math.min(1, tAlloc * (1 + 0.12 * work - 0.18 * (h >= 0 && h <= 5 ? 1 : 0)))
    const infer = Math.min(1, iAlloc * (0.82 + 0.22 * Math.max(0, day)))
    return {
      hour: `${String(h).padStart(2, '0')}:00`,
      trainingAllocated: train,
      inferenceAllocated: infer,
      smUtil: Math.min(1, sm * (0.85 + 0.25 * Math.max(0, day))),
    }
  })
}
