# Learn (Grip Education) — glossary

The terms that appear repeatedly in this project's docs, with the meaning
**we** use (which sometimes differs from the textbook).

When a term has a precise statistical definition AND a working operational
one, both are below.

---

## A/B terminology

**Arm** — one of the variant groups in the experiment (e.g., the "Control arm" or the "Treatment arm").

**Baseline equivalence** — A check that Control and Treatment had similar metrics *before* the experiment started. If they didn't, the random bucketing isn't doing its job. Currently deferred to V3 (V3-MN-06).

**Bucketing** — The deterministic process that maps a user_id to a variant. Implemented in `utils/experimentBucketing.ts`. Uses a hash of `experiment_name + user_id` so the same user always gets the same variant.

**Cohort** — Users who were bucketed into the experiment (Control + Treatment combined). The denominator for visit-rate, FTI-rate, etc.

**Control surface leak** — Users assigned to Control who somehow reached the Treatment surface (`/learn`). Should be 0; non-zero indicates a gating bug. Today: 2 users (~0.20%).

**MDE (Minimum Detectable Effect)** — The smallest absolute (or relative) effect the experiment can statistically detect with the current sample size, at conventional 80% power and α=0.05. Reported in percentage points. As N grows, MDE shrinks.

**Power** — The probability of correctly detecting a true effect of a given size. We target 80% (industry standard).

**Sample Ratio Mismatch (SRM)** — When the Control/Treatment split deviates from the target (50/50 here) more than chance allows. Standard threshold: `p < 0.001` flags an SRM. Drift here invalidates all comparisons.

**Sticky bucketing** — A user assigned to Treatment in Week 1 stays in Treatment forever, even if they only FTI in Week 5. Implemented via the `>= assigned_week` predicate in the merge — the first `experiment_assigned` event per user is authoritative.

**Variant** — One specific arm value: `control`, `treatment`, `treatmentv1`, `treatmentv2`, etc. The aggregator handles arbitrary variant strings (D-05).

---

## Product terminology

**Bond101 / Advanced** — The two learn-category buckets the videos are organised into. Bond101 = entry-level investing concepts. Advanced = bonds, structured products, fixed income mechanics.

**Engaged visitor** — A visitor who plays at least one video. Distinct from "visitor" (who landed on `/learn`).

**Entry source** — How a user reached `/learn`. Values: `top_chip`, `bottom_nav`, `deep_link`, `direct`. Carried on `learn_page_viewed`.

**Exit reason** — Why a `learn_video_viewed` event fires. Values: `swipe_next`, `swipe_back`, `close`, `unmount`. Carried on `learn_video_viewed`.

**First-Time Investor (FTI)** — A user's first successful BUY order. Defined by `status IN (1, 7, 8) AND order_type='BUY'` in `prodgripdb.ur_tblorders`, per Metabase question 2672.

**FTI∩Watched** — Users who FTI'd AND also have at least one `learn_video_viewed` event in the experiment window. The "causal candidate" subset.

**FTI date** — Per user, `MIN(created_at)` over qualifying orders. Used to verify causal ordering (`fti_date >= assigned_week`).

**Non-invested user** — A user who has never had a successful BUY order. The Learn experiment's target population (Control + Treatment).

**Outbound click** — A user taps an in-grid banner that routes off `/learn` to `/assets`, `/academy`, etc. Tracked by `learn_outbound_clicked`.

**Reels** — The fullscreen vertical-swipe video player on `/learn`. Opens when a user taps a video card.

---

## Data / infrastructure terminology

**Cron commit** — The auto-generated commit `chore: refresh Learn Education data` that the GitHub Action makes after a successful fetch. Carries the latest CSV.

**DuckDB** — The columnar database the backend uses. `grip.duckdb` is baked at deploy time by `build_duckdb.py` from the per-project CSVs.

**Engagement query** — The SQL that reads cohort + per-user engagement signals from Rudder (DB 8). Returns one row per cohort user.

**FakeClient** — The test-only Metabase client that dispatches by `database_id` to return canned rows. Lets us test the merge logic without hitting Metabase. Pattern in `backend/tests/test_learn_education.py`.

**FTI query** — The SQL that reads `prodgripdb.ur_tblorders` (DB 24, ClickHouse warehouse), scoped to cohort user_ids, paginated. Returns one row per cohort user who has FTI'd.

**Manifest** — `backend/data/learn_education/manifest.json`. Single source of truth for "when was this data last refreshed?". Read by the dashboard's "as of" stamp.

**Nonce** — An integer counter that `useProjectRefresh` increments after a successful refresh. Feeding it into `useLearnEducation(nonce)` re-triggers the data fetch — the React way of forcing a re-query without a page reload.

**Probe** — A lightweight `COUNT(*)` query the cron runs before the main query to confirm events exist. If both probes return 0, the run returns `awaiting_first_event` cleanly without writing a CSV.

**Test user** — User IDs in `TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)`. Internal accounts excluded from every SQL path.

**ur_tblorders** — `prodgripdb.ur_tblorders`. The `unrestricted_user` role's view of `tblorders` on Metabase DB 24. Has columns our service account can read (the underlying `tblorders` has GRANTs we don't hold).

---

## Editorial / UI terminology

**Dateline** — The top-of-page strip that shows "VOL. I · NO. 01 · {week range} · LIVE". Mimics newspaper masthead conventions.

**Editorial** — The dashboard variant that styles like a broadsheet newspaper (Fraunces / Newsreader / IBM Plex Mono). Alternative would be a "classic" tabular variant; we ship only editorial for Learn.

**Exhibit** — A card-style numeric callout in the headline section (e.g., "5.63% visit rate"). Editorial term borrowed from museum-style display.

**Lead / Lede** — The opening headline + pull-quote that frames the dashboard's main finding. Lives at the top of `LearnEducationDashboardEditorial.jsx`.

**Margin Notes** — The new section being added in V2 that surfaces A/B integrity indicators (SRM, Control leak, FTI lift CI, MDE). See [`specs/2026-05-27-tier2-and-margin-notes.md`](./specs/2026-05-27-tier2-and-margin-notes.md).

**Masthead** — The dashboard's top banner. Carries the dateline + headline.

**Pull-quote** — A short italicised quote pulled out of body text, set larger than surrounding type. Used to highlight the headline number (e.g., "Treatment converts X pp better").

---

## Statistical math we use

**Two-proportion z-test** — Used in two places:
1. SRM check: `H0: control_n / (control_n + treatment_n) = 0.5`.
2. FTI lift CI: 95% confidence interval on `(p_treatment − p_control)` using the normal approximation. Suppressed when either arm has < 10 successes.

**Wilson interval** — A more conservative alternative to the normal approximation, especially good when proportions are near 0 or 1. We don't use it yet; would consider if normal-approximation CIs misbehave in real data.

**Pooled rate** — `(successes_control + successes_treatment) / (n_control + n_treatment)`. Used as the variance estimate in MDE calculations.
