# Architecture options — hosting, query layer, build-vs-buy, pipeline

- **Date:** 2026-05-18
- **Status:** Review, not a decision. Captures the alternatives so the choices
  can be made deliberately when the triggers below are hit.
- **Why now:** the MVP is proven — leadership and teams are using it. That
  validates the *experience layer* and makes it worth reviewing what runs
  underneath. This doc is the landscape; nothing here is committed.

## The reframe — four separable layers

"The architecture" is not one decision. It is four, and each can be upgraded
independently without a rewrite. The MVP made one reasonable choice at each:

| Layer | MVP choice today |
|---|---|
| 1. Hosting / compute | Render free tier, single web service |
| 2. Query layer | DuckDB, baked into an in-memory file at deploy (`build_duckdb.py`) |
| 3. The app | Custom FastAPI + Next.js — the editorial design + AI chat |
| 4. Data pipeline | Scripts → CSVs → git → baked at deploy; GitHub Actions cron for refresh |

This is a sound MVP: cheap, simple, working. The question is *which upgrades,
and when* — not whether to rewrite.

---

## Layer 1 — Hosting / compute

The render free tier sleeps after 15 min idle and caps RAM at ~512 MB. Cold
starts are mitigated (keepalive cron + prebuilt `.duckdb`) but the ceiling is
real.

| Option | Pros | Cons |
|---|---|---|
| **Render free** (today) | $0, zero-config | 15-min cold sleep, ~512 MB RAM ceiling, single instance, free-tier reliability |
| **Render paid** ($7–25/mo) | Removes cold starts + RAM ceiling; **zero migration** | Still a smaller platform; outgrown eventually |
| **GCP Cloud Run / AWS App Runner** | Industry standard for a containerised service: scale-to-zero, pay-per-request, fast cold starts, integrates with company IAM + observability | More IAM/setup; needs cloud familiarity |
| **Fly.io / Railway** | Better DX than raw cloud, container-native, global edge | Another vendor; Fly exposes more ops knobs |
| **Vercel functions** (for the backend) | Co-located with the frontend | **Bad fit** — DuckDB + a baked file does not work in serverless (cold start per call, function size limits). Do not. |

**Assessment.** The highest-leverage, lowest-effort move is **Render paid
tier** — it erases the cold-start and RAM problems for $7–25/mo with no
migration. If Grip standardises on a cloud (AWS/GCP), the durable answer is
**Cloud Run**: the app is already a container (`render.yaml` web service), so
the migration is ~a day, and it puts the platform on company rails (IAM,
observability, SSO). Do the cloud move when company observability/SSO is
wanted anyway — not for its own sake.

---

## Layer 2 — Query layer (DuckDB-in-RAM)

DuckDB baked into an in-memory file is genuinely clever for the current data
size (tens of MB) — fast and free. It has three real ceilings:

- **All data lives in RAM** → total data is capped by the hosting tier.
- **Single connection + lock** (`services/duck.py`) → queries serialise; fine
  at low concurrency, a bottleneck under many simultaneous users.
- **Data is frozen at deploy** → "live" needs the refresh-endpoint workaround.

| Option | Pros | Cons |
|---|---|---|
| **DuckDB on a persistent disk** | Tiny change; decouples data from deploys; still fast | Still one box, still RAM-bound for hot queries |
| **MotherDuck** (managed DuckDB cloud) | The natural evolution of *exactly this* architecture — offloads storage + scale, keeps DuckDB SQL unchanged | A managed-service cost; newer vendor |
| **ClickHouse** | The actual industry standard for serving analytics — **Grip already uses it** (the Metabase `… CH` cards are ClickHouse-backed) | Heavier to operate; overkill until data is large |
| **Postgres** (Render / Neon / Supabase) | Durable, concurrent, universally understood; fine for tens of MB | Slower than DuckDB/ClickHouse on large analytical scans |

**Assessment.** For today's data size DuckDB is the right tool — do not
replace it. The cheap fix is persisting the `.duckdb` file to disk rather than
rebaking each deploy. The **architectural trigger**: when total data across all
projects will not fit one box's RAM (anticipated around ~30 projects),
DuckDB-in-memory must change — **MotherDuck** is the lowest-friction path
(same SQL), **ClickHouse** the most house-standard one (Grip already runs it).

---

## Layer 3 — Build vs buy

