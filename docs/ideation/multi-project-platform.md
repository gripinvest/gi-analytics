# Multi-project platform

## Why

Today the platform is one project (`asset_search`) deeply wired in. Adding a
second project means touching ~6 places: `project.json`, CSV folder, a
dashboard component (×2 for classic+editorial), query helpers, the dashboards
registry, and likely the chat schema prompt. The platform should make adding
a project a 1-file change. Otherwise "more projects" stalls on its own
boilerplate.

## Pointers

### A. The data contract per project

Each project should be a directory under `backend/data/<project_id>/` with:

- **`project.json`** — metadata. Today: `name`, `description`, `status`, `tags`, `owner`, `dashboard_component`, `jira_ticket`. Add:
  - `weeks` (display label, optional — used by the home-page "issue" metadata)
  - `events` (display label, optional — same)
  - `tagline` (one-line editorial blurb, optional — falls back to `description`)
  - `refresh` (object describing the refresh pipeline; see [data-refresh.md](./data-refresh.md))
- **CSV files** — DuckDB tables, name pattern is up to the project. Keep the `{project_id}__{filename_stem}` table-naming convention.
- **Optional `schema.md`** — a short narrative description of the tables/columns, used as the chat system prompt. Today schema comes from `db.get_schema()` (DESCRIBE + sample rows). Letting the project author write a tighter description improves the chat experience.

### B. The dashboard contract

Each project ships one or more dashboard variants. Two paths to pick from:

**B1. Per-project bespoke dashboards** (current pattern)
- `components/dashboards/<Project>Dashboard.jsx` + `<Project>DashboardEditorial.jsx`
- Project-specific `lib/queries/<project>.js`
- Registry entry: `DASHBOARDS[key] = { classic: …, editorial: … }`
- *Best when:* the project has its own narrative (like asset_search). Highest ceiling, highest floor.

**B2. Generic / schema-driven dashboard**
- A single configurable dashboard that reads `project.json` for what to render (stat cards, time-series, top-N tables)
- The project author writes a JSON config, not React
- *Best when:* the project is "show me trends + a leaderboard" with no narrative. Lower ceiling, much lower floor.

The right answer is probably **both**: bespoke when the project earns it, generic as the default for the long tail. The generic one is the unbuilt thing. `GenericDashboard.jsx` already exists as a stub — it's the natural place to grow this.

### C. Query helpers

Today `lib/queries/<project>.js` defines:
- `groupTables(tables)` — partitions a project's tables by week / event family
- A function per metric (e.g. `queryHealthByWeek`, `funnelByWeek`)
- `METRIC_DEFS` — tooltip definitions

For new projects, follow the same shape. Worth extracting:
- A common helper like `unionByWeek(tables, cols, weekFromName)` that any project can reuse
- A common `weekTag(name)` parser

### D. The chat panel

`backend/services/claude.py` (the chat handler) reads `db.get_schema(project_id)`
and passes it as the system prompt. For each new project, **either**:
- Let `get_schema` auto-generate from DuckDB DESCRIBE (current behaviour) — works, but the prompt gets noisy
- **Recommended:** if `data/<project_id>/schema.md` exists, prepend that to the auto-generated schema. It costs the project author 30 minutes and improves chat answers a lot.

### E. The home page / index

Already lists every project; nothing structural to change. Bigger N could justify:
- **Filter / search** on the home page (e.g. by tag, owner, status) — only worth doing past ~6 projects
- **Project groupings** — e.g. "Search & Discovery" vs "Conversion & Retention" — driven by a `category` field in `project.json`

### F. Project creation flow

Today the "New project" button on the home page just shows an alert. Two paths:

**F1. CSV-driven creation** (closer to current)
- The upload panel already exists. Extend it to optionally create a *new* `project_id` when the dropdown's chosen value doesn't exist.
- Backend creates `data/<new_id>/` and a minimal `project.json` on first upload.
- Dashboard component defaults to `GenericDashboard`.

**F2. Form-driven creation**
- A modal that collects name / description / tags / dashboard_component, then writes the directory.
- More explicit, more clicks.

F1 is simpler and matches "drop CSVs, get a dashboard." F2 is closer to "real product."

## Trade-offs

- **B1 (bespoke) compounds**: every new bespoke dashboard is a maintenance liability. Mitigate by extracting shared chart primitives + the data hook pattern that `AssetSearchDashboardEditorial` already follows.
- **B2 (generic) flattens**: every project starts looking the same. Mitigate by letting `project.json` set the dashboard's headline + lede so at least the framing differs.
- **Schema files** (D) drift from reality unless someone owns them. If you go this way, add a CI check that compares the listed columns to the live DuckDB DESCRIBE.
- **F1** lets users create projects without a name — fine for an internal tool, would be weird in a real product.

## Open questions

1. Will there be many projects (10+) or a few (3–4)? Drives whether to invest in the generic dashboard.
2. Is asset_search the model for what "good" looks like, or is the editorial-style ambitious for most future projects? Drives whether editorial is a default or an opt-in per project.
3. Who creates new projects — engineers or PMs? Drives F1 vs F2 (or a CLI-only creation path).
4. How tightly tied to Grip's product taxonomy should projects be? E.g. one project per feature, or one big "discovery" project with sub-sections?

## Suggested first slice

The smallest move that materially helps a second project:

1. Decide on the next project (concretely: which event tables / which metrics).
2. Build it bespoke (path B1) — that gives you the second data point to extract shared primitives from. **Don't generalize on one example.**
3. After it ships, extract the truly shared pieces (week-tagging, the `useDashboard` hook shape, the StatStrip pattern) into `lib/dashboard-kit.ts` or similar. Use the *editorial-vs-classic* split as the test: anything used by both modes is a real primitive.

Resist the urge to design the generic dashboard before the second project ships. The wrong abstractions are the most expensive code in this repo.
