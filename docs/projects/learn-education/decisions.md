# Learn (Grip Education) — decision log

Append-only record of the meaningful design / engineering decisions we've
made on this project. Each entry: **what we decided, why, what we
considered, and what would force a revisit.**

---

## D-25 · 2026-05-28 — §V "The Daily" tab with invest-time attribution + granularity dropdown

**Decided.** A new §V dashboard tab "The Daily" shows a tabular breakdown with **FTI attributed to invest-time** (the period in which the FTI happened), not bucketing week. A dropdown selects the rollup grain: **Hour-on-Hour / Day-on-Day / Week-on-Week / Month-on-Month**.

A single hourly source CSV (`hourly_breakdown.csv` → DuckDB table `learn_education__hourly_breakdown`) serves every grain — the frontend rolls up via DuckDB `date_trunc` at query time. ~2,016 rows at hour grain over 12 weeks; trivial cost.

**Why this is a different question than §II Ledger.** The Ledger uses sticky-week attribution (a user assigned in W1 who FTIs in W3 credits to W1). That answers the cohort-acquisition question: "how is the W1 cohort performing over time?". The Daily answers the operational question: "what was our FTI conversion in this hour/day/week?". Both are valid; they answer different questions.

**The 9-column shape per row:**
- `new_cohort_control` / `new_cohort_treatment` — users newly assigned to each arm in this bucket
- `new_visitors_control` / `new_visitors_treatment` — users whose first /learn visit was this bucket
- `fti_control` — control users who FTI'd this bucket (post-assignment-only)
- `fti_treatment_total` — total treatment FTIs this bucket
- `fti_treatment_visited` — subset who had visited /learn before this FTI
- `fti_treatment_played_1p` — subset who had ≥1 video play before this FTI
- `fti_treatment_played_2p` — subset who had ≥2 video plays before this FTI

**Nesting:** total ⊇ visited ⊇ played_1p ⊇ played_2p. Visual indent in the table makes the subset relationship readable.

**Causal-ordering filter still applies.** Pre-experiment FTIs (gate-leak users whose FTI was before their bucketing) are filtered out via the same `_fti_is_post_assignment()` check used in `aggregate_rows`. The `fti_control` and `fti_treatment_total` columns are causally honest.

**SQL change:** the plays CTE in `build_engagement_sql` now emits `second_play_at` (the timestamp of the second play) via `(array_agg(timestamp ORDER BY timestamp ASC))[2]`. Needed to precisely classify "played ≥2 videos before FTI" — without it we'd approximate via `play_count >= 2 AND first_play_at <= fti_date`, which is biased if the 2nd play happened post-FTI.

**Why hour grain in the source, not day:**
- Launch-day stakeholders want Hour-on-Hour to see immediate uptake (D+0).
- Rolling UP to coarser grains is cheap in DuckDB. Rolling DOWN from day to hour requires re-running the cron with finer data. Pay the storage cost once (~2k rows × 12 columns × 12 weeks = tiny).

**Considered + rejected:**
- **Separate CSVs per granularity** (daily.csv + weekly.csv + …): duplication of data; DuckDB `date_trunc` is the right primitive.
- **Client-side rollup from a flat events table**: too large; the per-bucket aggregation makes sense at backend write time.
- **No `second_play_at`, approximate via play_count**: biased estimator; we already pay one extra CTE column to fix it precisely.
- **Use bucketing week (sticky)** for FTI attribution here too: defeats the point. §II Ledger already does that; §V exists specifically for the invest-time view.

**Revisit if:** the hourly CSV grows past ~10K rows (would happen at 12-month windows). At that point reconsider whether the hourly grain pays for itself.

**Tests added (+7):**
- `test_hourly_breakdown_empty_inputs_returns_empty`
- `test_hourly_breakdown_attributes_fti_to_invest_hour_not_assignment_hour` — the core attribution test
- `test_hourly_breakdown_treatment_engagement_nesting` — verifies the 4 nested columns
- `test_hourly_breakdown_excludes_pre_assignment_ftis` — causal-ordering regression
- `test_hourly_breakdown_skips_ftis_for_non_cohort_users` — out-of-cohort defense
- `test_hourly_breakdown_control_vs_treatment_split` — variant split at hour grain
- `test_iso_to_hour_handles_various_timestamp_formats` — helper unit test

Total: 88 → 95 tests passing.

---

## D-24 · 2026-05-28 — `fti_users` filter tightens to per-user `assignment_timestamp`

