# Performance Grip — design spec review findings

**Date:** 2026-05-20
**Spec reviewed:** [`2026-05-20-performance-grip-design.md`](./2026-05-20-performance-grip-design.md)
**Review passes:** 8 in parallel — backend-architect, frontend-architect, devops-architect, security-engineer, technical-writer, requirements-analyst, ui-ux-pro-max multi-pass (7 sub-passes), devil's-advocate.
**Total findings:** ~100, of which **7 CRITICAL** and **~30 HIGH**.

This document presents findings for triage. **Nothing has been changed in the spec yet** — fixes will be applied after triage decisions.

---

## 1. CRITICAL findings (must address before writing the implementation plan)

| ID | Theme | Finding | Suggested fix | Reviewers |
|----|-------|---------|---------------|-----------|
| **C1** | NRQL parsing | `percentile(field, 75, 95)` in NerdGraph returns **nested objects** (e.g. `result.lcp["75"]`), not flat aliased columns. The spec's §4.2 claim of "aliased sub-fields `lcp.75`/`lcp.95`" will cause a `KeyError` on day 1 unless the parser knows the actual JSON shape. | Capture a real NerdGraph response fixture **before** writing the fetch code. Either split into per-percentile calls (10 queries, still cheap) or document the actual nested-dict unpacking. | backend-architect (H confidence) |
| **C2** | NRQL silent truncation | `FACET pageUrl, deviceType LIMIT MAX` caps at **2,000 facet combinations** per query in NerdGraph. A busy day on `gi-client-web` with hundreds of asset URLs × devices will silently drop the long tail with no error. The empty-result detection in §7 won't catch it. | Probe `uniqueCount(pageUrl)` first; alert if response facet count == 2000. Or cap to `LIMIT 500` and reject responses that hit the cap. | backend-architect (M) |
| **C3** | Idempotency race | The merge in §4.4 is **not atomic across runs**. A concurrent `workflow_dispatch` overlap with the daily cron will race-condition: last writer wins on CSV, last pusher wins on git. The spec's idempotency story assumes serialised runs. | Add `concurrency: { group: refresh-performance-grip, cancel-in-progress: false }` to the workflow. Document that manual backfills wait for the daily run to clear. | backend-architect (H), devops-architect (H), security-engineer (M) |
| **C4** | **PII in URLs committed to git** | NR Browser captures raw `pageUrl`. On a logged-in investing platform, this routinely includes paths with `userId`, `orderId`, `kycId`, embedded in dynamic-route segments (e.g. `/profile/207871`, `/order/abc123`). §4.6 only strips query strings — path segments are preserved. Once committed, git makes this **immutable** (BFG/filter-repo needed). Under DPDPA (India) this is identifiable data. | **Apply route_patterns.csv collapsing AT FETCH time**, not in the UI, for any pattern with an ID-bearing segment. Store the pattern label (`/assets/[id]`) in `page_url`. Hash or drop URLs that don't match a known pattern. **This inverts a decision in §12.** | security-engineer (H), with ui-ux trade-off noted |
| **C5** | Visual overload on charts | The `MetricTrendCard` is specced with **5 simultaneous visual layers**: threshold bands (3 zones) + week-boundary gridlines + horizontal axis gridlines + p75→p95 spread band + p75 line. On a 120px-tall mobile card the trend line gets ~5px of vertical room per zone. Bands will dominate over the data. | Cut to 3 layers: keep p75 line (neutral ink) + spread band (neutral wash) + threshold bands (semantic color, calibrated opacity). Drop horizontal gridlines (threshold bands are the y-context). Make week boundaries dotted at 12% or drop entirely. | ui-ux-pro-max (CRIT), frontend-architect (HIGH) |
| **C6** | Dashboard "30-second test" fails | The dashboard shows 5 trendlines + 2 ungrounded deltas with no top-line verdict. Leadership opening this on a Monday morning has no anchor — they must read the page to form a judgment, which is the engineer's job, not the leader's. The spec explicitly rejected (§12) a status badge, on grounds of "duplicating the chart's signal" — but duplication for the audience is the **feature**. | Add a **rule-based status verdict** at the top of the page: one of `All Good / Watch / Needs Attention`, derived deterministically from CWV threshold status, with a one-sentence "why" ("INP on mobile crossed 200ms threshold for 3 of last 7 days"). Not editorial prose; not causal. Just a verdict. | requirements-analyst (CRIT), ui-ux-pro-max, frontend-architect |
| **C7** | Weekly cadence mismatch | The dashboard is daily-grained but reviewed weekly. The hero "↓ 0.12s" delta has no defined comparison window — yesterday? Last week? 7d trailing avg? Spec doesn't say. For a weekly review, the only useful comparison is **this week (7d) vs last week (7d)**. | Lock delta semantics explicitly: `p75 LCP this week (7d) vs last week (7d): 2.40s → 2.52s (+0.12s, ↑5%)`. Reframe hero as "Week of May 12–18" (ISO week), not trailing 7d. Make week boundaries solid lines, not 10% gridlines. | requirements-analyst (HIGH) |

