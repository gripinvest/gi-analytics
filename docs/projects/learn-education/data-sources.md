# Learn (Grip Education) — data source mapping

**DBs:** Rudder Prod (DB 8, `client_web` schema) for engagement events ·
ClickHouse warehouse (DB 24, `prodgripdb.ur_tblorders` — the analyst-canonical
view) for FTI. Aligning to DB 24 keeps our numbers consistent with what
business analysts publish in their own dashboards.
**Status:** **LIVE.** Cron is producing weekly_ab_tracker.csv on schedule;
first commit landed 2026-05-27 with 932 Control + 937 Treatment users in W1.
**Source repo:** `gi-client-web` — event constants in `events/constants.ts`,
typed payloads in `events/types.ts`, call sites listed in §0 below.

> Feeds the Learn (Grip Education) editorial dashboard at
> `/projects/learn_education`. Pairs with [`roadmap.md`](./roadmap.md)
> for build order; design spec at
> [`specs/2026-05-26-weekly-ab-tracker.md`](./specs/2026-05-26-weekly-ab-tracker.md).

---

## 0. Validation status

**LIVE on `develop`** as of 2026-05-26 via gi-client-web PR #6226
(*PT-37596 + PT-37900 post-merge fixes*). All six events documented
below are emitting from the production gi-client-web build:

| Event | Wired in | Source-side verified |
|---|---|---|
| `experiment_assigned` (`learn_page`) | `components/learn/hooks/useShowLearnPage.ts` (useEffect with `trackExperimentAssignment`) | ✅ |
| `learn_page_viewed` | `components/learn/hooks/useLearnPageEvents.ts` | ✅ |
| `learn_category_clicked` | `components/learn/LearnVideoSection/LearnVideoSection.tsx` | ✅ |
| `learn_video_opened` | `components/learn/LearnVideoSection/LearnVideoSection.tsx` | ✅ |
| `learn_video_viewed` | `components/learn/VideoReels/useVideoReels.ts` | ✅ |
| `learn_outbound_clicked` | `components/learn/VideoGrid/VideoGrid.tsx` | ✅ |

Cross-feature events that also fire on this surface (use canonical tables,
do **not** Learn-fork queries):

- `bottom_nav_click` — `components/layout/FooterWrapper/MobileFooter/index.tsx`
  fires this for the Learn item too. The Learn item URL is
  `/learn?source=bottom_nav`, so the subsequent `learn_page_viewed` event
  carries the `entry_source` attribution.
- `banner_clicked` — top + bottom carousel banners on `/learn` go through
  the shared banner widget. Filter via `page = '/learn'`.

**Pre-data-fetch validation pending** — the analytics-side daily refresh
will idle as `awaiting_first_event` until the two probes
(`learn_page_viewed` + `experiment_assigned(learn_page)`) return rows from
Rudder. Once both fire, the cron writes the first weekly CSV and the
dashboard switches from "GALLEY PROOF" to "LIVE".

Validation steps still to do once W1 prod data lands:
1. Confirm each event appears in Rudder schema
   (`client_web.{event_name}`).
2. Run one-week sample row-count + payload-shape validation via a
   harness modelled on
   `backend/services/integrations/validate_asset_search.py`.
