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
wins; else if a `dashboard` config object is present, use `GenericDashboard`;
else fall back to the bare table-list + SQL console that `GenericDashboard.jsx`
is today.

**But "bespoke vs config" is not the right fork** — see §G. The end state is
one path: every dashboard is a `dashboard` config, and bespoke React lives
*inside* it as a `custom` widget. The `dashboard_component` registry above is
the transitional form, kept until the two existing bespoke dashboards migrate
to a single-`custom`-widget config.

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
| `custom` | A bespoke React component, placed by config, fed the same `data` binding + `props` | the escape hatch — see §G |

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

### G. Bespoke flexibility — a dial, not a fork

The worry with config-only is a ceiling: someday an author wants a figure the
six widget types can't express. The answer is **not** "then they write a whole
bespoke dashboard instead." Bespoke is not a *parallel path* — it's a
**`custom` widget that lives inside a config dashboard**.

A `custom` widget names a registered React component and gets handed the same
`data` binding and a `props` object from config:

```jsonc
{ "type": "custom", "component": "SearchLiftNarrative",
  "data": { "query_key": "cohort" },
  "props": { "target": 1.5 } }
```

So a single dashboard freely mixes catalogue widgets with custom ones — a
config layout with one hand-built hero figure, or three. This collapses the
"two paths" into one: a **100%-custom dashboard is just the extreme** — one
section, one `custom` widget that is the whole page. That extreme *is* what
AssetSearch is today. Once `custom` exists, the `dashboard_component` registry
is redundant: the two bespoke dashboards become config files with a single
`custom` widget each, and there is exactly one render path to maintain.

This also means **the bespoke-ness is per-widget, not per-project**. You don't
choose "config project" or "bespoke project" up front. You build with
catalogue widgets and drop to custom only for the specific figure that needs
it. The 90%-config / 10%-bespoke dashboard — the common real case — is a
first-class citizen, not a compromise.

**Self-serve, though, is a separate axis from bespoke.** "Can someone make a
custom widget without a PR?" has three tiers, increasing in power and cost:

| Tier | What the author can do | Self-serve? | Cost / risk |
|---|---|---|---|
| **T1 — registered component** | Place an existing `custom` widget via config; tune its `props`. | Placing: yes. Authoring the component: no — a builder writes it in a reviewed PR. | Low. The component is normal vetted code. |
| **T2 — free-form blocks** | A `markdown` widget for narrative; a `metric` widget with a small **safe expression language** (`sum(col) / count(*)`, no arbitrary JS) for derived numbers. | Fully. | Low — the expression language is sandboxed by construction; markdown is sanitised. |
| **T3 — sandboxed code widget** | Write a widget's render logic in JS, executed in a constrained sandbox (iframe-isolated, vetted runtime, no arbitrary network or npm). | Fully. | High — real isolation work, a stable widget API surface, an XSS/supply-chain threat model. A deliberate later decision. |

The honest read: **T1 + T2 meet most "the catalogue can't do this" needs.** A
builder adds a custom widget once; everyone else places it. Free-form markdown
and safe-expression metrics cover the rest. **T3 is the only path to *fully
self-serve arbitrary bespoke*** — and it's expensive enough that it should wait
for sustained, specific demand rather than being built speculatively. The
platform stays safe and useful long before T3 exists.

## Trade-offs

- **The config ceiling is real — but the `custom` widget is the relief valve.**
  A schema can't express every bespoke flourish (AssetSearch's drop-cap,
  pull-quote, search-lift narrative). That's fine: the figure that needs it
  becomes a `custom` widget (§G) inside an otherwise-config dashboard — not a
  whole parallel bespoke dashboard. The platform's value is still *uniformity*;
  the `custom` widget is the deliberate, contained exception, and keeping it a
  widget (not a path) means there's still exactly one render pipeline.
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
- **The `custom` widget is a real-code surface.** A T1 custom widget (§G) is
  vetted PR'd code, low-risk. But it still gets a `data` binding and `props`
  from a config that may, post-§F.3, be authored by a non-builder — so the
  component must treat its props defensively (missing columns, empty rows) the
  way a catalogue widget does. T3 (sandboxed code) is a much larger surface and
  is explicitly *not* in any near-term slice.

## Open questions

1. **Does `GenericDashboard` evolve from today's stub, or get rebuilt?** The
   current `GenericDashboard.jsx` is a table-list + SQL console. The config
   renderer is a different component; the stub becomes the no-config fallback.
   Worth confirming we keep the fallback at all.
2. **Where does `project.json` live when authored in-app?** Today it's a file
   in `backend/data/<id>/`. Self-serve writes need a path — backend endpoint
   that writes the file, or a small metadata store. Ties into
   data-integrations.md's refresh-endpoint work.
3. **Which is the first config-driven project?** It should NOT be AssetSearch
   or Grip Connect — those stay on the `dashboard_component` registry until
   `custom` widgets exist (§G), at which point they migrate to single-`custom`
   configs. The first config project should be a genuinely new, simple one
   that proves the *catalogue* widgets without reaching for `custom` on day one.
4. **Validation home.** Shared validator for the schema — does it live in the
   backend (Python, runs on write) or frontend (JS, runs in the authoring
   form), or both? Both means two implementations to keep in sync.
5. **How much does the chat panel need the config?** The chat already reads
   per-project `chat_context`. Could the `dashboard` config also seed chat
   starter questions ("a figure shows X — offer 'break X down by week'")?
   Probably later, but the config is the natural place for it.
6. **How far into T3 (sandboxed code widgets), and when?** §G argues T1 + T2
   cover most needs and T3 is expensive. The open call is whether T3 is ever
   worth it for an internal tool, or whether "a builder PRs a `custom` widget"
   (T1) is permanently good enough. Decide only when a concrete request can't
   be met by T1/T2 — not speculatively.

## Suggested first slice

1. **Freeze the v1 catalogue** at the six widget types in §C — `stat-row`,
   `comparison-grid`, `table`, `chart`, `prose`, `placeholder`. They cover
   everything the two bespoke dashboards do. `custom` (§G) is the seventh type
   but comes in step 5, not here.
2. **Build the config renderer.** A new `GenericDashboard` (config-aware) that
   reads `project.json.dashboard`, fetches the distinct data bindings, and
   renders the six widget types in editorial mode. Grip Connect is the test
   fixture — its dashboard is simple enough that a faithful config port is the
   correctness check. *Port, don't replace:* keep `GripConnectDashboardEditorial.jsx`
   registered; build the config in a second project file and diff the output.
3. **Add `schema_version`** to the `dashboard` object from the first commit.
4. **Write the scaffold CLI** (§F.1) — it makes the renderer immediately
   usable by builders and shakes out the schema before any form is built.
5. **Add the `custom` widget type.** A `custom`-widget branch in
   `GenericDashboard` that resolves `component` against a registry and passes
   `data` + `props`. Prove it by migrating Grip Connect to a config whose one
   non-trivial figure (or the whole thing) is a `custom` widget — that retires
   its `dashboard_component` entry and shrinks the platform to one render path.
6. **Pick and ship the first genuinely-new config-driven project** (open
   question 3) — ideally one whose data is simple and pre-aggregated, so the
   first real config doesn't fight the schema.
7. Only after 3+ config-driven projects exist: build the in-app authoring page
   (§F.3). By then the schema has stopped moving and the form has a stable
   target. T2 free-form widgets (`markdown`, safe-expression `metric`) land
   around here; T3 (open question 6) stays deferred.

The gating decision is **open question 3** — picking the first project that's
*born* config-driven. Everything else is code that follows from the schema in
§B, and the schema is already grounded in two shipped dashboards.
