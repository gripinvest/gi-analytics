# Session S1 — Launch-day handoff

**Closed:** 2026-05-27 ~21:10 IST
**Prod feature go-live:** gi-client-web `v22.0.26` at 2026-05-27 13:02 IST
**Latest cron run:** 2026-05-27 ~20:46 IST (committed weekly_ab_tracker.csv to main)

> Copy the markdown code block below into the next session to resume.

---

## Carry-forward prompt

```markdown
Continue the Grip Education analytics work. This is a fresh session
picking up from S1 handoff on 2026-05-27 ~21:10 IST.

## Project state

The Learn (Grip Education) A/B experiment dashboard at
`/projects/learn_education` in https://github.com/purujit-grip/grip-analytics
is LIVE. gi-client-web events shipped to production in tag `v22.0.26`
at 2026-05-27 13:02 IST. Daily cron at 01:00 IST + manual-refresh
button both work end-to-end. Repo is on `main` at the latest cohort-
scoped FTI + DB 24 ur_tblorders + pagination fix (PR #98 merged).

Latest CSV — backend/data/learn_education/weekly_ab_tracker.csv,
committed 2026-05-27 ~20:46 IST:

  W1 (week_start 2026-05-25, ~2.8 days of post-launch data so far):
    Control   — 982 users · 0.20% visit rate · 0 FTI
    Treatment — 994 users · 5.63% visit / 17 players / 43 plays /
                52.1s avg watch · 0 FTI

  Daily-order probe: 717 BUY orders yesterday
  Cohort users who have ever FTI'd in last 12 weeks: 764

FTI=0 is expected: W1 cohort was bucketed starting 2026-05-25 (3 days
ago at S1 close). FTI typically matures 3-7 days post-assignment.
Expect non-zero by 2026-05-30; statistically meaningful comparison
around W4 (need ~12K users per arm for 5% MDE @ 80% power).

## Architecture

- gi-client-web (separate repo, on `develop`, shipped via `v22.0.26`):
  6 Learn events emitting from production:
    experiment_assigned (learn_page), learn_page_viewed,
    learn_category_clicked, learn_video_opened, learn_video_viewed,
    learn_outbound_clicked.
  Plus cross-feature `bottom_nav_click` + `banner_clicked`
  (page='/learn').

- Backend fetch: backend/services/integrations/learn_education.py
  · Cohort + engagement: Metabase DB 8 (Rudder, client_web schema)
  · FTI: DB 24 (ClickHouse warehouse) `prodgripdb.ur_tblorders`,
    cohort-scoped + LIMIT 2000 OFFSET n paginated.
  · DO NOT swap back to DB 2 — we use DB 24 for analyst-canonical
    alignment (business reports query the same warehouse).

- Frontend dashboard:
  components/dashboards/LearnEducationDashboardEditorial.jsx
  Editorial broadsheet (Asset Search / Performance Grip family).
  Reads from DuckDB table `learn_education__weekly_ab_tracker`.
  Has Refresh button + nonce-driven re-fetch.

- Docs source of truth: docs/projects/learn-education/data-sources.md

## Cron design — closed questions, don't re-litigate

S1 considered and rejected three alternatives. Don't switch back.

1. Twice-daily cron — REJECTED. No retention pressure on Rudder/
   Postgres (unlike Performance Grip's 8-day NR Web Vitals window).
   Doubles cost for no analytic gain.

2. Shorter rolling window (4 weeks instead of 12) — REJECTED.
   The `fti_users >= c.assigned_week` predicate means W1's FTI rate
   keeps updating as late-tail conversions happen (15-60 days
   post-bucketing). A 4-week window would freeze W1 at week 5 and
   silently understate the FTI lift. Conservative is fine; silently
   wrong is not.

3. Incremental daily-fetch pattern (Asset Search style) — REJECTED.
   Our output CSV is 24 rows max (12 weeks × 2 variants). Git growth
   is a non-issue. The whole-window recompute is self-healing: a
   missed day or a backfill in Rudder/tblorders surfaces on the next
   run automatically.

Why the cohort-scoped FTI fetch decouples cost from window length:
the `WHERE user_id IN (<~2,000 cohort ids>)` predicate uses ClickHouse's
user_id index — query work is bounded by cohort size, not the ~60,000
order rows in the 12-week source. Engagement query is similarly bounded
(~2,000 per-user rows from Rudder's ~3,000 events). Total cron cost
~3-5s.

## Tier 2 metrics to ship (priority order)

All derivable from existing event data. Numbers are from S1 close.

1. Engaged-visitor rate = unique_video_players / learn_page_visitors
   Today Treatment: 17/56 = 30.4% (most visitors don't play — UX
   signal). Aggregator-only change in aggregate_rows(); no SQL change.

2. Plays-per-visitor = total_video_plays / learn_page_visitors
   Today Treatment: 43/56 = 0.77. Different shape from Avg/User
   (denominator = visitors not players). Aggregator-only.

3. Drop-after-first-video = 1 - (multi-play users / unique players)
   Aggregator-only: bucket['multi_play_users'] += 1 if play_count > 1
   in the per-user loop. Then (multi_play_users / unique_players).

4. Completion rate = plays where completion_pct >= 75 / total plays
   Engagement SQL needs adding:
     COUNT(*) FILTER (WHERE completion_pct >= 75) AS completed_plays
   in the plays CTE. One column added to per-user rows; aggregator
   does SUM(completed_plays) / SUM(total_video_plays).

5. Outbound click rate = learn_outbound_clicked / learn_page_visitors
   Engagement SQL needs a NEW CTE that pulls learn_outbound_clicked
   events from Rudder per user, joined to cohort.

## Other follow-ups (post Tier 2)

6. Category split (Bond101 vs Advanced) — SQL needs per-user category
   breakdown. Recommend a sibling CSV (weekly_ab_tracker_by_category.csv)
   rather than widening the single row. Keeps the weekly tracker
   scannable.

7. Investigate the Control surface-leak — gi-client-web side.
   Both weeks: 2 Control visitors at ~0.20%. Investigate:
   · /learn?source=deep_link path?
   · useShowLearnPage gate edge case?
   · UTM bypass?

8. A/B statistical layer — wait until W4 for meaningful CIs.
   Currently MDE ~1.4pp at N=982; need ~12K/arm for 5% relative MDE.
   When ready: two-proportion z-test or Bayesian beta-binomial in
   deriveMeta(), surface 95% CI on (treatment - control) in the
   lift box.

## Where to start

1. Pull origin/main in grip_analytics repo.

2. Create a worktree from latest main (mandate per CLAUDE.local.md):
     git worktree add -b feat/learn-tier2-metrics \
       .claude/worktrees/learn-tier2-metrics origin/main

3. Add Tier-2 metrics in this order (low → high risk):
   - First 3 (engaged-visitor rate, plays-per-visitor, drop-after-
     first) are pure aggregator changes, no SQL change. Start there.
   - #4 (completion rate) — small SQL change (one column to plays CTE).
   - #5 (outbound CTR) — adds a new CTE to the engagement SQL.

4. Each metric:
   · Add key to CANONICAL_COLUMNS in
     backend/services/integrations/learn_education.py
   · Add matching entry to COLUMNS in
     frontend/lib/queries/learnEducation.js
     (these arrays MUST match exactly)
   · Add a unit test in backend/tests/test_learn_education.py

5. After Tier 2 lands, decide whether category-split (#6) goes in the
   same CSV (wider rows) or a sibling CSV. Recommend sibling.

## Read-only reference files

- docs/projects/learn-education/data-sources.md — full event spec + SQL
- docs/projects/learn-education/README.md — chart-column mapping
- docs/projects/learn-education/sessions/S1-2026-05-27-launch-day-handoff.md
   (this file)
- backend/data/learn_education/weekly_ab_tracker.csv — latest live data
- backend/services/integrations/learn_education.py — fetch module
- backend/tests/test_learn_education.py — 25/25 passing tests

  gi-client-web on origin/develop (tag v22.0.26):
    components/learn/hooks/useShowLearnPage.ts
    components/learn/hooks/useLearnPageEvents.ts
    components/learn/LearnVideoSection/LearnVideoSection.tsx
    components/learn/VideoReels/useVideoReels.ts
    components/learn/VideoGrid/VideoGrid.tsx
    events/constants.ts            — LEARN_* event keys
    utils/experimentBucketing.ts   — getExperimentVariant

## Conventions to honor

- Worktree per task (CLAUDE.local.md mandate). Never edit primary
  checkout.
- DB 24 + ur_tblorders for FTI (analyst-canonical alignment). Comments
  in code warn against swapping back to DB 2.
- Cohort-scoped FTI fetch + LIMIT 2000 OFFSET n pagination (wired in
  fetch_fti_for_cohort()).
- TEST_USERS excluded in every SQL path:
  (3, 4, 207871, 207875, 207878, 207879).
- 187/187 backend pytest currently passing — keep it that way.
- Event names: [object]_[past_tense_verb] convention
  (e.g., learn_video_viewed, not view_learn_video).
- Canonical event constants live in events/constants.ts (gi-client-web).

Pick a Tier 2 metric and let's start.
```

