# Learn (Grip Education) — decision log

Append-only record of the meaningful design / engineering decisions we've
made on this project. Each entry: **what we decided, why, what we
considered, and what would force a revisit.**

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
