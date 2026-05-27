# Learn (Grip Education) — operations runbook

Day-to-day operation of the dashboard: how it refreshes, how to trigger
it manually, where to look when it breaks, what each piece costs.

> **For what the system *is*:** [`architecture.md`](./architecture.md).
> **For why it's shaped this way:** [`decisions.md`](./decisions.md).

---

## 1. The daily cron

**Schedule:** 01:00 IST daily (`30 19 * * *` UTC).
**Workflow:** `.github/workflows/refresh-learn-education.yml`.
**Runtime:** ~3-5 seconds in steady state.

What it does, in order:
1. Spin up Ubuntu runner + Python 3.12.
2. Install `backend/requirements.txt`.
3. Run `python -m services.integrations.refresh learn_education`.
4. If the refresh wrote a CSV, commit it via the bot account.
5. Push to `main`.

Exit codes:
- `0` — success (cron commit + push). Also `0` when status is `awaiting_first_event` (probes returned no rows — clean idle).
- `1` — error (the run itself failed: Metabase down, SQL error, etc.).

If the workflow exits `1`, the action surfaces it in the GitHub Actions UI. No Slack page today; consider adding one if we see repeated failures.

## 2. Triggering a manual refresh

### 2.1 From the dashboard

Hit the **Refresh data ↻** button under the masthead. Backend kicks off a job, polls to completion, the dashboard re-fetches in place. 60-second cooldown after each successful run.

### 2.2 From CLI (operator/admin)

```bash
gh workflow run "Refresh Learn Education data" -R purujit-grip/grip-analytics
```

Then watch the run:
```bash
gh run list -R purujit-grip/grip-analytics --workflow="Refresh Learn Education data" --limit 1
gh run view <run-id> -R purujit-grip/grip-analytics --log
```

Pull the key log lines:
```bash
gh run view <run-id> -R purujit-grip/grip-analytics --log 2>&1 | grep -E "probes ok|engagement|daily-order probe|fti:|merged|wrote"
```

### 2.3 From local laptop (last-resort)

```bash
cd backend
METABASE_URL=https://metabase.gripinvest.in \
METABASE_EMAIL=... METABASE_PASSWORD=... \
python -m services.integrations.refresh learn_education
```

Outputs `weekly_ab_tracker.csv` + `manifest.json` to `backend/data/learn_education/`. **Doesn't commit** — useful for spot-checks against staging.

## 3. Where to look when something fails

### 3.1 Dashboard shows old/empty/wrong numbers

Walk the data hops in order — first to fail tells you where to look:

| Check | How | If broken |
|---|---|---|
| Is `learn_education__weekly_ab_tracker` on prod DuckDB? | `curl https://grip-analytics-api.onrender.com/health \| grep learn_education` | Render didn't rebuild the DuckDB image. Trigger a redeploy. |
| Is the CSV on `main` current? | `git log origin/main --oneline -- backend/data/learn_education/weekly_ab_tracker.csv \| head -3` | Cron didn't run, or didn't commit. Check GitHub Actions. |
| Did the latest cron run succeed? | `gh run list -R purujit-grip/grip-analytics --workflow="Refresh Learn Education data" --limit 3` | Read the log; common causes in §4 below. |
| Does Render's running container have the latest build? | Render dashboard → grip-analytics-api → latest deploy timestamp | Manually trigger a redeploy. |
| Does the frontend's data hook actually query the table? | `git show origin/main:frontend/lib/queries/learnEducation.js \| grep -A2 "useState"` should show `{ rows: [], meta: EMPTY_META }`, not `MOCK_ROWS` | A PR reverted D-07. Fix the hook. |
| Is the user's browser caching an old bundle? | Hard-refresh (Cmd+Shift+R) | Vercel deployed but the user's cache is stale. |

### 3.2 Cron run output reference

A healthy run logs:
```
probes ok — 90 learn_page_viewed, 2096 experiment_assigned in last 90 days
engagement: 1976 per-user rows from Rudder
daily-order probe: 717 BUY orders yesterday
fti: 764 FTI rows from prodgripdb.ur_tblorders (scoped to 1976 cohort users)
merged into 2 (week, variant) rows
wrote 2 rows → learn_education/weekly_ab_tracker.csv
```

If any of those numbers look wrong, the rest of the pipeline downstream
is fine — the source data has shifted.

### 3.3 Cron failure modes (catalogued)

| Failure | Symptom | Fix |
|---|---|---|
| Metabase auth expired | `401 Unauthorized` on `/api/session` | Rotate the `METABASE_PASSWORD` secret in Render + GitHub. Service account creds. |
| Metabase database renamed / removed | `database not found` | Update `RUDDER_DB_ID` or `TRANSACTIONS_DB_ID` in `learn_education.py`. |
| ur_tblorders permissions changed | `ACCESS_DENIED` on column | Check what columns we lost; ask data team for grants. (Happened at launch — see D-09.) |
| Cohort empty | Engagement query returns 0 rows, FTI fetch skipped | Probably an event-emission regression in gi-client-web. Check Rudder for `experiment_assigned(learn_page)`. |
| Test user count grew | `TEST_USERS` doesn't include a new internal account | Add the user_id to the tuple in `learn_education.py` + `test_learn_education.py`. |

