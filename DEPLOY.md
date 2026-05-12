# Deploy — Render (backend) + Vercel (frontend), free tier

Roughly 15 minutes. The backend is a FastAPI app that loads the committed CSVs
into DuckDB on startup; the frontend is a Next.js app that talks to it.

Repo layout:
```
grip-analytics/
├── backend/        FastAPI + DuckDB        → Render
│   ├── data/<project>/*.csv + project.json  (ships with the deploy)
│   ├── requirements.txt, runtime.txt
│   └── main.py, services/, routers/
├── frontend/       Next.js                 → Vercel
└── render.yaml     Render blueprint
```

---

## 0. One decision first: the CSV data

`backend/data/asset_search/` holds the raw event CSVs (~35 MB). They ship with
the deploy so the app has data on startup with zero extra setup.

- The W1–W3 files carry only safe columns (timestamp, session id, user_id,
  query_text, results_count, …).
- The **W4–W6 `*_cleared` files have `ip_address` / `context_ip` columns**. Open
  one and check the values: if they're already hashed, you're fine; if they're
  real IPs, run `search_analytics/sanitize_csvs.py` against the originals in
  `metabase-connect/` and replace the files first.
- If you'd rather not commit the data at all: uncomment `backend/data/*/*.csv`
  in `.gitignore`, then upload (sanitized) CSVs via the app's **Upload CSVs**
  button after deploy. Caveat: on Render's free tier those uploads sit on
  ephemeral disk and disappear on every redeploy, so committing is the better
  model for anything you want to keep.

---

## 1. Push to GitHub (2 min)

A `.gitignore` is in place — it keeps `.env`, `.env.local`, `node_modules/`,
`.next/`, and `.venv/` out of the repo. **Verify before pushing** that no `.env*`
file is staged (it would leak your `ANTHROPIC_API_KEY`).

```bash
cd grip-analytics
git init -b main
git add .
git status                       # confirm: no .env / .env.local / node_modules / .venv
git commit -m "Grip Analytics — dashboards, issuer roll-up, Claude Q&A"

# Create a PRIVATE repo, then:
gh repo create grip-analytics --private --source=. --remote=origin --push
# (or create it on github.com, then: git remote add origin <url> && git push -u origin main)
```

---

## 2. Backend on Render (5 min)

Render reads `render.yaml`, so use the blueprint flow:

1. https://render.com → sign up / log in with GitHub.
2. **New → Blueprint** → pick the `grip-analytics` repo → it detects
   `render.yaml` and proposes a web service `grip-analytics-api`.
3. Before "Apply", set the env vars it asks for:
   - `ANTHROPIC_API_KEY` = your Anthropic key.
   - `ALLOWED_ORIGINS` = leave blank for now; you'll fill it in step 4.
   - (`PYTHON_VERSION=3.12.8` is already in the blueprint.)
4. Apply. First build takes ~3–5 min (installs deps, then on boot it loads the
   36 CSV views — watch the logs for `DuckDB loaded. Tables: [...]`).
5. Copy the service URL, e.g. `https://grip-analytics-api.onrender.com`.
6. Sanity check: open `…/health` (should return `{"status":"ok","tables":[…]}`)
   and `…/ping` (returns `ok`).

Not using the blueprint? Create a Web Service manually with: Root Directory
`backend`, Build `pip install -r requirements.txt`, Start
`uvicorn main:app --host 0.0.0.0 --port $PORT`, and the env vars above.

---

## 3. Frontend on Vercel (3 min)

1. https://vercel.com → log in with GitHub → **Add New… → Project** → import
   the `grip-analytics` repo.
2. **Set "Root Directory" to `frontend`** (important — the Next.js app lives
   there). Vercel auto-detects Next.js; leave the build settings default.
3. **Environment Variables** → add:
   - `NEXT_PUBLIC_API_URL` = your Render URL from step 2 (e.g.
     `https://grip-analytics-api.onrender.com`). This is read at build time, so
     it must be set before the build.
4. Deploy. Copy the URL, e.g. `https://grip-analytics.vercel.app`.

(CLI alternative: `cd frontend && npx vercel --prod`, set `NEXT_PUBLIC_API_URL`
when prompted.)

---

## 4. Point CORS at the frontend (1 min)

The backend already allows `localhost:3000` and `grip-analytics.vercel.app`. For
any other Vercel URL (custom name, custom domain, preview deploys), add it on
Render → your service → **Environment** → `ALLOWED_ORIGINS` =
`https://your-actual-url.vercel.app` (comma-separated for several). Save → Render
redeploys automatically. Then reload the frontend and try **Ask the data**.

---

## 5. Keep the backend warm — UptimeRobot (2 min, optional)

Render's free tier sleeps after ~15 min idle, so the first request after a nap is
slow. To avoid that:

1. https://uptimerobot.com → free account.
2. **Add Monitor** → HTTP(s) → URL `https://grip-analytics-api.onrender.com/ping`
   → interval 5 min (≤ Render's 15-min idle window).
3. Save. The backend stays up 24/7.

---

## Cost

| | |
|---|---|
| Vercel (frontend) | $0 |
| Render (backend) | $0 |
| UptimeRobot | $0 |
| Anthropic API (chat) | usage-based, ~a few $/mo at low volume |

---

## Updating later

- **Code**: push to `main` → Render and Vercel both redeploy automatically.
- **New data for an existing project**: drop the CSVs into
  `backend/data/<project>/`, commit, push. They're picked up on the next boot.
  Re-run `sanitize_csvs.py` first if they contain PII.
- **A new project**: add `backend/data/<new_id>/project.json` (+ CSVs), and a
  dashboard component in `frontend/components/dashboards/` registered in
  `components/dashboards/index.js`. Unmatched projects fall back to the generic
  table + ad-hoc-query view.
