# Config-driven dashboards + self-serve authoring

> **Captured 2026-05-17 (user input).** The ask: *"document this config-driven
> approach for a generic dashboard"* — and beyond that, *"allow people to
> create their own dashboards on this platform, driving data from various
> sources — YouTube for our channel to compare with others, app-team metrics
> from New Relic + Play Console + App Store, and the like."*
>
> This doc is the deep version of [multi-project-platform.md](./multi-project-platform.md) §C1/§D.
> That doc sketched a `dashboard` config in ~20 lines; this one specifies it.

## Why

Today a dashboard is a React component. AssetSearch and Grip Connect each ship
a bespoke `*DashboardEditorial.jsx` registered in `components/dashboards/index.js`.
That was the right call for the first two — they set the visual bar and gave
us two concrete examples to generalise *from*. It does not scale:

- Every new project needs an engineer to write, review, and ship a component.
- "Anyone can create a dashboard" is impossible while creation means a PR.
- 30 bespoke components is 30 things to keep on-brand as the design evolves.

The fix is a **single generic dashboard component that renders from a JSON
config**. The project author describes *what* to show — sections, figures,
which data feeds which figure — and the platform owns *how* it looks. A new
dashboard becomes a `project.json` edit, then (later) a form, then (much
later) a drag-and-drop editor.

The two bespoke dashboards don't go away — they become the "eject hatch" for
the rare flagship project that earns hand-built treatment. Everything else is
config.

## Pointers

### A. The contract: definition / data / presentation stays the same

A project is still **(definition, data, presentation)** — see
[multi-project-platform.md](./multi-project-platform.md) §A. This doc only
changes *presentation*:

- **Bespoke (today):** `project.json` has `"dashboard_component": "GripConnect"`,
  the registry maps it to a React component.
- **Generic (this doc):** `project.json` has a `"dashboard": { … }` object, and
  the registry-less `GenericDashboard` renders it. No component, no registry
  entry, no PR.

`getDashboard()` resolves in this order: a registered `dashboard_component`
wins (eject hatch); else if a `dashboard` config object is present, use
`GenericDashboard`; else fall back to the bare table-list + SQL console that
`GenericDashboard.jsx` is today.

### B. The `dashboard` config schema

Grounded in what AssetSearch and Grip Connect actually render. A starting
shape — expect it to grow as real projects stress it:

```jsonc
"dashboard": {
  "design": "editorial",            // optional; defaults to platform default
  "masthead": {
    "title": "Grip Connect",
    "kicker": "A partner-distribution report · Internal edition",
    "lede": "Grip Connect places Grip's products inside four partner apps…",
    "dateline": "Week of May 4, 2026"
  },
  "sections": [
    {
      "title": "The North Star",
      "deck": "AUM, first-time and repeat investors — MTD vs LMTD.",
      "widgets": [
        {
          "type": "comparison-grid",
          "data": { "table": "01_north_star" },
          "group_by": "partner",
          "metrics": [
            { "label": "AUM", "where": "metric = 'AUM'",
              "value": "mtd", "delta": "delta_pct", "format": "inr_cr" }
          ]
        }
      ]
    },
    {
      "title": "Registration to KYC",
      "widgets": [
        {
          "type": "table",
          "data": { "table": "02_reg_to_kyc" },
          "columns": [
            { "key": "partner", "label": "Partner" },
            { "key": "reg_success_pct", "label": "Reg ✓", "format": "pct1" }
          ]
        }
      ]
    }
  ]
}
```

Two **data bindings** — a widget's `data` is one of:
- `{ "table": "01_north_star" }` — read a table directly. For projects whose
  source data is already aggregated (Grip Connect's CSVs are one row per
  partner×metric). The platform prefixes the project id automatically.
