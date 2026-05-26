# Learn (Grip Education) — session log

> Newest entry first. Each entry = where the project stood at the end of one
> session, and what to pick up next. Date format `YYYY-MM-DD` (IST).

---

## 2026-05-26 — Project scaffolding + event spec drafted

**What landed:**

- Project folder created (`docs/projects/learn-education/`) with README,
  data-sources, roadmap, and the dashboard spec
  (`specs/2026-05-26-weekly-ab-tracker.md`).
- Documented the post-rewrite event surface emitted by gi-client-web's
  `feat/learn-analytics-events` branch (off `feature/grip-education-learn-page-v2`):
  `experiment_assigned`, `learn_page_viewed`, `learn_video_viewed`,
  `learn_outbound_clicked`.
- Canonical SQL formulas drafted for all 10 columns of the weekly A/B
  tracker (Total Non-Invested, Visit Rate, Unique Players, Plays, Avg
  Videos/User, Avg Watch Time, FTI, FTI-who-watched, FTI Rate).

**State of source-side changes (gi-client-web):**

- 9 files modified on `feat/learn-analytics-events` worktree
  (`/Users/purujit/grip/grip-code/gi-client-web-learn-analytics`)
- 279 tests passing across affected suites
- Not yet committed / pushed — awaiting review

**Open questions raised in `roadmap.md` §Open decisions** — need product
sign-off before SQL ships in any dashboard component:

- Q1 — Plays definition (`total_watched_seconds > 0` recommended)
- Q2 — Avg Watch Time denominator (per-play recommended)
- Q3 — Cohort slice (activity-week recommended)
- Q4 — FTI attribution window (any-time-after-assignment recommended)
- Q5 — Surface a Control Visit Rate health strip? (yes recommended)

**Pick up next:**

1. Commit + open PRs on both repos (gi-client-web feature events branch +
   this analytics docs branch).
2. After feature ships to prod and W1 data lands: scaffold
   `backend/services/integrations/fetch_learn_education.py` (Phase 2 D2).
3. Get product answers on Q1–Q5 so the dashboard SQL doesn't re-litigate
   definitions per-chart.

**Not picked up (parked):**

- Top/bottom carousel banner migration to `learn_outbound_clicked` —
  documented as a known gap in `data-sources.md §3a`, intentional scope
  cut to keep the source-side diff small.
- `/learn/[videoId]` deep-link fix — separate PR, separate concern.
