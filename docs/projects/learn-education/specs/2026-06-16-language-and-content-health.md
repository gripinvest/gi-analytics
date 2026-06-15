# Language & content-health metrics — Learn (Grip Education)

**Status:** Draft. Source-side `language` attribute partially implemented (see §2); analytics side not started.
**Owner:** Puru
**Created:** 2026-06-16

## Why this spec

The existing `learn_education` project (see `2026-05-26-weekly-ab-tracker.md`)
is built entirely around the `learn_page` **A/B experiment** — Control vs
Treatment, FTI lift. Two things have changed since:

1. The **Hindi language toggle** shipped to production (PT-38392). It emits a
   new `learn_language_toggled` event, and **nothing in this project consumes
   it yet.** The toggle ships to *everyone* — it is not an experiment arm.
2. We now have a rich engagement stream (`learn_video_viewed` with completion,
   watch-time, loop, exit-reason, session-position) that the weekly A/B tracker
   only summarises as a single "video engagement" number.

This spec defines the **content-health** view — language adoption + engagement
quality — as a surface that is *independent of and outlives* the A/B
experiment. It also pins down the source-side event contract that has to exist
before any of it is answerable.

## Scope boundary

- **In:** language adoption/engagement metrics, engagement-quality metrics
  derivable from events already emitted, the source-side attribute additions
  needed to slice engagement by language.
- **Out:** anything in the weekly A/B tracker (that surface stays as-is).
  Do **not** bolt language onto the Control/Treatment table — see §5.
- **Test-user exclusion** (user ids 3, 4, 207871, 207875, 207878, 207879)
  applies to every metric here, same as the rest of the project.

---

## 1. Naming note

Engagement/funnel events use a flat `language` attribute (the content language
in effect, e.g. `en` / `hi`). The toggle event keeps its existing
`selected_language` / `previous_language` (it describes a transition, so it
needs both). When joining, `learn_language_toggled.selected_language` is the
same vocabulary as `learn_video_viewed.language`.

---

## 2. Source-side event contract (gi-client-web)

### 2a. Implemented — branch `feat/learn-language-analytics-attrs`

`language: string` added to the three engagement/funnel events so engagement
can be cut by content language:

| Event | New attribute | Source |
|-------|---------------|--------|
| `learn_video_viewed` | `language` | section content language at view-end |
| `learn_video_opened` | `language` | section content language at card tap |
| `learn_category_clicked` | `language` | section content language at tab switch |

Values are the config-driven language codes (`en` when no toggle is configured,
so non-Hindi cohorts emit a correct `en` baseline).

### 2b. Proposed — not yet implemented

| Event | Proposed attribute | Why | Priority |
|-------|--------------------|-----|----------|
| `learn_page_viewed` | `initial_language` | language the user lands in (from `?lang=` deep-link / persisted choice) — measures landing-language distribution, not just in-session toggles | P1 |
| `learn_outbound_clicked` | `language` | in-grid banners come from the localised content block; lets us attribute outbound clicks to the language surface | P2 |
| `learn_outbound_clicked` | `user_id` | event currently carries no user id, so outbound can't be joined to a user/cohort | P2 |

These are cheap (~1 line each at the emit site) but are deliberately **not** in
the implemented branch to keep that PR scoped to the engagement unblocker.
Schedule as a follow-up if the metrics in §4 that depend on them are wanted.

### 2c. New events considered and **deferred** (YAGNI)

| Candidate event | Why deferred |
|-----------------|--------------|
| `learn_video_progress` (periodic heartbeat) | `learn_video_viewed` already carries `total_watched_seconds`, `max_position_reached_seconds`, `completion_pct`, `loop_count` per view. A heartbeat adds volume for no new question we have today. |
| `learn_reels_swiped` | `position_in_session` + per-view `exit_reason` (`swipe_next` / `swipe_back`) already reconstruct swipe behaviour. |
| `learn_language_toggle_viewed` (impression) | We can infer exposure from `learn_page_viewed` on cohorts where the toggle config is present; a dedicated impression event isn't worth the wiring yet. |

Revisit only if a concrete metric needs them.

---

## 3. Data-pipeline impact

New event CSVs to export and ingest into DuckDB (table naming
`learn_education__{event_name}`, handled by the build pipeline):

- `learn_education__learn_language_toggled` — **new**, required for all §4 Tier-A
  toggle metrics.