## 4. Costs & quotas

| Surface | What we use | Cost (today) |
|---|---|---|
| Metabase | One session + 3 ad-hoc queries per run + 1 paginated FTI fetch (1 page) | Trivial — well below Metabase's per-instance throttle. |
| GitHub Actions | ~5-second job, daily | Free tier covers it. |
| Render (backend) | 1 web service, free tier | Cold-start risk: free tier sleeps after inactivity. First request after sleep takes ~30s. |
| Vercel (frontend) | Auto-deploy on push, hosted Next.js | Free tier covers it. |
| DuckDB | ~127 MB image, baked at build time | Storage is free; build adds ~2 min to deploy. |

If we move to a paid Render tier (no sleep), cold-start friction goes
away. Not blocking today.

## 5. Updating the cron / fetch logic

Quality gate before merging:
1. Open a worktree off `main` (mandate per `CLAUDE.local.md`).
2. Make the change in `backend/services/integrations/learn_education.py`.
3. Update tests in `backend/tests/test_learn_education.py` to cover it.
4. Run the suite: `python -m pytest backend/tests/test_learn_education.py -q`. Must be 25/25 (current). After V2 PRs: ≥ 40/40.
5. Manually invoke the fetch locally to validate against a real Metabase: see §2.3.
6. Open PR, get review, merge.
7. Trigger a manual cron run post-merge to verify.

## 6. Updating the dashboard / frontend

1. Worktree off `main`.
2. Edit `frontend/components/dashboards/LearnEducationDashboardEditorial.jsx` and/or `frontend/lib/queries/learnEducation.js`.
3. **`COLUMNS` in the frontend and `CANONICAL_COLUMNS` in the backend must match exactly.** Mismatch silently corrupts the table.
4. Run `next build` from `frontend/`. Must be 0 errors, 0 warnings.
5. PR + review + merge. Vercel auto-deploys.

## 7. Adding a new Tier 2 metric (recipe)

Concrete steps for the spec at `specs/2026-05-27-tier2-and-margin-notes.md`:

| Step | File | Action |
|---|---|---|
| 1 | `learn_education.py` | Extend the engagement CTE / aggregator. Add the new key to `CANONICAL_COLUMNS`. |
| 2 | `test_learn_education.py` | Add a FakeClient test asserting the new column with known inputs. |
| 3 | `learnEducation.js` | Add to `COLUMNS` with `kind` matching the value shape. |
| 4 | `LearnEducationDashboardEditorial.jsx` | Add to the weekly-table render (auto-derived from COLUMNS, but verify mobile layout). |
| 5 | `data-sources.md` §4 | Document the new SQL + Python merge logic. |
| 6 | `README.md` (chart-source mapping) | Add a row for the new column. |
| 7 | Local fetch + manual cron run | Validate the column shows up with a non-zero value. |

## 8. Adding a new "Margin Notes" indicator

| Step | File | Action |
|---|---|---|
| 1 | `learn_education_stats.py` | Add a pure helper (no I/O). |
| 2 | `test_learn_education_stats.py` | Cover the math: balanced, skewed, edge cases (n=0, both arms zero, etc.). |
| 3 | `learn_education.py` `run()` | Call the helper, write to `manifest['margin_notes']`. |
| 4 | `LearnEducationDashboardEditorial.jsx` Margin Notes section | Render the new card with traffic-light + value + caption. |
| 5 | `glossary.md` | Define any new term the indicator introduces. |
| 6 | `decisions.md` | Add an entry if the indicator forces a meaningful design choice. |

## 9. Deprecating a metric / column

1. Mark deprecated in `CANONICAL_COLUMNS` with a comment.
2. Keep emitting it for 4 weeks (don't silently drop columns; downstream might depend).
3. Drop the column from `CANONICAL_COLUMNS` AND `COLUMNS` in the same commit.
4. Update `data-sources.md` and `decisions.md` (add entry: "deprecated X because Y").

## 10. People + ownership

| Surface | Owner | Backup |
|---|---|---|
| gi-client-web events + bucketing | Puru | gi-client-web team |
| grip-analytics backend (fetch + cron + tests) | Puru | n/a (single-maintainer today) |
| grip-analytics frontend (dashboard) | Puru | n/a |
| Metabase service-account creds | Puru | Operations team has rotation procedure |
| Render + Vercel hosting | Puru | account owner only |

The single-maintainer state is a risk. When V2 lands, a docs walkthrough
with one additional engineer is a reasonable next step.
