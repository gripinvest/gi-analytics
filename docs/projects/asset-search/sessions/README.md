# Asset Search — planned sessions

Each file here is a **self-contained session brief** — enough context to start
that work cold in a fresh session. One session = one git worktree = one branch
= one PR.

**Before any session:** read the project [`README.md`](../README.md),
[`session-log.md`](../session-log.md), [`data-sources.md`](../data-sources.md),
and [`roadmap.md`](../roadmap.md). Work in a dedicated worktree (standing mandate).

## The sessions

| # | Session | Depends on | Parallel-safe | Status |
|---|---------|-----------|---------------|--------|
| [S1](./S1-classic-dashboard-parity.md) | Classic dashboard — un-deprecate + session-outcome funnel parity + mobile-first | — | yes | ✅ merged — [PR #49](https://github.com/purujit-grip/grip-analytics/pull/49) |
| [S2](./S2-shared-ui-fixes.md) | Shared UI fixes — sign-out / theme-switcher overlap + UI-break audit | — | yes | ✅ merged — [PR #50](https://github.com/purujit-grip/grip-analytics/pull/50) |
| [S3](./S3-metabase-data-validation.md) | Validate Asset Search data points against Metabase | — | yes | ✅ merged — [PR #52](https://github.com/purujit-grip/grip-analytics/pull/52) |
| [S4](./S4-live-data-spec.md) | Asset Search live-data — design spec (Metabase fetch + daily cron + new tables) | — | yes | ✅ done — [PR #51](https://github.com/purujit-grip/grip-analytics/pull/51) |
| [S5](./S5-live-data-implementation.md) | Asset Search live-data — implementation | **S4** (benefits from S3) | no | ✅ done — [PR #54](https://github.com/purujit-grip/grip-analytics/pull/54) |

S1–S4 are independent and can run in any order or in parallel (separate
worktrees). S5 must follow S4.

## Decisions already made (carry into every session)

- **Metabase credentials** live in `backend/.env` as `METABASE_EMAIL` /
  `METABASE_PASSWORD`. Metabase URL: `https://metabase.gripinvest.in`.
- **Classic dashboard** is being **un-deprecated** and maintained side-by-side
  with Editorial, at **full data parity** (the live session-outcome funnel).
- **Data discipline:** deterministic Python only; Claude authors & validates
  fetch/validation scripts, never runs extraction interactively.
- Reference pattern for the live-data work: the approved Grip Connect spec
  `docs/specs/2026-05-17-grip-connect-live-data-design.md` — adapt, don't copy.

## Starting a session — kickoff prompt

Hand the next agent this prompt. Change only the **one** config line.

```
You are picking up a scoped work session on the Grip Analytics repo.

### CONFIG — set this
Session to work: S1      # one of: S1, S2, S3, S4, S5

### Repo
/Users/purujit/grip/grip-code/grip_analytics/grip-analytics

### Steps
1. Read docs/projects/asset-search/sessions/README.md, then the brief for your
   session (docs/projects/asset-search/sessions/S<n>-*.md). It defines the
   goal, cold-start context, scope, and definition of done — follow it exactly.
2. Read the project context: docs/projects/asset-search/README.md,
   session-log.md, data-sources.md, roadmap.md, and the repo CLAUDE.md.
3. Work in a dedicated git worktree on the brief's suggested branch — never the
   primary checkout. Fetch latest main first.
4. Execute to the brief's "Definition of done". Build-validate (`next build`)
   and commit at each checkpoint.
5. When done: push, open a PR to main, and update session-log.md + the status
   table in sessions/README.md.

### Locked decisions — carry these
- Classic dashboard → full parity with Editorial (the live session-outcome funnel).
- Metabase credentials are in backend/.env (METABASE_EMAIL / METABASE_PASSWORD).
- Live-data work adapts — does not copy — the Grip Connect spec at
  docs/specs/2026-05-17-grip-connect-live-data-design.md.

### Scope discipline
Work only the session named above. If it depends on another (S5 needs S4),
confirm the dependency is met before starting.
```

## Status

As of 2026-05-19 — see the **Status** column in the table above:

- **S1 merged** — PR #49, classic dashboard un-deprecated + funnel parity.
- **S2 merged** — PR #50, shared UI fixes (chrome overlap + ≥44 px targets).
- **S3 merged** — PR #52, Metabase data-validation harness + report. F1
  (data-sources.md §0 W6 double-count) found & corrected; the credentialed
  Metabase run is pending by design.
- **S4 merged** — [PR #51](https://github.com/purujit-grip/grip-analytics/pull/51),
  live-data design spec (`specs/2026-05-19-asset-search-live-data-design.md`),
  8-agent-reviewed.
- **S5 done** — live-data implementation (5 phases: fetch core, refresh
  registry, refresh endpoint, refresh UI, daily cron),
  [PR #54](https://github.com/purujit-grip/grip-analytics/pull/54) open to `main`.
  Backend 102 tests pass, `next build` clean. Pre-cutover: the Metabase
  native-query-permission check + credentialed first run are operator/CI
  steps, and the cron's GitHub Actions secrets must be set before it goes live.

Update the table above and `session-log.md` as sessions land.
