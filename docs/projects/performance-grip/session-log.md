# Performance Grip — session log

Append new dated entries at the top each session.

---

## 2026-05-21 — Phase 0 discovery COMPLETE (Session 3)

**Where the project stands at session end:**

All Phase 0 hard gates and supporting tasks executed via direct NerdGraph
HTTP calls (no GraphiQL UI needed — the API is just a POST to
`api.newrelic.com/graphql`). Fixtures committed; data-sources.md filled in.

| Task | Finding | Status |
|---|---|---|
| 0.1 — Auth | NEW_RELIC_API_KEY in primary `.env`; verified | ✅ |
| 0.2 — App names | `gi_client_static_prod`, `gi_client_web_prod` | ✅ Locked in `APP_CONFIG` |
| 0.3 — Q1 fixture + CA2 | **CA2 confirmed:** `timingName` discriminator IS required. Variant A inflates `sample_count` ~5×. Production query uses `filter()`-wrapped form. Plan Task 2.10 `_nrql_q1` updated. | ✅ Fixture saved (56 facets, 25.8K) |
| 0.4 — Q2 fixture | 75 facets in a 1-hour window | ✅ Fixture saved (10.8K) |
| 0.5 — Q3 fixture + deviceType | **CA3 disconfirmed for this account:** Q3 `deviceType` is 100% populated. Keep `FACET pageUrl, deviceType` as specced. | ✅ Fixture saved (18.7K, 128 facets) |
| 0.6 — Field names | INP populated; `firstByte` confirmed for TTFB; all 5 Web Vitals present | ✅ Documented |
| 0.7 — TIMESERIES | **DECISION: use TIMESERIES.** Works cleanly with FACET; `LIMIT` caps facets only (not facet×bucket). Reduces NRQL call volume by ~24× vs per-hour. | ✅ Fixture saved (5K) |
| 0.8 — Bot filter | `userAgent` IS queryable BUT bot filter matched 0 / 53,315 events. NR Browser pre-filters bots. **Omit WHERE in production.** | ✅ Documented |

**Other findings worth flagging:**

- `pageUrl` is a full absolute URL (`https://www.gripinvest.in/corporate-bonds`) — `clean_url` handles via `urlparse`.
- Percentile response shape: nested `{lcp: {"75": v, "95": v}, ...}` — confirms public docs, parser locks against this.
- Some URLs are Google-Translate proxied (`www-gripinvest-in.translate.goog`) — will collapse to original path after clean_url.
- TTFB values mostly 0.0 in discovery — investigate during dashboard work; may need different field.
- INP values in seconds (0.04, 0.088) — unit conversion to ms needed in parser or display.
- Plan Task 2.10 `_nrql_q1` updated with `filter()` wrappers + canonical app names.

**Plan changes applied during Phase 0:**

- `APP_CONFIG` literals now use `gi_client_static_prod` / `gi_client_web_prod` (not the GUI display names).
- `_nrql_q1` rewritten with `filter(percentile, WHERE timingName)` per metric.

**Pick up next — Phase 1 (Subagent execution can begin):**

Start a new Claude session and say:

> "Resume Performance Grip subagent execution. Plan 1 at
> `docs/projects/performance-grip/plans/2026-05-20-performance-grip-archive-plan.md`.
> Phase 0 complete; all fixtures and data-sources.md committed. Dispatch
> implementer for Task 1.1 (NewRelicClient skeleton)."

The new session will invoke `superpowers:subagent-driven-development` and
work through Phases 1–6 task-by-task with continuous execution. Phase 5.2
secret push (`gh secret set`) and Phase 6 verification will still need you
to be present briefly.

---

## 2026-05-21 — Plan + reviews complete; Phase 0 handoff to user (Session 2 end / Session 3 start)

**Where the project stands at session end:**

Design + plan are fully complete and reviewed:

