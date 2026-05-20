# Performance Grip — Plan 1 (Archive) review findings

**Date:** 2026-05-20
**Plan reviewed:** [`2026-05-20-performance-grip-archive-plan.md`](./2026-05-20-performance-grip-archive-plan.md)
**Review passes:** 6 in parallel — python-expert, NR/NRQL correctness (general-purpose with web docs), devops-architect, quality-engineer (test design), technical-writer, devil's-advocate.
**Total findings:** ~80, of which **10 CRITICAL** and **~20 HIGH**.

The plan has real bugs that would have caused the implementation to fail at runtime or silently corrupt data. This is **substantially heavier than the spec review** — design held up, but the translation to code in the plan has issues.

---

## 1. CRITICAL findings — must fix before execution

### Group A — NR API correctness (3 findings, would silently corrupt the archive)

| ID | Finding | Fix |
|----|---------|-----|
| **CA1** | **Insights Query Key does NOT work with NerdGraph.** Query Keys authenticate the legacy Insights Query API (`insights-api.newrelic.com`), not NerdGraph. Sending a Query Key to `api.newrelic.com/graphql` returns 401. The spec/plan's "preferred path: Insights Query Key" will fail auth on Task 6.1's first run. NR docs explicitly require a **User API Key** for NerdGraph. | Drop Query Key preference entirely. Use a User API Key tied to a dedicated service-account user with a read-only NerdGraph custom role. Update spec §5.4, plan Task 0.1, Task 2.10 CLI wiring, workflow env, and the `roadmap.md` references. |
| **CA2** | **`PageViewTiming` event uses a `timingName` discriminator** — each event carries ONE timing value (LCP, INP, CLS, FCP, or TTFB). Querying all 5 metrics in one `SELECT percentile(largestContentfulPaint, 75, 95), percentile(interactionToNextPaint, 75, 95), ...` returns *something* (percentile() skips nulls) but `count(*) AS sample_count` becomes the SUM of all timing-event types — ~5× the real LCP sample count. Sample-size context is wrong. May also return mostly-null values for some metrics. | Use 5 separate `filter(percentile(field, 75, 95), WHERE timingName='field') AS metric` aggregates in one SELECT, plus `filter(count(*), WHERE timingName='largestContentfulPaint') AS sample_count`. Document in Phase 0 discovery; lock parser. |
| **CA3** | **`JavaScriptError` events don't reliably carry `deviceType`.** Q3's `FACET pageUrl, deviceType` will drop most error rows (NR returns `deviceType: null` or omits the facet). Merge join on `(page_url, device)` then yields ~zero js_errors. The plan's `merge_rows` "*" fallback in Task 2.5 is asymmetric and may not trigger correctly. | Drop `deviceType` from Q3's FACET. Q3 stores at `(page_url)` grain only; `merge_rows` broadcasts to both devices (or sums). Update Task 2.4 parser, Task 2.5 merge, Task 2.10 NRQL builder. Phase 0 task 0.5 measures real availability and locks the choice. |

### Group B — Plan correctness (4 findings, runtime path bugs)

