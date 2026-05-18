# Grip Analytics — documentation

Docs are organised **project-first**. Each analytics project (Asset Search,
Grip Connect, …) has its own data, metrics, ideation and roadmap — they are
genuinely different products and do not share a doc namespace. Only concerns
that span *every* project live at the top level.

## Layout

```
docs/
  architecture/            Platform-wide concerns ONLY. A change here affects
                           every project: the multi-project model, the
                           data-integration framework, the DuckDB/build
                           pipeline, shared UI standards, auth, routing.
  projects/
    asset-search/          Everything specific to one project — its data
    grip-connect/          sources, dashboard, metric definitions, ideation,
    <project>/             plans and specs. One folder per project.
```

## The rule — where does a doc go?

Before adding a doc, ask: **"does this change the platform for every project,
or just one project?"**

- Changes the platform for everyone → `architecture/`
- Specific to one project's data, metrics, dashboard or roadmap → `projects/<project>/`

Most docs are project-level. `architecture/` should stay small — it is for
genuine cross-project / structural decisions, not for whichever project
happened to motivate the change.

## Per-project folder convention

Each `projects/<project>/` folder holds:

| File | Purpose |
|------|---------|
| `README.md` | Project hub — what it is, owner, status, dashboard, key files |
| `data-sources.md` | The events/tables the project uses, with validation status |
| `roadmap.md` | What's done, what's next, open decisions |
| `plans/`, `specs/` | Implementation plans and design specs, as needed |

## Migration (in progress)

The legacy type-first folders — `docs/plans/`, `docs/specs/`, `docs/ideation/`
— predate this structure and are being migrated:

| Legacy file | Destination |
|-------------|-------------|
| `ideation/multi-project-platform.md` | `architecture/` |
| `ideation/data-integrations.md` | `architecture/` |
| `ideation/mobile-first.md` | `architecture/` |
| `ideation/pwa-offline.md`, `ideation/config-dashboard.md` | `architecture/` (platform features) |
| `ideation/issuer-deepdive.md` | `projects/asset-search/` ✓ done |
| `plans/2026-05-17-grip-connect-live-data.md` | `projects/grip-connect/plans/` |
| `specs/2026-05-17-grip-connect-live-data-design.md` | `projects/grip-connect/specs/` |

The Grip Connect files are left in place for now to avoid colliding with
in-flight Grip Connect work — they should move when that branch settles.