3. Spot-check `ur_tblorders` (DB 24) FTI counts against
   [Metabase q2672](https://metabase.gripinvest.in/question/2672-fti-dod-non-pii-ch).

---

## 1. Funnel map — what fires and when

```
User in LEARN_PAGE bucketing (non-invested, non-GC, mobile)
        │
        ▼
[experiment_assigned]            ← Once per user-per-experiment (deduped via
        │                          localStorage). Both arms emit. The
        │                          denominator on every chart row.
        │
        ├── variant = control ──► (Learn surface never rendered)
        │
        └── variant = treatment ─► User sees Learn entry points (top chip / bottom nav)
                                   │
                                   ▼
                        [learn_page_viewed]    ← Once per Learn route mount.
                                   │            entry_source = top_chip | bottom_nav |
                                   │            deep_link | direct
                                   │
                                   │  optional: user switches category tab
                                   │  ▼
                                   │  [learn_category_clicked] — Bond101 ↔ Advanced.
                                   │  Fires only on a real switch (skipped when
                                   │  the active tab is re-clicked, and not fired
                                   │  for the reels-driven auto-derived change).
                                   │
                                   ▼
                           User taps a video card
                                   │
                                   ▼
                        [learn_video_opened]   ← Intent: card tap before reels
                                   │            playback begins. Pairs with
                                   │            learn_video_viewed: opens − plays
                                   │            = autoplay-failure rate.
                                   │
                                   ▼
                        [learn_video_viewed] ← Fires at every view-end
                                   │            (swipe / close / unmount).
                                   │            One row per video the user
                                   │            was in front of, including
                                   │            zero-watch slides.
                                   │
                                   ├── exit_reason = swipe_next | swipe_back
                                   │   (user moves to another video — next
                                   │    learn_video_viewed will fire on its
                                   │    own end)
                                   │
                                   ├── exit_reason = close (user taps back /
                                   │   X — reels surface closes)
                                   │
                                   └── exit_reason = unmount (safety net for
                                       browser-nav-away)

User taps an in-grid banner → [learn_outbound_clicked] → /assets or /academy

Cross-feature events that ALSO fire on this surface (use canonical tables, do
not Learn-fork queries):
- [bottom_nav_click] — fires when the user taps the Learn item in the mobile
  footer (consistent with the rest of the bottom-nav). entry_source on the
  subsequent learn_page_viewed carries which surface they came from.
- [banner_clicked] — top + bottom carousel banners on /learn (the shared
  banner widget). page = '/learn' filters them.
```

The funnel closes against `ur_tblorders` (FTI conversion) using same-user
joins. `ur_tblorders` lives in DB 24 (warehouse); the fetch module runs
the join client-side in Python because Metabase doesn't support
cross-database joins in native SQL. See §4 for the exact SQL and
[Metabase q2672](https://metabase.gripinvest.in/question/2672-fti-dod-non-pii-ch)
for the canonical FTI definition.

---

## 2. Event spec

### 2a. `experiment_assigned` — A/B cohort source of truth

| Aspect | Value |
|---|---|
| **Status** | Wired in `components/learn/hooks/useShowLearnPage.ts` |
| **Trigger** | `useEffect` inside `useShowLearnPage`, runs once per non-invested non-GC user when `learnPageConfig` is hydrated |
| **Dedup** | Yes — localStorage key `experiment_assigned_<userId>_learn_page` (handled by `trackExperimentAssignment` in `utils/experimentBucketing.ts`) |
| **Both arms emit?** | **Yes** — fires for both `treatment` and `control` |
| **Excluded** | `isInvested === true` · GC users (unless `config.includeGCUsers === true`) · missing `userId` · missing config |

**Payload** (already standardised across all experiments — do not Learn-fork):

```ts
{
  experiment_name: 'learn_page',
  experiment_variant: string,             // see "Variant landscape" below
  experiment_bucket: number,              // 1-100 deterministic hash
  experiment_treatment_percentage: number, // for SRM checks
  user_id: string | number,
  timestamp: string,                       // ISO
}
```

**Variant landscape** — per gi-client-web develop-branch
`utils/experimentBucketing.ts:getExperimentVariant`:

| Strapi config | Possible `experiment_variant` values |
|---|---|
| `treatmentPercentage > 0`, no `variants[]` (binary mode) | `'control'`, `'treatment'` |
| `treatmentPercentage > 0`, `variants: [{name: 'treatmentv1', ...}, ...]` (named mode) | `'control'`, `'treatmentv1'`, `'treatmentv2'`, … |

For `learn_page` today the experiment runs in binary mode → values are
`'control'` and `'treatment'`. The analytics pipeline accepts any string
the Strapi config produces; switching to named variants is a config
change, not a code change. The cohort CTE defensively filters out
`'gc_excluded'` and `'not_eligible'` (these come from
`getExperimentAssignment` early-returns and never reach the tracking
event in the documented call path, but the filter is cheap insurance).

This is **the** denominator. Every metric is `count(...) / count(distinct user_id from experiment_assigned where variant = X)` for the chosen week, grouped per (week, variant). Multi-variant experiments produce N+1 rows per week (1 Control + N treatments).

### 2b. `learn_page_viewed` — Learn surface visit

| Aspect | Value |
|---|---|
| **Status** | Wired in `components/learn/hooks/useLearnPageEvents.ts` |
| **Trigger** | `useEffect` after `router.isReady`, fires once per Learn page mount per `useRef`-guarded session |
| **Fires for logged-out?** | Yes, `user_id` is `null` for anon |

**Payload:**

```ts
{
  user_id: string | number | null,
  entry_source: 'top_chip' | 'bottom_nav' | 'deep_link' | 'direct',
  experiment: { learn_page: { variant, bucket } },
}
```

**Entry source values** — canonical strings from
`events/constants.ts:LEARN_ENTRY_SOURCE`:

- `top_chip` — top-nav "Learn" chip in `Navigation.tsx` (logged-in mobile)
- `bottom_nav` — mobile footer Learn item in `MobileFooter/index.tsx`
- `deep_link` — landed via a shared `/learn` URL with no UTM (today the
  `/learn/[videoId]` SSR redirect collapses to `direct` — see roadmap §G2)
- `direct` — default fallback when `?source=` is absent

> **Naming note:** values use snake_case to match the `EntrySource` convention
> in `events/types.ts` and `events/NAMING_CONVENTIONS.md`.

### 2c. `learn_category_clicked` — tab switch

| Aspect | Value |
|---|---|
| **Status** | Wired in `components/learn/LearnVideoSection/LearnVideoSection.tsx` |
| **Trigger** | User taps a different category tab in the `HorizontalTabBar` |
| **Skipped when** | Active tab is re-clicked (`nextCategoryId === activeCategory`) · reels-driven auto-derived category change (`onCategoryChange` from `VideoReels`) — that path is engagement, not exploration |

**Payload:**

```ts
{
  user_id: string | number | null,
  category_id: string,                    // newly active category
  category_position: number,              // 0-based index in the categories array
  previous_category_id: string | null,    // what they came from
  experiment: { learn_page: { variant, bucket } },
}
```

**Why we need this:** users who explore "Advanced" but never tap a video are
invisible in `learn_video_viewed`. This event closes that gap — "engagement
without watching" is a real signal for content-mix decisions.

### 2d. `learn_video_opened` — tap-to-open intent

| Aspect | Value |
|---|---|
| **Status** | Wired in `components/learn/LearnVideoSection/LearnVideoSection.tsx` (`handleVideoClick`) |
| **Trigger** | User taps a `VideoCard` — fires *before* reels mount, *before* playback attempt |
| **Pairs with** | `learn_video_viewed` — every `learn_video_opened` should produce at least one `learn_video_viewed` row (even on autoplay failure, with `total_watched_seconds = 0`) |

**Payload:**

```ts
{
  user_id: string | number | null,
  category_id: string,                    // category of the opened video
  video_id: string,
  video_title: string,
  video_index: number,                    // 0-based position in the all-videos list (matches learn_video_viewed.video_index)
  grid_position: number,                  // 0-based position within the currently-filtered grid the user is looking at
  has_prior_progress: boolean,            // did they have a watched-percent cookie for this video?
  experiment: { learn_page: { variant, bucket } },
}
```

**Why we need this:** `learn_video_viewed` with `total_watched_seconds = 0`
could mean "tapped and bounced" OR "didn't tap and the slide auto-loaded
silently". This event disambiguates — every 0-watch `learn_video_viewed`
**without** a preceding `learn_video_opened` is autoplay/preload noise; the
ones **with** one are real intent-to-watch failures.

**Diagnostic queries** this unlocks:
- *Autoplay-success rate* — `count(learn_video_viewed where total_watched_seconds > 0) / count(learn_video_opened)`
- *Resume-friendliness* — split watch metrics by `has_prior_progress` to see if returning viewers behave differently
- *Grid-position bias* — does `grid_position = 0` get disproportionately more opens than the rest?

### 2e. `learn_video_viewed` — one row per ended view

**This is the workhorse event.** It replaces the old `learn_video_action`
4-state event (`start` / `complete` / `dropoff` / `resume`) with a single
view-end event carrying the watch metrics.

| Aspect | Value |
|---|---|
| **Status** | Wired in `components/learn/VideoReels/useVideoReels.ts` |
| **Trigger** | IntersectionObserver moves to a new slide · close button · component unmount |
| **Fires when watch was zero?** | **Yes** — autoplay failures / instant-swipe-past slides emit a row with `total_watched_seconds = 0`. This is the silent-failure signal. |
| **Dedup** | `hasEmittedViewRef` guards against double-fire when close is followed by unmount |

**Payload:**

```ts
{
  user_id: string | number | null,
  category_id: string,                    // raw category id from JSON config (e.g. "Bond101", "Advanced")
  video_index: number,                    // 0-based position in the all-videos list
  video_id: string,                       // stable per-video id
  video_title: string,
  video_duration_seconds: number,         // rounded; from <video>.duration
  max_position_reached_seconds: number,   // rounded; high-watermark across loops
  total_watched_seconds: number,          // rounded; sum of forward deltas ≤ 1s
  completion_pct: number,                 // rounded; min(100, max_position / duration * 100)
  loop_count: number,                     // # of times currentTime wrapped near-end → near-zero
  exit_reason: 'swipe_next' | 'swipe_back' | 'close' | 'unmount',
  position_in_session: number,            // 1, 2, 3… within this reels surface session
  experiment: { learn_page: { variant, bucket } },
}
```

**Watch-time honesty:** `total_watched_seconds` is *accumulated forward
delta* with a 1s ceiling per sample — a seek-forward 20s doesn't count, but
genuine watching does. `max_position_reached_seconds` is a separate
high-watermark and survives seek-backs. **Both are needed** because they
answer different questions:

- *"How deep did they get?"* → `max_position_reached_seconds` / duration
- *"How much time did they spend?"* → `total_watched_seconds`

For the chart's "Avg Watch Time" use `total_watched_seconds` summed across
the row's plays.

**Loop handling:** the `<video>` element loops. When `currentTime` drops from
near-duration to near-zero we increment `loop_count` and keep accumulating
watch time. So a user watching a 30s reel twice produces one row with
`total_watched_seconds ≈ 60` and `loop_count = 2`. The dashboard can cap by
duration if desired.

### 2f. `learn_outbound_clicked` — CTA out of Learn

| Aspect | Value |
|---|---|
| **Status** | Wired for in-grid banners in `VideoGrid.tsx`. Top/bottom carousel banners still ride on the generic `banner_clicked` event (see §3a). |
| **Trigger** | User taps an in-grid banner — fires before `next/link` navigation |

**Payload:**

```ts
{
  cta_type: 'in_grid_banner' | 'top_banner' | 'bottom_banner',
  creative_id: string,                    // from JSON config (banner.entrySource / link.analyticsEvent)
  destination_url: string,
}
```

**`cta_type` values** — canonical strings from `LEARN_CTA_TYPE`.

---

## 3. Edge cases and known gaps

### 3a. Top/bottom carousel banners still ride on `banner_clicked`

The `top-banner` and `bottom-banner` carousels on `/learn` use the shared
`components/discovery/Primitives/clickHelpers.ts` flow, which fires the
generic `banner_clicked` event with `config_event_name: 'learn_top_banner'`
or `'learn_grip_academy_banner'` from the JSON config. They are
**not yet folded into `learn_outbound_clicked`** to avoid touching the shared
banner widget in this branch.

**Query implication:** to get every Learn-page outbound CTA, you need:

```sql
SELECT user_id, 'in_grid_banner' AS cta_type, creative_id, destination_url
FROM learn_outbound_clicked
UNION ALL
SELECT user_id, config_event_name AS cta_type, NULL AS creative_id, redirect_url AS destination_url
FROM banner_clicked
WHERE page = '/learn'
```

When the shared banner widget is migrated, drop the UNION arm.

### 3b. Deep-link to `/learn/[videoId]` collapses to `/learn`

`pages/learn/[videoId].tsx` is a 302 to `/learn`. Any shared link loses the
video id and the user gets dropped on the grid. `entry_source` will be
`direct` for these landings — the share-attribution channel is lost. Roadmap
item §G2.

### 3c. Looped reels and the "what is a play" question

A user who lets a 30s video loop twice produces **one** `learn_video_viewed`
row (`loop_count = 2`, `total_watched_seconds ≈ 60`), not two. A user who
swipes past silently produces **one** row with `total_watched_seconds = 0`.

**Convention for the chart:**
- **Plays** = `count(learn_video_viewed WHERE total_watched_seconds > 0)`
- **Unique Players** = `count(DISTINCT user_id WHERE total_watched_seconds > 0)`
- **Avg Watch Time** = `SUM(total_watched_seconds) / Plays`

Other definitions are defensible — these are the ones the spec doc commits
to. Cement them in SQL once, do not redefine downstream.

### 3d. Cohort vs. session week

A user assigned in W1 might first visit Learn in W3 (the assignment is
sticky). Two ways to slice:

- **Assignment-week cohorts** (recommended) — every metric for a week is
  computed on the users assigned **in that week**, regardless of when they
  visited. Cleanest for cohort drift checks.
- **Activity-week** — count visits/plays in the week they happened. Easier
  for engagement trends.

The product chart implies activity-week for engagement columns and either
slice works for the cohort columns; document the choice on each chart.

### 3e. Test users

Exclude `user_id IN (3, 4, 207871, 207875, 207878, 207879)` in every query
(platform-wide convention — see `grip-analytics/CLAUDE.md`).

---

## 4. Metric formulas (canonical)

All formulas filter the test-user exclusion list. `:week_start` /
`:week_end` are inclusive Monday–Sunday IST.

### Cohort denominator

```sql
WITH cohort AS (
  SELECT
    experiment_variant AS variant,
    DATE_TRUNC('week', timestamp) AS week_start,
    COUNT(DISTINCT user_id) AS total_non_invested_users
  FROM experiment_assigned
  WHERE experiment_name = 'learn_page'
    AND user_id NOT IN (3, 4, 207871, 207875, 207878, 207879)
  GROUP BY 1, 2
)
SELECT * FROM cohort;
```

### Learn Page Visitors / Visit Rate

```sql
SELECT
  c.variant,
  c.week_start,
  c.total_non_invested_users,
  COUNT(DISTINCT v.user_id) AS visitors,
  ROUND(100.0 * COUNT(DISTINCT v.user_id) / c.total_non_invested_users, 2) AS visit_rate_pct
FROM cohort c
LEFT JOIN learn_page_viewed v
  ON DATE_TRUNC('week', v.timestamp) = c.week_start
  AND v.user_id IS NOT NULL
  AND v.user_id::text NOT IN ('3','4','207871','207875','207878','207879')
  -- Variant is recovered via experiment_assigned join (sticky bucketing):
  AND EXISTS (
    SELECT 1 FROM experiment_assigned ea
    WHERE ea.user_id = v.user_id
      AND ea.experiment_name = 'learn_page'
      AND ea.experiment_variant = c.variant
  )
GROUP BY 1, 2, 3;
```

(Control users never visit if the build is correct — Control Visit Rate
should be 0%. Non-zero Control visits are an SRM signal: the conditional
render is leaking.)

### Unique Video Players / Total Plays / Avg Videos Per User

```sql
SELECT
  variant_join.variant,
  DATE_TRUNC('week', lvv.timestamp) AS week_start,
  COUNT(DISTINCT lvv.user_id) AS unique_video_players,
  COUNT(*) AS total_video_plays,
  ROUND(1.0 * COUNT(*) / NULLIF(COUNT(DISTINCT lvv.user_id), 0), 2) AS avg_videos_per_user
FROM learn_video_viewed lvv
JOIN (
  SELECT user_id, experiment_variant AS variant
  FROM experiment_assigned
  WHERE experiment_name = 'learn_page'
) variant_join USING (user_id)
WHERE lvv.total_watched_seconds > 0
  AND lvv.user_id::text NOT IN ('3','4','207871','207875','207878','207879')
GROUP BY 1, 2;
```

### Avg Watch Time (sec)

```sql
SELECT
  variant_join.variant,
  DATE_TRUNC('week', lvv.timestamp) AS week_start,
  ROUND(1.0 * SUM(lvv.total_watched_seconds) / NULLIF(COUNT(*), 0), 1) AS avg_watch_time_sec
FROM learn_video_viewed lvv
JOIN (
  SELECT user_id, experiment_variant AS variant
  FROM experiment_assigned
  WHERE experiment_name = 'learn_page'
) variant_join USING (user_id)
WHERE lvv.total_watched_seconds > 0
  AND lvv.user_id::text NOT IN ('3','4','207871','207875','207878','207879')
GROUP BY 1, 2;
```

### FTI source — `prodgripdb.ur_tblorders` on DB 24

| Aspect | Value |
|---|---|
| Database | **Metabase database_id 24** (ClickHouse warehouse) |
| Table | **`prodgripdb.ur_tblorders`** — the unrestricted_user role's view |
| Filter | `status IN (1, 7, 8) AND order_type = 'BUY'` |
| Scoping | **`user_id IN (<cohort user_ids>)`** — see "Cohort scoping" below |
| FTI per user | `MIN(created_at)` grouped by `user_id` |
| Pagination | `ORDER BY user_id LIMIT 2000 OFFSET n` — walks Metabase's 2000-row response cap |
| Reference | [Metabase question 2672 — FTI DoD non-PII](https://metabase.gripinvest.in/question/2672-fti-dod-non-pii-ch) |

**Why DB 24 / `ur_tblorders` and not the Postgres source?** Business
analysts already publish dashboards off DB 24's warehouse. Using the
same warehouse keeps our FTI numbers identically reconcilable with what
the team ships elsewhere — no "but the source-of-truth says X and your
dashboard says Y" drift. `tblorders` directly has column-level GRANT
restrictions the service account can't satisfy (the role is
`unrestricted_user`; `ur_tblorders` is its purpose-built view).

Status codes per Metabase question 2672:
- `1` — order placed
- `7` — success
- `8` — settled

Other statuses (2–6) are interim/failed and do not count toward FTI.

**Cohort scoping** — the FTI query filters `user_id IN (<cohort ids>)`
rather than scanning the full FTI universe. Two reasons:

1. **Result size.** Without scoping, an unbounded `SELECT user_id, MIN(created_at) FROM ur_tblorders GROUP BY user_id` returns ~2000+ rows and silently hits Metabase's `/api/dataset` response cap (we saw exactly 2000 rows in an earlier run — that was the cap, not the true count). Scoping to ~1,800 cohort users/week brings the result to ≤cohort size.
2. **Cost.** ClickHouse uses the `user_id` index on the IN clause; the
   unbounded query is a full table scan.

The fetch loop in `fetch_fti_for_cohort()` paginates with
`ORDER BY user_id LIMIT 2000 OFFSET n` anyway, as belt-and-suspenders
against future cohort growth past the cap.

Because Metabase cannot JOIN across databases in native SQL, the fetch
module runs **three queries** and merges in Python (see
`backend/services/integrations/learn_education.py`):
1. **Engagement query** (DB 8) — per-user cohort + visits + plays.
2. **Daily-order probe** (DB 24) — `COUNT(*)` of yesterday's BUY orders,
   logged for the operator to sanity-check FTI universe size.
3. **Cohort-scoped FTI fetch** (DB 24, paginated) — per-user
   `MIN(created_at)` for the cohort users from step 1.
4. **Python merge** — aggregate to (week × variant) with sticky bucketing.

### FTI Users / FTI Rate — engagement side (DB 8)

The cohort denominator comes from `experiment_assigned`:

```sql
-- DB 8 (Rudder / client_web)
SELECT
  user_id::text,
  experiment_variant AS variant,
  DATE_TRUNC('week', timestamp)::date AS assigned_week
FROM experiment_assigned
WHERE experiment_name = 'learn_page'
  AND user_id::text NOT IN ('3','4','207871','207875','207878','207879')
```

### FTI Users / FTI Rate — FTI side (DB 24, cohort-scoped)

```sql
-- DB 24 (ClickHouse warehouse, prodgripdb schema)
SELECT
  user_id,
  MIN(created_at) AS fti_date
FROM prodgripdb.ur_tblorders
WHERE status IN (1, 7, 8)
  AND order_type = 'BUY'
  AND user_id NOT IN (3, 4, 207871, 207875, 207878, 207879)
  AND user_id IN (<cohort user_ids from DB 8>)
GROUP BY user_id
ORDER BY user_id
LIMIT 2000 OFFSET 0
```

Pagination loop in Python walks `OFFSET 2000`, `OFFSET 4000`, … until a
short read.

### Python merge — sticky bucketing

For each cohort row `(user_id, variant, assigned_week)`:
- `fti_users += 1` if the user appears in the FTI lookup AND
  `fti_date >= assigned_week` (defensive guard against an upstream
  `useShowLearnPage` bug; should always be true since the hook gates
  on `!isInvested`).
- `fti_users_who_watched += 1` if the above AND the user's
  `first_play_at <= fti_date` (causal ordering — watch before invest).

Both `tblorders.user_id` (int, Postgres native) and
`experiment_assigned.user_id` (varchar, Rudder convention) are normalised
to `str()` before lookup so the join works.

The final `fti_rate_pct = ROUND(100.0 * fti_users / total_non_invested_users, 2)`
is computed in Python after aggregation.

### FTI users who watched — causal ordering

Implemented inside the Python merge — not a separate SQL because we
need the cross-DB user join. The condition is:

```text
play.played_at  <=  fti.fti_date
```

A user who FTI'd then watched does NOT count. Watching after the
investment decision proves nothing about Learn's causal influence —
they were going to invest anyway and stumbled onto Learn afterward.

---

## 5. Tables to fetch (recommended order)

| # | Event / table | DB | Status | Why |
|---|---|---|---|---|
| 1 | `experiment_assigned` (filtered to `experiment_name = 'learn_page'`) | 8 (Rudder) | Existing in Rudder | Denominator for everything |
| 2 | `learn_video_viewed` | 8 (Rudder) | **New** — first prod data after feature ships | The workhorse — every engagement column derives from it |
| 3 | `learn_page_viewed` | 8 (Rudder) | **New** | Visit-rate numerator |
| 4 | `tblorders` filtered to `status IN (1,7,8) AND order_type='BUY'` | **24 (transactions)** | Existing in production DB; new data path | FTI numerator — source of truth per Metabase q2672 |
| 5 | `learn_video_opened` | 8 (Rudder) | **New** | Pairs with `learn_video_viewed` for autoplay-success rate; grid-position bias |
| 6 | `learn_category_clicked` | 8 (Rudder) | **New** | Category exploration that doesn't reach a play |
| 7 | `learn_outbound_clicked` | 8 (Rudder) | **New** — single-source of in-grid banner clicks | "Did Learn drive a click into a deal" |
| 8 | `banner_clicked WHERE page = '/learn'` | Already exported | Top/bottom carousel banners — joins on `page = '/learn'` |
| 9 | `bottom_nav_click WHERE nav_item_name = 'Learn'` | Already exported | Cross-feature event; gives bottom-nav click count for Learn item independent of `learn_page_viewed` (which requires a successful route mount) |

Use the deterministic Metabase fetch pipeline
(`backend/services/integrations/`), not hand-exports. See Asset Search's
`fetch_asset_search.py` as the template for the Learn fetch module.

---

## 6. Open questions for product

These are documented in [`roadmap.md`](./roadmap.md) — copy any answers back
here when settled:

1. **"Plays" definition** — `total_watched_seconds > 0` (recommended) vs. any
   `learn_video_viewed` row?
2. **"Avg Watch Time" denominator** — per-play (engagement of content) vs.
   per-user (engagement of surface)?
3. **Cohort slice** — assignment-week vs. activity-week for each chart row?
4. **FTI attribution window** — same-week only, or any time after assignment?
   The SQL above uses "any time after" which is the more lenient causal
   read.
