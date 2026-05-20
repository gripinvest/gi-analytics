# Performance Grip — roadmap

## v1 (this implementation)

- [x] Spec authored, 8-pass reviewed (commits e107d81 → 7de8394)
- [x] Plan 1 (Archive) authored, 6-pass reviewed (commits b0d6439 → 1c4dba9 for spec; 70dd5a7 → bfe16e9 for plan fixes)
- [x] Phase 0 discovery — fixtures, NR app names, response shapes, Path C architecture (commits Phase 0)
- [x] **Phase 1 — NewRelicClient** (4 commits, 0abd052 → 1c4dba9; 8 tests)
- [x] **Phase 2 — performance_grip.py fetch module** (10 commits; 34 tests; Path C split-query orchestrator)
- [x] **Phase 3 — project metadata** (project.json, route_patterns.csv, data-sources.md, session-log.md, roadmap.md)
- [ ] **Phase 4 — pip dependency hashing** (--require-hashes + requirements.lock, Dependabot)
- [ ] **Phase 5 — GitHub workflow** (twice-daily cron, concurrency-locked, SHA-pinned)
- [ ] **Phase 6 — first production backfill + verification**
- [ ] **Plan 2 (separate)** — Editorial dashboard (start after Plan 1 has run for ~7 days for calibration data)

## v1.5 (after ~30 days of operation)

- [ ] Refine `route_patterns.csv` from observed traffic (week-4 review)
- [ ] Classic dashboard alongside Editorial
- [ ] Slack-on-failure alerts (trigger: first real miss)
- [ ] Cross-app status pills in hero
- [ ] Print stylesheet / `?print=1` route
- [ ] 6th metric card (JS errors per 1K page views) — if leadership asks
- [ ] Service-account user migration (currently personal User API Key)
- [ ] Promote `--require-hashes` to asset-search / grip-connect / fra-youtube workflows

## v2

- [ ] Mobile app metrics (NR Mobile product, separate spec)
- [ ] Cross-app comparison charts
- [ ] Date-range `[ 30d | 90d ]` formal toggle
- [ ] PDF / CSV export
- [ ] Threshold-breach alerts
- [ ] TTFB field investigation (Phase 0 found mostly-zero values — needs different field or different aggregation)
- [ ] INP unit conversion verification (Phase 0 found values in seconds-as-fraction — may need ×1000 for ms display)

## v3+

- [ ] Editorial prose with deploy-correlation context
- [ ] Causal attribution (regressions ↔ deploys)
- [ ] Hourly drill-down view at the UI layer
- [ ] Per-route trend in dashboard (currently aggregate-only past day 7)

See [`specs/2026-05-20-performance-grip-design.md`](./specs/2026-05-20-performance-grip-design.md) §10 (open questions) and §12 (decisions log) for full context.
