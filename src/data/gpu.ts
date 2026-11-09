// Synthetic GPU fleet and ML job telemetry. Model names describe generic recommender / visual-discovery
// workloads and are illustrative only.

export type GpuKind = 'Training' | 'Inference'

export interface GpuJob {
  id: string
  name: string
  team: string
  region: string
  kind: GpuKind
  /** GPUs requested per run (training) or replicas (inference). */
  gpus: number
  /** Wall-clock hours per run (training). */
  hoursPerRun: number
  /** Training runs per month (inference services run continuously). */
  runsPerMonth: number
  /** Average streaming-multiprocessor (compute) utilization while allocated. */
  smUtil: number
  /** Average GPU memory utilization while allocated. */
  memUtil: number
  /** Share of allocated time stalled waiting on the input pipeline. */
  dataWait: number
  /** Share of allocated time in collective communication / checkpointing. */
  commOverhead: number
  /** Measured speedup ÷ ideal speedup at the requested GPU count (1 = linear). */
  scalingEff: number
  /** Median hours a run waits in the scheduler queue. */
  queueWaitHrs: number
  /** Interactive / reserved pool rather than batch jobs. */
  interactive?: boolean
  /** Requests are served one-by-one (no dynamic batching). */
  unbatched?: boolean
}

export const GPU_RATE: Record<GpuKind, { type: string; perHour: number }> = {
  Training: { type: 'H100-class (80 GB)', perHour: 2.8 },
  Inference: { type: 'L4-class (24 GB)', perHour: 0.85 },
}
/** Share of each region's AI/ML compute spend that goes to each GPU kind. Rates are blended committed-use prices. */
export const GPU_SPEND_SPLIT: Record<GpuKind, number> = { Training: 0.72, Inference: 0.28 }
/** Allocated GPU-hours ÷ available GPU-hours, by region and kind (scheduler data). */
export const GPU_ALLOCATION: Record<string, Record<GpuKind, number>> = {
  'us-east': { Training: 0.88, Inference: 0.94 },
  'us-west': { Training: 0.82, Inference: 0.9 },
  'eu-west': { Training: 0.9, Inference: 0.95 },
  'eu-central': { Training: 0.74, Inference: 0.88 },
  'ap-southeast': { Training: 0.7, Inference: 0.86 },
}
export const HOURS_PER_MONTH = 720

