# scripts/

## `refresh_data.py` — pull a new week of data from Metabase into the dashboard

### What it does

1. Queries Metabase (`POST /api/dataset/csv`, no row cap) for the 6 Asset Search
   event tables, filtered to one week and with the internal/QA `user_id`s excluded.
2. Sanitizes the result (drops PII columns, hashes IP columns) — defensive; the
   `SELECT`s are already narrow.
3. Writes `W{n}_{label}_asset_search_{event}.csv` into `backend/data/asset_search/`,
   matching the column layout the dashboard expects.
4. `git add` + `git commit` + `git push`. **Pushing to `main` redeploys Render
   (backend) and Vercel (frontend)** — the new week shows up live ~2-3 min later.

Stdlib only. Run it with the system `python3`, no virtualenv needed.

### One-time setup

1. In `backend/.env` (not committed):

   ```
   METABASE_URL=https://metabase.yourcompany.com     # no trailing slash needed
   METABASE_API_KEY=<personal API key>               # Metabase → Account Settings → API Keys
   ```

2. In `refresh_data.py`, fill the **SOURCE CONFIG** block at the top:
   - `DATABASE_ID` — Metabase database id of the warehouse with the event tables
   - `SCHEMA` — the schema/dataset those tables live in
   - `EVENT_TABLES` — only if your table names aren't `asset_search_<event>`

   Leave the `EVENT_COLUMNS` `SELECT` lists alone unless you also change the
   dashboard's SQL — those column names are what the dashboard reads.

3. Sanity-check without touching anything:

   ```bash
   python3 scripts/refresh_data.py --next-week --dry-run
   ```

   It prints the target window, the generated SQL, and the files it would write.

### Usage

```bash
python3 scripts/refresh_data.py --next-week          # the next sequential week
python3 scripts/refresh_data.py --week 7             # W7 explicitly
python3 scripts/refresh_data.py --from 2026-05-12 --to 2026-05-18 --label may12-may18
python3 scripts/refresh_data.py --next-week --no-push   # write + commit, you push later
python3 scripts/refresh_data.py --next-week --no-commit # just write the CSVs
python3 scripts/refresh_data.py --next-week --dry-run   # plan only
```

Weeks are 7-day Thu→Wed windows anchored on the launch date (2026-04-02 = W1).
`--to` is the inclusive last day. W6 was a partial week (`may07-may11`), so
`--next-week` jumps to W7 (`may14-may20`); use `--from/--to/--label` if you need
to backfill the `may12-may13` gap or any other off-cadence window.

If the CSVs come back byte-identical to what's committed, the script notices and
skips the commit.

## Automating it

Pick one. The script is the same; only the trigger differs.

### Option A — just run it

Set a calendar reminder for, say, every Thursday morning and run the one-liner.
Zero infra. Fine if "the dashboard is a week stale" is never a real problem.

### Option B — `launchd` (macOS's built-in scheduler)

Not a new tool to install; `launchd` is already running on your Mac (it's what
`cron` has been replaced by here). Drop this at
`~/Library/LaunchAgents/com.grip.analytics.refresh.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.grip.analytics.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>/Users/purujit/grip/grip-code/grip_analytics/grip-analytics/scripts/refresh_data.py</string>
    <string>--next-week</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/purujit/grip/grip-code/grip_analytics/grip-analytics</string>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/grip-analytics-refresh.log</string>
  <key>StandardErrorPath</key><string>/tmp/grip-analytics-refresh.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.grip.analytics.refresh.plist   # enable
launchctl start com.grip.analytics.refresh                               # run once now to test
launchctl unload ~/Library/LaunchAgents/com.grip.analytics.refresh.plist # disable
```

Caveat: it only fires when your Mac is awake. If it was asleep at the scheduled
time, `launchd` runs it on next wake. If it can't reach Metabase (VPN), it'll
just error in the log and you re-run manually.

(`cron` works too — `0 9 * * 4 cd /path/to/grip-analytics && /usr/bin/python3 scripts/refresh_data.py --next-week` — but on macOS `launchd` is the supported path and survives reboots cleanly.)

### Option C — GitHub Actions (doesn't depend on your laptop)

Only viable if a GitHub-hosted runner can reach your Metabase host (public, or
via a self-hosted runner inside the network). Add `.github/workflows/refresh.yml`,
store `METABASE_URL` / `METABASE_API_KEY` as repo secrets, `schedule:` it weekly,
and let it commit + push. More moving parts, but the refresh happens whether or
not anyone's machine is on.

### Why not "add a /admin/refresh button to the deployed backend"?

Tempting, but it doesn't work here: Render's box can't reach an internal Metabase;
you'd be putting the Metabase key in a third place; you'd still need something to
hit the endpoint on a schedule; and Render's free tier has no persistent disk, so
a refresh that wrote CSVs there would vanish on the next redeploy. The data has to
land in the repo to survive — which means it runs wherever you have git + network,
i.e. your machine (or a CI runner), i.e. this script.
