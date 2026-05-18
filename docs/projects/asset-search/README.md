# Asset Search — project

Post-launch analytics for the Grip Asset Search feature (launched **2 Apr 2026**,
v21.9.0). Tracks search intent, zero-result rate, search outcomes, issuer-level
demand, and search→invest conversion.

- **Owner:** Puru (Product Analytics)
- **Dashboard route:** `/projects/asset_search`
- **Data window:** W1–W6 (2 Apr – 13 May 2026); W7 onward pending export
- **Jira:** PT-37543

## Dashboard

Two variants behind the design toggle:

- **Editorial** ("Grip Weekly") — `components/dashboards/AssetSearchDashboardEditorial.jsx`
  — **the maintained variant.** All new work goes here.
- **Classic** — `components/dashboards/AssetSearchDashboard.jsx` — **deprecated**
  (`@deprecated` banner in-file). Kept for reference; do not extend.

## Primary metric — the session-outcome funnel

Every searched session is classified once into one of three mutually-exclusive
buckets, computed live from `asset_search_query` + `asset_search_result_clicked`:

| Bucket | Meaning |
|--------|---------|
| **Success** | the session clicked a search result |
| **Relevance gap** | results were shown, nothing clicked (a ranking miss) |
| **Dead end** | every query returned zero results (a catalog / alias gap) |

**Search Success Rate** is the headline (~52% over W1–W6, trending 44% → 59%).
This replaced the earlier `asset_search_cleared`-based "true abandonment / relevance
gap" split, which understated search failure ~10× — see `roadmap.md` for the why.

## Key files

| Area | Path |
|------|------|
| Query builders | `frontend/lib/queries/assetSearch.js` |
| Dashboard (maintained) | `frontend/components/dashboards/AssetSearchDashboardEditorial.jsx` |
| Project data | `backend/data/asset_search/` |
| Project metadata | `backend/data/asset_search/project.json` |

## In this folder

- [`data-sources.md`](./data-sources.md) — every event/table the project uses,
  with validation status against the local exports.
- [`roadmap.md`](./roadmap.md) — what's done, what's next, open decisions.
- [`issuer-deepdive.md`](./issuer-deepdive.md) — issuer-level analysis ideation.
