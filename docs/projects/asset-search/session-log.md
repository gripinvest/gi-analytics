# Asset Search — session log

Where the project stood at the end of each working session. Newest first.
Read the top entry when starting a new session. Supersedes the old loose
`AGENT_CONTEXT.md` handoff.

---

## 2026-05-18 — session planning

**Status:** PR #42 **merged & deployed.** Next work is broken into 5 scoped
sessions — see [`sessions/README.md`](./sessions/README.md). Each is its own
worktree / branch / PR; S1–S4 are parallel-safe, S5 follows S4.

- **S1** — Classic dashboard: un-deprecate + session-outcome funnel parity + mobile-first
- **S2** — Shared UI fixes: sign-out / theme-switcher overlap
- **S3** — Validate Asset Search data points against Metabase
- **S4** — Asset Search live-data design spec (Metabase fetch + daily cron)
- **S5** — Asset Search live-data implementation

Decisions locked: Classic → full parity with Editorial; Metabase creds are in
`backend/.env`; live-data work adapts (not copies) the Grip Connect spec.

---

## 2026-05-18 — session-outcome funnel (PR #42, merged)

### Shipped — PR #42 (`feat/asset-search-dashboard-updates`)

https://github.com/purujit-grip/grip-analytics/pull/42 · 9 commits · rebased on
`main`, build-clean.

- **Session-outcome funnel** — the new primary metric. Every searched session
  classified once: Success / Relevance-gap / Dead-end, live from
  `asset_search_query` + `asset_search_result_clicked`. Overall (Editorial
  Overview, Fig 3) + per-issuer (Issuers section). Search Success Rate ~52%→59%.
- Retired the `asset_search_cleared` abandonment reconstruction from the
  maintained dashboard (understated failure ~10×; W1–W3 lacked the payload).
- Full **W6** data (7–13 May); "partial week" copy removed; masthead date range
  + feature-week glossary.
- Interactive **SORT BY** control on the issuer list (default: Searches).
- **Classic dashboard deprecated** (`@deprecated`); Editorial is maintained.
- **Project doc structure** — `docs/projects/<project>/` + `docs/architecture/`;
  new repo `CLAUDE.md` defining the project- vs platform-level pattern.

### Where we stand / in flight

- **PR #42** — open, base `main`. Squash-merge recommended (history contains the
  reconstruction commits later retired).
- **Localhost validation pending** — the post-funnel dashboard has not been
  eyeballed rendered. Before merge: `npm run dev` from the worktree, open
  `/projects/asset_search` Editorial, check Fig 3 funnel + Issuers tab + III·b.
- **Worktree** at `grip_analytics/wt-asset-search/` on branch
  `feat/asset-search-dashboard-updates`. `ExitWorktree` to clean up after merge.

### When resuming — pick up from

1. If #42 merged → **roadmap item #1: Asset Search live data** — Metabase fetch
   via the `backend/services/integrations/` framework (apply the approved Grip
   Connect spec). **Blocker:** `METABASE_EMAIL` / `METABASE_PASSWORD` creds.
2. If #42 not merged → finish localhost validation, then merge.
3. Then roadmap #2 — export `view_payment_page_loaded` + `view_payment_status_page`
   for payment-stage conversion; roadmap #3 — cross-day attribution (doable now).

See [`roadmap.md`](./roadmap.md) for the full next-steps detail.

### Context not visible in the code

- The reconstruction (`search_analytics/reconstruct_abandonment.py`, the
  `ISSUER_MAP.abandoned/relgap` arrays) is **legacy** — superseded by the funnel.
  Don't build on it. The arrays stay only because the deprecated Classic
  dashboard still reads them.
- The 8-step review ran *before* the funnel build; the funnel was build-validated
  and its SQL validated against real data, but not re-reviewed end-to-end.
- A concurrent agent works on **Grip Connect** in this repo — always work in a
  dedicated worktree (standing mandate).
- No live Metabase connection this session — claims were validated against the
  local W1–W6 CSV exports in `metabase-connect/`.
- Data window is W1–W6 (through 13 May); W7+ not yet exported.
