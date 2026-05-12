# Grip Analytics

Internal product analytics platform. Interactive dashboards + conversational Q&A on raw CSV data.

## Stack
- **Frontend**: Next.js 14 (App Router) → Vercel
- **Backend**: FastAPI + DuckDB → Railway
- **AI**: Claude claude-sonnet-4-20250514 via tool_use for natural language queries

## Setup

### 1. Clone and install

```bash
git clone <repo>

# Frontend
cd frontend && npm install

# Backend
cd ../backend && pip install -r requirements.txt
```

### 2. Environment variables

**frontend/.env.local**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**backend/.env**
```
ANTHROPIC_API_KEY=sk-ant-...
DATA_DIR=./data
```

### 3. Add your first project data

```bash
mkdir -p backend/data/asset_search
cp /path/to/metabase-connect/W*.csv backend/data/asset_search/
```

The backend auto-discovers CSV files and loads them into DuckDB on startup.
Table names = filename stems (e.g. `W4_apr23-apr29_asset_search_query`).

### 4. Run locally

```bash
# Terminal 1 — backend
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open http://localhost:3000

## Deploy

### Vercel (frontend)
```bash
cd frontend && vercel --prod
```
Set env var: `NEXT_PUBLIC_API_URL=https://your-railway-app.railway.app`

### Railway (backend)
```bash
# In Railway dashboard:
# 1. New project → Deploy from GitHub
# 2. Set root directory: backend/
# 3. Add env vars: ANTHROPIC_API_KEY, DATA_DIR=/data
# 4. Add volume mounted at /data
# 5. Upload CSVs to the volume via Railway CLI:
railway volume cp ./data/asset_search /data/asset_search
```

## Adding a new project

1. Create `backend/data/{project_id}/` and drop CSVs in
2. Add project metadata to `backend/data/projects.json`
3. Create `frontend/components/dashboards/{ProjectName}.tsx` with your React dashboard
4. Register it in `frontend/lib/projects.ts`

That's it. Backend auto-loads new CSVs, chat works immediately.
