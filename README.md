# Infrastructure Capacity & Efficiency Control Tower

An interactive decision-support demo that shows how an Infrastructure TPM can manage cloud capacity, improve utilization, find cost inefficiencies, and use AI to cut down on program-management toil.

> **Portfolio demo.** All data is synthetic and illustrative. It is not affiliated with, and does not represent, any company's internal systems. No credentials, production endpoints, or private infrastructure information are used.

**Live demo:** https://mayleenliu.github.io/demo/

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
```

There's no backend and no API keys. App state (approvals, statuses, audit log) is saved in `localStorage`. Use **Reset demo data** in the sidebar to restore the starting state.

## What's inside

| Section | What it demonstrates |
| --- | --- |
| **Executive Overview** | KPIs, 12-month utilization trend, spend vs budget, 6-month demand forecast, regional heatmap, top opportunities, health indicators |
| **Capacity & Utilization** | Inventory (region / AZ / workload / hardware / reserved / headroom), utilization by region and workload, a forecasting simulator (demand, growth, threshold, horizon, optimize-first), a what-if comparison (business-as-usual vs AI-accelerated growth vs optimize-before-buying), and an **AZ failover simulator** that fails one AZ and moves its load into the same hardware pool in the surviving AZs |
| **Cost Optimization** | A workload economics table (business role → infrastructure challenge → optimization lever → spend → savings), plus rule-based detection of underutilized compute and GPUs, CDN / image-format savings, storage, network, and stranded capacity; a prioritization matrix; sortable table; approval workflow (Proposed → Under Review → Approved → In Progress → Completed); push approved items to Program Execution |
| **GPU Efficiency** | GPU fleet allocation vs useful compute (SM) utilization, GPU memory use, idle GPU-hours, cost per useful GPU-hour and per training run, a breakdown of where GPU time goes, a 24-hour profile, a per-job investigation checklist (waiting on data? memory underused? batchable? scheduling? over-provisioned?), and a what-if showing how much of the planned GPU purchase utilization fixes would offset |
| **AI Recommendations** | Simulated assistant with five workflows: efficiency analysis, regional capacity planning (including an N+1 check), executive update, quarterly prioritization, and GPU utilization diagnosis. Each answer shows source metrics, calculations, assumptions, and confidence, and requires human review |
| **Program Execution** | Initiative tracker and timeline, overdue / at-risk milestones, cross-team dependencies, decisions, program financials, and an AI TPM assistant (weekly status, risk scan, follow-ups, meeting notes → action items, dependency risk, exec summary) with edit and approval steps before anything is communicated |
| **AI Governance** | Audit trail (sources, timestamp, confidence, reviewer, status, edits), responsible-AI principles, and a role-based access matrix. Switch roles in the sidebar to see redaction and approval gating |

Global filters (region, infra type, workload, time period) apply to every chart, metric, and AI answer.

## About the "AI"

No LLM is called. The assistant is a **deterministic engine** (`src/lib/ai.ts`, `src/lib/tpm.ts`) that computes every number from the in-app dataset and shows its work. This is intentional:

- It never claims an analysis it didn't perform. Questions it can't answer from the data are declined.
- Measured data and AI-generated content are labeled differently.
- Recommendations below 60% confidence are flagged and can't be approved until a reviewer validates the source data.
- The AI can recommend but has no way to change infrastructure.

## Synthetic data assumptions

- **Regions** (`src/data/model.ts`): five regions using the brief's provisioned / used / spend figures (e.g. US East 10,000 units, 7,200 used, $1.2M/mo). Each region has its own monthly growth rate (1.1%–3.8%), budget, procurement lead time (3–5 months), and capacity history.
- **Workloads:** seven workloads (Home Feed, Search, Ads, AI/ML, Media, Data Platform, Core API) with different tiers, utilization profiles, growth adjustments (AI/ML grows fastest), and unit prices (GPU-heavy AI costs roughly 2.6× more per unit).
- **Inventory:** generated with a seeded random number generator, so it's identical on every load. Compute usage is fitted to match each regional total exactly. Spend is split 62% compute, 23% storage, 15% network.
- **Forecasting:** demand compounds monthly per workload. The aggregate planning threshold is **85%**.
- **85% aggregate is not an N+1 guarantee.** Losing one of three equal AZs raises load on the survivors by 1.5×, so even perfectly interchangeable capacity must stay at or below ceiling × 2/3 (60% at a 90% failover ceiling). Unequal AZ sizes lower that limit further. Capacity also isn't interchangeable: GPU and Tier 0 pools can only fail over into the same pool. Each compute pool is therefore split across AZs with uneven sizes and load (e.g. EU Central's AZs run at 85% / 45% / 44%, 60% overall, mirroring a hot-AZ scenario). The failover simulator checks each pool separately. Tier 0 shortfalls count as outage risk, Tier 1 as degraded service, and Tier 2 batch as deferrable.
- **Rightsizing targets are tier-aware:** 60% for Tier 0 (N+1-safe at a 90% failover ceiling) and 65% for Tier 1/2.
- **Workloads** are modeled on Pinterest's publicly described product (visual discovery, Home Feed, search, ads, shopping, AI-driven recommendations). Each workload is mapped to its main infrastructure challenge and optimization lever. No internal information is used.
- **GPU fleet** (`src/data/gpu.ts`, `src/lib/gpu.ts`): GPU counts come from each region's AI/ML compute spend at blended committed-use rates ($2.80/hr H100-class training, $0.85/hr L4-class inference). Jobs carry 30-day telemetry: SM and memory utilization, data-wait, communication overhead, multi-GPU scaling efficiency, and queue wait. Each job's main bottleneck is diagnosed by rules and gets a fix with an estimated utilization gain (e.g. recover 60% of data-wait; dynamic batching up to 65% SM). Fleet totals: ~88% of GPU-hours are allocated but only ~33% do useful compute.
- **Opportunity detection** (`src/lib/calc.ts`):
  - Compute: under 58% utilization → rightsize to the tier target; savings × 0.85 to account for reservation lock-in.
  - GPU: per-job bottleneck fixes worth more than $5K/mo.
  - Image serving: CDN cache-hit 88% → 94% plus AVIF/WebP (~25% fewer bytes) cuts origin egress.
  - Storage: cold data moved to a cheaper tier (60% price difference) plus oversized volumes shrunk to 80% full.
  - Network: under 42% of p95 → resize to 60%; savings × 0.7.
  - Stranded: reserved-but-unused capacity in regions with spare headroom, reallocated against the most constrained region's shortfall. The shortfall is counted only once, and data-residency limits are considered.
  - Confidence drops as 90-day utilization volatility rises.
- **Priority score** = financial impact ($K/mo) × confidence × feasibility, where feasibility = effort factor × risk factor.
- **Program data** (`src/data/program.ts`): fictional people and initiatives, dated relative to Nov 9, 2026.

## Tech

React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Lucide icons. Deployed to GitHub Pages with GitHub Actions (`.github/workflows/deploy.yml`).
