# Grip Analytics — repo guide

Internal, hosted analytics platform: a Next.js frontend + FastAPI/DuckDB backend
that serves multiple independent analytics **projects** (Asset Search, Grip
Connect, …) from one codebase.

## Project-level vs platform-level — the core pattern

Each analytics project has genuinely different data, metrics, and roadmap. They
do **not** share a doc namespace or a planning surface. Keep work scoped to the
right level:

| Level | Where | What belongs |
|-------|-------|--------------|
| **Project** | `docs/projects/<project>/` | A project's data sources, metric definitions, dashboard design, ideation, plans, specs. **Most things.** |
| **Platform / architecture** | `docs/architecture/` | Only cross-project, structural concerns — the multi-project model, the data-integration framework, the DuckDB/build pipeline, shared UI standards, auth, routing. |

**Before writing a doc or planning work, ask:** does this change the platform
for *every* project, or just one? Platform → `architecture/`. One project →
`projects/<project>/`. Default to project-level; keep `architecture/` small.

See `docs/README.md` for the full layout and the per-project folder convention.
New project → add `docs/projects/<name>/` (README, data-sources, roadmap) and a
`backend/data/<name>/` with `project.json`.

## Projects

| Project | Route | Docs | Status |
|---------|-------|------|--------|
| Asset Search | `/projects/asset_search` | `docs/projects/asset-search/` | Active. Editorial dashboard maintained; Classic deprecated. |
| Grip Connect | `/projects/grip_connect` | `docs/projects/grip-connect/` (spec/plan still under `docs/specs`,`docs/plans` — migration pending) | Active. Live-data pipeline spec approved. |

## Data discipline

- **Deterministic Python only in the data path.** No LLM in extraction or
  refresh. Claude **authors and validates** fetch/transform scripts; it does
  **not** run extraction at runtime.
- **Live data** is pulled from Metabase via the REST API
  (`POST /api/session` → `POST /api/card/{id}/query`) by the per-project fetch
  modules under `backend/services/integrations/`. Reference design:
  `docs/specs/2026-05-17-grip-connect-live-data-design.md`. Asset Search is the
  second project on this framework — see its `roadmap.md`.
- Per-project CSVs live in `backend/data/<project>/`, baked into `grip.duckdb`
  by `backend/build_duckdb.py`; table naming `{project}__{csv_stem}`.
- Exclude test users `3, 4, 207871, 207875, 207878, 207879` in every query path.

## Working conventions

- **Worktrees:** any task that edits this repo runs in a dedicated git worktree,
  never the primary checkout (standing mandate — see `~/.claude` /
  `CLAUDE.local.md`). One worktree per task.
- Commit at every checkpoint; build (`next build`) before claiming done.
- Mobile-first: new UI is cleared at 375 px first (`docs/ideation/mobile-first.md`).