**Decided.** `aggregate_rows()`'s FTI causal-ordering check now uses each user's actual `assignment_timestamp` (not the week's Monday-truncated `assigned_week`). A unified helper `_fti_is_post_assignment(fti_date, engagement_row)` is the single source of truth — both `aggregate_rows()` and the funnel's `_has_post_assignment_fti()` route through it. Falls back to the legacy `assigned_week` check when `assignment_timestamp` is missing.

**Why this is a bug fix, not a refinement.** The previous filter (`fti_date >= assigned_week`) used week granularity, which silently counted gate-leak users whose FTI happened **before** their bucketing on the same calendar week. Concrete scenario:
- User assigned Wed 16:00 (`assignment_timestamp = '2026-05-27T16:00:00'`)
- User FTI'd Wed 13:00 (`fti_date = '2026-05-27T13:00:00'`)
- assigned_week = '2026-05-25' (Monday DATE_TRUNC)
- `'2026-05-27T13:00:00' >= '2026-05-25'` → TRUE → counted as experiment FTI ❌

This user was already invested 3 hours before they got bucketed. They're a gate-leak from `useShowLearnPage`'s `!isInvested` check, not an experiment-caused conversion.

**The fix is symmetric with D-23.** That decision tightened `days_to_fti` to per-user timestamps. This one tightens `fti_users` to match. Today (W1) the impact is significant — the dashboard's headline FTI count drops from ~53/55 per arm to the true post-assignment ~17–21 per arm. The number is smaller but causally correct.

**Tests added (+4):**
- `test_aggregate_rows_fti_users_filters_by_assignment_timestamp_not_week` — reproduces the exact gate-leak scenario (assigned Wed 16:00, FTI'd Wed 13:00). Must be excluded.
- `test_aggregate_rows_fti_users_accepts_post_assignment_same_day` — symmetric: same-day post-bucketing FTI counts.
- `test_aggregate_rows_fti_users_falls_back_to_week_when_timestamp_missing` — defensive: legacy data path still works.
- `test_funnel_post_assignment_fti_also_uses_assignment_timestamp` — funnel side now uses the same filter (was independently using week granularity).

**Considered + rejected:**
- Keep both filters (week-based fti_users, timestamp-based days_to_fti). Rejected — they answer different questions but operate on the same conceptual "did this user FTI as a result of the experiment" attribution; inconsistency is misleading.
- Drop `assigned_week` from the engagement SQL entirely. Rejected — it's still useful for the sticky-week attribution grouping (a user assigned in W1 who FTIs in W3 should credit to W1's row).

**Revisit if:** product asks to revert to the lenient week-anchored count (for parity with a manual spreadsheet). Currently no such ask; the corrected number is more defensible.

---

## D-23 · 2026-05-28 — `days_to_fti` anchors on `assignment_timestamp`, not `assigned_week`

**Decided.** The conversion-momentum metric (median days from assignment to FTI) anchors on each user's actual `experiment_assigned.timestamp`, NOT on the week's Monday. The cohort CTE now emits `assignment_timestamp` alongside `assigned_week`; `_collect_days_to_fti()` subtracts the per-user assignment timestamp from `fti_date` and reports fractional days (`0.4d`, not `2d`).

**Why this is a bug fix, not a refinement.** With the launch happening Wed 2026-05-27 at 13:02 IST, every Treatment user this week was bucketed mid-week. Their `assigned_week` is "2026-05-25" (the Monday). A user who FTI'd Wednesday after bucketing had `(fti_date - assigned_week_monday)` = 2 days — regardless of whether the actual bucketing-to-FTI gap was 5 minutes or 10 hours. The metric was structurally inflated.

User's catch: *"how 2 days when the code went live only recently today/yesterday 27th May around 1pm ist and it's more than 12-14 hrs."* Correct.

**The fixed metric:**
- Treatment 0.4d ≈ "engaged users invest ~9 hours after bucketing" — platform's natural conversion pull.
- Causal-ordering hygiene preserved: pre-experiment FTIs (negative deltas) still dropped silently.

**Tests added (+3, plus +1 SQL pin):**
- `test_days_to_fti_median_anchored_on_assignment_timestamp` — 3 users with same `assigned_week` but different `assignment_timestamp`, verifies the median uses per-user timestamps.
- `test_days_to_fti_regression_does_not_anchor_on_week_monday` — exact scenario that caused the bug (mid-week launch, 9h gap → 0.4d not 2d).
- `test_days_to_fti_skips_users_with_missing_assignment_timestamp` — defensive handling.
- `test_engagement_sql_pulls_assignment_timestamp` — SQL pin so future refactors can't accidentally drop the field.

**Display:** Float median rendered as `0.4d` for sub-day values, `2d` for whole-number multi-day gaps (no trailing `.0`).

**Considered + rejected:**
- Anchoring on Monday + adding a "live-since" correction — fragile; breaks on mid-experiment relaunches.
- Computing the metric in SQL — needs cross-DB join (cohort in DB 8, FTI in DB 24); Python merge is correct.

**Revisit if:** Rudder stops capturing per-event timestamps. Today they're guaranteed by `trackEvent` instrumentation.

---

## D-22 · 2026-05-28 — Pull-quote uses logic B (highest-rate band) + WoW delta + days-to-FTI

**Decided.** Three changes to the engagement-gradient pull-quote and surrounding signals:

1. **Logic B** — top band is the band (excluding baseline) with the **highest FTI rate AND N ≥ 10**, not the deepest. With today's data, this picks "Visited /learn" (10.87%) over "Completed" (5.26%), telling a much richer story.
2. **WoW delta** in the pull-quote when ≥ 2 weeks of data exist. Shows the same band's FTI rate vs the prior week with directional arrow + pp delta.
3. **Days-to-FTI median** added to §III Engagement's Conversion Funnel as a "CONVERSION MOMENTUM" section. Surfaces how quickly engaged cohort users move from bucketing to first investment.

**Why Logic B over deepest-band.** The data revealed engagement-depth FTI rate is not monotonic — it can peak at "Visited" before dropping at deeper bands. Logic B picks the actual strongest signal; the full funnel viz in §III shows the non-monotonic gradient for readers who want the depth narrative.

**Why WoW.** At W1 the dashboard is a static snapshot. At W2+ the reader wants to know "is the gradient strengthening or weakening?". The WoW delta in the pull-quote gives an at-a-glance answer.

**Why days-to-FTI.** Surfaces conversion momentum. Slow median (>30d) means users research longer; fast median (<5d) means the surface drives immediate intent. Computed per-variant; Control's days_to_fti is the platform's natural conversion velocity (no Learn influence).

**Backend changes:**
- `build_conversion_funnel` refactored: extracted `_funnel_for_week()` helper, calls it for both latest and prior week, returns `prior_variants` alongside `variants`.
- New `_collect_days_to_fti()` helper computes days from `assigned_week` to `fti_date` for post-assignment FTIs.
- Each variant block in the funnel manifest now carries `days_to_fti_median` and `days_to_fti_n`.

**Tests added (+4):** prior_week presence/absence, days-to-FTI computation with multiple users, days-to-FTI suppression when no post-assignment FTIs.

**Considered + rejected:**
- Client-side prior-week funnel from `rows` — `rows` is pre-aggregated, no per-user data, impossible.
- Show WoW on baseline ITT rate (4.05% → 4.05%+δ) — defeats the gradient framing.
- Multi-week funnel history in manifest — balloons size; single-WoW is enough.

**Revisit if:** Logic B picks a band with cohort_n just above 10, variance too high to trust. Raise the N≥10 floor to N≥30 or compute a CI on the top-band rate itself.

---

## D-21 · 2026-05-28 — Pull-quote shows the engagement gradient, not the ITT delta

**Decided.** The masthead pull-quote shows the **conversion gradient** — Treatment cohort baseline FTI rate → top engagement band's FTI rate — formatted as `4.15% → 14.3%`. The caption makes the selection-effect caveat explicit. Falls back to the ITT delta only when funnel data is unavailable.

**Why.** The previous pull-quote showed only the ITT lift (e.g. `+0.32 pp`). This was:
1. **Redundant.** The same number appears in §I Overview, §II Ledger verdict box, and §IV Reading №01.
2. **Flat when CI brackets zero.** At W1 the lift is small and inconclusive — the bold pull-quote either misleads or feels deflating.
3. **Doesn't tell you anything new.** A great pull-quote surfaces a story the rest of the page doesn't already say.

The engagement gradient tells the within-Treatment story: as you condition on deeper engagement, FTI rate climbs. The bold number is real AND interesting. The caveat (selection effect, not causal) is built into the caption so the boldness doesn't overclaim.

**Considered + rejected:**
- Show only the ITT delta (status quo) — fails the "tell me something new" test.
- Show the CI bracket (`[-0.96, +2.14] pp`) — accurate but visually defeating in a pull-quote position.
- Show "time to significance" forecast — interesting but speculative; reads like a hedge.
- Show baseline → treatment FTI rate (`3.83% → 4.15%`) without engagement conditioning — same fail as the ITT delta.

**Revisit if:** the funnel produces noisy top-band numbers due to small N at the completed band. At very low N (say, <10 completers), the rate is statistically meaningless and the pull-quote should fall back to the ITT delta.

---

## D-20 · 2026-05-28 — Engagement-depth conversion funnel (descriptive, not causal)

**Decided.** Add a new "Conversion Funnel" viz to §III The Engagement that breaks Treatment users down by **cumulative engagement depth** (Bucketed → Visited → Played → Multi-played → Completed) and reports FTI rate at each depth band. Plus an entry-source breakdown (top_chip / bottom_nav / deep_link / direct) for visitors. Control appears only as the baseline band — by design, Control cannot reach the deeper bands.

**Why.** User's question: *"calculating the FTI rate for people who are just in Treatment as it doesn't really make sense. We need to ideally compare between the people who have converted after watching a video."* This is the engagement-conditional view. The honest answer is:

- **ITT (Treatment vs Control)** remains the only **causal** claim. Random assignment guarantees the two arms are comparable at baseline.
- **Engagement-conditional analysis** is *descriptive* — users who choose to watch self-select. Their high FTI rate is partly the kind of person who watches, not just the effect of watching.

The right move is to **show both, clearly framed.** The conversion funnel surfaces the engagement-conditional story; the framing makes the selection-effect caveat explicit; ITT remains the headline causal claim in §I and §II.

**Data shape:** cumulative bands (depth >= N). A user at the "completed" depth also counts at "played", "visited", and "bucketed". This matches the funnel-reading mental model better than exclusive bands.

**Backend implementation:**
- New `build_conversion_funnel(engagement_rows, fti_by_user)` in `learn_education.py`.
- Engagement SQL extended to capture `first_entry_source` from the page_views CTE.
- Output stored in `manifest.conversion_funnel`.
- Pure-function, no I/O. 7 unit tests cover band classification, FTI attribution, entry-source breakdown, both arms, and edge cases.

**Frontend implementation:**
- `ConversionFunnel` viz in §III with bar-pair rows (cohort width + FTI overlay).
- Entry-source breakdown grid below the funnel.
- Control reference band at the bottom, in muted ink.
- Selection-effect caveat baked into the section header AND the band-level prose.

**Considered + rejected:**
- **Replace ITT with engagement-conditional only.** Would drop the causal claim. Wrong move — the user's experiment is fundamentally A/B; ITT must remain.
- **Show exclusive depth bands** (depth == N exactly). Less intuitive for reading attrition.
- **Compute the funnel client-side from rows.** Adds complexity to React without a corresponding gain; cron-time computation is one fewer thing for the dashboard to handle.

**Revisit if:** product asks for instrumental-variable or propensity-score analysis to actually decompose the selection effect.

---

## D-19 · 2026-05-28 — "Treatment only" is a dedicated block, not omitted

**Decided.** Treatment-only engagement metrics (visit rate, plays, watch time, completion, time-to-first-play, drop-after-first, outbound CTR, banner CTR) are shown in a clearly labeled **"Treatment only · Control is invisible to /learn by design"** block within §II The Ledger, NOT dropped from the comparison section as initially proposed. The block is visually distinct (warmer paper tint, full border, explicit "NOT A COMPARISON" caption).

**Why.** User pushback: dropping these metrics would hide important readouts. The original problem ("em-dashes everywhere makes for a boring comparison") wasn't that the data was wrong — it was that the SHAPE was wrong, pretending these are comparison metrics. The fix is to keep the metrics but reframe them as a single-arm readout with a clear "no Control counterpart" header.

These metrics also appear in §III The Engagement as a deeper funnel-narrative. The duplication is intentional: a reader who stops at §II gets the compact form; a reader who clicks into §III gets the deeper version.

**Considered + rejected:**
- Drop the metrics from §II entirely (initial proposal) — leaves §II thin, forces every reader to drill into §III for basic engagement reading.
- Render them with explicit "N/A" Control values — perpetuates the comparison framing problem.
- Side-stripe accent block — banned per impeccable design rules.

**Revisit if:** the duplication between §II's "Treatment only" block and §III The Engagement creates editorial drift (numbers diverge, or one becomes stale).

---

## D-18 · 2026-05-28 — §IV becomes "The Reading"; "The Guardrails" removed

**Decided.** Section IV in the navigable body is now "The Reading" — the inferences view. The previous §IV "The Guardrails" (HealthSection) is removed.

**Why.** User feedback: The Reading deserves its own tab, not a dedicated inline block at the top. The previous §IV Guardrails was redundant with the inline "Editor's Note on Confidence" (collapsible MarginNotes, D-16) — same indicators surfaced twice was clutter. Replacing §IV with The Reading moves the inferences view from forced-prominence to opt-in and consolidates experiment-integrity coverage in one place (the collapsed Editor's Note).

Final SECTIONS array: §I Overview · §II Ledger · §III Engagement · §IV Reading.

**Revisit if:** product asks for a dedicated "experiment health" tab again. The data is still in `project.manifest.margin_notes`; re-introducing the section is a 50-line component.

---

## D-17 · 2026-05-28 — "The Reading" section: deterministic inferences, no runtime LLM

**Decided.** Add a new dashboard section "The Reading" that surfaces 4-5 plain-English inferences derived from the cohort data. Each inference is **deterministically computed** from the same `rows` the Ledger uses — no LLM at runtime — and carries a citation pointing into our own docs (Ledger row, glossary entry, decision-log reference).

**Why.** The reader wants the dashboard to draw conclusions, not just display numbers. Editorial broadsheets do this with an "Analysis" column. Computing inferences in JS at render time keeps the data path deterministic (CLAUDE.md rule), keeps each inference auditable (one function, one place), and means inferences update in lockstep with the data without a separate refresh job.

**Specifically NOT** generating these via LLM at cron or render time. The "Deterministic Python only in the data path" rule applies — a runtime LLM would re-introduce non-reproducibility, cost, and risk of hallucinated claims about money.

**Each inference shape:** `{claim, evidence, caveat?, tone}`.
- `claim` — natural-language reading.
- `evidence` — cites the specific Ledger row + computation source.
- `caveat` — honest hedge (e.g., "selection effect, not causal").
- `tone` — drives the small colored marker (positive / cautious / negative / neutral).

**Considered + rejected:**
- LLM at cron time → violates data-discipline.
- LLM at render time client-side → needs API key in browser; not viable.
- Static authored text → can't update with data.
- Per-metric tooltip-only inferences → too dispersed; the whole point is consolidation.

**Revisit if:** product asks for richer narrative that exceeds rule-based templates. At that point, consider an LLM-at-cron with a deterministic output schema + a "generated by" disclosure on the card.

---

## D-16 · 2026-05-28 — Margin Notes collapsed by default, per-card explainers

**Decided.** Margin Notes are wrapped in a top-level `<details>` (collapsed by default), with a softer title "Editor's Note on Confidence" and "MARGIN NOTES" demoted to a sub-caption. Each of the four indicator cards is also a `<details>` — closed state shows label + value + verdict glyph; expanded state shows a paragraph of plain-English context + a citation to our own docs.

**Why.** The previous design dominated the masthead with four loud cards. User feedback: "too in-the-face, very less explanation". Statistical-confidence indicators are *guardrails* — readers should be able to ignore them when reading the headline and read them carefully when interpreting the lift. Collapsing solves the prominence; per-card `<details>` solves the explanation without taking up space.

**Considered + rejected:**
- Tooltips on hover → fail on touch devices, hide on keyboard nav, not editorial.
- Modal overlay → overkill; explanations are short.
- Sticky footnotes → visually compete with the colophon.
- Separate `/learn/methodology` route → too much friction for one-paragraph explainers.

The chosen `<details>` element is native HTML, keyboard-accessible by default, works without JS, and matches the "newspaper editor's marginalia" framing — fold open the margin when you want it.

**Revisit if:** indicators grow to 6+ and the collapsed list becomes a wall of summary lines.

---

## D-15 · 2026-05-28 — Ledger redesigned as section-grouped editorial rows

**Decided.** The Ledger tab (§ II) drops the 19-column horizontal-scroll table in favour of three editorial sections — **The Surface · The Watch · The Investor** — each containing per-metric rows with (label · Control value · Treatment value · delta · trend sparkline).

**Why.** The original table was 19 metrics × N weeks × 2 variants = a spreadsheet. Editorial broadsheets don't do spreadsheets. The new layout:
- Maps metrics to **funnel stages** (Surface → Watch → Investor) so a reader can scan by topic.
- Keeps **comparison density**: every row shows Control + Treatment + delta side-by-side.
- Adds **temporal context**: a small sparkline per row shows the week-over-week lift trend (single point in W1, growing into a full curve).
- Reads cleanly at 375 px (rows collapse to two-line cards).

**Considered + rejected design alternatives:**

| Option | Why rejected |
|---|---|
| **A. The Markets Page (FT-style ticker)** | One mega-row-per-metric with all columns visible — readable but lost the funnel-stage narrative grouping. Useful primitive but flat. |
| **B. Small Multiples grid** | Each metric becomes a tiny chart panel. Strong visual separation but doubled the page height and lost the ability to read straight down. Better for engagement deep-dives than headline ledger. |
| **C. The Spread (slope graph)** | Every metric is a slope from Control to Treatment — visually striking but harder to read absolute values, and slope visualizations of percentage-point lifts at varying magnitudes are misleading without log axes. |
| **D. The Box Score** | Sports-style winner-per-metric scorecard. Too reductive — hides nuance, encourages binary thinking ("Treatment won 5/7") that A/B integrity (Margin Notes) explicitly cautions against. |
| **E. The Reading (longform prose)** | Each metric a paragraph with the number embedded. Most "editorial" but heavy to scan and untenable for any reader doing a quick check. |

**The chosen hybrid** keeps Markets Page's tabular comparison density inside Small Multiples' section grouping — the user's specific call. Visual: section header (Fraunces italic) + grouped rows. Tabular alignment via grid, NOT `<table>` — gives us responsive control without overflow scrolling.

**Revisit if:** the cohort grows past ~12 weeks and the sparkline becomes too dense (would need a tooltip layer), OR if product asks for variant breakouts beyond binary (need stacked multi-arm display).

---

## D-14 · 2026-05-28 — DISTINCT ON in cohort CTE

**Decided.** The cohort CTE uses `SELECT DISTINCT ON (user_id::text)` ... `ORDER BY user_id::text, timestamp ASC` to keep exactly one row per user — the earliest `experiment_assigned` event.

**Why.** The localStorage-based dedup in `gi-client-web utils/experimentBucketing.ts` is the primary mechanism, but in practice ~10% of users emit duplicate `experiment_assigned` events (cleared localStorage, multi-device sessions, browser race conditions). Without DISTINCT, the aggregator counted those users 2-3× in every metric — inflating cohort denominators and over-counting FTI conversions. Observed in prod on 2026-05-28: 118 fti_users from 107 unique post-assignment FTI rows (~10% over-count).

**Considered + rejected:** Filtering at the Python aggregator level (e.g., a `seen_user_ids` set per variant). Rejected because (a) Postgres is the right layer for set semantics, (b) Python-side dedup would still pull duplicate rows over the wire, (c) DISTINCT ON keeping the EARLIEST event is meaningful (matches the "first assignment is authoritative" semantic of sticky bucketing).

**Revisit if:** upstream emits a single canonical `experiment_assigned` per user and the DISTINCT becomes a redundant safeguard.

---

## D-13 · 2026-05-28 — Canonical user_id key (float vs int-string normalization)

**Decided.** `_user_id_key(uid)` normalises all user_ids to `int-as-string` via `str(int(float(uid)))` on both sides of the cohort × FTI merge.

**Why.** Metabase's ClickHouse driver returns `ur_tblorders.user_id` (integer column) as Python `float` via JSON deserialization. Rudder returns user_id as `str` via PostgreSQL `::text` cast. `str(2.0) == "2.0"` but `str("2") == "2"` — every hash-table lookup missed silently. The fix gives the same canonical key for all three representations.

**Revisit if:** Metabase changes its driver to return integers natively (then the float fallback would still work, just cost an unneeded `float()` round-trip).

Newest first. Don't re-litigate — if a decision needs to change, add a new
entry that supersedes the prior one (and link back).

> **Naming:** ADR-lite. We don't number them like canonical ADRs because
> the dependency-of-decisions graph is shallow and the chronological order
> is more useful.

---

## D-12 · 2026-05-27 — Tier 3 A/B section named **"Margin Notes"**

**Decided.** The A/B-experiment integrity section in the editorial dashboard is named "Margin Notes".

**Why.** Editorial broadsheets historically carried marginalia — annotations editors hand-wrote in manuscript margins. The phrase "margin of error" sits naturally inside it. Fits the existing Fraunces/Newsreader aesthetic.

**Considered + rejected:** "The Verification Bureau" (too formal), "Statistical Marginalia" (erudite, too precious).

**Revisit if:** the section grows beyond 4 cards and starts to need a different framing. Or if user testing shows readers don't intuit the name.

---

## D-11 · 2026-05-27 — Ship 7 Tier 2 metrics, defer 3

**Decided.** V2 adds these 7 metrics: engaged-visitor rate, plays-per-visitor, drop-after-first-video, completion rate (≥75%), median time-to-first-play, outbound click rate, banner CTR on /learn.

**Why.** They are the highest-signal metrics derivable from raw events we already collect, and they tell a coherent story when read together: surface attracts (1), drives action (6, 7), with content that holds (3, 4, 5).

**Considered + rejected for V2:**
- Exit-reason mix — diagnostic, not headline.
- Multi-session rate — needs ≥2 weeks data.
- Category split — deserves its own sibling CSV; would double column count.

**Revisit if:** product wants any of the deferred 3 sooner. Or if a Tier 2 metric proves to add no decision value after 4 weeks.

---

## D-10 · 2026-05-27 — Cron stays **once-daily, 12-week recompute**

**Decided.** Daily cron at 01:00 IST, computes a fresh 12-week rolling window from scratch each run.

**Why.** The output is ≤ 3 KB. Self-healing on missed days or backfills. Cohort-scoped IN-clause keeps query cost bounded by cohort size — independent of window length.

**Considered + rejected:**
1. **Twice-daily.** No retention pressure on Rudder/Postgres (unlike Performance Grip's 8-day NR Web Vitals window). Doubles cost for no analytic gain.
2. **4-week window.** The `fti_users >= c.assigned_week` predicate means W1's FTI rate keeps updating as late-tail conversions happen 15-60 days post-bucketing. A 4-week window would freeze W1 at W5 and silently understate the FTI lift.
3. **Incremental daily-fetch** (Asset Search style). Output is tiny; we don't need it. Whole-window recompute is simpler and self-healing.

**Revisit if:** query cost crosses 30s, or readers ask for fresher data and we have evidence late-day data has changed meaningfully.

---

## D-09 · 2026-05-27 — FTI source: **DB 24 / `prodgripdb.ur_tblorders`**

**Decided.** FTI fetch hits Metabase database_id 24 (ClickHouse warehouse), table `prodgripdb.ur_tblorders`.

**Why.** Business analysts publish dashboards off DB 24. Aligning to the same warehouse means our numbers match what's published elsewhere — no "but the source-of-truth says X and your dashboard says Y" reconciliation. `tblorders` has column-level GRANT restrictions our service account can't satisfy; `ur_tblorders` is the `unrestricted_user` role's view, designed for analyst access.

**Considered + rejected:**
- **DB 2 / `tblorders` (Postgres source-of-truth).** Reads cleanly with our service account, but diverges from the warehouse over short time windows (replication lag). Briefly tried (PR #97) before D-09 settled on DB 24.
- **Rudder `client_web.new_user_order`.** Originally proposed. Rejected because the canonical product FTI definition (Metabase question 2672) uses `tblorders` with `status IN (1,7,8) AND order_type='BUY'`, which is stricter and more accurate than the Rudder event.

**Revisit if:** the warehouse `ur_tblorders` view goes away, or business analysts move to a new canonical source.

---

## D-08 · 2026-05-27 — FTI fetch is **cohort-scoped + paginated**

**Decided.** The FTI query filters `WHERE user_id IN (<cohort user_ids>)` rather than scanning the full FTI universe. Pagination loop walks `ORDER BY user_id LIMIT 2000 OFFSET n` against Metabase's 2000-row /api/dataset response cap.

**Why.** Without scoping, the unbounded query hit exactly 2000 rows — silently truncated by Metabase's cap, missing every cohort user whose user_id sorted late. Scoping bounds the result by cohort size (~2,000), well under the cap, and lets ClickHouse use the user_id index instead of a full table scan.

**Revisit if:** cohort grows past ~10K users/arm, at which point we should benchmark whether pagination overhead exceeds a single unscoped fetch (unlikely but possible).

---

## D-07 · 2026-05-26 — Drop mock-data fallback; show empty state instead

**Decided.** `useLearnEducation()` initializes empty rows + `EMPTY_META`. On query error, surfaces the error and shows the dashboard's existing "On the presses…" empty-state UI. No `MOCK_ROWS` / `MOCK_META` fallback.

**Why.** Pre-launch mock was misleading viewers into thinking real numbers had landed. The editorial dashboard already has a graceful empty state. Once live data lands, the empty path is dead code.

**Revisit if:** we re-introduce a pre-launch demo mode for unrelated features.

---

## D-06 · 2026-05-26 — Refresh button is **shared, not project-specific**

**Decided.** The dashboard uses `RefreshControl` + `useProjectRefresh` from `frontend/components/RefreshControl.jsx` (same as Asset Search and Performance Grip). Nonce-driven re-fetch.

**Why.** UX consistency. Three projects on the same harness should refresh identically.

**Revisit if:** Learn surfaces a refresh use case the shared component can't accommodate.

---

## D-05 · 2026-05-26 — **Multi-variant** experiment support, not just binary

**Decided.** Frontend variant helpers accept `treatment` AND `treatmentv1`, `treatmentv2`, …; aggregator groups by arbitrary variant string. Control rows render "—" for surface-only columns.

**Why.** The gi-client-web experiment architecture (post-refactor on `develop`) supports named variants for the same experiment. Today's `learn_page` is binary, but the next experiment may not be. Cost of handling it now is small (one helper function); cost of retrofitting later is high.

**Revisit if:** the named-variant architecture is removed upstream.

---

## D-04 · 2026-05-26 — Event names: **`[object]_[past_tense_verb]`**

**Decided.** Learn event naming follows `[object]_[past_tense_verb]`. Examples: `learn_page_viewed` (not `view_learn_page`), `learn_video_viewed` (not `view_learn_video`), `learn_outbound_clicked` (not `learn_outbound_click`).

**Why.** Consistency with the cross-feature convention (`bottom_nav_click` is the legacy exception, kept for backward compatibility per D-03). Past-tense names read naturally as analytics dimensions: "of users where `learn_page_viewed` happened, how many also `fti_completed`?"

**Revisit if:** the cross-feature analytics taxonomy gets a formal redesign.

---

## D-03 · 2026-05-26 — `bottom_nav_click` stays **cross-feature**, not Learn-forked

**Decided.** Learn does not introduce a `learn_bottom_nav_clicked` event. Bottom-nav taps on the Learn item route through the same canonical `bottom_nav_click` event, with `nav_item='learn'` discriminating. The subsequent `learn_page_viewed` carries `entry_source='bottom_nav'`.

**Why.** Bottom-nav CTR is a cross-feature comparison metric. Forking it per feature would prevent that comparison and require every dashboard to track bottom-nav separately.

**Revisit if:** Learn-specific bottom-nav variants emerge that the canonical event can't model.

---

## D-02 · 2026-05-26 — One `learn_video_viewed` event, not 4 phase events

**Decided.** A single `learn_video_viewed` fires at view-end (swipe / close / unmount) with `completion_pct`, `exit_reason`, `total_watched_seconds`. No separate `started` / `25_pct` / `50_pct` / `completed` events.

**Why.** Each phase event is just a derivable subset of the single event's `completion_pct`. Four events triple Rudder ingest cost and dashboard SQL complexity. The completion-rate metric (Tier 2 #4) reads cleanly off `WHERE completion_pct >= 75` against the single event.

**Considered + rejected:** A 4-phase ladder (industry-common). Rejected on YAGNI + cost grounds.

**Revisit if:** product asks for video-completion buckets (10/25/50/75/90) as distinct events; switching costs are low.

---

## D-01 · 2026-05-26 — Project lives in `grip-analytics`, not in product code

**Decided.** The analytics dashboard for Learn (Grip Education) is a project inside the `grip-analytics` repo (alongside Asset Search, Grip Connect, Performance Grip, FRA YouTube). NOT inside `gi-client-web` or in a Metabase dashboard.

**Why.** Internal-hosted analytics with editorial framing requires Next.js + DuckDB and is shared with sibling projects. Metabase is fine for ad-hoc analyst dashboards but not for the editorial reading we want. Embedding inside `gi-client-web` would conflate product feature code with internal ops tooling.

**Revisit if:** another project requires structurally different infrastructure (e.g., streaming) that grip-analytics's batch-only model can't support.

---

## D-00 · 2026-05-26 — The hypothesis itself

**Decided.** The Learn page A/B experiment tests this hypothesis:
*"Surfacing short-form, bite-sized investing content to non-invested
users will lift the First-Time Investor (FTI) rate without hurting funnel
metrics elsewhere."*

**Why.** Engagement loops via short video reels are a low-cost
intervention compared to long-form content. If they work for investing
education, they scale.

**Revisit if:** the hypothesis is invalidated at W4-W6 reveal (no lift,
or lift with cannibalisation of other funnel surfaces).
