# Asset Search — planned sessions

Each file here is a **self-contained session brief** — enough context to start
that work cold in a fresh session. One session = one git worktree = one branch
= one PR.

**Before any session:** read the project [`README.md`](../README.md),
[`session-log.md`](../session-log.md), [`data-sources.md`](../data-sources.md),
and [`roadmap.md`](../roadmap.md). Work in a dedicated worktree (standing mandate).

## The sessions

| # | Session | Depends on | Parallel-safe |
|---|---------|-----------|---------------|
| [S1](./S1-classic-dashboard-parity.md) | Classic dashboard — un-deprecate + session-outcome funnel parity + mobile-first | — | yes |
| [S2](./S2-shared-ui-fixes.md) | Shared UI fixes — sign-out / theme-switcher overlap + UI-break audit | — | yes |
| [S3](./S3-metabase-data-validation.md) | Validate Asset Search data points against Metabase | — | yes |
| [S4](./S4-live-data-spec.md) | Asset Search live-data — design spec (Metabase fetch + daily cron + new tables) | — | yes |
| [S5](./S5-live-data-implementation.md) | Asset Search live-data — implementation | **S4** (benefits from S3) | no |

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

## Status

All sessions: **not started.** Update this table and `session-log.md` as they
land.
