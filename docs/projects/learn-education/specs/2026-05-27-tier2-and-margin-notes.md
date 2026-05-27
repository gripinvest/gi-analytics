# Tier 2 metrics + Margin Notes — Grip Education dashboard V2

**Status:** Approved (2026-05-27). Not yet implemented.
**Owner:** Puru
**Created:** 2026-05-27
**Supersedes:** the "Tier 2 metrics" section of [`../sessions/S1-2026-05-27-launch-day-handoff.md`](../sessions/S1-2026-05-27-launch-day-handoff.md)

> This spec extends [`2026-05-26-weekly-ab-tracker.md`](./2026-05-26-weekly-ab-tracker.md) (V1 / Tier 1).
> V1 ships the 10 product-spreadsheet columns. V2 adds 7 derived Tier 2 metrics
> + a "Margin Notes" section that surfaces A/B-experiment integrity and
> statistical confidence.

---

## 1. Why this spec

V1 of the Grip Education dashboard reproduces the manual product spreadsheet
1:1 — same columns, same shape. With ~3 days of post-launch data in hand, two
gaps have become obvious:

1. **The raw event surface carries more signal than we surface.** Each
   `learn_video_viewed` event ships `completion_pct`, `exit_reason`,
   `category`, `position`, `total_videos_in_session`. Each `learn_page_viewed`
   ships `entry_source` and a timestamp. We aggregate to "plays" and "watch
   time" and discard the rest. Several diagnostics-grade questions are
   answerable today without any new instrumentation.

2. **A/B-experiment integrity is implicit, not surfaced.** SRM, control
   surface leak, and statistical-confidence calibration live in the
   analyst's head, not on the page. A dashboard that publishes
   "Treatment 5.55% / Control 0.20%" without a confidence interval is
   inviting over-reading.

This spec ships both: **7 Tier 2 metrics** (derived from existing raw data)
and a **Margin Notes** section (4 A/B integrity indicators).

## 2. Scope

### 2.1 Tier 2 — 7 derived metrics

Listed in the order of estimated build cost (cheapest first):

| # | Metric | Formula | Built From | Cost |
|---|---|---|---|---|
| 1 | **Engaged-visitor rate** | `unique_video_players / learn_page_visitors` | existing engagement CTE | aggregator-only |
| 2 | **Plays-per-visitor** | `total_video_plays / learn_page_visitors` | existing engagement CTE | aggregator-only |
| 3 | **Drop-after-first-video** | `1 − (users with play_count > 1 / unique_video_players)` | existing engagement CTE | aggregator-only |
| 4 | **Completion rate** | `plays where completion_pct ≥ 75 / total_video_plays` | new column in plays CTE | small SQL change |
| 5 | **Median time-to-first-play (sec)** | per-user `MIN(learn_video_opened.timestamp) − learn_page_viewed.timestamp`, then median across users | new CTE joining the two events | new SQL CTE |
| 6 | **Outbound click rate** | `unique_learn_outbound_clicked_users / learn_page_visitors` | new CTE on `learn_outbound_clicked` | new SQL CTE |
| 7 | **Banner CTR on /learn** | `unique_banner_clicked_users WHERE page='/learn' / learn_page_visitors` | new CTE on `banner_clicked` | new SQL CTE |

### 2.2 Tier 3 — "Margin Notes" section (4 indicators)

| # | Indicator | What it surfaces | Calculation |
|---|---|---|---|
| 1 | **Sample-Ratio Mismatch (SRM)** | Cohort split between Control and Treatment vs the 50/50 target. Drift here invalidates all comparisons. | Two-proportion z-test against 0.50 expected. Fail if `p < 0.001` (tight) per the standard SRM guideline. |
| 2 | **Control Surface Leak** | Control users who reached `/learn`. Should be 0. | `count(distinct user_id) WHERE variant='control' AND learn_page_viewed events > 0`. Threshold: 0 ideal, ≤1% acceptable, >1% red. |
| 3 | **FTI Lift — 95% CI** | The 95% confidence interval on `(Treatment FTI rate − Control FTI rate)` for the most recent week with non-zero FTI in both arms. | Two-proportion z-test, normal approximation. CI = `(Δ̂) ± 1.96 · √(p̂_t·(1−p̂_t)/n_t + p̂_c·(1−p̂_c)/n_c)`. Returns `null` when either arm has 0 FTI (suppress until both ≥ 10). |
| 4 | **Minimum Detectable Effect at current N** | "We can currently detect an absolute lift ≥ X pp at 80% power." | Standard power calculation: `MDE_abs = (z_{1−α/2} + z_{1−β}) · √(2·p̄·(1−p̄)/n_arm)` with `α=0.05`, `β=0.20`, `p̄` = pooled FTI rate, `n_arm` = smaller arm. |