- `{ "query": "SELECT week, …" }` or `{ "query_key": "by_week" }` — read a
  computed query. `query_key` resolves against `project.json.queries` (the
  named-SQL map). For projects that need real computation over raw event rows
  (AssetSearch's weekly ZRR, funnels, cohorts).

The generic dashboard fetches each **distinct** binding once, dedups, then
hands each widget its slice. A widget with an inline `where` filters client-
side; anything heavier belongs in a named query.

### C. The widget catalogue (v1)

Extracted from the two bespoke dashboards — these are the shapes that already
exist, just made declarative. Each new widget type is a schema key **and** a
branch in `GenericDashboard`; keep the set small and earn each addition.

| `type` | Renders | Bespoke precedent |
|---|---|---|
| `stat-row` | A row of stat tiles from ONE data row | AssetSearch "By the Numbers" exhibits |
| `comparison-grid` | A stat group repeated per `group_by` value | Grip Connect North Star (per partner) |
| `table` | A ruled comparison table; `columns` with per-column `format` | Grip Connect funnel / hand-off tables |
| `chart` | Recharts figure; `subtype: bar\|line\|area\|composed`, `x`, `series` | AssetSearch weekly figures |
| `prose` | An editorial text block (lede, editor's note) | AssetSearch lede |
| `placeholder` | An "awaiting instrumentation" plate | Grip Connect webhook / app-adoption sections |

`format` enum (shared by stats, table columns, chart tooltips):
`number · count · pct · pct1 · inr · inr_cr · delta_pct · date · text`.

### D. Editorial *and* classic from one config

The same config renders in both design modes — `GenericDashboard` reads
`useDesign()` and picks editorial vs classic primitives, exactly as the
bespoke dashboards already do. The config never names a colour, font, or
spacing value. That separation is the whole point: authors describe
*structure*, the platform owns *style*, and a design refresh updates one
component instead of thirty.

### E. The data source is decoupled from the dashboard

This is the part that makes "drive data from YouTube / New Relic / Play
Console / App Store" work. The dashboard config **does not know or care**
where a table's rows came from. It binds to `{ table: "channel_stats" }`; it
never asks who filled it.

What fills the table is an **integration adapter** —
see [data-integrations.md](./data-integrations.md). A project declares
`integrations`; each adapter pulls from one source and writes canonical rows
into DuckDB tables. The dashboard renders those tables identically whether
they were filled by Metabase, a Rudderstack export, or the YouTube Data API.

So a "compare our YouTube channel against others" project is:
1. an `integrations` entry of kind `youtube` (channel IDs, metrics) →
   fills a `channel_stats` table,
2. a `dashboard` config with a `comparison-grid` grouped by channel and a
   `chart` of subscribers-over-time,
3. nothing else. No new component.

An "app health" project is the same move with `newrelic` + `appstore` +
`gplay` adapters feeding `crash_rate`, `ratings`, `installs` tables, and a
`dashboard` config laying them out. The adapters are the new work (one per
source kind, written once, reused forever); the dashboard is config.

### F. Self-serve authoring — the progression

"Anyone can create a dashboard" is a flow, not a feature. Buildable in order,
each stage usable before the next exists:

1. **Scaffold CLI** (`scripts/new-project.mjs`) — prompts for id, category,
   source kind; writes `project.json` with an empty `dashboard` skeleton.
   Builders use it; ships in a day. *(multi-project-platform.md §D.1)*

2. **Source-connect step** — before laying out widgets the author has to get
   data in. A small UI (or CLI step) to pick an adapter kind, enter its
   non-secret config (channel ID, New Relic account id, app bundle id), and
   trigger the first fetch. Secrets stay infra-side (env vars per adapter —
   see data-integrations.md §B); the author never sees a credential.

3. **In-app authoring page** (`/projects/new`) — a form: Identity → Category →
   Source(s) → first query/table → first section + widget. Writes the same
   `project.json` the CLI would. This is the "non-builder can do it" line.

4. **Live widget editor** — inline edit mode on a project page: add a section,
   pick a widget type, point it at a table/query, reorder by drag. The
   Notion-of-dashboards end state. Don't start until (3) has been used in
   anger and the widget catalogue has stopped churning.

The config schema is the contract that lets all four stages coexist — CLI,
form, and editor all just produce the same `dashboard` JSON, and
`GenericDashboard` renders whatever any of them wrote.

## Trade-offs

- **The config ceiling is real.** A schema can't express every bespoke flourish
  (AssetSearch's drop-cap, pull-quote, the search-lift narrative). Accepted:
  generic dashboards inherit a strong *default* editorial treatment, and the
  `prose` widget carries any narrative text. The rare project that genuinely
  needs more ejects to a bespoke component. The platform's value is
  *uniformity*; fighting that with per-project config knobs recreates the
  maintenance cost we're escaping.
- **Every widget type is two commits forever** — a schema key and a
  `GenericDashboard` branch, both maintained for the platform's life. Adding
  types is not free; the v1 catalogue (§C) should resist growth until a real
  project can't be expressed without a new one.
- **Client-side `where` filtering is a trap past small N.** Fine for Grip
  Connect's 12-row North Star table; wrong for anything large. The schema
  should make the named-`query` path the obvious choice for real computation,
  so authors don't reach for inline filters on big tables.
- **Self-serve authoring widens the blast radius.** Today a bad dashboard is a
  PR that gets reviewed. A form that writes `project.json` has no reviewer —
  it needs validation (does the table exist? does the query parse? is the
  format enum valid?) and the §F.1 CLI should share that validator so both
  paths fail the same way.
- **Schema versioning.** Once non-builders author configs, a schema change
  can't just be a refactor — old `project.json` files in the wild must keep
  rendering. Add a `"schema_version"` to the `dashboard` object before stage
  §F.3, not after.

## Open questions

1. **Does `GenericDashboard` evolve from today's stub, or get rebuilt?** The
   current `GenericDashboard.jsx` is a table-list + SQL console. The config
   renderer is a different component; the stub becomes the no-config fallback.
   Worth confirming we keep the fallback at all.
2. **Where does `project.json` live when authored in-app?** Today it's a file
   in `backend/data/<id>/`. Self-serve writes need a path — backend endpoint
   that writes the file, or a small metadata store. Ties into
   data-integrations.md's refresh-endpoint work.
3. **Which is the first config-driven project?** It should NOT be a port of
   AssetSearch or Grip Connect (those stay bespoke). It should be a genuinely
   new, simple project — a candidate that proves the schema without needing
   the eject hatch on day one.
4. **Validation home.** Shared validator for the schema — does it live in the
   backend (Python, runs on write) or frontend (JS, runs in the authoring
   form), or both? Both means two implementations to keep in sync.
5. **How much does the chat panel need the config?** The chat already reads
   per-project `chat_context`. Could the `dashboard` config also seed chat
   starter questions ("a figure shows X — offer 'break X down by week'")?
   Probably later, but the config is the natural place for it.

## Suggested first slice

1. **Freeze the v1 widget catalogue** at the six types in §C — `stat-row`,
   `comparison-grid`, `table`, `chart`, `prose`, `placeholder`. They cover
   everything the two bespoke dashboards do.
2. **Build the config renderer.** A new `GenericDashboard` (config-aware) that
   reads `project.json.dashboard`, fetches the distinct data bindings, and
   renders the six widget types in editorial mode. Grip Connect is the test
   fixture — its dashboard is simple enough that a faithful config port is the
   correctness check. *Port, don't replace:* keep `GripConnectDashboardEditorial.jsx`
   registered; build the config in a second project file and diff the output.
3. **Add `schema_version`** to the `dashboard` object from the first commit.
4. **Write the scaffold CLI** (§F.1) — it makes the renderer immediately
   usable by builders and shakes out the schema before any form is built.
5. **Pick and ship the first genuinely-new config-driven project** (open
   question 3) — ideally one whose data is simple and pre-aggregated, so the
   first real config doesn't fight the schema.
6. Only after 3+ config-driven projects exist: build the in-app authoring page
   (§F.3). By then the schema has stopped moving and the form has a stable
   target.

The gating decision is **open question 3** — picking the first project that's
*born* config-driven. Everything else is code that follows from the schema in
§B, and the schema is already grounded in two shipped dashboards.
