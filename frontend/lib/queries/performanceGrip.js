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

/* The project id — the path segment for /api/projects/{id}/query and the
   backend's data dir key. runQuery's signature is (projectId, sql, limit). */
const PROJECT_ID = "performance_grip";

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

/* ── Outlier handling ────────────────────────────────────────────────────────
   NR Web Vitals carry garbage extremes — idle-tab INP of 70+ hours, CLS of 6,
   hung-page LCP of 1000s. We re-aggregate per-hour percentiles with a weighted
   mean, which amplifies them. So before aggregating we:
     · clamp each metric to a sane ceiling (above it is an artifact, not a
       real measurement — CrUX-style tools do the same), and
     · drop (url,hour) rows backed by fewer than MIN_SAMPLES readings — too
       noisy to trust; outliers cluster in tiny-sample buckets.
   Both clamped and dropped rows are still COUNTED (see outlierCount) so the
   dashboard can show how many readings were set aside — some may be real. */
const CAP = { lcp: 60000, inp: 10000, cls: 1.0, fcp: 60000, ttfb: 60000 };
const MIN_SAMPLES = 3;

/* Column name for a metric+stat. CLS is dimensionless (`cls_p75`); the timing
   metrics carry the `_ms` suffix (`lcp_p75_ms`). */
function col(metric, stat) {
  return metric === "cls" ? `cls_${stat}` : `${metric}_${stat}_ms`;
}

/* A clamped, sample-filtered, page-view-... no — sample-weighted average for
   one metric column. Rows below MIN_SAMPLES are excluded; values are clamped
   to CAP[metric] before the weighted mean. */
function wavg(metric, stat) {
  const c = col(metric, stat);
  const cap = CAP[metric];
  const keep = `FILTER (WHERE sample_count >= ${MIN_SAMPLES})`;
  return `SUM(LEAST(${c}, ${cap}) * sample_count) ${keep} `
       + `/ NULLIF(SUM(sample_count) ${keep}, 0)`;
}

/* Count of (url,hour) rows set aside for one metric — either too few samples
   to trust, or a p75 above the cap (clamped). Drives the per-card
   "N set aside" caption. */
function outlierCount(metric) {
  const c = col(metric, "p75");
  return `COUNT(*) FILTER (WHERE sample_count < ${MIN_SAMPLES} OR ${c} > ${CAP[metric]})`;
}

/* Build per-day trendline aggregates from the hourly archive. Page-view-weighted
   averages across the day's hours per (page_url) — then dashboard rolls up to
   site-level by page-view-weighted average across page_urls. */
function trendlineSQL({ app, device, days }) {
  const dev = deviceClause(device);
  return `
    SELECT
      date,
      SUM(page_views)   AS page_views_total,
      SUM(js_errors)    AS js_errors_total,
      SUM(sample_count) AS sample_count_total,
      COUNT(*)          AS reading_count,
      ${wavg("lcp",  "p75")} AS lcp_p75_ms,
      ${wavg("lcp",  "p95")} AS lcp_p95_ms,
      ${wavg("inp",  "p75")} AS inp_p75_ms,
      ${wavg("inp",  "p95")} AS inp_p95_ms,
      ${wavg("cls",  "p75")} AS cls_p75,
      ${wavg("cls",  "p95")} AS cls_p95,
      ${wavg("fcp",  "p75")} AS fcp_p75_ms,
      ${wavg("fcp",  "p95")} AS fcp_p95_ms,
      ${wavg("ttfb", "p75")} AS ttfb_p75_ms,
      ${wavg("ttfb", "p95")} AS ttfb_p95_ms,
      ${outlierCount("lcp")}  AS lcp_outliers,
      ${outlierCount("inp")}  AS inp_outliers,
      ${outlierCount("cls")}  AS cls_outliers,
      ${outlierCount("fcp")}  AS fcp_outliers,
      ${outlierCount("ttfb")} AS ttfb_outliers
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
        SUM(page_views)   AS page_views,
        SUM(js_errors)    AS js_errors,
        SUM(sample_count) AS samples,
        ${wavg("lcp", "p75")} AS lcp_p75_ms,
        ${wavg("inp", "p75")} AS inp_p75_ms
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
        SUM(page_views) AS page_views,
        SUM(js_errors)  AS js_errors,
        ${wavg("lcp", "p75")} AS lcp_p75_ms,
        ${wavg("inp", "p75")} AS inp_p75_ms,
        ${wavg("cls", "p75")} AS cls_p75
      FROM performance_grip__hourly_web_vitals
      WHERE app = '${app}'${dev}
        AND date >= CURRENT_DATE - INTERVAL 7 DAY
      GROUP BY page_url
    ),
    last_week AS (
      SELECT
        page_url,
        ${wavg("lcp", "p75")} AS lcp_p75_ms_lw
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
    MIN(CAST(date AS DATE)) AS first_date,
    MAX(CAST(date AS DATE)) AS last_date,
    (MAX(CAST(date AS DATE)) - MIN(CAST(date AS DATE))) + 1 AS days_collected
  FROM performance_grip__hourly_web_vitals
`;

/* Per-route 30-day LCP sparkline (used when the user expands a route row). */
function routeSparklineSQL({ app, device, pageUrl }) {
  const dev = deviceClause(device);
  return `
    SELECT
      date,
      ${wavg("lcp", "p75")} AS lcp_p75_ms,
      SUM(sample_count)     AS samples
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
        runQuery(PROJECT_ID, sql, 1000)
          .then(res => [key, res && res.error ? { error: res.error } : { rows: (res && res.rows) || [] }])
          .catch(e => [key, { error: e.message || String(e) }])
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
    runQuery(PROJECT_ID, routeSparklineSQL({ app, device, pageUrl }), 1000)
      .then(res => { if (!cancelled) setRows((res && res.rows) || []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [app, device, pageUrl]);
  return rows;
}
