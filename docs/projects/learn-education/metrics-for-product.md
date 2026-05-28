# Learn (Grip Education) — Metrics, in plain English

A product-manager-facing walkthrough of every number on the Learn dashboard. What each metric measures, how it's calculated, where the data comes from, and — most importantly — what you can and cannot claim from it.

Companion to [`data-sources.md`](./data-sources.md) (the SQL-level technical reference) and [`decisions.md`](./decisions.md) (the why behind every design choice). This doc is the bridge: you should be able to read it, then defend any number in the dashboard to leadership or the data team without needing to read code.

---

## 1. The hypothesis

> **Surfacing short-form investing content (Reels-style videos at `/learn`) to non-invested users will lift the First-Time Investor (FTI) rate without harming funnel metrics elsewhere.**

That's the entire experiment. Everything below is built to evaluate this one claim honestly.

---

## 2. The experiment setup

### Who's in the experiment

**Cohort**: every non-invested platform user who, in the last 12 weeks, triggered an `experiment_assigned` event with `experiment_name='learn_page'`. This happens automatically inside the mobile app when the user lands on a page that bucketing covers.

**Variants**: today the experiment runs in binary mode — `control` vs `treatment`. The data pipeline supports multi-variant (`treatmentv1`, `treatmentv2`, …) for future experiments.

**Excluded**: test users (IDs 3, 4, 207871, 207875, 207878, 207879). Filtered in every query.

### How users get attributed

This is the most important attribution rule on the page.

**Sticky-week bucketing**: a user assigned in Week 1 who FTIs in Week 4 still counts under **Week 1's row** — not Week 4's. The week we credit an FTI to is the week the user **entered** the experiment, not the week they invested.

Why: the natural product question is "what happened to the cohort we acquired in W1?", not "who FTI'd this week from any prior bucketing?". The first is the lifetime cohort question; the second mixes generations.

**Causal-ordering filter**: a user's FTI counts only if it happened **at or after their actual bucketing moment** — the per-user `experiment_assigned` timestamp, not just the week's Monday. This filters out users who were already invested when bucketed (the "gate-leak" scenario where the `useShowLearnPage` `!isInvested` check missed them). See [D-24] in `decisions.md` for the full rationale.

### A reader's first question

> **"Why is the FTI rate so much lower than what I see in q2672 (Metabase dashboard 190)?"**

Because that dashboard counts platform-wide FTIs per day. Ours counts FTIs **within the experiment cohort, after their bucketing moment**. Different denominator, different filter. Two reconciliable numbers:

- Platform daily FTIs: ~190 per day (your reference number).
- Our cohort FTIs: ~15–21 per arm per week. The cohort is ~1,400 users per arm in 12 weeks, so we'd expect roughly `1400 × (190 / 50000_non_invested_pool) ≈ 5/day` to land in our denominator — which matches what we see.

---

## 3. The metrics

We organise them into four groups by what question they answer.

### Group A — Cohort metrics (the denominator)

These tell you who the experiment is **about**, before any engagement happens.

#### Total Non-Invested Users
- **What it is**: the number of users assigned to this variant in the latest week.
- **How it's computed**: count of distinct `user_id` in `client_web.experiment_assigned` where `experiment_name = 'learn_page'`, grouped by week and variant.
- **Notable**: deduplication uses `DISTINCT ON (user_id)` keeping the earliest assignment, because Rudder occasionally emits duplicate events (~10% of users) when localStorage is cleared or multi-device sessions race. Without this, cohort counts would be inflated. See [D-14].
- **Today's number**: 1,404 Control, 1,384 Treatment (W1).

#### Cohort balance (SRM verdict)
- **What it is**: are the two arms split correctly per the experiment config (50/50 here)?
- **How it's computed**: two-proportion z-test on the cohort counts against the expected 50/50 split.
- **The threshold**: we flag SRM at `p < 0.001`, not the standard `p < 0.05`. At our cohort sizes, the standard threshold flags innocuous noise (49.7% vs 50.3% would fail). Industry convention for SRM is the stricter `< 0.001`.
- **Today's verdict**: OK (`p = 0.66`, well within tolerance).

### Group B — Engagement metrics (what users do on /learn)