---

## 2. HIGH findings (should address before writing the plan)

Grouped by theme.

### 2.1 — Cron reliability

| ID | Finding | Suggested fix | Reviewers |
|----|---------|---------------|-----------|
| H1 | GitHub Actions cron drifts 5-30 min and can silently skip runs under platform load. For an 8-day retention window where silent miss = permanent loss, **single cron is the wrong infrastructure choice** (per the spec's own §1 framing). | Add a **second daily run** (12:15 IST, 12 hours later) — idempotent merge dedups. One YAML line, halves the missed-day probability. | devops-architect, devil's-advocate |
| H2 | **Slack alerts are mis-deferred.** Spec admits 8+ days of failure = permanent data loss. All three detection layers (GH email, dashboard timestamp, empty-result detection) are async or require deliberate inspection. A Slack webhook step is 4-6 lines of YAML and the only synchronous channel. "Matches the FRA/Grip Connect pattern" doesn't apply when Performance Grip has a strictly different data-loss profile. | Add Slack-on-failure step. Strike "No Slack alerts" from §2 non-negotiables. This contradicts your earlier "no slack" instruction — surfacing for your call. | devil's-advocate (B), devops-architect (M) |
| H3 | `workflow_dispatch.inputs.since` is user-input flowing into the workflow. If interpolated into `run:` as `${{ inputs.since }}`, it's a shell-injection vector. Even via env, a malformed date (`2026-13-99`, future date, empty string) can corrupt the merge. | Never interpolate `${{ inputs.since }}` into `run:` — pass via `env:` and validate in Python with `^\d{4}-\d{2}-\d{2}$`, reject future dates and dates >8d old. Exit non-zero on parse failure before any fetch. | devops-architect (H), security-engineer (M) |
| H4 | Empty-result detection is too coarse. Low-traffic Sunday on Static or single-app outage will fail the entire run and refuse to write the good app's data. | Scope all-or-nothing to **`(app, date)`**, not `(run, date)`. Per-app idempotent write. Treat `JavaScriptError == 0` as expected; only Q1/Q2 zeroes are failures. | devops-architect (H), backend-architect (M) |
| H5 | Workflow lacks `timeout-minutes` (default 6 hours). A hung NRQL call burns runner quota and delays next day's run. | Add `timeout-minutes: 15` on the job. | devops-architect (H) |

### 2.2 — Security & supply chain

| ID | Finding | Suggested fix | Reviewers |
|----|---------|---------------|-----------|
| H6 | NR **User API Key** is over-scoped for read-only NRQL. It inherits the user's full UI permissions across NerdGraph (dashboards, alerts, infrastructure, mutations). | Use an **Insights Query Key** (account-scoped, query-only). NerdGraph accepts it for `nrql()` reads via `Api-Key` header. Or create a dedicated service-account user with read-only custom role. Document chosen key type in §5.4. | security-engineer (H) |
| H7 | Workflow actions (`actions/checkout@v4`, `actions/setup-python@v5`) are floating major tags — re-tagable by upstream / repo compromise. `requirements.txt` pins versions but **not hashes**, and `httpx<0.28` is an open range. | Pin actions to commit SHAs (`actions/checkout@<sha>  # v4.1.7`); switch to `pip install -r requirements.txt --require-hashes` with a generated `requirements.lock`. Add Dependabot config for `pip` and `github-actions`. | security-engineer (H) |
| H8 | The workflow pushes directly to `main` with `contents: write` and no branch protection visible. | Add `if: github.ref == 'refs/heads/main'` to the commit step. Verify branch protection forbids force-push and the bot can only push the daily refresh. Workflow-level `permissions: { contents: write }` already done — verify repo defaults are `read`. | security-engineer (H) |

### 2.3 — Data integrity

| ID | Finding | Suggested fix | Reviewers |
|----|---------|---------------|-----------|
| H9 | Null `pageUrl` / empty `deviceType` rows are unhandled. NR emits these for redirects, prerender, or older agent versions. They'll either collapse to a single bucket or produce `None` keys that break the PK. | Add `WHERE pageUrl IS NOT NULL AND deviceType IS NOT NULL` to all three queries; log the dropped-row count in run output. | backend-architect (H) |
| H10 | Schema has **no `sample_count`** per percentile, but §6.2 tooltip claims to show it. Without it you can't detect low-volume noise on the p95 line (page with 3 views/day → meaningless p95). | Add `sample_count` column (from `count(*)` on `PageViewTiming`); surface in tooltip; filter low-sample rows from trendlines. | backend-architect (H) |
| H11 | Backfill loop crashes mid-`--since` leave a mix of new and old rows. | Either stage writes to a temp CSV across the whole backfill window and swap atomically at end, or commit-per-day so each day is independently consistent and resumable. | backend-architect (M) |

### 2.4 — Dashboard structure & UX

| ID | Finding | Suggested fix | Reviewers |
|----|---------|---------------|-----------|
| H12 | Route drill-down is buried below 5 trendlines + 2 supporting cards. "Which route regressed?" is the **single most leadership-actionable artifact** in the design and the one thing NR can't answer (their data has aged out). | Promote route drill-down **above** the metric grid. Sort default by **WoW p75 LCP regression** descending. Default Top **5** expanded (not 15). Page-view sort as a toggle. | requirements-analyst, frontend-architect |
| H13 | "JS errors" stored but never displayed. Free leadership-readable signal sitting in the data layer. | Either add a 6th small card "JS errors / 1K page views" in Supporting, or fold into hero verdict ("errors up 3× this week"). | requirements-analyst |
| H14 | Threshold-band colors specced as raw "green/amber/red" — repo's Editorial palette is rust/forest/gold tokens. 5% opacity green on cream paper (#f2ebdb) is barely 1-2% luminance delta — invisible on a projector. | Bind to Editorial tokens: `good = var(--ed-forest)`, `needs-improvement = var(--ed-gold)`, `poor = var(--ed-rust)`. Test 5/8/10/12% opacities on cream paper at projector resolution. Likely target 8-10%. | ui-ux-pro-max (HIGH ×2) |
| H15 | Sticky header (app switcher + device toggle + last-data + cold-start banner) eats ~120px / 18% of mobile viewport at scroll-top. Combined with 5 stacked metric cards, the route drill-down is multiple screens below the fold on mobile. | Sticky header collapses to ~48px strip after scrolling past the hero (IntersectionObserver). On mobile, hoist LCP+INP into the hero; put CLS+FCP+TTFB behind an accordion. | ui-ux-pro-max (HIGH ×2), frontend-architect |
| H16 | Y-axis "auto-scaled with ~20% headroom" + absolute threshold bands fight each other. If LCP p75 is always ~2.3s, the chart zooms tight and the 2.5s "good→amber" boundary sits 80% up — visually screaming "near the cliff" when comfortably in Good. | Pick one: either **fixed Y-axis at threshold scale** (always show 0 → 1.5×amber-boundary, threshold positions stable across the week) — better for leadership comprehension. Or drop bands and use auto-scale. The current "both" produces misleading shapes. | frontend-architect (HIGH) |
| H17 | App switcher (navigation) and device toggle (filter) presented at visually the same level — users will think they're the same kind of control. | Visually differentiate: app switcher as primary nav (underline tabs); device toggle as filter chip (rounded pill, smaller, secondary). | ui-ux-pro-max (MED) |
| H18 | Cold-start handling is a banner above 5 mostly-empty trendlines — apologises for them rather than addressing the period properly. | Replace with a **first-class cold-start view** for 1-20 day window: explainer + current-day readings table, no trendlines. Trendlines at day 8+. WoW comparisons at day 15+. Three explicit phases, each its own layout. | requirements-analyst (MED) |
| H19 | The "Other pages" bucket is a half-measure: too engineering-y for leadership, but contains real signal. | Either elevate "Other pages share" to the status verdict ("32% of traffic uncategorised — patterns file stale"), or drop from the leadership view entirely and surface in an admin pane. | requirements-analyst (MED) |
| H20 | No PDF/print-stylesheet means the dashboard's delivery channel becomes laptop-screenshots-pasted-into-Slack. Not leadership-grade for weekly review. | Add `?print=1` route or print stylesheet that hides nav chrome and produces one A4-portrait page. ~2 hours of work; unlocks the actual delivery channel. PDF/CSV can wait. | requirements-analyst (MED) |

### 2.5 — Strategic / framing

| ID | Finding | Suggested fix | Reviewers |
|----|---------|---------------|-----------|
| H21 | **NR Data Plus / equivalent longer-retention SKU has not been priced.** The entire project's premise rests on this. If it's <$200/month delta, build vs buy probably flips. | Add §1.1 "Alternatives priced": (a) NR Data Plus monthly cost for this account tier, (b) what CrUX/Search Console covers for `gi-client-static` for free, (c) Cloudflare RUM if either site fronted by CF. Decide before implementation. | devil's-advocate (top finding) |
| H22 | "Demonstrating attention" framing makes question 1 ("should we build this?") harder to refute. | Reframe §1 lead with operational outcome: "(a) trends survive NR's 8-day retention, (b) single weekly artefact anchors leadership review and catches regressions before they compound." Keep "demonstrating attention" as a secondary framing. | devil's-advocate |
| H23 | Hourly granularity is a one-way door. Storing daily aggregates throws away time-of-day patterns (peak-hour LCP degradation) forever. Cost of hourly is ~24× rows = still trivial for DuckDB. | Consider: store **hourly**, aggregate to **daily** for dashboard. PK becomes `(date, hour, app, page_url, device)`. Preserves optionality the same way raw-URL grain does. | devil's-advocate |

### 2.6 — Spec writing quality

| ID | Finding | Suggested fix | Reviewer |
|----|---------|---------------|----------|
| H24 | "5 metrics" vs "7 metrics" ambiguity between §2 (lists 7 incl. page-views + JS errors) and §6.1 (shows 5 trendline cards). Page views and JS errors are stored but never trended. | Separate in §2: "5 trended Web Vitals + supporting context (page views, JS errors)". Add JS-error sparkline (H13) to resolve. | technical-writer |
| H25 | "Supporting metrics" used in two senses — Google's sub-group (FCP/TTFB) and broader "supporting context" (page views, JS errors). | Rename §6.1 lower group to "Page-load timing (FCP, TTFB)" or "Secondary Web Vitals". Reserve "supporting metrics" for the broader sense. | technical-writer |
| H26 | Decisions log (§12) **missing entries** for: IST day boundary, URL casing rule, 30-day window default, tablet folded into "All", top-15 routes cutoff. | Add log entries for each. | technical-writer |
| H27 | Two duplicate discovery checklists: §4.7 (5 items) and §10 (6 items), overlapping but not identical. | Delete §4.7, forward-ref §10. Or rename §4.7 "Data-layer unknowns" / §10 "Cross-cutting unknowns", state the split. | technical-writer |

---

## 3. MEDIUM findings (resolve in implementation, not blocking)

| ID | Theme | Finding | Reviewer |
|----|-------|---------|----------|
| M1 | Backend | `cls_p75 FLOAT` mixed with `lcp_p75_ms INT` may break DuckDB strict typing on nulls. Declare percentile columns as DOUBLE. | backend-architect |
| M2 | Backend | `WITH TIMEZONE 'Asia/Kolkata'` + literal timestamps is ambiguous in NRQL. Use relative form (`SINCE 1 day AGO`). | backend-architect |
| M3 | Backend | `js_errors` joined on `device` — `JavaScriptError` may not carry `deviceType` reliably. Need discovery probe; consider nullable js_errors. | backend-architect |
| M4 | Backend | Unit test #1 ("parse NerdGraph response") is the only guard against C1. Block implementation on capturing real fixture first. | backend-architect |
| M5 | Frontend | Click-row-to-expand sparkline only shows LCP. Either show all 5 sparklines, or make selection follow whichever metric card was clicked. | frontend-architect (LOW) |
| M6 | Frontend | "Other pages" row WoW delta currently not shown — show it (signals patterns-file staleness). | frontend-architect |
| M7 | Frontend | Cold-start logic misses (a) new routes mid-archive (short sparkline embedded in 30-day chart), (b) cron-gap days (MIN(date) still shows old). | frontend-architect |
| M8 | DevOps | `NEW_RELIC_REGION` (public) should be `env:` literal; `NEW_RELIC_ACCOUNT_ID` should be a repo *variable*, not secret. | devops-architect |
| M9 | DevOps | Stagger of 15 min was justified by "Render cold-start collision" — but the daily refresh doesn't call Render. Strike the rationale. | devops-architect |
| M10 | DevOps | Retry backoff `1s, 4s, 16s` has no jitter. Add ±25%, cap at 30s. | devops-architect |
| M11 | Security | Log scrubbing — `httpx` exceptions can include headers in repr. Ensure `Api-Key` never logs. | security-engineer |
| M12 | Security | Key rotation cadence undocumented. Add to §5.4: rotate every 90 days. | security-engineer |
| M13 | Security | JS error event content guardrail — future engineer might extend Q3 to `message`/`stackTrace`/`customAttributes`. Add §4.2 comment forbidding this without re-review. | security-engineer |
| M14 | Tech writing | §1 "load-bearing failure-loudness" vs §5.3 "no novel infrastructure" reads as contradictory; resolution buried. Soften §1 or lead §5.3 with reconciliation. | technical-writer |
| M15 | Tech writing | §3 architecture prose redundant with the file tree. Drop or collapse. | technical-writer |
| M16 | Tech writing | §4.2 NRQL ellipsis ambiguous (Q1 concrete, Q2/Q3 placeholder). Either fully concretise or annotate "same window as Q1". | technical-writer |
| M17 | Tech writing | §4.6 URL casing rule has fuzzy reconsideration trigger. Specify alternative outcome explicitly. | technical-writer |
| M18 | Tech writing | §6.1 ASCII diagram places device toggle in "This Week" box but §6.5 places it in hero header. Reconcile. | technical-writer |
| M19 | Tech writing | §6.4 "top 15" ambiguous — is ranking by pattern or by URL? Make explicit: rows are *patterns*, ranking is sum across matching URLs. | technical-writer |
| M20 | UI/UX | `▾` Unicode glyph for expand affordance is character-as-icon. Replace with Lucide `ChevronDown` SVG. Audit existing `▲▼` delta arrows too. | ui-ux-pro-max |
| M21 | UI/UX | Recharts default `Area` animation morphs SVG path (CPU). On device-toggle re-render, 5 charts × spread bands = visible jank. Set `isAnimationActive={false}` after initial mount; enable only for 300ms one-shot on toggle. | ui-ux-pro-max |
| M22 | UI/UX | iOS Safari address-bar collapse causes sticky header to jump 60px. Use `top: env(safe-area-inset-top)` not `top: 0`; `min-h-dvh` (already in user memory). | ui-ux-pro-max |
| M23 | UI/UX | Unit-suffix width (`s` vs `ms`) — tabular numerals don't fix this. When values cross 1000ms → 1.0s the column shifts. Pick one unit per metric. | ui-ux-pro-max |
| M24 | UI/UX | Device toggle default should be **Mobile**, not All — Grip Invest is a mostly-mobile Indian fintech audience. | requirements-analyst |
| M25 | UI/UX | Date-range radio `[ 30d \| 90d ]` adds quarterly-review capability for one extra UI state. Picker stays deferred. | requirements-analyst |
| M26 | Cross-app | Cross-app side-by-side status summary in hero (not chart, just status pill per app) is leadership's natural first question. Move from v2 to v1.5. | requirements-analyst |
| M27 | Style | Existing Editorial dashboards use a "Grip Weekly" masthead with VOL/NO/dateline. Performance Grip's header is just a control bar. Decide: full broadsheet ("Grip Weekly. on Performance") or "Editorial Lite". Document. | ui-ux-pro-max |
| M28 | Style | Existing Editorial system applies `--ed-grain` SVG paper-noise overlay. On chart surfaces this degrades band-vs-data contrast. Disable on chart wrappers. | ui-ux-pro-max |

---

## 4. Cross-cutting conflicts between reviews

These are places where reviewers explicitly **disagree** — your call which way to go.

| Conflict | Position A | Position B | Notes |
|---|---|---|---|
| **Threshold bands** | Devil's-advocate, requirements-analyst, frontend-architect: drop bands, use status pill / verdict | UI/UX pro-max: keep bands but calibrate opacity + bind to Editorial tokens + drop other layers | Both agree the chart has too many layers. Disagreement is whether bands provide continuous information worth keeping (UI/UX) or are noise that a discrete pill replaces (others). |
| **Raw URLs vs patterns at fetch** | Security-engineer: **CRITICAL PII risk** — collapse to patterns at fetch | §12 decisions log + backend-architect implicit: store raw, group at UI | Stark conflict. Security's concern is legitimate (DPDPA, git-immutability). Original decision was about retroactive grouping — once collapsed, can't ungroup. The middle path is "collapse known ID-bearing patterns at fetch, keep raw for safe paths". |
| **Slack alerts** | Devil's-advocate, devops-architect: ADD them — the spec's own data-loss profile demands it | Original user instruction (your most recent): no Slack alerts, match pattern | Your explicit "no Slack" instruction was given before these reviews. Surfacing this for you to re-decide. Cost is 4-6 lines of YAML. |
| **Daily vs hourly** | Devil's-advocate: hourly preserves time-of-day patterns; one-way door | Backend-architect implicit + spec §4.3: daily is fine | Hourly is ~24× rows but still trivial. Mirrors the "store raw" argument from §12. |
| **Mobile-first at 375px** | Devil's-advocate: this is an internal leadership tool, mobile use is theoretical | CLAUDE.md mandate + ui-ux-pro-max: mobile-first is the discipline | Devil's-advocate notes the right answer is "keep mobile-first as starting point, but explicitly desk-check at 1280/1920". |

---

## 5. Strategic questions surfaced

Three questions the spec **hasn't answered** and arguably must answer before implementation:

1. **What does NR Data Plus actually cost?** If <$200/month uplift, build-vs-buy may flip. Spec assumes "build" without writing this down. (H21)
2. **What's the recovery posture for a missed cron day?** Spec lists three detection layers and admits data loss is the failure mode but doesn't specify whether a missed day is acceptable or a SEV-2. Connects to H1 (second cron run) and H2 (Slack). (devil's-advocate)
3. **Who exactly looks at this dashboard, when, and what do they do with it?** "Leadership" is vague. Dashboard IA changes meaningfully between "CEO 15-second Monday glance" and "Head-of-Eng 10-minute Tuesday review". Spec's §6 currently aims at the latter. (devil's-advocate)

---

## 6. Recommendation

**Before invoking writing-plans (the brainstorming-skill terminal step), I recommend triaging this list in three buckets:**

- **A — Must fix in spec now** (CRITICAL findings + chosen HIGH findings): apply spec edits, re-commit.
- **B — Resolve in implementation, capture in `docs/projects/performance-grip/roadmap.md`** as discovery items.
- **C — Decline / defer with rationale**, noted in §12 decisions log so future readers see them considered.

The CRITICAL findings (C1-C7) plus the **3 strategic questions** in §5 are the minimum to address before the implementation plan is written. The rest can be triaged at your discretion.
