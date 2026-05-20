# Performance Grip — Editorial Dashboard Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the Editorial dashboard surface for Performance Grip — the leadership-facing weekly view backed by the hourly archive that's now flowing into DuckDB.

**Architecture:** Standard grip-analytics dashboard pattern. `frontend/lib/queries/performanceGrip.js` defines DuckDB SQL queries + a `usePerformanceGrip()` hook. `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx` consumes the hook and composes sub-components (MetricTrendCard, StatusVerdict, HeroBand, WindowToggle, AppSwitcher, DeviceToggle, RouteDrilldown). Registered in `dashboards/index.js` under key `PerformanceGripEditorial`.

**Tech Stack:** Next.js 14 (Pages Router), React 18, Recharts 2.12.7, IBM Plex Mono + Fraunces + Newsreader (Editorial fonts already in `app/editorial.css`), Tailwind via existing tokens (`var(--ed-*)`).

**Reference:** Spec §6 (dashboard design) + `backend/data/performance_grip/hourly_web_vitals.csv` + the first cron commit `75e4ae3`. When in doubt, the spec wins.

**Plan 1 dependency:** Archive must be flowing (first cron landed `75e4ae3` on 2026-05-21 with 17 rows). DuckDB table `performance_grip__hourly_web_vitals` is rebuilt on Render backend deploy via `build_duckdb.py`.

---

## Pre-flight

- [ ] Confirm worktree is on a Plan 2 working branch (NOT the merged `performance-grip-design`). Suggest `feat/performance-grip-dashboard`:

```bash
cd /Users/purujit/grip/grip-code/grip_analytics/grip-analytics
git fetch origin
git worktree add .claude/worktrees/performance-grip-dashboard -b feat/performance-grip-dashboard origin/main
cd .claude/worktrees/performance-grip-dashboard
```

- [ ] Confirm DuckDB table is exposed. On the Render backend (or a local `python build_duckdb.py && python -m uvicorn main:app --reload`):

```bash
curl 'http://localhost:8000/query?sql=SELECT+count(*)+FROM+performance_grip__hourly_web_vitals'
```

Expected: a non-zero count (whatever the cron has accumulated).

- [ ] Skim spec §6 sections 6.1 through 6.6. The spec drives implementation details below.

---

## Phase A — Query layer (`frontend/lib/queries/performanceGrip.js`)

The dashboard reads everything through one query module + one hook. Following the pattern of `fraYoutube.js` and `assetSearch.js`.

### Task A.1: Create `performanceGrip.js` with the SQL spec

**Files:**
- Create: `frontend/lib/queries/performanceGrip.js`

The SQL keys map to discrete dashboard sections. Each query is pre-aggregated by DuckDB; the dashboard does minimal post-processing.

- [ ] **Step 1: Write the file**:

```javascript
/**
 * SQL queries + theme-agnostic data hook for the Performance Grip project.
 *
 * Data: hourly Web Vitals archive at backend/data/performance_grip/hourly_web_vitals.csv,
 * baked into DuckDB table `performance_grip__hourly_web_vitals`.
 *
 * Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md
 * Path C config: backend/data/performance_grip/route_patterns.csv
 *
 * All queries take `app` (slug) and `device` ("all" | "mobile" | "desktop" | "tablet")
 * + a window in days.
 */

import * as React from "react";
import { runQuery } from "@/lib/api";

// Web Vitals thresholds (spec §6.2 — Google official). [Good, NI, Poor] boundaries.
// LCP/INP/FCP/TTFB are in milliseconds (the archive stores seconds — we ×1000 in display).
// CLS is dimensionless.
export const THRESHOLDS = {
  lcp:  { good_ms: 2500, ni_ms: 4000  },
  inp:  { good_ms: 200,  ni_ms: 500   },
  cls:  { good: 0.1,     ni: 0.25     },
  fcp:  { good_ms: 1800, ni_ms: 3000  },
  ttfb: { good_ms: 800,  ni_ms: 1800  },
};

/* Device filter — note the archive uses 'unknown' as a 4th value for unattributed
   page views (observed in real data). It's folded into "all" only. */
function deviceClause(device) {
  return device === "all" ? "" : ` AND device = '${device}'`;
}

/* Build per-day trendline aggregates from the hourly archive. Page-view-weighted
   averages across the day's hours per (page_url) — then dashboard rolls up to
   site-level by page-view-weighted average across page_urls. */
function trendlineSQL({ app, device, days }) {
  const dev = deviceClause(device);
  return `
    SELECT
      date,
      SUM(page_views)                                                          AS page_views_total,
      SUM(js_errors)                                                           AS js_errors_total,
      SUM(sample_count)                                                        AS sample_count_total,
      SUM(lcp_p75_ms * sample_count)  / NULLIF(SUM(sample_count), 0)           AS lcp_p75_ms,
      SUM(lcp_p95_ms * sample_count)  / NULLIF(SUM(sample_count), 0)           AS lcp_p95_ms,
      SUM(inp_p75_ms * sample_count)  / NULLIF(SUM(sample_count), 0)           AS inp_p75_ms,
      SUM(inp_p95_ms * sample_count)  / NULLIF(SUM(sample_count), 0)           AS inp_p95_ms,
      SUM(cls_p75    * sample_count)  / NULLIF(SUM(sample_count), 0)           AS cls_p75,
      SUM(cls_p95    * sample_count)  / NULLIF(SUM(sample_count), 0)           AS cls_p95,
      SUM(fcp_p75_ms * sample_count)  / NULLIF(SUM(sample_count), 0)           AS fcp_p75_ms,
      SUM(fcp_p95_ms * sample_count)  / NULLIF(SUM(sample_count), 0)           AS fcp_p95_ms,
      SUM(ttfb_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0)           AS ttfb_p75_ms,
      SUM(ttfb_p95_ms * sample_count) / NULLIF(SUM(sample_count), 0)           AS ttfb_p95_ms
    FROM performance_grip__hourly_web_vitals
    WHERE app = '${app}'${dev}
      AND date >= CURRENT_DATE - INTERVAL ${days} DAY
    GROUP BY date
    ORDER BY date
  `;
}

/* Hero band — this-week (last 7 complete days) vs last-week (7 days prior). */
function heroSQL({ app, device }) {
  const dev = deviceClause(device);
  return `
    WITH agg AS (
      SELECT
        CASE
          WHEN date >= CURRENT_DATE - INTERVAL  7 DAY THEN 'this_week'
          WHEN date >= CURRENT_DATE - INTERVAL 14 DAY THEN 'last_week'
          ELSE NULL
        END AS bucket,
        SUM(page_views)                                                        AS page_views,
        SUM(js_errors)                                                         AS js_errors,
        SUM(sample_count)                                                      AS samples,
        SUM(lcp_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0)          AS lcp_p75_ms,
        SUM(inp_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0)          AS inp_p75_ms
      FROM performance_grip__hourly_web_vitals
      WHERE app = '${app}'${dev}
        AND date >= CURRENT_DATE - INTERVAL 14 DAY
      GROUP BY bucket
    )
    SELECT * FROM agg WHERE bucket IS NOT NULL
  `;
}

/* Route drill-down — Top 15 by 7-day page views with this-week / last-week LCP
   for the WoW delta column. Path C semantics: page_url stores pattern labels
   like '/external-ui/[uuid]' for collapsed rows; the dashboard treats them as
   plain strings (no special UI marker — they're already grouped). */
function routesSQL({ app, device }) {
  const dev = deviceClause(device);
  return `
    WITH this_week AS (
      SELECT
        page_url,
        SUM(page_views)                                                        AS page_views,
        SUM(js_errors)                                                         AS js_errors,
        SUM(lcp_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0)          AS lcp_p75_ms,
        SUM(inp_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0)          AS inp_p75_ms,
        SUM(cls_p75    * sample_count) / NULLIF(SUM(sample_count), 0)          AS cls_p75
      FROM performance_grip__hourly_web_vitals
      WHERE app = '${app}'${dev}
        AND date >= CURRENT_DATE - INTERVAL 7 DAY
      GROUP BY page_url
    ),
    last_week AS (
      SELECT
        page_url,
        SUM(lcp_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0)          AS lcp_p75_ms_lw
      FROM performance_grip__hourly_web_vitals
      WHERE app = '${app}'${dev}
        AND date <  CURRENT_DATE - INTERVAL 7  DAY
        AND date >= CURRENT_DATE - INTERVAL 14 DAY
      GROUP BY page_url
    )
    SELECT
      tw.page_url,
      tw.page_views,
      tw.js_errors,
      tw.lcp_p75_ms,
      tw.inp_p75_ms,
      tw.cls_p75,
      tw.lcp_p75_ms - COALESCE(lw.lcp_p75_ms_lw, tw.lcp_p75_ms) AS lcp_wow_delta_ms
    FROM this_week tw
    LEFT JOIN last_week lw USING (page_url)
    ORDER BY tw.page_views DESC
  `;
}

/* Data age — drives the data-age caption (6.1.3) and the cold-start auto-promote.
   No app/device filter — the caption is a global property of the archive. */
const DATA_AGE_SQL = `
  SELECT
    MIN(date) AS first_date,
    MAX(date) AS last_date,
    CAST(MAX(date) - MIN(date) + INTERVAL 1 DAY AS INTEGER) AS days_collected
  FROM performance_grip__hourly_web_vitals
