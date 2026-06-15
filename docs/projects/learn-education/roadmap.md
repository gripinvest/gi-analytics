# Learn (Grip Education) — roadmap

> What's done in the **gi-client-web feature branch**, and what's left to
> build on the **analytics side** to power the dashboard.

## Source-side (gi-client-web) — feature branch `feat/learn-analytics-events`

Done on this branch (off `feature/grip-education-learn-page-v2`):

- ✅ `experiment_assigned` now fires for the `learn_page` experiment in
  `useShowLearnPage` — both arms, deduped, gated on non-invested non-GC.
- ✅ `learn_page_viewed` retained; payload unchanged.
- ✅ `learn_video_viewed` replaces `learn_video_action` — single view-end
  event with `max_position_reached_seconds`, `total_watched_seconds`,
  `completion_pct`, `loop_count`, `exit_reason`, `position_in_session`.
- ✅ `learn_outbound_clicked` replaces in-grid `learn_banner_click`.
- ✅ `learn_category_clicked` added — tab-bar switch (Bond101 ↔ Advanced),
  with `previous_category_id` and `category_position` attributes.
- ✅ `learn_video_opened` added — fires on video-card tap (before reels mount),
  pairs with `learn_video_viewed` for autoplay-success rate diagnostics.
- ✅ `learn_video_chip_clicked` dropped — folded into `learn_page_viewed`
  `entry_source: 'top_chip'`. (Note: this was a Learn-bespoke event;
  cross-feature consistent events like `bottom_nav_click` are **kept**.)
- ✅ `bottom_nav_click` still fires for the Learn item (cross-feature
  consistent event — other dashboards depend on it). `entry_source` on
  `learn_page_viewed` is an *additional* attribute, not a replacement.
- ✅ All attribute values are typed constants (`LEARN_ENTRY_SOURCE`,
  `LEARN_EXIT_REASON`, `LEARN_CTA_TYPE`) — no hardcoded strings at use
  sites.
- ✅ URL entry-source values use snake_case (`top_chip`, `bottom_nav`) to
  match the codebase `EntrySource` convention.
- ✅ Test coverage: 281 tests passing across affected suites.

Not done — known follow-up on the source side:

- 🟡 **Top + bottom carousel banners on `/learn`** still emit the generic
  `banner_clicked`. Fold into `learn_outbound_clicked` when touching the shared
  banner widget is acceptable. *Impact:* dashboard query needs a UNION until
  this lands. See `data-sources.md` §3a.
- 🟡 **`/learn/[videoId]` deep link** — currently a 302 to `/learn`,
  drops the video id. UX bug and an attribution miss for shared links.
- 🟢 Drop the now-unreferenced `useMobileFooterHeight.ts` (the reels
  overlay no longer accounts for the footer — full-bleed since `91c6e2660`).

## Analytics-side (this repo) — build order

### Phase 1 — Foundation (pre-data)

| Step | What | Done? |
|------|------|-------|
| F1 | This project folder (`docs/projects/learn-education/`) | ✅ |
| F2 | Dashboard spec (`specs/2026-05-26-weekly-ab-tracker.md`) | ✅ |
| F3 | `backend/data/learn_education/project.json` stub | ☐ |
| F4 | Add Learn to project registry / route table | ☐ |

### Phase 2 — Data pipeline (after feature ships to prod)

| Step | What | Blocked by |
|------|------|-----------|
| D1 | Confirm event schemas in Rudder once W1 lands | feature live |
| D2 | Author `backend/services/integrations/fetch_learn_education.py` modelled on `fetch_asset_search.py` | D1 |
| D3 | First W1 CSV export → `backend/data/learn_education/` | D2 |
| D4 | `validate_learn_education.py` — re-compute every chart metric from CSV, diff against Metabase | D3 |
| D5 | DuckDB table naming `learn_education__{event_name}` | D3 (build pipeline handles automatically) |

### Phase 3 — Dashboard

| Step | What | Blocked by |
|------|------|-----------|
| C1 | Query builders in `frontend/lib/queries/learnEducation.js` for the 7 metric columns + cohort denominator | D3 |
| C2 | `components/dashboards/LearnEducationDashboard.jsx` — weekly A/B tracker table | C1 |
| C3 | Variant filter, week range filter, test-user exclusion baked in | C2 |
| C4 | Mobile-first review at 375 px | C3 |
| C5 | Health strip: SRM check (cohort sizes within tolerance), Control Visit Rate (must be ~0) | C2 |

### Phase 4 — Iteration once we have data

| Item | Trigger |
|------|---------|
| Per-video performance breakdown (which categories convert) | After W2 |
| Funnel: Learn visit → outbound click → invest | After top/bottom carousel migration (S §3a) |
| Causal lift estimate (Treatment FTI rate − Control FTI rate) with CI | After W4 (sample size) |
| Drop-off histogram by `completion_pct` band | Anytime after D3 |

### Phase 5 — Language & content health (post-Hindi-toggle)

Spec: `specs/2026-06-16-language-and-content-health.md`. This is a **separate
surface** from the A/B tracker — the Hindi toggle ships to everyone, is not an
experiment arm, and these metrics outlive the experiment.

| Step | What | Blocked by |
|------|------|-----------|
| L1 | Source-side `language` on `learn_video_viewed`/`_opened`/`_category_clicked` | ✅ done (gi-client-web `feat/learn-language-analytics-attrs`) |
| L2 | Ingest `learn_language_toggled` + language column on view/open events | feature deployed + first prod week |
| L3 | Tier-A language metrics: adoption, toggle/bounce-back, engagement-by-language | L2 |
| L4 | Tier-B engagement-quality metrics (autoplay success, loop, exit-reason, session depth) — no source change | data flowing |
| L5 | "Content Health & Language" dashboard section, separate from the A/B table | L3, L4 |
| L6 | (Optional) source-side `initial_language` on page_viewed + `language`/`user_id` on outbound | product call (spec §2b, §6) |

---

## Open decisions

These should be answered before Phase 3 — they shape the SQL the dashboard
ships with.

| # | Question | Recommended default | Owner |
|---|---|---|---|
| Q1 | "Plays" definition: `total_watched_seconds > 0` vs. any `learn_video_viewed` row? | `total_watched_seconds > 0` (drops autoplay failures) | Product |
| Q2 | "Avg Watch Time" denominator: per-play vs. per-user? | Per-play (content engagement) | Product |
| Q3 | Cohort slice for engagement columns: assignment-week vs. activity-week? | Activity-week (matches the displayed week) | Product |
| Q4 | FTI attribution window: same-week vs. any time after assignment? | Any time after assignment (lenient causal read) | Product |
| Q5 | Should we surface a Control Visit Rate row to spot SRM? | Yes, as a small health strip | This repo |

When answered, copy the decision into `data-sources.md` §6 and mirror in any
SQL that ships.
