# Learn (Grip Education) — project

Pre-investment education surface — short-form video reels on `/learn` shown
to non-invested users in the **`learn_page` A/B experiment**. Hypothesis:
*surfacing bite-sized investing content lifts the First-Time Investor (FTI)
rate without hurting funnel metrics elsewhere.*

- **Owner:** Puru (Product Analytics)
- **Status:** **LIVE.** Prod tag `v22.0.26` (2026-05-27 13:02 IST).
- **Dashboard:** [`/projects/learn_education`](https://grip-analytics-psi.vercel.app/projects/learn_education)
- **Source repo:** `gi-client-web` (`develop` ≥ PR #6226 merged 2026-05-26)
- **Jira:** PT-37596

---

## Start here

Depending on what you need to do, jump to the right doc:

| If you want to… | Read |
|---|---|
| Understand **what the dashboard does** + what it answers | [README — Surface contract](#surface-contract) (below) |
| See **how it works end-to-end** — data flow, repos, deployments | [`architecture.md`](./architecture.md) |
| Find **the exact SQL or event payload** for a metric | [`data-sources.md`](./data-sources.md) |
| Understand **why** we chose DB 24 / 12-week window / "Margin Notes" / etc. | [`decisions.md`](./decisions.md) |
| Resolve a term: FTI, MDE, SRM, sticky bucketing, etc. | [`glossary.md`](./glossary.md) |
| Trigger a refresh, debug a failure, deploy a change | [`operations.md`](./operations.md) |
| See **what's shipped vs what's next** | [`roadmap.md`](./roadmap.md) |
| Trace **session-by-session history** of how this was built | [`session-log.md`](./session-log.md) + [`sessions/`](./sessions/) |
| Read the **dashboard specifications** (V1, V2) | [`specs/`](./specs/) |

---

## Surface contract

The Learn surface emits **6 events** plus **2 cross-feature events** that
also fire here. See [`data-sources.md`](./data-sources.md) for payloads.

### Learn-specific events

| Event | When it fires | Wired in |
|---|---|---|
| `experiment_assigned` (`learn_page`) | Once per non-invested non-GC user when `learnPageConfig` hydrates | `useShowLearnPage.ts` |
| `learn_page_viewed` | On each `/learn` mount (with `entry_source`) | `useLearnPageEvents.ts` |
| `learn_category_clicked` | On real category-tab switch (not re-click) | `LearnVideoSection.tsx` |
| `learn_video_opened` | When user taps a video card, before reels open | `LearnVideoSection.tsx` |
| `learn_video_viewed` | At view-end (swipe / close / unmount) with `completion_pct` + `exit_reason` | `useVideoReels.ts` |
| `learn_outbound_clicked` | On in-grid banner tap routing off `/learn` | `VideoGrid.tsx` |

### Cross-feature events (canonical, do NOT Learn-fork)

| Event | Where it carries Learn signal |
|---|---|
| `bottom_nav_click` | When the user taps the Learn item; the next `learn_page_viewed` carries `entry_source='bottom_nav'` |
| `banner_clicked` | Top + bottom carousel banners on `/learn` — filter `page='/learn'` |

**Deprecated events** (removed from source, filter by week if you see them in pre-launch data):
- `learn_video_action`
- `learn_banner_click`
- `learn_video_chip_clicked`

---

## What the dashboard answers

The primary surface is a **weekly cohort A/B table** keyed by `(week × variant)`:

| Column | Source | Definition |
|---|---|---|
| Total Non-Invested Users | `experiment_assigned` distinct `user_id` per variant per week | denominator |
| Learn Page Visitors | `learn_page_viewed` distinct `user_id` ∩ same-week cohort | visit numerator |
| Learn Visit Rate | derived | Visitors / Non-Invested |
| Unique Video Players | `learn_video_viewed` distinct `user_id` where `total_watched_seconds > 0` | engagement |
| Total Video Plays | `learn_video_viewed` count where `total_watched_seconds > 0` | engagement volume |
| Avg Videos Per User | derived | Plays / Unique Players |
| Avg Watch Time (sec) | derived | Σ `total_watched_seconds` / Plays |
| FTI Users | `prodgripdb.ur_tblorders` (DB 24) where `status IN (1,7,8) AND order_type='BUY'`, scoped to cohort | conversion — per [Metabase q2672](https://metabase.gripinvest.in/question/2672-fti-dod-non-pii-ch) |
| FTI users who watched | `ur_tblorders` FTI ∩ `learn_video_viewed` where played-at ≤ fti-date | causal-overlap proxy |
| FTI Rate | derived | FTI / Non-Invested |

**V2 (in flight per [`specs/2026-05-27-tier2-and-margin-notes.md`](./specs/2026-05-27-tier2-and-margin-notes.md)) adds:**
- 7 Tier 2 metrics (engaged-visitor rate, plays/visitor, drop-after-first, completion rate, time-to-first-play, outbound CTR, banner CTR on /learn)
- "Margin Notes" — A/B integrity section with SRM, Control leak, FTI lift CI, MDE

---

## Key files

### `gi-client-web` (source repo)

| Area | Path |
|---|---|
| Event constants & types | `events/constants.ts`, `events/types.ts` |
| Page mount event | `components/learn/hooks/useLearnPageEvents.ts` |
| Category-click + video-open | `components/learn/LearnVideoSection/LearnVideoSection.tsx` |
| View-end event | `components/learn/VideoReels/useVideoReels.ts` |
| Outbound click event | `components/learn/VideoGrid/VideoGrid.tsx` |
| Experiment bucketing + assignment fire | `components/learn/hooks/useShowLearnPage.ts` |
| Default JSON config | `public/fallback-config/learn.json` |

### `grip-analytics` (this repo)

| Area | Path |
|---|---|
| Fetch module | `backend/services/integrations/learn_education.py` |
| Output CSV | `backend/data/learn_education/weekly_ab_tracker.csv` |
| Manifest | `backend/data/learn_education/manifest.json` |
| Tests | `backend/tests/test_learn_education.py` |
| Dashboard hook | `frontend/lib/queries/learnEducation.js` |
| Dashboard component | `frontend/components/dashboards/LearnEducationDashboardEditorial.jsx` |
| Daily cron workflow | `.github/workflows/refresh-learn-education.yml` |

---

## Current data snapshot (W1, 2026-05-25)

```
                  Control       Treatment
─────────────────────────────────────────
Bucketed users      982            994
Visit Rate         0.20%          5.63%
Unique Players       2              17
Total Plays          6              43
Avg Watch (s)       1.7            52.1
FTI Users            0               0      (W1 too fresh — ~3 days post-launch)
```

Daily-order probe: **717 BUY orders/day** (the FTI universe). Cohort users who have ever FTI'd in the 12-week window: **764**.

**Next milestone:** W4 statistical reveal (~2026-06-22) — by then the cohort should be ≥ 12K users/arm, enough for a 5% relative MDE at 80% power. See [`decisions.md`](./decisions.md) D-11 and the V2 spec.