**Deferred to V3** (kept out of scope to ship V2 cleanly):

- **Time-to-Statistical-Power projection** (#5 from the brainstorm) — needs a cohort-accrual model.
- **Baseline Equivalence check** (#6 from the brainstorm) — needs a pre-experiment data pull (30 days before W1).
- **Sticky-bucketing integrity** — verify same user_id → same variant across weeks. Defer until we see a row where it could fail.
- **Variant SRM across weeks** — drift detection. Defer until we have ≥ 4 weeks.

### 2.3 Out of scope (Tier 2 deferred)

These ranked below the top 7 in the brainstorm:

| # | Deferred metric | Why | When to revisit |
|---|---|---|---|
| 8 | Exit-reason mix (close / swipe_next / swipe_back / unmount) | Diagnostic noise rather than headline. The reels-close-vs-swipe question is interesting but answerable on-demand without a column. | If we see anomalies in completion rate without a clear cause. |
| 9 | Multi-session rate (users with Learn visits on >1 day) | Need ≥ 2 weeks of data to mean anything. Today's data window is 3 days. | W4 onwards. |
| 10 | Category split (Bond101 vs Advanced) | Doubles dashboard column count. Better as a **sibling CSV** + a separate dashboard panel. | V3. |

---

## 3. Data model changes

### 3.1 Engagement SQL (DB 8 / Rudder)

Today's `build_engagement_sql()` returns one row per cohort user with:
`user_id, variant, assigned_week, visit_count, play_count, watch_seconds_sum, first_play_at`.

Add the following per-user columns:

| Column | Source | Why |
|---|---|---|
| `completed_play_count` | `COUNT(*) FILTER (WHERE completion_pct ≥ 75)` in plays CTE | Tier 2 #4 |
| `first_video_opened_at` | `MIN(timestamp)` over `learn_video_opened` per user | Tier 2 #5 numerator |
| `first_page_viewed_at` | `MIN(timestamp)` over `learn_page_viewed` per user | Tier 2 #5 denominator |
| `outbound_clicked` | `1 if any learn_outbound_clicked, else 0` | Tier 2 #6 (boolean per user, summed for unique-users metric) |
| `learn_banner_clicked` | `1 if any banner_clicked WHERE page='/learn', else 0` | Tier 2 #7 |

The new CTEs join on `user_id` after applying the canonical test-user / cohort filter.

### 3.2 Output schema (`weekly_ab_tracker.csv`)

Append 7 columns after `fti_rate_pct`, in the order they appear in §2.1:

```
... fti_rate_pct,
engaged_visitor_rate_pct,
plays_per_visitor,
drop_after_first_pct,
completion_rate_pct,
median_time_to_first_play_sec,
outbound_click_rate_pct,
banner_ctr_on_learn_pct
```

`CANONICAL_COLUMNS` in `backend/services/integrations/learn_education.py` and
`COLUMNS` in `frontend/lib/queries/learnEducation.js` MUST update in lockstep.

### 3.3 New module: `learn_education_stats.py`

```
backend/services/integrations/learn_education_stats.py
```

Pure-Python statistical helpers, no I/O, fully unit-tested:

| Function | Returns |
|---|---|
| `srm_p_value(control_n, treatment_n, expected_ratio=0.5)` | `float` p-value from two-proportion z-test |
| `proportion_ci_95(successes_a, n_a, successes_b, n_b)` | `(lower_pp, upper_pp)` of `B − A` 95% CI on percentage points |
| `mde_at_n(pooled_rate, n_per_arm, alpha=0.05, power=0.80)` | `float` minimum detectable absolute effect (pp) |
| `is_control_leaking(control_visitors, control_cohort)` | `('ok'|'warn'|'fail', leak_pct)` traffic-light |

The aggregator calls these four functions on the merged data and stuffs the
results into the manifest under a new `margin_notes` key. The frontend
renders the manifest directly — no DuckDB query needed for these (the
4 numbers are computed once per cron run and snapshotted).

### 3.4 Manifest schema additions

`backend/data/learn_education/manifest.json` gains:

```json
{
  "refreshed_at": "...",
  "tables": ["weekly_ab_tracker"],
  "margin_notes": {
    "as_of_week": "2026-05-25",
    "srm": {
      "control_n": 982,
      "treatment_n": 994,
      "p_value": 0.79,
      "verdict": "ok"
    },
    "control_leak": {
      "control_visitors": 2,
      "control_cohort": 982,
      "leak_pct": 0.20,
      "verdict": "warn"
    },
    "fti_lift_ci": {
      "control_pct": 0.0,
      "treatment_pct": 0.0,
      "delta_pp": 0.0,
      "ci_lower_pp": null,
      "ci_upper_pp": null,
      "verdict": "insufficient_data"
    },
    "mde": {
      "n_per_arm": 982,
      "pooled_rate_pct": 0.0,
      "mde_abs_pp": 1.4,
      "mde_rel_pct": null
    }
  }
}
```

The dashboard reads this directly from `project.manifest`. The four cards
in Margin Notes each have an `if (verdict === 'insufficient_data')` branch
that renders a tasteful em-dash placeholder rather than a misleading 0.

---

## 4. Frontend changes

### 4.1 Margin Notes section

Lives **below the lift box, above the weekly table**. Layout:

```
─── Margin Notes ──────────────────────────────────────────────
[A note on what these numbers do and don't yet claim.]

  SRM CHECK        CONTROL LEAK     FTI LIFT 95% CI    MDE @ N
  982 / 994        2 of 982         awaiting W2 data   ±1.4 pp
  within ±2%       0.20%            (need ≥10/arm)     at 80% power
  ✓                ⚠                —                  N=982/arm
```

Each card is a 4th of the row on desktop, stacked 2×2 on mobile (375 px).
Border/typography matches the existing exhibit-card pattern in
`LearnEducationDashboardEditorial.jsx`.

### 4.2 Editorial copy under the heading

Single pull-quote, set in Newsreader italic per `ed-prose-italic`:

> *Where the numbers admit what they can — and can't — claim. The dashboard
> tells you what it sees; the margin tells you whether to believe it yet.*

### 4.3 Traffic-light treatment

Status colors from the existing palette:
- `ok` → `var(--ed-forest)` ✓
- `warn` → `var(--ed-gold)` ⚠
- `fail` → `var(--ed-rust)` ✕
- `insufficient_data` → `var(--ed-ink-faint)` —

No icons beyond the single glyph per card. The visual weight is the
number, not the indicator.

### 4.4 Weekly table

Appends 7 new columns in the order specified in §3.2. Mobile view (375 px)
keeps the Tier 1 columns visible by default and lets the 7 new columns
horizontally scroll to the right — same pattern as Asset Search's wide
funnel table.

`formatCell()` in `frontend/lib/queries/learnEducation.js` gains:
- `kind: 'seconds'` for `median_time_to_first_play_sec` (already exists)
- existing `kind: 'pct'`, `kind: 'decimal'` cover the rest

---

## 5. Implementation order

Ship in 3 PRs, each independently mergeable and behind no flag:

**PR-1 — Aggregator-only Tier 2** (#1, #2, #3)
- No SQL changes. Pure additions to `aggregate_rows()`.
- 3 new columns in the CSV + frontend table.
- Smallest, lowest-risk PR. Lands first.

**PR-2 — SQL-extending Tier 2** (#4, #5, #6, #7)
- 4 new columns in engagement SQL output.
- 4 new columns in the CSV + frontend table.
- 4 new unit-test cases covering each SQL/aggregator pair.

**PR-3 — Margin Notes section**
- New `learn_education_stats.py` module with 4 helpers.
- `aggregate_rows()` calls stats helpers, populates manifest's `margin_notes` key.
- Frontend renders the 4-card section + pull-quote.
- New `test_learn_education_stats.py` with cases covering the math edge
  cases (n=0, both arms zero, equal rates, large lift, etc.).

Each PR adds:
- 1+ unit test per new metric (FakeClient pattern, mirror existing tests)
- Updated `data-sources.md` §4 with the new SQL + math
- Updated `README.md` chart-source mapping table

---

## 6. Definitions and edge cases

### 6.1 The `≥ 75%` completion threshold

Industry convention varies (50% / 75% / 90%). 75% is a balance between
"meaningful watch" and "tolerant of users who skip outros". The threshold
is a constant in `learn_education.py`:

```python
COMPLETION_THRESHOLD_PCT = 75
```

If product disagrees with 75% post-launch, change one constant. The CSV
column stays named `completion_rate_pct` semantically (it's a rate, not a
percentile).

### 6.2 Time-to-first-play — what counts as "first"

The denominator is the **earliest** `learn_page_viewed` per user in the
12-week window. The numerator is the **earliest** `learn_video_opened`
strictly after that page view.

Users with `first_video_opened_at IS NULL` (visited, never opened) are
**excluded from the median**, not counted as ∞ or 0. The reported median
is over engaged users only.

### 6.3 Outbound click rate — uniques, not events

Denominator: `learn_page_visitors` (already unique users).
Numerator: `count(distinct user_id) with at least one learn_outbound_clicked`.
Same shape as visit-to-engage rates. A user who clicks 5 banners counts
once.

### 6.4 Banner CTR on /learn

Banners are a cross-feature event. The Asset Search dashboard tracks
their CTR site-wide. The Learn variant filters `WHERE page='/learn'`.

Both top and bottom carousel banners on /learn are in scope; the existing
`banner_clicked` event already carries `page`, so no instrumentation
change needed.

### 6.5 SRM tolerance

The two-proportion z-test against `0.5` expected is sensitive — even a
49.5 / 50.5 split flags at large N. Per the standard SRM guideline, we
fail the indicator at `p < 0.001`, not `p < 0.05`.

### 6.6 FTI Lift CI suppression

CI is suppressed (`verdict: 'insufficient_data'`) when either arm has
fewer than 10 FTI conversions. Below that, the normal approximation is
unreliable. The card renders an em-dash and a one-line caption
("awaiting more conversions") until both arms cross the threshold.

### 6.7 MDE relative vs absolute

We report **absolute** MDE in percentage points (e.g., "±1.4 pp").
The relative MDE (`mde_abs / pooled_rate`) is undefined when pooled
rate is 0 (true today, FTI=0 both arms). The card renders absolute MDE
always; the relative figure appears as a subtitle once `pooled_rate > 0`.

---

## 7. Tests

| File | Coverage |
|---|---|
| `backend/tests/test_learn_education.py` | Extend with 7 cases — one per Tier 2 metric — using existing FakeClient pattern. Each test asserts the new column exists with the right value for a synthetic engagement row set. |
| `backend/tests/test_learn_education_stats.py` (NEW) | 4 cases per helper × edge cases: SRM (balanced, mild skew, severe skew, n=0); CI (zero successes one arm, both zero, both equal, normal case); MDE (n=0 → ∞, large n + small pooled rate, large n + large pooled rate); leak (0%, 0.5%, 5%, 50%). |
| `frontend` build | `next build` must remain 0-error 0-warning. |

Existing 25/25 backend tests must continue to pass. Target: **40+/40+** after V2.

---

## 8. Validation before shipping

1. **CSV column order matches `CANONICAL_COLUMNS` and `COLUMNS` (frontend) exactly.** Mismatch silently corrupts the table.
2. **Spot-check Tier 2 #5 (Time-to-first-play)** by computing one user's median by hand against `client_web.learn_video_opened` and `client_web.learn_page_viewed`. The join is the most error-prone part of this spec.
3. **Spot-check Margin Notes #3 (CI)** against a known reference. Sanity-check: when Control = 1/100 and Treatment = 5/100, the CI is roughly `(0.2 pp, 7.8 pp)`.
4. **Force `pooled_rate = 0`** in a unit test and confirm MDE math doesn't divide by zero.

---

## 9. Pending items (formal punch-list)

Tracked here as the single source of truth for what's known to be incomplete
or outstanding around the Learn (Grip Education) dashboard. **Update this
list as items are resolved.**

### 9.1 In-flight after this spec

| ID | Item | Owner | Status |
|---|---|---|---|
| V2-PR-1 | Ship Tier 2 aggregator-only metrics (#1-3) | Puru | Spec-pending |
| V2-PR-2 | Ship Tier 2 SQL-extending metrics (#4-7) | Puru | Spec-pending |
| V2-PR-3 | Ship Margin Notes section + `learn_education_stats.py` | Puru | Spec-pending |
| V2-DOCS | Update `data-sources.md` §4 + `README.md` table with V2 columns | Puru | Spec-pending |

### 9.2 Deferred to V3 (require more data or product input)

| ID | Item | Why deferred | When to revisit |
|---|---|---|---|
| V3-T2-08 | Exit-reason mix column | Diagnostic noise vs headline metric | If completion-rate anomalies appear |
| V3-T2-09 | Multi-session rate | Needs ≥ 2 weeks data | W4 (2026-06-22) onwards |
| V3-T2-10 | Category split (Bond101 vs Advanced) — sibling CSV | Doubles column count; deserves own dashboard panel | After V2 lands |
| V3-MN-05 | Margin Notes: Time-to-Statistical-Power projection | Needs cohort-accrual model | After 3+ weeks of data |
| V3-MN-06 | Margin Notes: Baseline Equivalence check | Needs pre-experiment data pull | When W2+ stabilises |
| V3-MN-07 | Margin Notes: Sticky-bucketing integrity check | Wait until we have ≥ 4 weeks to look for drift | W4 onwards |
| V3-MN-08 | Margin Notes: Variant SRM across weeks (drift) | Same | W4 onwards |

### 9.3 Open product / data questions

| ID | Question | Why it matters | Default if no answer |
|---|---|---|---|
| Q-01 | Completion threshold — 50% / 75% / 90%? | Determines what "completed" means in #4 | 75% (industry midpoint) |
| Q-02 | Significance threshold for the lift CI — 95% or 99%? | Header alignment with how product reports A/B results | 95% (CI per spec) |
| Q-03 | Baseline window length — 30 / 60 / 90 days pre-experiment? | Affects V3-MN-06 when we get there | 30 days |
| Q-04 | Is the 0.20% Control surface leak (2 users) acceptable, or a P1? | Determines whether we file a gi-client-web bug now | File as P2 with link to this dashboard |

### 9.4 Operational / hygiene

| ID | Item | Notes |
|---|---|---|
| OP-01 | 0.20% Control surface leak — file gi-client-web bug | Investigate `/learn?source=deep_link` path, `useShowLearnPage` gate edge cases, UTM bypass. Owner: Puru. |
| OP-02 | 14 stale local worktrees from S1 launch day | `git worktree remove` cleanup. Owner: anyone with the local clone. |
| OP-03 | 7 dependabot PRs on grip-analytics | Unrelated to Learn; separate hygiene cycle. |
| OP-04 | W4 statistical reveal date | Plan to publish lift CI to product team on ETA `2026-06-22`. Calendar invite to follow once V2 is in prod. |

### 9.5 Decisions already made (record for posterity)

So we don't re-litigate later:

- **DB 24 / `prodgripdb.ur_tblorders`** is the FTI source (analyst-canonical alignment). Not DB 2. Not DB 8.
- **12-week rolling window** for both engagement and FTI. Each cron run is a full recompute, no incremental writes. Reasoning: cohort-scoped IN-clause keeps query cost bounded by cohort size, and whole-window recompute is self-healing on backfill. (Decided 2026-05-27.)
- **Once-daily cron at 01:00 IST.** No twice-daily run. No retention pressure on the source data. (Decided 2026-05-27.)
- **TEST_USERS exclusion list** `(3, 4, 207871, 207875, 207878, 207879)` applies in every SQL path. Single-sourced.
- **Event naming convention** `[object]_[past_tense_verb]` (e.g., `learn_video_viewed`, not `view_learn_video`).
- **Section name "Margin Notes"** for the A/B integrity section. (Decided 2026-05-27.)

---

## 10. References

- V1 spec: [`2026-05-26-weekly-ab-tracker.md`](./2026-05-26-weekly-ab-tracker.md)
- Data sources: [`../data-sources.md`](../data-sources.md)
- Session log (launch day): [`../sessions/S1-2026-05-27-launch-day-handoff.md`](../sessions/S1-2026-05-27-launch-day-handoff.md)
- gi-client-web events: `events/constants.ts`, `events/types.ts`
- Live dashboard: `https://grip-analytics-psi.vercel.app/projects/learn_education`
- Two-proportion CI math: standard normal approximation (Newcombe 1998); we ship that and only switch to Wilson when a unit test catches an edge case.
- SRM convention: `p < 0.001` per the de-facto industry guideline ("Sample Ratio Mismatch" tests at experimentation conferences pinned this for skewed-power reasons).