`;

/* Per-route 30-day LCP sparkline (used when the user expands a route row). */
function routeSparklineSQL({ app, device, pageUrl }) {
  const dev = deviceClause(device);
  return `
    SELECT
      date,
      SUM(lcp_p75_ms * sample_count) / NULLIF(SUM(sample_count), 0) AS lcp_p75_ms,
      SUM(sample_count)                                              AS samples
    FROM performance_grip__hourly_web_vitals
    WHERE app = '${app}'${dev}
      AND date >= CURRENT_DATE - INTERVAL 30 DAY
      AND page_url = '${pageUrl.replaceAll("'", "''")}'
    GROUP BY date
    ORDER BY date
  `;
}

/* ───────────────────────────── Public hook ───────────────────────────── */

export function usePerformanceGrip({ app, device, windowDays }) {
  const [data, setData] = React.useState({});
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const queries = {
      trendlines: trendlineSQL({ app, device, days: windowDays }),
      hero:       heroSQL({ app, device }),
      routes:     routesSQL({ app, device }),
      dataAge:    DATA_AGE_SQL,
    };

    Promise.all(
      Object.entries(queries).map(([key, sql]) =>
        runQuery(sql).then(rows => [key, { rows }]).catch(e => [key, { error: e.message || String(e) }])
      )
    ).then(entries => {
      if (cancelled) return;
      setData(Object.fromEntries(entries));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [app, device, windowDays]);

  return { data, loading, error };
}

export function useRouteSparkline({ app, device, pageUrl }) {
  const [rows, setRows] = React.useState([]);
  React.useEffect(() => {
    if (!pageUrl) { setRows([]); return; }
    let cancelled = false;
    runQuery(routeSparklineSQL({ app, device, pageUrl }))
      .then(r => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [app, device, pageUrl]);
  return rows;
}
```

- [ ] **Step 2: Verify queries parse against the live DuckDB** (smoke test, no automated assertion):

Start backend locally (or rebuild Render) and exercise each query:

```bash
cd backend
.venv/bin/python build_duckdb.py
# Then run uvicorn or just shell into duckdb
.venv/bin/python -c "
import duckdb
con = duckdb.connect('data/grip.duckdb')
print(con.sql('SELECT count(*) FROM performance_grip__hourly_web_vitals').fetchall())
"
```

Expected: non-zero count. Run the trendlines / hero / routes queries by substituting `'${app}'` etc with literal `'gi-client-web'` and `device='mobile'`; each should return rows without SQL errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/queries/performanceGrip.js
git commit -m "feat(performance-grip): query module (SQL specs + usePerformanceGrip hook)"
```

### Task A.2: (Skip) — Backend `/query` endpoint already exists

The `/query` endpoint that `runQuery` calls is the existing platform-shared endpoint (`backend/routers/query.py`). It already serves arbitrary SELECTs against `grip.duckdb`. No backend changes needed.

If `/query` is missing or broken — escalate before continuing. Performance Grip's frontend depends on it working exactly like the other dashboards.

---

## Phase B — Component registration + skeleton

### Task B.1: Create the dashboard component skeleton

**Files:**
- Create: `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx`
- Create: `frontend/components/dashboards/performance-grip/` (subdir for sub-components)

- [ ] **Step 1: Write the dashboard component shell** at `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx`:

```jsx
"use client";

