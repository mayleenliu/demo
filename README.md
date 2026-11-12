# SDN Appliance Capacity Planning

An interactive decision-support demo for a **capacity TPM running a network (SDN) appliance fleet**. It walks through the questions that come up every month:

- **Do we approve this customer request, phase it, or escalate for power?**
- **When do we order and dock?**
- **Can we rebalance racks to where they're needed?**
- **How do we refresh Gen6 before EOL: Gen8 now, or wait for Gen11?**
- **What do we decommission, and what's the write-off?**

> **Portfolio demo.** All fleet data, sites, SKUs and numbers are synthetic and illustrative. It does not represent any company's systems.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:5173 (edits under src/ hot-reload)
npm run build    # production build to dist/
```

No backend and no API keys. Decisions you make (approvals, orders, rebalancing, retirements) are saved in `localStorage`. Use **Reset decisions** in the sidebar to start over.

## Pages

| Page | What it shows |
| --- | --- |
| **Overview** | Racks deployed and utilization, regions at risk, power, Gen6 EOL countdown, open requests; **deployed fleet** by generation (racks, utilization, MW, book value, EOL) and racks docked by year; regional table (now / +6 / +12 months, rack mix, power) |
| **Capacity & Demand** | **Datacenter capacity**: space, power allocated vs drawn, stranded power, PUE, first region to run out; **trend and forecast** per region (racks deployed vs floor positions and power, racks needed at 75%, or % used) with the date a region runs out of space or power, with and without power reclaim; **customer requests** in racks against a cluster (Oracle 12 on phx23prdoci01, NetApp 10 on sn4prdnap01, Nutanix 200 on dsm10prdntx01, GitHub 100 on phx21prdgh01): approve if it fits → order racks if power and lead time allow → phase what fits → escalate for power → defer; **order timeline** (when a region hits 75%, order-by and dock-by, racks, Gen8 write-off); **optimize**: reclaim stranded power, reduce over-provisioning, unlock stranded space and power, improve PUE, protect availability (cluster-loss check); **rebalance racks** |
| **Hardware Lifecycle** | **Gen6 refresh strategy** (wait for Gen11 vs hybrid vs all Gen8, with a Gen11 slip toggle); **racks by generation** roadmap; **rack table**: one row per rack with dock date, utilization, book value, recommendation, retire date and write-off, plus search, filters, sorting and bulk actions (don't replace at EOL, retire early) |

## Model & assumptions (`src/data/fleet.ts`, `src/lib/capacity.ts`)

- **Regions & clusters:** Azure regions (West US 3, Central US, South Central US, West Europe, North Europe). Racks belong to clusters named `<site>prd<customer><nn>`, e.g. `phx23prdoci01` (Oracle), `sn4prdnap01` (NetApp), `dsm10prdntx01` (Nutanix), `phx21prdgh01` (GitHub).
- **Units:** everything is tracked in racks. Utilization is NIC utilization (provisioned ÷ capacity) per rack, and "racks in use" = Σ utilization. Every rack draws 10 kW and costs $200K, and has its own dock date.
- **Fleet:** 700 Gen6 racks docked 2020–2025, mostly 2022–2024 (EOL Sep 2028) and 1,200 Gen8 racks docked 2025–2026 (EOL Dec 2032). Gen11 is GA Mar 2028 (EOL Dec 2035). Gen6 racks docked after Sep 2022 still carry book value at EOL.
- **Planning line:** keep utilization ≤ 75%. "Hits 75%" is the first month a region crosses it. A request for N racks needs N ÷ 75% racks of new capacity if there's no headroom.
- **Lead times:** 3 weeks order → dock, 4 weeks dock → live.
- **Demand:** each region's racks in use compound monthly at its own growth rate, plus approved (or phased) requests from their need-by date.
- **Power:** each region has a fixed MW allocation. Racks can only land if power is free; otherwise escalate.
- **Book value:** per rack, straight line over 6 years from its dock date. Write-off = book value left at retirement: Gen6 at its swap date, and Gen8 bought before Gen11 GA at Gen8 EOL.
- **Gen6 refresh:** rack-for-rack swaps, oldest racks first, 120 racks per month fleet-wide. Hybrid puts pre-2022 racks on Gen8 and the rest on Gen11. Gen8 bridge swaps are scheduled just in time, finishing 6 months before Gen6 EOL.
- **Space & power (`src/lib/datacenter.ts`):** each region has floor positions and a power budget; capacity is whichever runs out first. A rack is allocated 10 kW but draws 35% idle + 45% × utilization of that, with peaks 1.2× average; allocated-but-never-drawn power is stranded. Re-baselining the allocation to 8.5 kW (peak at 75% utilization plus margin) reclaims it. Positions with no power behind them, or power with no positions, are stranded space/power.
- **Over-provisioning:** racks beyond what 12-month demand plus open requests need at 75%.
- **Availability:** in 12 months, on planned racks, a region should stay under 85% after losing one 40-rack cluster.
- **PUE:** per region, against a 1.25 target at $0.08/kWh.
- **Rebalancing:** moves the lowest-utilization Gen8 racks within a continent (~8 weeks); donor regions stay ≤ 70%.

## Tech

React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Lucide icons. Deploys to GitHub Pages with GitHub Actions (`.github/workflows/deploy.yml`).