---

## Session S1 — PRs shipped today (2026-05-27)

| PR | Subject | Status |
|---|---|---|
| gi-client-web #6139 + #6226 | All 6 Learn events to develop → prod tag `v22.0.26` (13:02 IST) | ✅ Merged |
| grip-analytics #91 | Project scaffold (docs, project.json) | ✅ Merged |
| grip-analytics #92 | Editorial dashboard + daily cron | ✅ Merged |
| grip-analytics #93 | FTI source switched from Rudder to tblorders | ✅ Merged |
| grip-analytics #94 | Multi-variant experiment support | ✅ Merged |
| grip-analytics #95 | Docs flipped from pre-launch → LIVE | ✅ Merged |
| grip-analytics #96 | Refresh button + nonce + live-data only | ✅ Merged |
| grip-analytics #97 | FTI DB 2 reasoning iteration (superseded) | ✅ Merged |
| grip-analytics #98 | Cohort-scoped FTI + DB 24 ur_tblorders + pagination + daily-order probe | ✅ Merged |

## Closing cron run output (2026-05-27 ~20:46 IST)

```
probes ok          — 90 learn_page_viewed · 2096 experiment_assigned (90d)
engagement         — 1,976 per-user cohort rows from Rudder (DB 8)
daily-order probe  — 717 BUY orders yesterday
fti                — 764 FTI rows from prodgripdb.ur_tblorders
                     (scoped to 1,976 cohort users)
merged             — 2 (week, variant) rows
wrote              — weekly_ab_tracker.csv → committed to main
```

## Latest CSV verbatim (committed to main)

```csv
week_start,variant,total_non_invested_users,learn_page_visitors,learn_visit_rate_pct,unique_video_players,total_video_plays,avg_videos_per_user,avg_watch_time_sec,fti_users,fti_users_who_watched,fti_rate_pct
2026-05-25,control,982,2,0.2,2,6,3.0,1.7,0,0,0.0
2026-05-25,treatment,994,56,5.63,17,43,2.53,52.1,0,0,0.0
```

## Operational notes

- **Cron behaviour:** Each run computes a fresh 12-week-rolling snapshot from Metabase. No incremental state. Running manually anytime gives a snapshot up to that moment.
- **Daily cron:** scheduled 01:00 IST (19:30 UTC) via `.github/workflows/refresh-learn-education.yml`.
- **Manual trigger:** `gh workflow run "Refresh Learn Education data" -R purujit-grip/grip-analytics`
- **Render auto-deploys** the backend on every push to main, so the dashboard sees the latest CSV within minutes of cron commit.
- **The 0.20% Control surface leak** (2 users) is tracked as follow-up #7 above. Not blocking but worth a gi-client-web investigation.