| ID | Finding | Fix |
|----|---------|-----|
| **CB1** | **Hyphen vs underscore data dir mismatch.** Existing projects use underscore (`backend/data/asset_search/`); `refresh.py` resolves `data_dir = ./data/{project_id}` with `project_id="performance_grip"` (underscore). But the plan writes everything to `backend/data/performance-grip/` (hyphen). The CSV will land where neither the workflow's `git add` nor the existing refresh runner expect it. | Pick underscore (`performance_grip/`) consistently — matches the existing convention. Update Task 3.1, 3.2, 5.1 workflow, Task 2.10 step 7 `data_dir`, all docs path references. |
| **CB2** | **CLI block insertion bug in `refresh.py`.** Task 2.10 step 7 inserts a `performance_grip`-specific block "before the existing Metabase client setup" — but `main()` unconditionally runs Metabase setup THEN dispatches via `run_refresh()`. The inserted block early-returns, bypassing the REGISTRY (which Step 6 just registered). So the REGISTRY entry becomes dead code and the engineer has two conflicting code paths. | Refactor `main()`: dispatch on `project_id` BEFORE client setup. Use a small `CLIENT_FACTORIES` dict, or accept `since` as a third REGISTRY arg, or branch the client selection cleanly. Show the actual diff, not "insert" instruction. |
| **CB3** | **`<REPLACE-WITH-SHA>` placeholder pattern.** Task 5.1 step 3 uses `actions/checkout@<REPLACE-WITH-SHA>` as a placeholder. Step 4 validates with `yaml.safe_load` — this PASSES (it's a valid string). But GitHub Actions parsing will FAIL with "could not resolve action" — at the actual run, not at commit time. False validation confidence. | Replace Step 4 with: `grep -q '<REPLACE-WITH-SHA>' .github/workflows/refresh-performance-grip.yml && { echo "unresolved SHA placeholder"; exit 1; }`. Or write SHA via `sed` substitution in Step 3 so unresolved placeholders never land. |
| **CB4** | **`gh api repos/.../git/ref/tags/v4.1.7` returns the tag-object SHA, not the commit SHA.** For annotated tags this is two different SHAs. Pinning to the tag-object SHA gives the runner an unresolvable ref. | Use `gh api repos/actions/checkout/commits/v4.1.7 --jq '.sha'` — always returns the commit. Document the gotcha. |

### Group C — Test design (2 findings, tests pass with broken code)

| ID | Finding | Fix |
|----|---------|-----|
| **CC1** | **Task 1.3 retry test passes with NO retry implementation.** The test patches `time.sleep` to a no-op and only asserts `call_count == 3`. An implementation that loops forever, or one with no retry at all (just three calls in a row), or one with wrong backoff intervals — all pass. The test isn't actually testing the retry logic. | Capture `time.sleep` calls; assert `call_count_of_sleep == 3` AND sleep durations approximate `[1, 4, 16]` within ±25% jitter. Document the schedule as part of the contract. |
| **CC2** | **Task 2.3 parser test only checks key presence, not value-presence.** A parser that returns `[{"page_url": "/a", "device": "mobile", "lcp_p75": None, ...all None...}]` passes the fixture test. Combined with the synthetic-test assuming the nested `{"75": v}` shape, a parser hand-coded to the wrong shape will produce all-None rows and the fixture test still passes. | Add value-presence assertions on the real-fixture test: `assert any(r["lcp_p75"] is not None for r in rows)`. Also: inspect the real fixture FIRST, write the assertion against what's actually there, THEN write the synthetic test (reverses the plan's order — prevents parser-shape drift). |

### Group D — CI/cron correctness (1 finding)

| ID | Finding | Fix |
|----|---------|-----|
| **CD1** | **`git pull --rebase && git push` races with sibling workflows.** Concurrency lock prevents two Performance Grip runs racing each other, but `refresh-asset-search`, `refresh-grip-connect`, `refresh-fra-youtube`, and human commits all push to `main` independently. With twice-daily cron + 3 sibling workflows + Dependabot PRs, push collisions will happen. The single `pull --rebase + push` will reject. | Wrap push in retry loop: `for i in 1 2 3; do git pull --rebase && git push && break || sleep $((i*10)); done`. Don't unify cross-workflow concurrency (would serialize unrelated work). |

---

## 2. HIGH findings — strong recommendation, should fix

### 2.1 — Code correctness