| Artifact | Status |
|---|---|
| Spec — [`specs/2026-05-20-performance-grip-design.md`](./specs/2026-05-20-performance-grip-design.md) | ✅ Authored, 8-pass reviewed, 7 CRITICALs + most HIGHs + 6 MEDIUMs applied |
| Spec review findings — [`specs/2026-05-20-performance-grip-review-findings.md`](./specs/2026-05-20-performance-grip-review-findings.md) | ✅ Committed; deferred MEDIUMs noted |
| Plan 1 (Archive) — [`plans/2026-05-20-performance-grip-archive-plan.md`](./plans/2026-05-20-performance-grip-archive-plan.md) | ✅ 2,650 lines; 6-pass reviewed; 10 CRITICALs + 15 KISS-survived HIGHs/DAs applied |
| Plan 1 review findings — [`plans/2026-05-20-performance-grip-archive-plan-review-findings.md`](./plans/2026-05-20-performance-grip-archive-plan-review-findings.md) | ✅ Committed; 8 HIGHs skipped with rationale, MEDIUMs deferred to implementation |
| README — [`README.md`](./README.md) | ✅ Up-to-date with hourly grain decision |
| `data-sources.md`, `roadmap.md` | ⏳ Will be created during Phase 0 + Phase 3 execution |
| **Plan 2 (Editorial dashboard)** | ⏳ Will be written after Plan 1 has run for ~7 days (so dashboard work calibrates against real data) |

**Decisions made and locked in:**

- K1: Slack alerts **deferred to v1.5** — added if a real miss occurs in operation
- K2: Raw URLs in CSV — **PII risk accepted** in private repo; mitigations documented
- K3: **Hourly grain** + **twice-daily cron** (01:00 + 13:00 IST)
- Q1: NR alternatives priced and rejected (Data Plus too costly; CrUX unsuitable for post-login)
- CA1: Only **User API Key** works with NerdGraph (Insights Query Keys don't). Auth confirmed against account 4002804 / US region.

**Pick up next — Phase 0 manual NR UI work (HUMAN-ONLY; no subagent can do this):**

Three Phase 0 tasks must complete BEFORE subagent execution can begin at Phase 1:

1. **Task 0.2** — Run `SELECT uniques(appName) FROM PageViewTiming SINCE 1 day AGO` in NR GraphiQL Explorer. Document the two canonical `appName` values in `data-sources.md`. These lock `APP_CONFIG` in plan Task 2.10.
2. **Task 0.3 (HARD GATE)** — Run the Q1 query AND its `timingName`-discriminated variant (CA2 verification). Compare `sample_count` between the two shapes. Save the correct response to `backend/tests/fixtures/new_relic/Q1_pageviewtiming_response.json`. Document the actual percentile response shape verbatim in `data-sources.md`. This locks the parser in plan Task 2.3.
3. **Task 0.7 (HARD GATE)** — Test `TIMESERIES 1 hour` against Q1. Verify response shape and facet-cap behaviour. Default decision is TIMESERIES; only fall back to per-hour queries if facet cap interacts badly. Document the choice in `data-sources.md`.

Other Phase 0 tasks (0.4 Q2 fixture, 0.5 Q3 + deviceType availability, 0.6 INP/TTFB field names, 0.8 bot filtering check) can run in parallel with Phase 1 — they must complete before Task 2.10 ships, but don't block client/parser code.

After committing the three hard-gate outputs, **start a new Claude session** and say something like:

> "Resume Performance Grip subagent execution. Plan 1 archive at
> docs/projects/performance-grip/plans/2026-05-20-performance-grip-archive-plan.md.
> Phase 0 hard gates (0.2, 0.3, 0.7) are complete. Dispatch implementer for Task 1.1."

The new session will invoke `superpowers:subagent-driven-development` and dispatch fresh implementer + spec-reviewer + code-quality-reviewer subagents per task, following the plan task-by-task with continuous execution.

**Commit history on `performance-grip-design` branch:**

```
docs(performance-grip): apply 15 KISS-survived HIGH/DA findings
docs(performance-grip): apply all 10 CRITICAL plan-review findings
docs(performance-grip): triage findings from 6-pass plan review
docs(performance-grip): implementation plan 1 — archive (backend + cron)
docs(performance-grip): apply remaining HIGHs + high-value MEDIUMs
docs(performance-grip): apply dashboard HIGH findings (H12, H13, H18, H19)
docs(performance-grip): apply CRITICAL findings + K3 hourly grain
docs(performance-grip): triage findings from 8-pass parallel review
docs(performance-grip): brainstormed v1 design spec + project README
```

**Local environment state:**

- `backend/.env` contains a working `NEW_RELIC_API_KEY` (User API Key, already auth-tested against NerdGraph).
- `NEW_RELIC_ACCOUNT_ID=4002804`, `NEW_RELIC_REGION=US`.
- Worktree: `.claude/worktrees/performance-grip-design` on branch `performance-grip-design` (off `origin/main`).
- No code committed yet — only docs (spec, plan, review findings, README, this session log).