import * as React from "react";
import { usePerformanceGrip } from "@/lib/queries/performanceGrip";

/* Editorial Lite — typography + palette only; no broadsheet masthead. See
   spec §6.5.1 and the M27 decision. */

const APP_DEFAULT = "gi-client-web";       // post-login is the higher-value default
const DEVICE_DEFAULT = "mobile";           // M24: Indian fintech traffic is mostly mobile
// Window auto-promote: 7d / 14d / 30d (no auto-promote to 90d — opt-in only)
function defaultWindow(daysCollected) {
  if (!daysCollected || daysCollected < 14) return 7;
  if (daysCollected < 30) return 14;
  return 30;
}

export default function PerformanceGripDashboardEditorial() {
  const [app,    setApp]    = React.useState(APP_DEFAULT);
  const [device, setDevice] = React.useState(DEVICE_DEFAULT);
  const [windowDays, setWindowDays] = React.useState(7);  // promoted by an effect once data loads

  const { data, loading } = usePerformanceGrip({ app, device, windowDays });

  // Auto-promote default window once we know the archive's age
  const daysCollected = data?.dataAge?.rows?.[0]?.days_collected ?? 0;
  React.useEffect(() => {
    setWindowDays(prev =>
      prev === 7 || prev === 14 || prev === 30
        ? defaultWindow(daysCollected)
        : prev   // user explicitly picked 90d — don't reset
    );
  }, [daysCollected]);

  if (loading) return <SkeletonShell />;

  return (
    <div className="performance-grip-dashboard">
      {/* TODO Phase D: StatusVerdict */}
      {/* TODO Phase D: HeroBand */}
      {/* TODO Phase D: WindowToggle */}
      {/* TODO Phase F: RouteDrilldown */}
      {/* TODO Phase E: MetricTrendGrid */}
      <pre style={{ fontFamily: "monospace", fontSize: 11, padding: 16 }}>
        {JSON.stringify({ app, device, windowDays, daysCollected }, null, 2)}
      </pre>
    </div>
  );
}

function SkeletonShell() {
  return <div style={{ padding: 24 }}>Loading Performance Grip…</div>;
}
```

- [ ] **Step 2: Register in `dashboards/index.js`**:

Add the import:
```jsx
import PerformanceGripDashboardEditorial from "./PerformanceGripDashboardEditorial";
```

Add the entry to `DASHBOARDS`:
```jsx
  PerformanceGripEditorial: {
    editorial: PerformanceGripDashboardEditorial,
  },
```

The key `PerformanceGripEditorial` matches `dashboard_component` in `backend/data/performance_grip/project.json`.

- [ ] **Step 3: Verify the route renders** — start frontend dev server:

```bash
cd frontend
pnpm install
pnpm dev
```

Navigate to `http://localhost:3000/projects/performance_grip` — expect the JSON-dump skeleton to render with non-error data.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx frontend/components/dashboards/index.js
git commit -m "feat(performance-grip): editorial dashboard skeleton + registration"
```

---

## Phase C — MetricTrendCard atom (the most complex single piece)

This is the reused 5× component for the trendline grid (LCP / INP / CLS / FCP / TTFB). Per spec §6.2:
- Three visual layers: threshold bands (background) + p75–p95 spread band (Area) + p75 line
- Fixed Y-axis anchored to amber threshold (not auto-scaled)
- Editorial token colors (`var(--ed-forest)`, `var(--ed-gold)`, `var(--ed-rust)`, `var(--ed-ink)`)
- Tabular numerals via `font-variant-numeric: tabular-nums`
- Inline legend
- Hover tooltip: p75, p95, sample_count, page_views

### Task C.1: Build `MetricTrendCard.jsx`

**Files:**
- Create: `frontend/components/dashboards/performance-grip/MetricTrendCard.jsx`

- [ ] **Step 1: Write the component**:

```jsx
"use client";