- `learn_education__learn_video_viewed` — already needed for engagement; ensure
  the export includes the new `language` column once W-of-deploy lands.
- `learn_education__learn_video_opened` — needed for autoplay-success rate and
  per-language open→view funnel.

`fetch_learn_education.py` (modelled on `fetch_asset_search.py`) must be
extended to pull these event streams. Until the `language` column is present in
exported data (i.e. the first full week after the source change deploys),
language cuts return only `en` — flag this in the dashboard rather than showing
a misleadingly complete split.

---

## 4. Metrics

Grain is weekly unless noted, to line up with the existing tracker.

### Tier A — Language adoption & engagement

| Metric | Definition | Source | Notes |
|--------|------------|--------|-------|
| **Hindi adoption rate** | distinct users with ≥1 `learn_language_toggled` to `hi` ÷ Learn page visitors | `learn_language_toggled`, `learn_page_viewed` | headline adoption number |
| **Toggle rate** | distinct users who toggled (either direction) ÷ visitors | `learn_language_toggled` | how discoverable/used the control is |
| **Bounce-back rate** | sessions with `en→hi` followed by `hi→en` ÷ sessions with any `en→hi` | `learn_language_toggled` | "tried Hindi, flipped back" — comprehension/content-quality signal |
| **Active-tab-at-toggle mix** | distribution of `active_tab` when toggled | `learn_language_toggled.active_tab` | which category drives the language switch |
| **Completion rate by language** | views with `completion_pct ≥ 75` ÷ views, split by `language` | `learn_video_viewed.language` | **needs 2a (shipped)** |
| **Avg watch time by language** | mean `total_watched_seconds`, split by `language` | `learn_video_viewed.language` | |
| **Plays / viewer by language** | views ÷ distinct viewers, split by `language` | `learn_video_viewed.language` | |
| **Drop-after-first by language** | viewers with exactly 1 view ÷ viewers, split by `language` | `learn_video_viewed.language` | |
| **FTI rate by language** | FTI users who watched ÷ watchers, split by language | `learn_video_viewed.language` + FTI source | the conversion question; confound: language not randomised, treat as directional |
| **Landing-language mix** | distribution of `initial_language` | `learn_page_viewed.initial_language` | **needs 2b (P1)** |

### Tier B — Engagement quality (no source change needed)

| Metric | Definition | Source |
|--------|------------|--------|
| **Autoplay-success rate** | `learn_video_viewed` count ÷ `learn_video_opened` count | both events |
| **Loop / replay rate** | views with `loop_count ≥ 1` ÷ views; and mean `loop_count` per video | `learn_video_viewed.loop_count` |
| **Exit-reason mix** | distribution of `exit_reason` (`completed` / `swipe_next` / `swipe_back` / `close` / `unmount`) | `learn_video_viewed.exit_reason` |
| **Session depth** | mean / p90 `position_in_session` reached | `learn_video_viewed.position_in_session` |
| **Per-category engagement** | completion rate + avg watch time grouped by `category_id` | `learn_video_viewed.category_id` |

### Tier C — Retention (needs user-grain ingestion)

| Metric | Definition | Blocker |
|--------|------------|---------|
| **Repeat-visitor rate** | visitors in week W who also visited a later week | weekly tracker is pre-aggregated; needs user-level event ingestion |

---

## 5. Dashboard placement

Add a **separate "Content Health & Language" section** (or a second dashboard),
not new columns on the weekly A/B tracker. Rationale:

- The toggle is **not** an experiment arm — putting it in the Control-vs-Treatment
  table conflates two analyses.
- The A/B tracker **sunsets** when the `learn_page` experiment concludes; language
  + engagement-quality are ongoing product-health metrics that must outlive it.

Suggested layout (375 px first): a language strip (adoption, toggle rate,
bounce-back) on top, an engagement-quality block (autoplay success, exit-reason
mix, loop rate) below, and a language split table for the Tier-A engagement
metrics once `language` data is flowing.

---

## 6. Open questions

1. Is the FTI-by-language cut worth surfacing given it isn't randomised, or do we
   cap language analysis at engagement (completion/watch) and leave conversion to
   the experiment? (Affects whether 2b/FTI join is built.)
2. Do we want `initial_language` (2b P1) in the first iteration, or is in-session
   toggle behaviour enough for v1?
3. Retention (Tier C) — is it in scope for this project, or does it belong to a
   cross-feature user-grain pipeline?
