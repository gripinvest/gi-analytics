# docs/

Documentation for Grip Analytics. Four areas, by how settled the thinking is —
**reference** is fact, **ideation** is still being explored.

## reference/ — source-of-truth facts

External documents and the notes built on them. Cite these; don't restate them.

| File | What it is |
|---|---|
| [grip-connect-metrics-catalog.md](reference/grip-connect-metrics-catalog.md) | The canonical reference for Grip Connect's data — which Metabase cards feed the dashboard, every column's meaning, what's verifiable, what could be added. Consolidates the data-team conversations, the design spec, and Kishor's `gc-analyst` repo. |
| [gripinvest-db-schema.md](reference/gripinvest-db-schema.md) | Companion notes for the production DB schema — 237 tables / 18 domains, with the `GCI_SCHEMA` (Grip Connect) tables mapped to dashboard sections. |
| [gripinvest-db-schema-overview.html](reference/gripinvest-db-schema-overview.html) | The backend team's interactive schema explorer. Open in a browser. |

## specs/ — approved designs

A design that has been reviewed and signed off, ready to plan against.

| File | What it is |
|---|---|
| [2026-05-17-grip-connect-live-data-design.md](specs/2026-05-17-grip-connect-live-data-design.md) | How the Grip Connect dashboard moves from hand-loaded CSVs to live Metabase data. Approved 2026-05-17. |

## plans/ — implementation plans

A spec broken into task-by-task steps for an implementer (human or agent).

| File | What it is |
|---|---|
| [2026-05-17-grip-connect-live-data.md](plans/2026-05-17-grip-connect-live-data.md) | Step-by-step build plan for the live-data spec above. |

## ideation/ — exploratory thinking

Not decided yet. Each doc follows the same shape (Why / Pointers / Trade-offs /
Open questions / Suggested first slice). Answer the open questions before
writing code. Start at [ideation/README.md](ideation/README.md).

| Thread | One-line |
|---|---|
| [multi-project-platform.md](ideation/multi-project-platform.md) | Many projects across feature / journey / domain / external. |
| [config-dashboard.md](ideation/config-dashboard.md) | One `GenericDashboard` from a JSON/YAML config; AI-authored; interactive `explorer` sections. |
| [data-integrations.md](ideation/data-integrations.md) | Pluggable source adapters (Metabase, Sentry, App Store, New Relic, YouTube, …). |
| [issuer-deepdive.md](ideation/issuer-deepdive.md) | Per-keyword breakdown inside each issuer; "leaving on the table" view. |
| [mobile-first.md](ideation/mobile-first.md) | Standing principle — every UI starts at ≤375px. |
| [pwa-offline.md](ideation/pwa-offline.md) | Installable home-screen app + offline-resilient reading. |

## Conventions

- **Reference** docs are dated snapshots — they note when to re-request the
  source from the owning team.
- **Specs and plans** are named `YYYY-MM-DD-<slug>`.
- **Ideation** docs are living — mark sections shipped as they land in `main`.