| ID | Task | Finding | Fix |
|----|------|---------|-----|
| H1 | 1.2 | `nrql()` doesn't check GraphQL `errors` envelope. HTTP 200 with `{"errors": [...]}` blindly indexes `nrql.results` → confusing KeyError | After `body = response.json()`, check `if body.get("errors")` and raise `NewRelicError("NRQL failed: ...")`. Also handle `nrql is None`. |
| H2 | 1.3 | Retry loop only catches `httpx.HTTPStatusError` — `ConnectError`, `ReadTimeout`, `RequestError` (common on cron networks) bubble immediately | Catch `httpx.HTTPStatusError` AND `httpx.RequestError`; treat the latter as always-retryable up to the loop limit |
| H3 | 1.3 | `httpx.Client(timeout=30.0)` constructed inside `nrql()` each call — defeats keep-alive. For 96 calls per run, every one pays TCP+TLS handshake | Construct `httpx.Client` in `__init__`, store on `self._client`. Accept injection for tests (mirror `MetabaseClient`). Tests can patch the instance, not module-global. |
| H4 | 1.4 | `_safe_message` defined but never called — dead code. Regression test passes trivially (httpx doesn't leak headers by default) | Wire `_safe_message` into the exception re-raise path, OR delete it. If kept, test must construct an error string containing `Api-Key: secret` and assert redaction. |
| H5 | 2.10 | `f"WHERE appName = '{nr_app}'"` is NRQL injection vector (apostrophe in app name → malformed query). Same for `_nrql_q2`, `_nrql_q3`, `_nrql_probe` | Escape single quotes (`.replace("'", "\\'")`) AND validate app names against regex `^[A-Za-z0-9 \-_./]+$` at config load. |
| H6 | 2.3/2.4 | Q1 + Q2 parsers don't guard `entry["facet"][1]` for length — Q3 does. IndexError if NR returns single-element facet | Add `len(facet) > 1 and facet[1]` guard, matching Q3's pattern |
| H7 | 2.5 | `merge_rows` Q3 fallback asymmetric: `q3_idx.get(key, q3_idx.get((url, "*"), 0))` — if `(url, "mobile")` exists with value 0, "*" fallback not triggered even when it has data | Either sum both buckets (`q3_idx.get(key, 0) + q3_idx.get((url, "*"), 0)`), or pick one strategy at fetch time per Phase 0 device-availability finding |
| H8 | 2.10 | `MockClient.nrql` routes on substring match — `"PageView" in query` matches both Q1 AND Q2. Order-fragile | Route on distinct substrings: `"FROM PageViewTiming"`, `"FROM PageView "`, `"uniqueCount("` |
| H9 | 1.2 | GraphQL wrapper doesn't request `metadata { facets messages timeWindow }` — can't distinguish "no traffic" from "NR error in messages" | Extend wrapper to include `metadata`; runner checks `metadata.messages` for non-empty before treating empty `results` as data |

### 2.2 — NRQL correctness

| ID | Finding | Fix |
|----|---------|-----|
| H10 | NerdGraph's `LIMIT MAX` is **5000** (as of 2024), not 2000. Plan's `LIMIT 500` actively caps at 500 facets — well below real cardinality. Probe thresholds at 1900/2000 are wrong | Either change `LIMIT 500` to `LIMIT MAX` (5000) with probe thresholds 4500/5000, or keep `LIMIT 500` with probe threshold 450. Adjust C2 probe to consider device multiplier (uniqueCount × ~2 for device split) |
| H11 | `TIMESERIES 1 hour` returns one row per `(facet × bucket)` — different shape from per-hour queries. Parser path in Task 2.3 only handles per-hour shape. If Task 0.7 picks TIMESERIES, parser needs different code path | Lock the bucketing choice BEFORE Task 2.3 writes the parser. If TIMESERIES wins, parser extracts `beginTimeSeconds` per row. Add second test fixture. Per devil's-advocate finding: bias toward TIMESERIES. |
| H12 | `firstByte` is a `timingName` value, not a top-level attribute on most account schemas — same issue as CA2 | Same fix: per-metric `filter()` with `WHERE timingName='firstByte'` |

### 2.3 — CI/cron + supply chain

| ID | Finding | Fix |
|----|---------|-----|
| H13 | Workflow lacks `Notify on failure` step that `refresh-asset-search.yml` already has. GH email-only is inadequate for the data-loss profile (despite K1 deferral) | Copy the existing `Notify on failure` step verbatim. `::error::` annotation is free; Slack curl is gated on `SLACK_WEBHOOK_URL` (stays disabled until configured per K1) |
| H14 | `pip install --require-hashes` rejects the install if any package lacks hash entry — including `pip`, `setuptools`, `wheel` if not in lock. Also rejects `-e .` editable installs | Pin pip/setuptools/wheel via `--allow-unsafe` in `pip-compile`. Document no-editable-installs constraint. |
| H15 | Dependabot config in Task 4.3 doesn't natively support `pip-compile` lock files. Default pip updater operates on `requirements.txt`, not `.lock` | Either (a) keep `requirements.txt` AND `requirements.lock` (lock-only updates as a follow-up), (b) use `versioning-strategy: lockfile-only`, or (c) document that lock regeneration is manual until Dependabot supports it |
| H16 | `requirements.in` template in Task 4.2 is "illustrative" — missing real deps: `anthropic==0.34.0`, `python-multipart`, `uvicorn[standard]`, and crucially **`httpx<0.28`** (anthropic 0.34 incompat note in current requirements.txt) | Replace illustrative list with actual top-level deps from existing `requirements.txt`, preserving constraints |
| H17 | `concurrency.cancel-in-progress: false` only queues ONE pending run — third trigger is silently discarded | Document the 1-in-queue cap. Note that idempotent merge makes 3rd-trigger drop safe (it'll be picked up by next scheduled run). |
| H18 | `if: github.ref == 'refs/heads/main'` on commit step skips commit when triggered from a non-main branch via workflow_dispatch — but the NRQL calls still run and burn quota. Confusing | Gate the entire job: `jobs.refresh.if: github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'`. Or restrict workflow_dispatch via repo settings. |
| H19 | Task 4.2 step 3 verifies install via fresh `python3.12 -m venv` — but worktree memory notes worktrees lack `python3.12` (system is py3.14 which can't install duckdb 1.1.0) | Use `backend/.venv/bin/pip install --require-hashes -r requirements.lock --dry-run` against the existing symlinked venv |
| H20 | Task 0.1 step 5 claims `backend/.env` is gitignored without verifying. Plan only suggests `git check-ignore` AFTER writing the key | Add prerequisite step before writing the file: grep `.gitignore` for `.env` coverage, add `backend/.env` to `.gitignore` if absent, THEN write credentials |

### 2.4 — Test design

| ID | Task | Finding | Fix |
|----|------|---------|-----|
| H21 | All client tests | Patches at `httpx.Client.post` — wrong abstraction level. Refactor to async or different client API silently breaks all tests | Inject client (or `post_fn`) into `NewRelicClient.__init__`. Use `httpx.MockTransport` (library-supported pattern). |
| H22 | 2.2, 2.8 | Zero timezone-boundary tests — `now` exactly on hour boundary, midnight crossing, `since` at midnight, naive datetime defensive | Add tests for these edge cases |
| H23 | 2.10 orchestrator | Assertions are vacuous: `status in ("ok", "partial")`, `isinstance(log, list)`, `"refreshed_at" in result`. An empty-CSV-writer impl passes | Assert exact `status == "ok"`; CSV row count matches expected; at least one row has expected `lcp_p75_ms` from fixture; log contains "rows committed" entries |
| H24 | 2.10 | No failure-mode tests for `run()` — network error mid-orchestration, facet-cap mid-loop, malformed response, empty Q3 (legitimate), client returns None. Bare `except Exception` swallows real bugs | Add `test_run_continues_after_one_app_fails`, `test_run_facet_cap_skips_hour`, `test_run_q2_empty_skips_hour`, etc. Treat 401/403 + FacetCapExceeded as fatal in `run()` (re-raise) |
| H25 | 2.4 Q3 test | `if rows: ...` lets a parser that always returns `[]` pass. Can't distinguish "fixture genuinely empty" from "parser broken" | Phase 0 gate: Q3 fixture must have at least one row before this phase. Assert `len(rows) > 0` |
| H26 | Plan-wide | No smoke integration test before Phase 6. The only end-to-end check is the manual NR-native spot-check after deploy | Add `test_run_smoke_with_mock_transport` in Phase 2: real `NewRelicClient` + `httpx.MockTransport` returning fixtures. Verifies payload assembly + parsing + merge + CSV write |

### 2.5 — Plan structure

| ID | Finding | Fix |
|----|---------|-----|
| H27 | Task 2.10 step 7 mixes imports (top-of-file vs inline). Engineer pasting may get import structure wrong | Move all imports to module top; show explicit diff, not "insert this block" |
| H28 | `--since` CLI flag missing — spec §4.5 documents `python -m services.integrations.refresh performance_grip --since 2026-05-12` but plan only wires env `SINCE` (from workflow) | Parse `--since YYYY-MM-DD` from argv in `refresh.py main()`; CLI overrides env. Add unit test mirroring spec's documented invocation |
| H29 | Task 6.1 step 3 says "tens of thousands of rows" — spec §4.3 math gives ~19K/day, so 7-day backfill ≈ 100-200K rows. Order-of-magnitude wrong, engineer may flag false bug | Update expected count to ~100-200K rows |

---

## 3. Devil's-advocate findings (process / philosophy)

The devil's-advocate review found 12 places to challenge the plan; **3 land hard, 4 are close calls, 5 don't land**. The ones that land:

| ID | Steelman | Recommended change |
|----|----------|--------------------|
| DA1 | Phase 0 over-sized — only Q1 fixture (0.3) and bucketing decision (0.7) are real hard gates. Others (key creation, app names, JS-error coverage, bot filtering) can run in parallel with Phase 1 | Collapse Phase 0 hard gates to Tasks 0.3 + 0.7. Other discovery tasks become "must complete before Task 2.10" but don't block Phase 1 start. Saves ~1 day wall-clock. |
| DA2 | Bias TIMESERIES decision (Task 0.7) — currently presented as equivalent options. TIMESERIES is the right answer unless facet cap behaves badly. Asking the engineer to "decide" creates an out toward per-hour | Rewrite Task 0.7 as "verify TIMESERIES works; fall back to per-hour ONLY if facet cap breaks." Two sentences, removes ambiguity. |
| DA3 | Script the secrets in Task 5.2 — manual `gh` UI work is jarring in an otherwise-automated plan | Use `gh secret set` and `gh variable set` reading from `backend/.env`. Keep workflow_dispatch trigger (Step 3) manual as a real checkpoint. |

Close calls (judgment required):
- TDD discipline for trivial helpers (`clean_url`, `check_facet_cap`) is theater — could write test + impl in one commit instead of separate steps
- Backfill atomicity: per-(app, hour) is right for steady-state but does O(n) reads × 336 hours on 7-day backfill (~gigabytes of CSV I/O). Could buffer-and-rewrite-once for the backfill path specifically
- Plan length (2200 lines) is right for subagent execution, exhausting for a human

Don't land (these are right): shared `new_relic.py`, twice-daily cron, MockClient strategy, the Plan 1/Plan 2 split, two-app v1.

---

## 4. Triage summary

**The plan as written would have failed at execution.** Specifically:
- Auth would fail immediately (CA1).
- Sample counts would be wrong silently (CA2).
- JS errors would be near-zero (CA3).
- File paths would mismatch between runner and workflow (CB1).
- CLI flow would have two competing code paths (CB2).
- YAML validation would pass but workflow would fail at runtime (CB3).

These are **find-and-fix-before-execution** issues, not "address during implementation" issues. None are spec problems — they're plan-writing mistakes (mostly: assumed public-doc shapes for NR that don't reflect how NR's events actually work, plus inconsistency in the codebase conventions).

The plan needs a substantive revision before execution. **Recommended next step:** apply all CRITICAL fixes, the most-relevant HIGH fixes, the 3 devil's-advocate findings that landed, then re-commit the plan.
