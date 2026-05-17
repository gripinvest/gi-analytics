# Multi-project platform

> **Status update (2026-05-13, user input):** the ambition is bigger than "a few projects." Goal is **"some semblance of an analytics platform — an editorial of all data for our company"**: feature analytics, core journeys, investment metrics, AOMs, marketing numbers, customer support, even external-vs-internal comparisons like our YouTube channel against popular ones. **Anyone should be able to create a dashboard** by pointing at an integration. This document is rewritten against that ambition.

## Why

The platform exists to let *anyone in the company* turn data from a source
(Metabase, Sentry, Google Play Console, YouTube, …) into a readable analytical
issue. The asset_search dashboard is the proof-of-concept; the platform is
what makes the next 30 dashboards a configuration exercise rather than a
codebase change.

This thread is the spine the rest of the docs hang off:
- Each project type defines its own source/integration → [data-integrations.md](./data-integrations.md)
- Each project's data must be cache-able for offline → [pwa-offline.md](./pwa-offline.md)
- Each project's UI must clear the mobile-first bar → [mobile-first.md](./mobile-first.md)

## Pointers

### A. The project model

A project is **(definition, data, presentation)**:

- **Definition** — `project.json` carries identity (`name`, `description`, `status`, `tags`), classification (`category` — see §B), data binding (`integrations` — see [data-integrations.md](./data-integrations.md)), and presentation (`dashboard` — see §C).
- **Data** — raw rows landed in DuckDB tables. Today via hand-dropped CSVs; the end state is integrations writing them directly.
- **Presentation** — the dashboard. Either generic (config-driven) or bespoke (a React component). At platform scale, **generic is the default**; bespoke is the exception.

### B. Project taxonomy (category)

With many projects coming, flat listing breaks fast. Suggested first taxonomy
— refine as projects accumulate:

| Category | Examples |
|---|---|
| `feature` | Asset Search, Quick Checkout, KYC funnel |
| `journey` | First-time investor, Repeat investor, Cross-product upgrade |
| `domain` | Investments (AUM, AOMs), Marketing (channels, attribution), Support (CSAT, ticket times) |
| `external` | YouTube channel vs competitors, App Store ranking, Sentry error volume |

Stored on `project.json` as `category: "feature" | "journey" | "domain" | "external"`. Drives:
- Home page grouping ("In this volume — Features. In this volume — Journeys. …")
- Sidebar filtering once there's enough to warrant a sidebar
- Editorial section titles in the home page (each category becomes a "section" of the weekly issue)

### C. Two dashboard paths — rebalanced

> **Status (2026-05-17):** the second project — **Grip Connect** — shipped
> bespoke, completing the "build the second project bespoke too" step of the
> migration plan below. The config-driven path is now the active next thread
> and has its own deep doc: **[config-dashboard.md](./config-dashboard.md)**.
> The schema sketch in C1 below is the short version; that doc specifies it.

**C1. Generic / config-driven dashboard (default for new projects)**
- One configurable React component (`GenericDashboard.jsx` — already stubbed).
- Reads `project.json.dashboard` for what to render. Schema sketch:

  ```json
  "dashboard": {
    "headline": "Six weeks in, conversion holds.",
    "lede": "…",
    "exhibits": [
      { "label": "Sessions", "query_key": "total_sessions", "format": "number" },
      { "label": "Conversion", "query_key": "cvr_overall", "format": "pct", "delta": { "from": "first", "to": "last" } }
    ],
    "sections": [
      {
        "title": "The Overview",
        "figures": [
          { "type": "composed", "query_key": "by_week", "bars": ["visitors"], "lines": ["adoption_pct"] },
          { "type": "table", "query_key": "top_terms", "columns": ["term", "searches", "zrr_pct"] }
        ]
      }
    ]
  }
  ```

- Each `query_key` is resolved against `project.json.queries` (which lives alongside `integrations` — see [data-integrations.md](./data-integrations.md)).
- Renders in both Classic and Editorial design modes from the same config.
- *Trade-off:* the ceiling is whatever the config schema can express. Adding new chart types means updating both the schema and the generic dashboard.