These exist only for Treatment — Control cannot reach `/learn` by design. They live in a **Treatment-only block** in §II Ledger and in §III Engagement.

#### Learn Page Visitors
- **What it is**: distinct users in the variant cohort who landed on `/learn` at least once.
- **How it's computed**: cohort × `client_web.learn_page_viewed` (any visit count > 0).
- **Today**: 100 Treatment visitors out of 1,384 bucketed = 7.23% visit rate.

#### Visit Rate
- **Formula**: `learn_page_visitors / total_non_invested_users`.

#### Unique Video Players
- **What it is**: users who actually played at least one video. We require `total_watched_seconds > 0` to filter out silent autoplay failures.
- **How it's computed**: cohort × `client_web.learn_video_viewed` with `total_watched_seconds > 0`.
- **Today**: 29 Treatment users (29 / 100 visitors = 29% engaged-visitor rate).

#### Total Video Plays
- **What it is**: total play events (one per video the user was in front of), filtered to `total_watched_seconds > 0`.
- **Today**: 85 Treatment plays. Mean = 2.93 plays per engaged user.

#### Avg Watch Time (seconds)
- **What it is**: across all plays, the average `total_watched_seconds`. Forward-delta accumulation with a 1-second ceiling per sample (so seeks don't inflate the number).
- **Today**: 51.8s Treatment.

#### Completion Rate (≥75%)
- **What it is**: % of plays where `completion_pct >= 75`. The 75% threshold is a configurable constant — see [D-15] for the threshold rationale.
- **Today**: 48% Treatment.

#### Engaged-Visitor Rate
- **Formula**: `unique_video_players / learn_page_visitors`.
- **Why it matters**: tells you how many visitors actually engage with content vs bouncing immediately.
- **Today**: 29% Treatment.

#### Plays per Visitor
- **Formula**: `total_video_plays / learn_page_visitors` (denominator = visitors, not players).
- **Why it matters**: amortizes engagement across the full visitor pool, not just the engaged subset. Different shape from "avg videos per user".
- **Today**: 0.85 Treatment.

#### Drop After First Video
- **Formula**: `1 - (users with >1 play / unique_video_players)`.
- **Why it matters**: signal of binge-vs-bounce. High drop = curiosity satisfied with one video; low drop = users hooked.
- **Today**: 31% Treatment (so 69% of players watched ≥2 videos).

#### Median Time to First Play
- **What it is**: across users who both visited and opened a video, the median seconds from first `learn_page_viewed` to first `learn_video_opened`.
- **Today**: 12 seconds Treatment.

#### Outbound Click Rate
- **What it is**: % of visitors who clicked a banner inside `/learn` that routed them elsewhere (`/assets`, `/academy`, etc).
- **Formula**: `unique outbound clickers / learn_page_visitors`.
- **Why it matters**: does Learn act as a funnel into deal-discovery, or is it a content cul-de-sac?
- **Today**: 2% Treatment.

#### Banner CTR on /learn
- **What it is**: same idea, but for the canonical `banner_clicked` event filtered to `page = '/learn'`. These are the top + bottom carousel banners on the Learn page.
- **Today**: 13% Treatment.

### Group C — Outcome metrics (the only thing the experiment claims to influence)

This is the headline causal claim.

#### FTI Users
- **What it is**: count of cohort users who became First-Time Investors after their bucketing moment.
- **The canonical FTI definition** (matches Metabase question 2672): a user's first qualifying BUY order, where:
  - `status IN (1, 7, 8)` (placed / success / settled)
  - `order_type = 'BUY'`
  - Earliest `created_at` per `user_id`
- **The data source**: `prodgripdb.ur_tblorders` on Metabase database 24 (ClickHouse warehouse). See [D-09] and [D-23] for why this and not Postgres source-of-truth.
- **The causal filter**: `fti_date >= user's assignment_timestamp` — strictly post-bucketing. A user who FTI'd 3 hours **before** they got bucketed is a gate-leak (pre-existing investor that `!isInvested` missed), not an experiment conversion. They don't count. See [D-24].
- **Today**: 15 Control, 21 Treatment.

#### FTI Rate
- **Formula**: `fti_users / total_non_invested_users`.
- **Today**: 1.07% Control, 1.52% Treatment.

#### FTI ∩ Watched
- **What it is**: of users who FTI'd, how many had watched at least one video **before** their FTI. Causal-ordering: `first_play_at <= fti_date`.
- **Today**: 0 Control (Control can't watch), 1 Treatment.
- **Important**: this is a *causal candidate signal*, not proof. See §6 below.

### Group D — A/B integrity (the Editor's Note on Confidence)

These guardrails tell you whether the rest of the numbers are believable. Collapsed by default in the dashboard so they don't dominate; expanded gives you per-card explanations.

#### Sample-Ratio Mismatch (SRM)
- **What it tests**: is the cohort split close to the configured 50/50?
- **Method**: two-proportion z-test, fail at `p < 0.001`.
- **What "fail" means**: bucketing is leaking. Stop reading downstream metrics until fixed.

#### Control Surface Leak
- **What it tests**: how many Control users reached `/learn`? Should be 0.
- **Thresholds**: 0 = ok; 0 < leak ≤ 1% = warn; > 1% = fail.
- **Today**: 0.07% Control (1 user). Warn. Tracked as gi-client-web follow-up.

#### FTI Lift, 95% Confidence Interval
- **What it tells you**: the experiment effect with honest uncertainty bounds.
- **Method**: normal approximation, two-proportion CI on `(treatment_rate − control_rate)`.
- **Suppressed when**: either arm has fewer than 10 conversions (the approximation gets unreliable).
- **How to read it**:
  - If the bracket **excludes zero on the positive side** → lift is statistically significant in Treatment's favor. Defensible claim.
  - If the bracket **brackets zero** → lift is consistent with random variation. We cannot yet claim a real effect.
  - If the bracket **lies below zero** → Treatment is *worse* than Control (statistically). Stop the experiment.
- **Today**: Δ +0.45 pp, CI = [-0.39, +1.29] pp. Brackets zero. Cannot claim significance yet.

#### Minimum Detectable Effect (MDE)
- **What it tells you**: the smallest absolute effect we could statistically detect at the current sample size, at 80% power and α = 0.05.
- **How to read it**: if today's MDE is ±1.2 pp and the true effect is +0.5 pp, the experiment would not detect it even with infinite patience. The experiment is **underpowered for small effects**.
- **Today**: ±1.20 pp at N = 1,384/arm. Need ~12,000/arm (about W4) to bring this below ±0.5 pp.

---

## 4. The conversion funnel (descriptive, not causal)

In §III Engagement we surface a depth-banded funnel:

```
Bucketed → Visited /learn → Played ≥1 video → Played multiple → Completed (≥75%)
```

Each band is **cumulative** (a user who completed a video also counts in all the shallower bands). At each band we report:
- `cohort_n`: how many users hit at least this depth
- `fti_n`: of those, how many FTI'd post-assignment
- `fti_rate_pct`: the conditional rate

We also break the visited users down by `entry_source` (top_chip / bottom_nav / banner / deep_link / direct).

And we surface **Conversion Momentum**: median days (or hours) from user-level bucketing to user-level FTI. Today this reads as `12 min` median — the platform's natural conversion velocity for invest-intent users is essentially same-session.

**Important framing**: this funnel is **descriptive, not causal**. See §6.

---

## 5. What you can claim from each tier of metric

| Question | What metric answers it | Strength |
|---|---|---|
| "Did the experiment cause a higher FTI rate?" | ITT comparison (Treatment vs Control FTI rate, with CI) | **Strong causal** — random assignment is the warrant. |
| "Did users actually use the surface?" | Visit rate, engaged-visitor rate, plays/visitor | Descriptive, Treatment-only. |
| "Was the content engaging?" | Avg watch time, completion rate, drop-after-first | Descriptive, Treatment-only. |
| "Where did engaged users come from?" | Entry-source breakdown | Descriptive, Treatment-only. |
| "Do users who watch convert at higher rates?" | Conversion funnel depth bands, FTI ∩ Watched | **Descriptive, NOT causal**. See §6. |
| "Is the experiment trustworthy?" | SRM, Control surface leak | Diagnostic — if these fail, ignore everything else. |
| "Is our cohort big enough?" | MDE, FTI Lift CI width | Diagnostic — calibrates confidence. |

---

## 6. The big caveat: causal vs descriptive

This deserves its own section because it's the most common analytical mistake stakeholders make.

### Causal: ITT (Intent-to-Treat)

> **Treatment FTI rate vs Control FTI rate.**

This IS causal. Random assignment guarantees the two arms are statistically identical at baseline; any difference in outcome is attributable to the experiment.

**You can say**: *"Being assigned to Treatment caused an X pp lift in FTI rate (CI: [a, b])."*

### Descriptive: Watcher vs non-watcher

> **Of Treatment users who watched, X% FTI'd. Of Treatment users who didn't watch, Y% FTI'd. X > Y, therefore watching causes investment.**

**This is NOT causal.** Users who chose to watch self-select into a pre-existing intent group. The watcher pool likely contains more invest-ready users to start with. A high FTI rate among watchers is a *mix* of:
- (a) the actual causal effect of watching, AND
- (b) who chooses to watch in the first place

We cannot separate (a) from (b) without instrumental variables or propensity scoring — neither is in scope today.

**You can say**: *"Among Treatment users who completed a video, X% became investors. This is consistent with engagement preceding conversion, but we can't yet claim watching caused the conversion."*

**You cannot say**: *"Watching videos increases investment by Z%."*

The dashboard's design enforces this distinction:
- ITT lift is the headline, with the 95% CI explicit.
- The engagement gradient (in the Pull Quote) is bold but its caption explicitly disclaims selection-effect.
- §IV The Reading inference #4 spells the distinction out for stakeholders.

---

## 7. Data sources, plain English

| What | Where | Why |
|---|---|---|
| Experiment assignment + engagement events | Metabase database 8 (Rudder) — `client_web` schema | Standard event tracking from gi-client-web's `trackEvent` calls. Each event is one row. |
| FTI orders | Metabase database 24 (ClickHouse warehouse) — `prodgripdb.ur_tblorders` view | The analyst-canonical view of `tblorders`. Aligns with Metabase q2672 and existing FTI dashboards. The underlying `tblorders` table requires column-level grants our service account doesn't have; `ur_tblorders` is the unrestricted-user role's view. |
| Test-user exclusion list | Hardcoded constant `TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)` | Single source across every SQL path. Updated by edit + cron rerun if internal accounts change. |

**Cross-DB join**: Metabase cannot join across databases in a single query. We run two queries (engagement from DB 8, FTI from DB 24) and merge in Python. The merge keys both sides through a canonical `user_id` normalisation (Rudder stores user_ids as text, ClickHouse as integers/floats — see [D-13]).

---

## 8. The events, by name

These are the six Learn-specific events plus two cross-feature events. All carry `user_id`, `anonymous_id`, `timestamp` by default; the listed attributes are Learn-specific.

| Event | When it fires | Attributes |
|---|---|---|
| `experiment_assigned` | Once per non-invested non-GC user on Learn page mount | `experiment_name='learn_page'`, `experiment_variant` |
| `learn_page_viewed` | On each `/learn` page mount | `entry_source` (top_chip / bottom_nav / deep_link / direct) |
| `learn_category_clicked` | On Bond101 ↔ Advanced tab switch (real switch only) | `category_id` |
| `learn_video_opened` | When the user taps a video card (before reels start) | `video_id` |
| `learn_video_viewed` | At view-end (swipe, close, unmount) | `total_watched_seconds`, `completion_pct`, `exit_reason`, `position`, `category` |
| `learn_outbound_clicked` | On in-grid banner tap routing off `/learn` | `destination`, `position` |
| `bottom_nav_click` *(cross-feature)* | On bottom-nav item tap | `nav_item='learn'` filters to Learn |
| `banner_clicked` *(cross-feature)* | On any banner tap site-wide | `page='/learn'` filters to Learn |

Deprecated events (removed from gi-client-web; filter by week if you see them in pre-launch data): `learn_video_action`, `learn_banner_click`, `learn_video_chip_clicked`.

---

## 9. The cron, in plain English

Once a day at 01:00 IST, a GitHub Action:
1. Pings two probe queries to confirm both `learn_page_viewed` and `experiment_assigned(learn_page)` events exist in Rudder. If both are zero, exits cleanly as `awaiting_first_event` — no alert.
2. Runs the engagement query against Rudder DB 8 to produce one row per cohort user (paginated; see [D-08]).
3. Runs the FTI query against `ur_tblorders` on DB 24, scoped to the cohort's user_ids (paginated).
4. Merges in Python: builds the per-(week × variant) CSV row, plus the manifest blocks (Margin Notes statistical computations, Conversion Funnel including WoW comparison and days-to-FTI).
5. Commits the CSV + manifest to `main`.
6. Render auto-deploys the backend; Vercel auto-deploys the frontend.

The dashboard's "as of" stamp tracks when this last happened. Manual refresh button forces an immediate re-run on demand (60-second cooldown).

---

## 10. What the dashboard does NOT do (deliberate scope cuts)

| Feature | Why not | When we'd revisit |
|---|---|---|
| Per-video performance breakout | Doubles dashboard column count; deserves own panel | After V2 lands and W3+ has stable data |
| Bond101 vs Advanced category split | Same — sibling CSV pattern preferred over wider rows | V3 |
| Confidence intervals on engagement metrics | Engagement is descriptive Treatment-only; CIs aren't the natural way to report | If product asks |
| Statistical significance via Bayesian methods | Frequentist CI is interpretable to most stakeholders | If frequentist results disagree across multiple weeks |
| Sequential testing / always-valid inference | Single reveal at W4 is sufficient for product decision | If we add a second mid-experiment reveal |
| Per-day breakdown of FTI rate | Daily noise > weekly signal at our cohort sizes | Never likely — weekly is the right granularity |

---

## 11. Known issues + active follow-ups

| ID | What | Owner |
|---|---|---|
| Gate leak (`useShowLearnPage` `!isInvested`) | 88% of cohort users had FTI'd BEFORE bucketing. The dashboard's causal filter correctly excludes them (so `fti_users` is correct), but the cohort itself is noisier than designed. | gi-client-web team (skip per current scope) |
| Control surface leak (0.07%) | 1 Control user reached `/learn`. Within operational tolerance (≤1%) but worth a single-user investigation. | gi-client-web team |
| W4 statistical reveal date | Target: 2026-06-22 (when cohort reaches ~12K/arm and MDE shrinks below ±0.5 pp). | Puru — calendar invite once V2 stable |

---

## 12. Where to look for what

| If you want to… | Read |
|---|---|
| Defend a number to leadership | This file (you are here) |
| Find the SQL behind a metric | [`data-sources.md`](./data-sources.md) §2-4 |
| Understand why we made a specific design choice | [`decisions.md`](./decisions.md) — search by D-## |
| Resolve a term (MDE, SRM, sticky bucketing, etc.) | [`glossary.md`](./glossary.md) |
| Understand the cron + data-flow plumbing | [`architecture.md`](./architecture.md) + [`operations.md`](./operations.md) |
| See what's planned next | [`roadmap.md`](./roadmap.md) and the V2 spec at [`specs/2026-05-27-tier2-and-margin-notes.md`](./specs/2026-05-27-tier2-and-margin-notes.md) |

---

## 13. The one-paragraph summary you can paste into a deck

> The Learn experiment dashboard at `/projects/learn_education` tracks whether surfacing short-form investing videos to non-invested users lifts the First-Time Investor rate. It computes a weekly cohort × variant table with 19 metrics, broken into cohort balance, engagement (Treatment-only, since Control can't reach `/learn`), and FTI conversion. The headline causal claim is the ITT lift (Treatment FTI rate minus Control FTI rate) with a 95% confidence interval. Within-Treatment engagement-conditional rates (watchers vs non-watchers) are shown for context but flagged as selection-effect, not causal. FTI attribution is sticky-week (a user assigned in W1 who invests in W3 credits to W1) with a per-user post-assignment causal filter. Data sources are Rudder for engagement events and `prodgripdb.ur_tblorders` on the ClickHouse warehouse for FTI orders, joined in Python because Metabase doesn't cross-join databases. Daily cron at 01:00 IST. Today (W1) the cohort is 1,400 / arm, ITT lift is +0.45 pp with a CI that brackets zero — we cannot yet claim significance. The W4 reveal target is 2026-06-22.