"Internal dashboards over data" is a mature, crowded product category. The
honest question: should this be a custom app at all?

| Option | Pros | Cons |
|---|---|---|
| **Metabase** (Grip already runs it) | Free/cheap, self-serve, fast to stand up | Generic BI-grid look, weak narrative, basic AI |
| **Superset / Preset** | Powerful open-source BI, hosted option | Generic look; operational weight |
| **Lightdash** | BI on a dbt metric layer — governed metrics | Tied to a dbt setup |
| **Hex / Deepnote** | Notebook-style, analyst-facing, has AI | Analyst tool, not an exec-facing product surface |
| **Looker / Omni** | Semantic-layer BI, governed metrics | Expensive; heavyweight |
| **Evidence.dev** | Code-driven: markdown + SQL → polished static dashboards. The closest off-the-shelf analog to what was built | Less interactive; smaller ecosystem |
| **Retool** | Fast internal-tool/app builder | App-shaped, not dashboard-narrative |

**Why the custom build is justified.** It does three things off-the-shelf BI
does poorly, and adoption has now validated them:

1. **Editorial design** — it reads as a designed product, not a BI grid.
2. **Native AI "ask the data"** with per-question model routing — bolted-on
   elsewhere.
3. The **config-driven + AI-authored dashboard** direction (see
   `docs/ideation/config-dashboard.md`).

The platform already treats Metabase as the *data layer* (it pulls Metabase
cards) and adds an *experience layer* on top — that separation is correct.

**The honest caveat.** A custom app is permanent maintenance cost, and BI
tools improve quickly. **Evidence.dev** specifically is worth studying — it is
the nearest product-shaped analog (markdown + SQL → designed dashboards),
even if only to borrow ideas.

**Assessment.** Keep building. Adoption justifies the experience layer. Treat
Metabase (+ ClickHouse under it) as the data foundation that is not rebuilt.

---

## Layer 4 — Data pipeline

Today: scripts → CSV → git → baked, plus a GitHub Actions cron for refresh.
The industry standard at scale is an **orchestrator** (Dagster / Airflow /
Prefect) + **dbt** for transforms + **Airbyte / Fivetran** for ingestion —
heavy for the current scale. The GitHub Actions cron is a reasonable
"poor-man's orchestrator." The one piece worth adopting earlier than the rest
is **dbt**, once metric definitions multiply across many projects and need to
be governed in one place.

---

## Recommendation — sequenced

1. **Now (cheap, high-leverage):** Render free → **paid tier**. Removes the
   cold-start and RAM pain for ~$7–25/mo with zero migration. Best ROI move.
2. **Soon:** persist the `.duckdb` file to disk instead of rebaking at deploy
   — decouples data from deploys.
3. **When it should be a "real" internal tool:** adopt two more standards —
   **SSO/OAuth** (replace the single shared password) and **observability**
   (error tracking + logs/metrics). These usually arrive with a Cloud Run move.
4. **At the data-size trigger:** when total data will not fit one box's RAM →
   MotherDuck or ClickHouse. Not before — do not pre-optimise.

**Do not** rewrite the MVP. It works and it is adopted. The next investment is
reliability *underneath* it, not a rebuild.

## Triggers to watch

| Trigger | Forces |
|---|---|
| Cold starts / RAM pressure felt by users | Layer 1 → Render paid (already overdue-ish) |
| Total data across projects approaching one box's RAM (~30 projects) | Layer 2 → MotherDuck or ClickHouse |
| Many simultaneous users; query serialisation visible | Layer 2 → a concurrent store; Layer 1 → multi-instance |
| Real internal-tool status; more than a handful of viewers | SSO/OAuth, observability |
| Metric definitions multiplying across projects | Layer 4 → dbt for a governed metric layer |

## Open questions

1. **Does Grip have a standard cloud (AWS/GCP)?** If yes, Cloud Run is the
   natural Layer-1 destination and the SSO/observability story comes mostly
   free. If no, Render paid is the pragmatic stop.
2. **What is the realistic data-volume trajectory?** Tens of MB today. The
   Layer-2 trigger depends entirely on how fast that grows.
3. **Is there appetite to study Evidence.dev** before committing more to the
   custom build — at minimum as a source of ideas?
4. **Who owns infra?** Render paid is a credit-card decision; Cloud Run +
   SSO + observability needs an owner with cloud access.