import * as React from "react";
import {
  LineChart, Line, Area, ReferenceArea, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

/* Editorial palette tokens (resolved at runtime by browser CSS variables) */
const ED_FOREST = "var(--ed-forest)";
const ED_GOLD   = "var(--ed-gold)";
const ED_RUST   = "var(--ed-rust)";
const ED_INK    = "var(--ed-ink)";

// Calibrated against cream paper at projector resolution (spec §6.2 H14 fix).
// 10% is more visible than the 5% the spec mentioned as a starting point.
const BAND_OPACITY     = 0.10;
const SPREAD_OPACITY   = 0.12;

/* Helper: convert a value field to display ms vs s vs raw float.
   LCP/FCP/TTFB in seconds (the archive stores ms; we ÷1000 for display).
   INP in ms. CLS dimensionless. */
function formatValue(metric, raw) {
  if (raw == null) return "—";
  switch (metric) {
    case "lcp":
    case "fcp":
    case "ttfb":
      return `${(raw / 1000).toFixed(2)}s`;
    case "inp":
      return `${Math.round(raw)}ms`;
    case "cls":
      return raw.toFixed(2);
    default:
      return String(raw);
  }
}

/* Map metric → threshold boundaries in the chart's data unit. */
function thresholdsFor(metric, thresholds) {
  if (metric === "cls") return { good: thresholds.cls.good, ni: thresholds.cls.ni };
  const t = thresholds[metric];
  return { good: t.good_ms, ni: t.ni_ms };
}

export default function MetricTrendCard({
  metric,         // 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'
  metricLabel,    // 'Largest Contentful Paint' / 'INP' / etc.
  metricBlurb,    // 'time until the largest visible element loads' (one-liner under the name)
  rows,           // [{ date, lcp_p75_ms, lcp_p95_ms, ... }, ...]  — from query module
  thresholds,     // imported THRESHOLDS object from performanceGrip.js
}) {
  const t = thresholdsFor(metric, thresholds);
  const p75Key = `${metric}${metric === "cls" ? "_p75" : "_p75_ms"}`;
  const p95Key = `${metric}${metric === "cls" ? "_p95" : "_p95_ms"}`;

  // Latest day's headline p75 value
  const latest = rows.length ? rows[rows.length - 1] : {};
  const latestP75 = latest[p75Key];

  // Fixed Y-axis anchored to thresholds. Range = [0, 1.5 × amber boundary].
  // Keeps the Good→NI line in a stable visual position across days.
  const yMax = t.ni * 1.5;

  return (
    <div className="metric-trend-card" style={{
      border: "1px solid var(--ed-rule-faint)",
      padding: 16,
      background: "var(--ed-paper)",
      fontFeatureSettings: "'tnum' 1",
    }}>
      <div className="metric-trend-card__head">
        <div className="metric-trend-card__name" style={{
          fontFamily: "var(--ed-display, Fraunces, serif)",
          fontSize: 18,
          marginBottom: 4,
        }}>{metricLabel}</div>
        {metricBlurb && (
          <div className="metric-trend-card__blurb" style={{
            fontFamily: "var(--ed-body, Newsreader, serif)",
            fontStyle: "italic",
            fontSize: 11,
            color: "var(--ed-ink-soft)",
            marginBottom: 8,
          }}>{metricBlurb}</div>
        )}
        <div className="metric-trend-card__value" style={{
          fontFamily: "var(--ed-mono, IBM Plex Mono, monospace)",
          fontSize: 32,
          fontVariantNumeric: "tabular-nums",
          color: ED_INK,
        }}>
          {formatValue(metric, latestP75)}
        </div>
      </div>

      <div className="metric-trend-card__chart" style={{ width: "100%", height: 140 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            {/* Threshold bands as ReferenceArea — paint first so they're behind data */}
            <ReferenceArea y1={0}    y2={t.good} fill={ED_FOREST} fillOpacity={BAND_OPACITY} />
            <ReferenceArea y1={t.good} y2={t.ni}   fill={ED_GOLD}   fillOpacity={BAND_OPACITY} />
            <ReferenceArea y1={t.ni}   y2={yMax}   fill={ED_RUST}   fillOpacity={BAND_OPACITY} />

            <CartesianGrid horizontal={false} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={10}
                   stroke="var(--ed-ink-soft)" />
            <YAxis domain={[0, yMax]} fontSize={10} stroke="var(--ed-ink-soft)"
                   tickFormatter={(v) => formatValue(metric, v)} />

            {/* Spread band between p75 and p95 (neutral ink, not the threshold hue) */}
            <Area type="monotone" dataKey={p95Key} stroke="none"
                  fill={ED_INK} fillOpacity={SPREAD_OPACITY}
                  baseLine={(d) => d[p75Key]} isAnimationActive={false} />

            {/* p75 line — the headline */}
            <Line type="monotone" dataKey={p75Key} stroke={ED_INK} strokeWidth={1.5}
                  dot={false} isAnimationActive={false} />

            <Tooltip
              contentStyle={{
                fontFamily: "var(--ed-mono)",
                fontSize: 11,
                background: "var(--ed-paper)",
                border: "1px solid var(--ed-rule)",
              }}
              formatter={(v, k) => [formatValue(metric, v), k]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="metric-trend-card__legend" style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        marginTop: 6,
      }}>
        ── p75   ░░ p75–p95 spread
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in-app rendering** — add a temporary direct-render in the skeleton (uncomment the metric grid section) and confirm:
  - Threshold bands visible (faint forest / gold / rust horizontal stripes)
  - p75 line visible (dark ink, ~1.5px)
  - Spread band visible (light ink wash between p75 and p95)
  - Y-axis is fixed (not auto-scaling) — confirm by viewing different days; the Good→NI boundary stays at the same vertical position

If threshold-band opacity is too subtle on cream paper at projector resolution, bump `BAND_OPACITY` from 0.10 to 0.12 or 0.15. Document the final value with a comment.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/performance-grip/MetricTrendCard.jsx
git commit -m "feat(performance-grip): MetricTrendCard atom with threshold bands + spread band"
```

---

## Phase D — Status verdict + Hero band + Window toggle

### Task D.1: StatusVerdict (rule-based)

**Files:**
- Create: `frontend/components/dashboards/performance-grip/StatusVerdict.jsx`

Per spec §6.1.1. Three states:
- **✓ All Good** — every CWV metric p75 stayed in Good all 7 days
- **⚠ Watch** — any CWV metric p75 crossed into NI on ≥1 day; nothing in Poor
- **🚨 Needs Attention** — any p75 landed in Poor on ≥1 day OR WoW delta exceeded ±10%

- [ ] **Step 1: Write the component**:

```jsx
"use client";
import * as React from "react";

/* Pure function — no state, no effects. Takes trendline rows + thresholds,
   returns { status: 'ok' | 'watch' | 'attention', reason: string }. */
export function computeVerdict(rows, thresholds) {
  if (!rows || rows.length === 0) {
    return { status: "watch", reason: "No data yet — first cron pending." };
  }

  // For each CWV metric (LCP, INP, CLS) check every day's p75 against thresholds.
  const cwv = ["lcp", "inp", "cls"];
  let worstStatus = "ok";
  const reasons = [];

  for (const m of cwv) {
    const key = m === "cls" ? "cls_p75" : `${m}_p75_ms`;
    const t = m === "cls" ? thresholds.cls : thresholds[m];
    const goodMax = m === "cls" ? t.good : t.good_ms;
    const niMax   = m === "cls" ? t.ni   : t.ni_ms;

    let daysInNi = 0, daysInPoor = 0;
    for (const r of rows) {
      const v = r[key];
      if (v == null) continue;
      if (v > niMax) daysInPoor++;
      else if (v > goodMax) daysInNi++;
    }

    if (daysInPoor > 0) {
      worstStatus = "attention";
      reasons.push(`${m.toUpperCase()} p75 in Poor on ${daysInPoor} of last ${rows.length} days`);
    } else if (daysInNi > 0 && worstStatus !== "attention") {
      worstStatus = "watch";
      reasons.push(`${m.toUpperCase()} p75 crossed NI threshold on ${daysInNi} of last ${rows.length} days`);
    }
  }

  return {
    status: worstStatus,
    reason: reasons.length === 0 ? "All Core Web Vitals within Good for the period." : reasons[0],
  };
}

const STATUS_VISUAL = {
  ok:        { label: "All Good",         color: "var(--ed-forest)", icon: "✓" },
  watch:     { label: "Watch",            color: "var(--ed-gold)",   icon: "⚠" },
  attention: { label: "Needs Attention",  color: "var(--ed-rust)",   icon: "🚨" },
};

export default function StatusVerdict({ rows, thresholds }) {
  const { status, reason } = computeVerdict(rows, thresholds);
  const v = STATUS_VISUAL[status];

  return (
    <div className="status-verdict" style={{
      border: `1px solid ${v.color}`,
      padding: 16,
      background: "var(--ed-paper)",
      marginBottom: 24,
    }}>
      <div style={{
        fontFamily: "var(--ed-display)",
        fontSize: 24,
        color: v.color,
        marginBottom: 4,
      }}>
        Status: {v.label} <span style={{ marginLeft: 8 }}>{v.icon}</span>
      </div>
      <div style={{
        fontFamily: "var(--ed-body)",
        fontStyle: "italic",
        fontSize: 14,
        color: "var(--ed-ink)",
      }}>
        {reason}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write tests for `computeVerdict`** (pure function — TDD applies cleanly):

`frontend/components/dashboards/performance-grip/StatusVerdict.test.jsx` (or wherever the existing frontend tests live — check first; otherwise skip the file and verify by visual inspection in dev).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/performance-grip/StatusVerdict.jsx
git commit -m "feat(performance-grip): rule-based StatusVerdict (CWV thresholds)"
```

### Task D.2: HeroBand + WindowToggle

**Files:**
- Create: `frontend/components/dashboards/performance-grip/HeroBand.jsx`
- Create: `frontend/components/dashboards/performance-grip/WindowToggle.jsx`

Per spec §6.1.2 (HeroBand — this-week vs last-week) + §6.1.3 (WindowToggle — `[7d | 14d | 1M | 3M]`).

- [ ] **Step 1: Write `HeroBand.jsx`**:

```jsx
"use client";
import * as React from "react";

/* Display direction: lower-is-better metrics get ↓ = forest, ↑ = rust.
   Higher-is-better (page_views) flip the sign. */
function delta(thisVal, lastVal, lowerIsBetter = true) {
  if (thisVal == null || lastVal == null) return null;
  const diff = thisVal - lastVal;
  const pct = lastVal !== 0 ? (diff / lastVal) * 100 : 0;
  const good = lowerIsBetter ? diff <= 0 : diff >= 0;
  return { diff, pct, good };
}

function fmtDelta(d, unit, signLabel) {
  if (!d) return "—";
  const sign = d.diff > 0 ? "↑" : d.diff < 0 ? "↓" : "→";
  const color = d.good ? "var(--ed-forest)" : "var(--ed-rust)";
  return <span style={{ color, fontFamily: "var(--ed-mono)" }}>{sign} {Math.abs(d.diff).toFixed(2)}{unit} ({d.pct >= 0 ? "+" : ""}{d.pct.toFixed(1)}%)</span>;
}

export default function HeroBand({ heroRows /* from hero query: this_week, last_week */ }) {
  const tw = heroRows?.find(r => r.bucket === "this_week") || {};
  const lw = heroRows?.find(r => r.bucket === "last_week") || {};

  const lcpDelta = delta(tw.lcp_p75_ms, lw.lcp_p75_ms, true);
  const inpDelta = delta(tw.inp_p75_ms, lw.inp_p75_ms, true);
  const errDelta = delta(tw.js_errors / Math.max(tw.page_views, 1) * 1000,
                          lw.js_errors / Math.max(lw.page_views, 1) * 1000, true);

  return (
    <div className="hero-band" style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 16,
      padding: 16,
      background: "var(--ed-paper-deep)",
      marginBottom: 16,
    }}>
      <HeroCell label="p75 LCP this week"
                value={tw.lcp_p75_ms != null ? `${(tw.lcp_p75_ms / 1000).toFixed(2)}s` : "—"}
                delta={fmtDelta(lcpDelta, "ms", "")} />
      <HeroCell label="p75 INP this week"
                value={tw.inp_p75_ms != null ? `${Math.round(tw.inp_p75_ms)}ms` : "—"}
                delta={fmtDelta(inpDelta, "ms", "")} />
      <HeroCell label="JS errors / 1K page views"
                value={tw.page_views ? (tw.js_errors / tw.page_views * 1000).toFixed(1) : "—"}
                delta={fmtDelta(errDelta, "", "")} />
      <HeroCell label="Page views (7d)"
                value={tw.page_views?.toLocaleString() || "—"}
                delta={null} />
    </div>
  );
}

function HeroCell({ label, value, delta }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 24,
        fontVariantNumeric: "tabular-nums",
        color: "var(--ed-ink)",
      }}>{value}</div>
      <div style={{ fontSize: 12, marginTop: 2 }}>{delta}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write `WindowToggle.jsx`**:

```jsx
"use client";
import * as React from "react";

const OPTIONS = [
  { days: 7,  label: "7d"  },
  { days: 14, label: "14d" },
  { days: 30, label: "1M"  },
  { days: 90, label: "3M"  },
];

export default function WindowToggle({ value, onChange, daysCollected }) {
  return (
    <div className="window-toggle" style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 16,
    }}>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 11,
        color: "var(--ed-ink-soft)",
      }}>
        Data: {daysCollected ?? 0} days collected · viewing last
      </div>
      {OPTIONS.map(opt => (
        <button
          key={opt.days}
          onClick={() => onChange(opt.days)}
          style={{
            fontFamily: "var(--ed-mono)",
            fontSize: 11,
            padding: "4px 12px",
            border: value === opt.days
              ? "1px solid var(--ed-ink)"
              : "1px solid var(--ed-rule-faint)",
            background: value === opt.days ? "var(--ed-paper-deep)" : "transparent",
            cursor: "pointer",
            borderRadius: 999,
            // Touch target — minimum 44px on touch devices (spec §6.5)
            minHeight: 32,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire both into the dashboard** — update `PerformanceGripDashboardEditorial.jsx`:

```jsx
import StatusVerdict from "./performance-grip/StatusVerdict";
import HeroBand from "./performance-grip/HeroBand";
import WindowToggle from "./performance-grip/WindowToggle";
import { THRESHOLDS } from "@/lib/queries/performanceGrip";
```

Replace the JSON-dump placeholder with:
```jsx
<>
  <WindowToggle value={windowDays} onChange={setWindowDays} daysCollected={daysCollected} />
  <StatusVerdict rows={data?.trendlines?.rows ?? []} thresholds={THRESHOLDS} />
  <HeroBand heroRows={data?.hero?.rows ?? []} />
</>
```

- [ ] **Step 4: Verify** — refresh `/projects/performance_grip` in dev. Expected:
  - Window toggle visible with `7d` selected
  - Status verdict block with one of the three states
  - Hero band with at least lcp + inp + page_views (errors might be — depending on real data)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboards/performance-grip/HeroBand.jsx \
        frontend/components/dashboards/performance-grip/WindowToggle.jsx \
        frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx
git commit -m "feat(performance-grip): hero band + window toggle + verdict wired"
```

---

## Phase E — Trendline grid (CWV + Secondary)

### Task E.1: `MetricTrendGrid.jsx`

**Files:**
- Create: `frontend/components/dashboards/performance-grip/MetricTrendGrid.jsx`

Per spec §6.1 — 3+2 grid (LCP/INP/CLS in row 1, FCP/TTFB in row 2). Section headers in Fraunces.

- [ ] **Step 1: Write the component**:

```jsx
"use client";
import * as React from "react";
import MetricTrendCard from "./MetricTrendCard";
import { THRESHOLDS } from "@/lib/queries/performanceGrip";

const METRICS = {
  lcp:  { label: "Largest Contentful Paint",  blurb: "Time until the largest visible element loads" },
  inp:  { label: "Interaction to Next Paint", blurb: "Latency of the user's next interaction" },
  cls:  { label: "Cumulative Layout Shift",   blurb: "How much the page visibly jumps after load" },
  fcp:  { label: "First Contentful Paint",    blurb: "When something first appears on screen" },
  ttfb: { label: "Time to First Byte",        blurb: "Server response speed" },
};

const CORE = ["lcp", "inp", "cls"];
const SECONDARY = ["fcp", "ttfb"];

export default function MetricTrendGrid({ rows }) {
  return (
    <div className="metric-trend-grid">
      <Section title="Core Web Vitals">
        <Grid columns={3}>
          {CORE.map(m => (
            <MetricTrendCard
              key={m}
              metric={m}
              metricLabel={METRICS[m].label}
              metricBlurb={METRICS[m].blurb}
              rows={rows}
              thresholds={THRESHOLDS}
            />
          ))}
        </Grid>
      </Section>
      <Section title="Secondary Web Vitals">
        <Grid columns={2}>
          {SECONDARY.map(m => (
            <MetricTrendCard
              key={m}
              metric={m}
              metricLabel={METRICS[m].label}
              metricBlurb={METRICS[m].blurb}
              rows={rows}
              thresholds={THRESHOLDS}
            />
          ))}
        </Grid>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        borderTop: "1px solid var(--ed-ink)",
        paddingTop: 8,
        marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function Grid({ columns, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
      gap: 16,
    }}>{children}</div>
  );
}
```

The `auto-fit, minmax(280px, 1fr)` means:
- 1 col on mobile (< 580px)
- 2-3 col on tablet
- 3 col for Core / 2-3 col for Secondary on desktop

`columns` prop is unused — kept for future explicit-column control. (YAGNI for v1.)

- [ ] **Step 2: Wire into the dashboard**:

```jsx
import MetricTrendGrid from "./performance-grip/MetricTrendGrid";
```

Add to the dashboard's render:
```jsx
<MetricTrendGrid rows={data?.trendlines?.rows ?? []} />
```

- [ ] **Step 3: Verify** — refresh. Should see all 5 metric cards rendered in a responsive grid. At narrow widths (resize browser to <580px), cards stack 1-up. At wide, fill 3-up.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboards/performance-grip/MetricTrendGrid.jsx \
        frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx
git commit -m "feat(performance-grip): metric trendline grid (Core + Secondary)"
```

---

## Phase F — Route drill-down

### Task F.1: `RouteDrilldown.jsx`

**Files:**
- Create: `frontend/components/dashboards/performance-grip/RouteDrilldown.jsx`

Per spec §6.1.4 + §6.4. Top 5 expanded by default, [show 15] expander, sort by week-over-week LCP delta descending.

- [ ] **Step 1: Write the component**:

```jsx
"use client";
import * as React from "react";
import { useRouteSparkline } from "@/lib/queries/performanceGrip";

const DEFAULT_TOP = 5;
const EXPANDED_TOP = 15;

export default function RouteDrilldown({ routeRows, app, device }) {
  const [expanded, setExpanded] = React.useState(false);
  const [openRow, setOpenRow] = React.useState(null);  // page_url of currently-expanded route

  // Sort by WoW LCP delta descending (biggest regressions first); ties → page_views desc
  const sorted = [...(routeRows || [])].sort((a, b) => {
    const da = a.lcp_wow_delta_ms ?? 0;
    const db = b.lcp_wow_delta_ms ?? 0;
    if (db !== da) return db - da;
    return (b.page_views ?? 0) - (a.page_views ?? 0);
  });

  const visible = sorted.slice(0, expanded ? EXPANDED_TOP : DEFAULT_TOP);
  const otherRows = sorted.slice(expanded ? EXPANDED_TOP : DEFAULT_TOP);
  const otherViews = otherRows.reduce((s, r) => s + (r.page_views ?? 0), 0);

  return (
    <section className="route-drilldown" style={{ marginTop: 24 }}>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        borderTop: "1px solid var(--ed-ink)",
        paddingTop: 8,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>Routes — top {expanded ? EXPANDED_TOP : DEFAULT_TOP} by week-over-week LCP regression</span>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            fontFamily: "var(--ed-mono)",
            fontSize: 10,
            background: "none",
            border: "none",
            color: "var(--ed-ink-soft)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {expanded ? "[show 5]" : `[show ${EXPANDED_TOP}]`}
        </button>
      </div>

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--ed-mono)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--ed-ink-soft)" }}>
            <th style={{ padding: 6 }}>Route</th>
            <th style={{ padding: 6, textAlign: "right" }}>Views (7d)</th>
            <th style={{ padding: 6, textAlign: "right" }}>LCP p75</th>
            <th style={{ padding: 6, textAlign: "right" }}>INP p75</th>
            <th style={{ padding: 6, textAlign: "right" }}>WoW Δ LCP</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <RouteRow key={r.page_url} row={r}
                      isOpen={openRow === r.page_url}
                      onToggle={() => setOpenRow(openRow === r.page_url ? null : r.page_url)}
                      app={app} device={device} />
          ))}
          {otherRows.length > 0 && (
            <tr style={{ borderTop: "1px solid var(--ed-rule-faint)", color: "var(--ed-ink-soft)" }}>
              <td style={{ padding: 6 }}>Other pages ({otherRows.length})</td>
              <td style={{ padding: 6, textAlign: "right" }}>{otherViews.toLocaleString()}</td>
              <td colSpan={3}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function RouteRow({ row, isOpen, onToggle, app, device }) {
  const wow = row.lcp_wow_delta_ms;
  const wowColor = wow > 0 ? "var(--ed-rust)" : wow < 0 ? "var(--ed-forest)" : "var(--ed-ink-soft)";
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", borderTop: "1px solid var(--ed-rule-faint)" }}>
        <td style={{ padding: 6 }}>{row.page_url}</td>
        <td style={{ padding: 6, textAlign: "right" }}>{row.page_views?.toLocaleString()}</td>
        <td style={{ padding: 6, textAlign: "right" }}>{row.lcp_p75_ms ? `${(row.lcp_p75_ms / 1000).toFixed(2)}s` : "—"}</td>
        <td style={{ padding: 6, textAlign: "right" }}>{row.inp_p75_ms != null ? `${Math.round(row.inp_p75_ms)}ms` : "—"}</td>
        <td style={{ padding: 6, textAlign: "right", color: wowColor }}>
          {wow == null ? "—" : `${wow >= 0 ? "+" : ""}${(wow / 1000).toFixed(2)}s`}
        </td>
      </tr>
      {isOpen && <RouteSparklineRow pageUrl={row.page_url} app={app} device={device} />}
    </>
  );
}

function RouteSparklineRow({ pageUrl, app, device }) {
  const rows = useRouteSparkline({ app, device, pageUrl });
  // Inline minimal sparkline — Recharts-based but smaller
  return (
    <tr>
      <td colSpan={5} style={{ padding: "8px 6px", background: "var(--ed-paper-deep)" }}>
        <div style={{
          fontFamily: "var(--ed-mono)",
          fontSize: 10,
          color: "var(--ed-ink-soft)",
          marginBottom: 4,
        }}>30-day LCP p75 trend</div>
        {rows.length > 0 ? (
          <Sparkline rows={rows} />
        ) : (
          <div style={{ color: "var(--ed-ink-soft)" }}>No data yet for this route.</div>
        )}
      </td>
    </tr>
  );
}

function Sparkline({ rows }) {
  // Inline SVG sparkline — light enough to avoid full Recharts overhead per row.
  const w = 480, h = 40, pad = 4;
  const max = Math.max(...rows.map(r => r.lcp_p75_ms || 0), 4000);
  const points = rows.map((r, i) => {
    const x = pad + (i / Math.max(rows.length - 1, 1)) * (w - 2 * pad);
    const y = h - pad - ((r.lcp_p75_ms || 0) / max) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke="var(--ed-ink)" strokeWidth={1.25} />
    </svg>
  );
}
```

- [ ] **Step 2: Wire into the dashboard** — between Hero and MetricTrendGrid (per spec §6.1.4: drill-down sits BELOW status verdict + hero, ABOVE the trendline grid):

```jsx
import RouteDrilldown from "./performance-grip/RouteDrilldown";
```

```jsx
<RouteDrilldown routeRows={data?.routes?.rows ?? []} app={app} device={device} />
<MetricTrendGrid rows={data?.trendlines?.rows ?? []} />
```

- [ ] **Step 3: Verify** — refresh. Should see the routes table with Top 5 expanded; click a row to see its sparkline. `[show 15]` toggles the expansion.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboards/performance-grip/RouteDrilldown.jsx \
        frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx
git commit -m "feat(performance-grip): route drill-down with sparkline expand"
```

---

## Phase G — App switcher + Device toggle (visually differentiated)

Per spec §6.5.1 H17: app switcher = tabs (primary nav), device toggle = filter chip (secondary). Both sticky-headerable.

### Task G.1: `AppSwitcher.jsx` + `DeviceToggle.jsx`

**Files:**
- Create: `frontend/components/dashboards/performance-grip/AppSwitcher.jsx`
- Create: `frontend/components/dashboards/performance-grip/DeviceToggle.jsx`

- [ ] **Step 1: Write `AppSwitcher.jsx`** (underline tabs, primary nav):

```jsx
"use client";
import * as React from "react";

const APPS = [
  { slug: "gi-client-static", label: "GI Client Static" },
  { slug: "gi-client-web",    label: "GI Client Web"    },
];

export default function AppSwitcher({ value, onChange }) {
  return (
    <div role="tablist" aria-label="App switcher" style={{
      display: "flex",
      gap: 24,
      borderBottom: "1px solid var(--ed-rule-faint)",
      marginBottom: 16,
    }}>
      {APPS.map(app => {
        const active = value === app.slug;
        return (
          <button
            key={app.slug}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(app.slug)}
            style={{
              fontFamily: "var(--ed-display)",
              fontSize: 16,
              padding: "12px 4px",
              background: "none",
              border: "none",
              borderBottom: active ? "2px solid var(--ed-ink)" : "2px solid transparent",
              color: active ? "var(--ed-ink)" : "var(--ed-ink-soft)",
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {app.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write `DeviceToggle.jsx`** (filter chips, secondary, rounded pill):

```jsx
"use client";
import * as React from "react";

const DEVICES = [
  { value: "all",     label: "All"     },
  { value: "mobile",  label: "Mobile"  },
  { value: "desktop", label: "Desktop" },
  { value: "tablet",  label: "Tablet"  },
];

export default function DeviceToggle({ value, onChange }) {
  return (
    <div role="group" aria-label="Device filter" style={{
      display: "inline-flex",
      gap: 6,
      marginBottom: 16,
    }}>
      <span style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        alignSelf: "center",
        marginRight: 6,
      }}>Device:</span>
      {DEVICES.map(d => {
        const active = value === d.value;
        return (
          <button
            key={d.value}
            aria-pressed={active}
            onClick={() => onChange(d.value)}
            style={{
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid var(--ed-rule-faint)",
              background: active ? "var(--ed-paper-deep)" : "transparent",
              color: active ? "var(--ed-ink)" : "var(--ed-ink-soft)",
              cursor: "pointer",
              minHeight: 32,
            }}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire both into the dashboard** — add at the TOP, before the WindowToggle:

```jsx
import AppSwitcher from "./performance-grip/AppSwitcher";
import DeviceToggle from "./performance-grip/DeviceToggle";
```

```jsx
<AppSwitcher value={app} onChange={setApp} />
<DeviceToggle value={device} onChange={setDevice} />
<WindowToggle ... />
```

- [ ] **Step 4: Verify** — refresh. Switch between apps; the trendlines + verdict + hero should update (the hook re-runs queries on `app` change).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboards/performance-grip/AppSwitcher.jsx \
        frontend/components/dashboards/performance-grip/DeviceToggle.jsx \
        frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx
git commit -m "feat(performance-grip): app switcher (tabs) + device toggle (filter chip)"
```

---

## Phase H — Mobile polish + production deploy

### Task H.1: Mobile-first verification at 375px

**Files:**
- Modify: `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx` (if any responsive tweaks needed)

- [ ] **Step 1: Browser at 375px-wide** (Chrome DevTools mobile preset, iPhone SE):

Walk through:
- App switcher tabs stack horizontally and fit
- Device toggle filter chips wrap if needed
- WindowToggle fits — may wrap onto a second line, that's fine
- Status verdict + Hero band stack vertically
- Route drill-down table — columns may be tight. Acceptable in v1; consider horizontal scroll wrapper if it's really cramped.
- Trendline grid: cards stack 1-up (auto-fit minmax should do this; verify)

Anything visually broken → fix inline. Add `overflow-x: auto` to the route table's wrapper if cells overflow.

- [ ] **Step 2: At 1280px (laptop) and 1920px (projector)**:

- Trendline cards: 3-up for CWV, 2-up for Secondary
- Status verdict + Hero band side-by-side (or stacked, both work)
- Route table: full-width

- [ ] **Step 3: Commit any tweaks**

```bash
git add frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx
git commit -m "fix(performance-grip): mobile/desktop responsive polish"
```

### Task H.2: Deploy to production

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin feat/performance-grip-dashboard
gh pr create --base main --title "feat(performance-grip): editorial dashboard (Plan 2)" \
  --body "Ships the Performance Grip Editorial dashboard per spec §6. Reads the existing performance_grip__hourly_web_vitals DuckDB table that Plan 1's cron is populating."
```

- [ ] **Step 2: Merge to main**

```bash
gh pr merge --merge
```

Render auto-redeploys the backend; Vercel (or whichever frontend host) auto-redeploys the frontend on push to main.

- [ ] **Step 3: Manual UAT against production**

Navigate to `https://<frontend-host>/projects/performance_grip`. Verify:
- Page renders without errors
- Status verdict shows real state
- Hero band shows real numbers (week-over-week if 14+ days of data; otherwise this-week only)
- Route table populated
- Trendlines visible (5 cards) with threshold bands
- Switching between apps + devices updates data without page reload

If any 404/500: check Render backend logs for `/query` errors.

- [ ] **Step 4: Update session log**

Append a new entry to `docs/projects/performance-grip/session-log.md` noting Plan 2 shipped, date, and any observations from initial UAT.

---

## Self-review (run by plan author before delivery)

**Spec coverage:** Every section of spec §6 is implemented or explicitly noted as out-of-v1:

- §6.1 IA → Phase B (skeleton) + sequential phase wiring
- §6.1.1 Status verdict → Phase D Task D.1
- §6.1.2 Hero band → Phase D Task D.2
- §6.1.3 Window toggle (replaces banner) → Phase D Task D.2
- §6.1.4 Route drill-down (promoted up) → Phase F
- §6.2 MetricTrendCard atom → Phase C
- §6.3 Cold-start (folded into window toggle) → Phase D + window-toggle copy
- §6.4 Route drill-down impl notes → Phase F
- §6.5 Device toggle (page-level) → Phase G
- §6.5.1 Implementation notes → applied: Editorial Lite (M27), `--ed-grain` disabled, per-metric unit lock, drill-down sparkline expand, Mobile default
- §6.6 Out of scope — confirmed not implemented (no editorial prose beyond blurbs, no causal attribution, no cross-app comparison chart, no threshold alerts, no PDF export, no `?as-of` date picker)

**Placeholders scan:** Search the plan for "TBD" / "TODO" / unfinished — none.

**Type/function consistency:** `usePerformanceGrip` hook returns `{ data, loading, error }` consistently. `THRESHOLDS` exported and consumed by both StatusVerdict and MetricTrendCard.

**Plan length:** ~1,200 lines (well under Plan 1's 2,650 — frontend is less algorithmically detailed than backend was).

---

## Execution handoff

Two execution options (per writing-plans skill):

**1. Subagent-driven (recommended)** — fresh agent per task. Best for an evening/morning of focused dashboard work; matches how Plan 1 was executed.

**2. Inline execution** — drive interactively in the current session.

Either way, the implementer needs:
- A new worktree `.claude/worktrees/performance-grip-dashboard` off `origin/main` (preflight step)
- Backend running locally OR an accessible Render deployment serving `/query` against the live DuckDB
- The first cron commit (`75e4ae3`) on main so DuckDB has data to query

Plan 2 has fewer hard gates than Plan 1 — the data shape is already known (real production CSV exists), and the frontend code is mostly composition rather than algorithmic. Each phase produces an incrementally-visible UI improvement; you can stop at any phase boundary and the dashboard is still usable (just less complete).