**C2. Bespoke (today's asset_search shape)**
- Project ships its own React component(s) + queries module.
- Registered in `DASHBOARDS` registry, keyed by `dashboard_component`.
- *When to use:* a flagship project that earns the engineering investment (asset_search did because of the editorial design + the search-lift narrative).
- *Default expectation:* most projects do NOT go this route.

**Migration plan:**
- ~~Keep asset_search bespoke (it set the bar).~~ ✅ done.
- ~~Build the **second project** bespoke too~~ ✅ done — Grip Connect shipped 2026-05-17.
- The **third project onward** uses the generic path → spec'd in [config-dashboard.md](./config-dashboard.md).
- *Refactor:* once 3+ generic projects exist, see what they keep configuring around. Those are the missing config keys; bake them into the schema.

### D. Self-serve dashboard creation

If "anyone can create a dashboard," the creation flow needs a UI, not a PR.
Probable shape (in roughly buildable order):

1. **CLI / scripted creation** (week-1 capability): a `scripts/new-project.mjs` that takes a project ID, asks for category + integration kind, scaffolds `project.json` + an empty `dashboard` config, drops it under `backend/data/<id>/`. Reload, project appears. **Builders use this; non-builders don't.**

2. **Authoring page in-app** (later): `/projects/new` — a multi-step form that walks through Identity → Category → Integration → First query → First figure. Behind the scenes, writes the same `project.json` the CLI would. Goes through Vercel-side write to the backend.

3. **Live dashboard editor** (much later): inline edit mode on a project page; click on a figure to change which query feeds it, drag stats to reorder, etc. The Notion-of-dashboards vision. **Don't build this until §1 and §2 have been used in anger.**

### E. The chat panel for many projects

The chat (`backend/services/claude.py`) currently reads `db.get_schema(project_id)`. At platform scale:
- Auto-generated schema becomes noisy with 50+ tables.
- Each project should be able to ship a hand-tuned **`schema.md`** that prepends to (or replaces) the auto-schema in the system prompt. 50 words from the project owner beats 50 columns of DESCRIBE output.
- Eventually: per-project "example questions" that seed the chat panel with starters.

### F. Permissions & ownership

Out of scope for the first slice but worth flagging:
- Read access: the basic-auth gate is one credential for everyone today. A real platform needs OAuth + roles eventually.
- Project-level ownership: each `project.json` has `owner`, but no enforcement. Future: only the owner (or admins) can edit the dashboard config or trigger refresh.
- Audit trail: who refreshed, who edited the config, who created the project. Just-enough logging on those mutations.

## Trade-offs

- **Bespoke per project compounds maintenance cost.** Rebalancing to generic-by-default avoids this — but generic-by-default means accepting that most dashboards look similar. That's correct at scale; uniformity *is* the platform's value.
- **Config-driven dashboards have a real ceiling.** Some narratives (the asset_search drop-cap, the editorial lede, the pull-quote) won't translate to a config schema cleanly. Solution: a tiny `prose` block in the config holds the editor's note text, and config-driven dashboards inherit a sensible default visual treatment.
- **Many projects means many DuckDB tables.** Memory is the binding constraint on Render free tier (~512MB). At ~50 projects × ~10 tables each, we will hit it. Mitigations: per-project lazy load, tier-based load (only load active projects), or move off Render free.
- **Category-driven home page** is more cognitive overhead than a flat list when N is small (2–5). Defer the grouping UI until there are ≥6 projects.

## Open questions

1. ~~Will there be many projects (10+) or a few (3–4)?~~ **Answered: many.** Plan for 30+.
2. **What integrations are highest-priority after Metabase?** (Sentry, Google Play, YouTube were called out — order matters because it shapes [data-integrations.md](./data-integrations.md)'s first adapters.)
3. **Who owns dashboard creation week-1?** If the answer is "you (Puru)" until the CLI / authoring page lands, the urgency on §D is lower. If non-builders need to create dashboards next month, the in-app authoring page is the gating piece.
4. **How tightly coupled to Grip's internal product taxonomy** should the `category` enum be? Generic ("feature/journey/domain/external") vs Grip-specific ("Investments/KYC/Marketing/Support") — the more Grip-specific, the more obvious the home page reads; the less reusable if Grip's structure changes.
5. **Is editorial mode the default for new generic dashboards**, or does classic stay default? Editorial is the brand differentiator but heavier visually; classic is denser, useful for stakeholder reviews.

## Suggested first slice

1. **Pick the second project.** Concretely: a real one you'd want next month. Marketing funnel? First-time-investor cohort? YouTube channel comparison? The choice affects which integration to wire first.
2. **Build it bespoke** alongside the asset_search pattern. One more bespoke project gives the second data point to extract the generic dashboard from.
3. **In parallel, scaffold `GenericDashboard.jsx`** to read a minimal config and render a StatStrip + a single ChartCard. Don't try to express asset_search's editorial energy yet — start with classic, simple.
4. **Add the `category` field** to `project.json` and the home page grouping (collapse to flat list when N≤3, group by category when N>3).
5. After (1)–(4) land, the path to the next 5 projects is mostly config.

The bottleneck is not code; it's **(1) — picking the second project**. Everything else follows from that choice.
