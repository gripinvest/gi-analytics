# Weekly A/B tracker — Learn (Grip Education)

**Status:** Draft. Not yet implemented.
**Owner:** Puru
**Created:** 2026-05-26

## Why this dashboard

The Learn page is a product experiment hypothesising that exposing
short-form investing content to non-invested users lifts the First-Time
Investor (FTI) rate. The product team tracks this in a weekly cohort table
(see `../README.md`). This dashboard replaces the manual spreadsheet with a
live, queryable surface backed by the same Rudder events.

## One-screen scope

A single table — week × variant — with health-check strips above. **Not a
multi-section narrative dashboard** (no editorial framing, no funnel
breakdowns). The job is to make the manual sheet redundant. Anything beyond
that is in `roadmap.md` Phase 4.

## Page layout (375 px first)

```
┌─────────────────────────────────────────────┐
│ Learn — Weekly A/B Tracker                  │
│ Week range: [W1 ▾] [W6 ▾]                   │
├─────────────────────────────────────────────┤
│ ⚠ HEALTH                                    │
│ SRM check: Treatment 5,000  Control 5,000  ✓│
│ Control Visit Rate: 0.0%                    │  ← non-zero = leak
├─────────────────────────────────────────────┤
│  Week 1  Control  | Non-Invested: 5,000     │
│                    Visit Rate: —            │
│                    Plays: —                 │
│                    FTI: 50 (1.0%)           │
│  Week 1  Treatment| Non-Invested: 5,000     │
│                    Visitors: 1,500 (30.0%)  │
│                    Unique Players: 750      │
│                    Plays: 1,200             │
│                    Avg Videos/User: 1.6     │
│                    Avg Watch Time: 22s      │
│                    FTI: 75 (1.5%)           │
│                    FTI ∩ Watched: 40        │
│  Week 2  Control  | …                       │
│  ⋮                                          │
└─────────────────────────────────────────────┘
```

Desktop renders the same data as a wide table (one row per week × variant,
columns as in the product sheet).

## Columns

Pulled from `data-sources.md` §4. Order matches the product spreadsheet:

1. Week (Monday IST)
2. Cohort (Control / Treatment)
3. Total Non-Invested Users
4. Learn Page Visitors
5. Learn Visit Rate (%)
6. Unique Video Players
7. Total Video Plays
8. Avg Videos Per User
9. Avg Watch Time (sec)
10. FTI Users
11. FTI Users Who Watched
12. FTI Rate (%)

Control rows display "—" for columns 4–9 (the surface is invisible to
Control). Filling these with 0 instead of "—" misleads — distinguish "did
not happen" from "could not happen by design."

## Health strip (above the table)

Two checks, fail-loud:

1. **SRM (Sample Ratio Mismatch).** Compare Control vs. Treatment counts in
   `experiment_assigned` for the selected window. Tolerance: ±2% of
   expected ratio. Fail → red, link to a docs entry on what to do.
2. **Control Visit Rate** — should be `0.0%` if the feature is correctly
   conditional-rendered. Non-zero = leak. Surface the number; one decimal.

These are the cheapest A/B-validity guardrails and they catch the two
classes of bug that destroy an experiment silently.

## Data freshness

Match Asset Search's pattern: daily refresh via the deterministic Metabase
fetch pipeline (`backend/services/integrations/fetch_learn_education.py` —
Phase 2 D2 in `roadmap.md`). Show "Last updated: <timestamp>" in the
footer.

## Filters

- Week range (default: full available history)
- Variant (default: both; allows zoom to Treatment-only)

No other filters in V1. Per-video / per-category breakdowns are Phase 4.

## Out of scope for V1

- Per-video performance
- Per-category split (Bond101 vs. Advanced)
- Completion-pct histograms
- Funnel: Learn visit → outbound click → invest
- Statistical significance / confidence intervals

Each of these is a separate iteration in `roadmap.md` Phase 4 with its own
trigger.

## SQL surface

All SQL lives in `frontend/lib/queries/learnEducation.js` as parameterised
DuckDB query builders (matching `assetSearch.js` style). One builder per
column, plus the cohort denominator builder. No SQL strings in the React
component; pass data in as already-shaped rows.

## Implementation order

Mirrors `roadmap.md` Phase 3:

1. `backend/data/learn_education/project.json`
2. Query builders covering the cohort denominator + all 12 columns
3. `components/dashboards/LearnEducationDashboard.jsx`
4. Health strip
5. Mobile review at 375 px
6. Add to project registry / route

Each step ships independently. The dashboard renders empty until step 3 and
shows real data once Phase 2 D3 has landed a W1 CSV.

## Validation before shipping

Before declaring the dashboard "ready":

- Cross-check every column against a hand computation on the W1 CSV.
- Verify SRM strip flags a deliberately-skewed test snapshot.
- Verify Control Visit Rate flags a synthetic row that places a Control
  user in `learn_page_viewed`.

Borrow the validation harness pattern from
`backend/services/integrations/validate_asset_search.py`.