export const GPU_JOBS: GpuJob[] = [
  { id: 'j-feed-rank', name: 'Home Feed ranking model (daily retrain)', team: 'Home Feed ML', region: 'us-east', kind: 'Training', gpus: 32, hoursPerRun: 8, runsPerMonth: 30, smUtil: 0.5, memUtil: 0.64, dataWait: 0.18, commOverhead: 0.1, scalingEff: 0.8, queueWaitHrs: 1.5 },
  { id: 'j-visual-embed', name: 'Visual search image embeddings', team: 'Visual Discovery', region: 'us-east', kind: 'Training', gpus: 64, hoursPerRun: 36, runsPerMonth: 4, smUtil: 0.31, memUtil: 0.4, dataWait: 0.42, commOverhead: 0.08, scalingEff: 0.74, queueWaitHrs: 6 },
  { id: 'j-notebooks', name: 'Interactive notebooks & experiments', team: 'ML Platform', region: 'us-east', kind: 'Training', gpus: 16, hoursPerRun: 720, runsPerMonth: 1, smUtil: 0.11, memUtil: 0.22, dataWait: 0.05, commOverhead: 0.0, scalingEff: 1, queueWaitHrs: 0, interactive: true },
  { id: 'j-sweeps', name: 'Hyperparameter sweeps', team: 'ML Platform', region: 'us-east', kind: 'Training', gpus: 8, hoursPerRun: 4, runsPerMonth: 250, smUtil: 0.54, memUtil: 0.46, dataWait: 0.1, commOverhead: 0.02, scalingEff: 0.95, queueWaitHrs: 14 },
  { id: 'j-ads-ctr', name: 'Ads CTR prediction (incremental)', team: 'Ads Ranking', region: 'us-west', kind: 'Training', gpus: 32, hoursPerRun: 5, runsPerMonth: 90, smUtil: 0.56, memUtil: 0.71, dataWait: 0.11, commOverhead: 0.09, scalingEff: 0.86, queueWaitHrs: 2 },
  { id: 'j-related-pins', name: 'Related-content graph embeddings', team: 'Discovery ML', region: 'us-west', kind: 'Training', gpus: 48, hoursPerRun: 18, runsPerMonth: 12, smUtil: 0.29, memUtil: 0.33, dataWait: 0.16, commOverhead: 0.27, scalingEff: 0.52, queueWaitHrs: 3 },
  { id: 'j-search-qu', name: 'Search query understanding', team: 'Search ML', region: 'eu-west', kind: 'Training', gpus: 16, hoursPerRun: 6, runsPerMonth: 120, smUtil: 0.41, memUtil: 0.3, dataWait: 0.12, commOverhead: 0.05, scalingEff: 0.9, queueWaitHrs: 4 },
  { id: 'j-gen-bg', name: 'Generative ad creative experiments', team: 'Ads Creative AI', region: 'eu-west', kind: 'Training', gpus: 32, hoursPerRun: 12, runsPerMonth: 30, smUtil: 0.46, memUtil: 0.86, dataWait: 0.07, commOverhead: 0.12, scalingEff: 0.82, queueWaitHrs: 9 },
  { id: 'j-catalog', name: 'Shopping catalog embeddings', team: 'Shopping ML', region: 'eu-central', kind: 'Training', gpus: 16, hoursPerRun: 3, runsPerMonth: 180, smUtil: 0.3, memUtil: 0.27, dataWait: 0.14, commOverhead: 0.04, scalingEff: 0.88, queueWaitHrs: 1 },
  { id: 'j-safety', name: 'Content safety classifier', team: 'Trust & Safety ML', region: 'ap-southeast', kind: 'Training', gpus: 8, hoursPerRun: 1.5, runsPerMonth: 300, smUtil: 0.23, memUtil: 0.24, dataWait: 0.2, commOverhead: 0.02, scalingEff: 0.95, queueWaitHrs: 0.5 },

  { id: 'i-feed', name: 'Home Feed ranking inference', team: 'Home Feed ML', region: 'us-east', kind: 'Inference', gpus: 0, hoursPerRun: 0, runsPerMonth: 0, smUtil: 0.34, memUtil: 0.41, dataWait: 0.03, commOverhead: 0, scalingEff: 1, queueWaitHrs: 0, unbatched: true },
  { id: 'i-ads', name: 'Ads relevance inference', team: 'Ads Ranking', region: 'us-west', kind: 'Inference', gpus: 0, hoursPerRun: 0, runsPerMonth: 0, smUtil: 0.42, memUtil: 0.48, dataWait: 0.02, commOverhead: 0, scalingEff: 1, queueWaitHrs: 0 },
  { id: 'i-visual', name: 'Visual search inference', team: 'Visual Discovery', region: 'eu-west', kind: 'Inference', gpus: 0, hoursPerRun: 0, runsPerMonth: 0, smUtil: 0.27, memUtil: 0.35, dataWait: 0.04, commOverhead: 0, scalingEff: 1, queueWaitHrs: 0, unbatched: true },
  { id: 'i-catalog', name: 'Shopping recommendations inference', team: 'Shopping ML', region: 'eu-central', kind: 'Inference', gpus: 0, hoursPerRun: 0, runsPerMonth: 0, smUtil: 0.3, memUtil: 0.32, dataWait: 0.03, commOverhead: 0, scalingEff: 1, queueWaitHrs: 0, unbatched: true },
  { id: 'i-safety', name: 'Content safety inference', team: 'Trust & Safety ML', region: 'ap-southeast', kind: 'Inference', gpus: 0, hoursPerRun: 0, runsPerMonth: 0, smUtil: 0.38, memUtil: 0.3, dataWait: 0.02, commOverhead: 0, scalingEff: 1, queueWaitHrs: 0 },
]
