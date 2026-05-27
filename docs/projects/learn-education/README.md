# Learn (Grip Education) — project

Pre-investment education surface — short-form video reels on `/learn` shown
to non-invested users in the **`learn_page` A/B experiment** (treatment vs.
control). The hypothesis: surfacing bite-sized investing content to
non-invested users lifts the First-Time Investor (FTI) rate without
hurting funnel metrics elsewhere.

- **Owner:** Puru (Product Analytics)
- **Dashboard route:** `/projects/learn_education` _(to build — see roadmap)_
- **Source feature branch:** `feature/grip-education-learn-page-v2` in
  `gi-client-web` (PR #6139 open against `develop`).
- **Jira:** PT-37596

## What the dashboard answers

The primary surface is a **weekly cohort A/B table** keyed by week × variant
(Control / Treatment), matching the product-side tracking grid:

| Column | Source | Definition |
|---|---|---|
| Total Non-Invested Users | `experiment_assigned` distinct `user_id` per variant per week | denominator for all rates |
| Learn Page Visitors | `learn_page_viewed` distinct `user_id` ∩ same-week cohort | numerator for visit rate |
| Learn Visit Rate | derived | Visitors / Non-Invested |
| Unique Video Players | `learn_video_viewed` distinct `user_id` where `total_watched_seconds > 0` | how many tried at least one video |
| Total Video Plays | `learn_video_viewed` count where `total_watched_seconds > 0` | engagement volume |
| Avg Videos Per User | derived | Plays / Unique Players |
| Avg Watch Time (sec) | derived | Σ `total_watched_seconds` / Plays |
| FTI Users | `prodgripdb.ur_tblorders` (DB 24) where `status IN (1,7,8) AND order_type='BUY'`, `MIN(created_at)` per `user_id` ∩ cohort | conversion numerator — canonical source per [Metabase q2672](https://metabase.gripinvest.in/question/2672-fti-dod-non-pii-ch) |
| FTI users who watched | `ur_tblorders` FTI ∩ `learn_video_viewed` where `played_at ≤ fti_date` | causal-overlap proxy |
| FTI Rate | derived | FTI / Non-Invested |

For the canonical metric definitions and SQL, see
[`data-sources.md`](./data-sources.md).

## Surface contract (gi-client-web)

The feature ships **five new events** plus one existing-but-newly-wired event
on `gi-client-web`. They are documented end-to-end in
[`data-sources.md`](./data-sources.md):

1. `experiment_assigned` (existing infra; **newly wired** for `LEARN_PAGE`)
2. `learn_page_viewed`
3. `learn_category_clicked`
4. `learn_video_opened`
5. `learn_video_viewed`
6. `learn_outbound_clicked`

Cross-feature events that continue to fire on Learn (do not Learn-fork — query
the canonical tables):

- `bottom_nav_click` — fires for Learn item too (consistent with other
  bottom-nav reports)
- `banner_clicked` — fires for the top + bottom carousel banners on `/learn`
  (the shared banner widget) with `page = '/learn'`

The deprecated events `learn_video_action`, `learn_banner_click`, and
`learn_video_chip_clicked` are removed from the source. If you see them in
production data they are pre-cutover and must be filtered by week.

## In this folder

- [`session-log.md`](./session-log.md) — handoff state between sessions.
- [`data-sources.md`](./data-sources.md) — canonical event spec, payloads,
  Metabase mapping (pending), and metric formulas.
- [`roadmap.md`](./roadmap.md) — what's done, what's next, open decisions.
- [`specs/2026-05-26-weekly-ab-tracker.md`](./specs/2026-05-26-weekly-ab-tracker.md)
  — design spec for the weekly A/B tracker dashboard.

## Key files (gi-client-web)

| Area | Path |
|------|------|
| Event constants & types | `events/constants.ts`, `events/types.ts` |
| Page mount event | `components/learn/hooks/useLearnPageEvents.ts` |
| View-end event | `components/learn/VideoReels/useVideoReels.ts` |
| Outbound click event | `components/learn/VideoGrid/VideoGrid.tsx` |
| Experiment bucketing + assignment fire | `components/learn/hooks/useShowLearnPage.ts` |
| Default JSON config | `public/fallback-config/learn.json` |
