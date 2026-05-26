# Grip Analytics — documentation

Docs are organised **project-first**. Each analytics project (Asset Search,
Grip Connect, …) has its own data, metrics, ideation and roadmap — they are
genuinely different products and do not share a doc namespace. Only concerns
that span *every* project live at the top level.

## Layout

```
docs/
  architecture/   Platform-wide structural concerns ONLY. A change here affects
                  every project: the multi-project model, the data-integration
                  framework, the DuckDB/build pipeline, shared UI, auth, routing.
  reference/      Source-of-truth facts — external documents and the notes built
                  on them (DB schema, metric catalogs). Cite these; don't restate.
  projects/
    asset-search/    Everything specific to one project — data sources,
    grip-connect/    dashboard, metric definitions, ideation, plans, specs.
    learn-education/ One folder per project.
    <project>/
```

## The rule — where does a doc go?

Before adding a doc, ask: **"does this change the platform for every project,
or just one project?"**

- Platform-wide structural decision → `architecture/`
- A source-of-truth fact (DB schema, an external reference) → `reference/`
- Specific to one project's data, metrics, dashboard or roadmap → `projects/<project>/`

Most docs are project-level. `architecture/` and `reference/` stay small — they
are for genuine cross-project material, not for whichever project happened to
motivate the change.

## architecture/ — platform-wide structural docs

Decisions and reviews that affect every project. Start at
[architecture/README.md](architecture/README.md).

| File | What it is |
|---|---|
| [architecture/architecture-options.md](architecture/architecture-options.md) | Review of the platform's hosting, query-layer, build-vs-buy and pipeline options — alternatives, trade-offs, and the triggers that force each move. |

## reference/ — source-of-truth facts

External documents and the notes built on them. Cite these; don't restate them.

| File | What it is |
|---|---|
| [reference/grip-connect-metrics-catalog.md](reference/grip-connect-metrics-catalog.md) | Canonical reference for Grip Connect's data — which Metabase cards feed the dashboard, every column's meaning, what's verifiable, what could be added. |
| [reference/gripinvest-db-schema.md](reference/gripinvest-db-schema.md) | Companion notes for the production DB schema — 237 tables / 18 domains. |
| [reference/gripinvest-db-schema-overview.html](reference/gripinvest-db-schema-overview.html) | The backend team's interactive schema explorer. Open in a browser. |

(Reference docs are dated snapshots — they note when to re-request the source
from the owning team. Project-specific reference material may later move into
that project's folder.)

## Per-project folder convention

Each `projects/<project>/` folder holds:

| File | Purpose |
|------|---------|
| `README.md` | Project hub — what it is, owner, status, dashboard, key files |
| `session-log.md` | Cross-session handoff — where the project last stood |
| `data-sources.md` | The events/tables the project uses, with validation status |
| `roadmap.md` | What's done, what's next, open decisions |
| `plans/`, `specs/` | Implementation plans and design specs, as needed |

## Migration (in progress)

The legacy type-first folders — `docs/plans/`, `docs/specs/`, `docs/ideation/`
— predate this structure and are being migrated. Each ideation doc follows the
same shape (Why / Pointers / Trade-offs / Open questions / Suggested first
slice); start at [ideation/README.md](ideation/README.md).

| Legacy file | Destination |
|-------------|-------------|
| `ideation/multi-project-platform.md` | `architecture/` |
| `ideation/data-integrations.md` | `architecture/` |
| `ideation/mobile-first.md` | `architecture/` |
| `ideation/pwa-offline.md`, `ideation/config-dashboard.md` | `architecture/` (platform features) |
| `ideation/issuer-deepdive.md` | `projects/asset-search/` ✓ done |
| `plans/2026-05-17-grip-connect-live-data.md` | `projects/grip-connect/plans/` |
| `specs/2026-05-17-grip-connect-live-data-design.md` | `projects/grip-connect/specs/` |

The Grip Connect spec/plan are left in place for now to avoid colliding with
in-flight Grip Connect work — they should move when that branch settles.

## Conventions

- **Reference** docs are dated snapshots — note when to re-request the source.
- **Specs and plans** are named `YYYY-MM-DD-<slug>`.
- **Ideation** docs are living — mark sections shipped as they land in `main`.
