/**
 * SQL query specs + a theme-agnostic data hook for the FRA YouTube project.
 *
 * Extracted from the inline `useFraYoutube` of FraYoutubeDashboard.jsx so the
 * editorial dashboard (and a deferred classic rewrite) can share one source of
 * truth for what is queried and how the results are shaped.
 *
 * The data is 10 layer-2 tables in DuckDB (`fra_youtube__*`), each carrying a
 * `snapshot_date`; every query pins to the latest snapshot. `/query` permits
 * `SELECT` only, which is why the cumulative-views series (see CUMULATIVE_VIEWS
 * below) is a window function over an existing table rather than a backend job.
 */

import * as React from "react";
import { runQuery } from "@/lib/api";

/* ── SQL query specs ──────────────────────────────────────────────────────────
   Keyed by the name the dashboard reads them back by. Every key resolves to a
   { rows } or { error } entry on the hook's `data` object. */

export const SQL = {
  /* Full overview history, latest first — rowsOf(...)[0] is the current
     snapshot; the rest feed computeTrend's day/week deltas. */
  overview: `
    SELECT * FROM fra_youtube__overview
    ORDER BY snapshot_date DESC
  `,
  distribution: `
    SELECT * FROM fra_youtube__distribution
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__distribution)
  `,
  channelSnapshots: `
    SELECT snapshot_date, total_views
    FROM fra_youtube__channel_snapshots
    ORDER BY snapshot_date
  `,
  monthlyViews: `
    SELECT * FROM fra_youtube__monthly_views
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__monthly_views)
    ORDER BY month
  `,
  /* The Growth-section reconstruction (spec §4). `channel_snapshots` holds one
     row today and grows by one per daily refresh, so a snapshot-delta trend
     cannot show history retroactively. Each video carries `published_at` +
     lifetime views, so a running SUM() over the monthly-views table yields a
     ~10-point cumulative library-views series back to Jul 2025.

     Honest caveat (surfaced in the UI): this is the cumulative lifetime views
     of videos *published through* month M — a library-accumulation proxy, not
     the channel's true total view count on that date, since older videos keep
     accruing views after their publish month. */
  cumulativeViews: `
    SELECT month, total_views,
           SUM(total_views) OVER (ORDER BY month) AS cumulative_views
    FROM fra_youtube__monthly_views
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__monthly_views)
    ORDER BY month
  `,
  categoryMix: `
    SELECT * FROM fra_youtube__category_mix
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__category_mix)
    ORDER BY perf_vs_mean_pct DESC
  `,
  engagement: `
    SELECT * FROM fra_youtube__engagement_breakdown
    WHERE dimension = 'category'
      AND snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__engagement_breakdown)
  `,
  cadenceDay: `
    SELECT * FROM fra_youtube__posting_patterns
    WHERE dimension = 'day'
      AND snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__posting_patterns)
  `,
  cadenceHour: `
    SELECT * FROM fra_youtube__posting_patterns
    WHERE dimension = 'hour'
      AND snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__posting_patterns)
  `,
  titlePatterns: `
    SELECT * FROM fra_youtube__title_patterns
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__title_patterns)
    ORDER BY avg_views DESC
  `,
  catalogHealth: `
    SELECT * FROM fra_youtube__catalog_health
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__catalog_health)
  `,
  /* Raw per-video view counts — used by the §3 histogram to bucket client-side.
     Pins to the latest snapshot so it stays consistent with all other queries. */
  videoViews: `
    SELECT views FROM fra_youtube__video_snapshots
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__video_snapshots)
  `,
};

/* ── small accessors ──────────────────────────────────────────────────────────
   Shared by both renderings — `data[key]` is either { rows } or { error }. */

export const rowsOf = (data, key) => (data && data[key] && data[key].rows) || [];
export const errOf = (data, key) => (data && data[key] && data[key].error) || null;

/* ── snapshot-history trend ───────────────────────────────────────────────────
   The "At a glance" deltas both dashboards show. The backend's overview.*_delta
   columns only diff against the single prior snapshot; we instead read the full
   overview history and compute TWO windows per core metric:

   - `day`  — vs the immediately preceding snapshot ("vs yesterday").
   - `week` — vs the most recent snapshot ≥7 days before the latest
              ("vs last week" — the today-vs-same-day-last-week read).

   Each window carries a per-metric delta map. `week` is null until the history
   is at least a week deep — it then populates automatically. `computeTrend`
   returns null when there is only one snapshot (nothing to compare yet). */

/* Core metrics tracked for deltas. subscriber_efficiency is derived
   (total_views ÷ subscribers); the rest are fra_youtube__overview columns. */
export const TREND_FIELDS = [
  "subscribers", "total_views", "video_count",
  "avg_views", "median_views", "avg_duration_sec", "subscriber_efficiency",
];

const _dayMs = 86400000;
const _dayOf = (s) => new Date(String(s ?? "").slice(0, 10)).getTime();
const _num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/* The seven tracked metrics for one overview row, subscriber_efficiency derived. */
function _metricsOf(row) {
  const subs = _num(row.subscribers);
  const views = _num(row.total_views);
  return {
    subscribers: subs,
    total_views: views,
    video_count: _num(row.video_count),
    avg_views: _num(row.avg_views),
    median_views: _num(row.median_views),
    avg_duration_sec: _num(row.avg_duration_sec),
    subscriber_efficiency: subs && views != null ? views / subs : null,
  };
}

function _windowLabel(spanDays, kind) {
  if (kind === "day") return spanDays === 1 ? "vs yesterday" : `vs ${spanDays} days ago`;
  return spanDays >= 6 && spanDays <= 8 ? "vs last week" : `vs ${spanDays} days ago`;
}

/* One comparison window — per-metric deltas of `latest` against `baseline`. */
function _diffWindow(latest, baseline, kind) {
  if (!baseline) return null;
  const lm = _metricsOf(latest);
  const bm = _metricsOf(baseline);
  const deltas = {};
  for (const f of TREND_FIELDS) {
    deltas[f] = lm[f] != null && bm[f] != null ? lm[f] - bm[f] : null;
  }
  const spanDays = Math.max(
    1, Math.round((_dayOf(latest.snapshot_date) - _dayOf(baseline.snapshot_date)) / _dayMs));
  return {
    baselineDate: String(baseline.snapshot_date).slice(0, 10),
    spanDays,
    label: _windowLabel(spanDays, kind),
    deltas,
  };
}

export function computeTrend(overviewRows) {
  if (!overviewRows || overviewRows.length < 2) return null;

  const rows = [...overviewRows].sort((a, b) =>
    String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const latest = rows[rows.length - 1];
  const latestDay = _dayOf(latest.snapshot_date);
  if (Number.isNaN(latestDay)) return null;

  // day window: the immediately preceding snapshot.
  const prior = rows[rows.length - 2];
  // week window: the most recent snapshot ≥7 days before the latest.
  let weekAgo = null;
  for (let i = rows.length - 2; i >= 0; i--) {
    const d = _dayOf(rows[i].snapshot_date);
    if (!Number.isNaN(d) && (latestDay - d) / _dayMs >= 7) { weekAgo = rows[i]; break; }
  }

  return {
    asOf: String(latest.snapshot_date).slice(0, 10),
    day: _diffWindow(latest, prior, "day"),
    week: _diffWindow(latest, weekAgo, "week"),
  };
}

/* ── data hook ────────────────────────────────────────────────────────────────
   Theme-agnostic: runs every SQL spec in parallel against the project and
   resolves to { loading, error, data }. A single failing query becomes a
   per-key { error } entry rather than blanking the whole report. */

export function useFraYoutube(projectId) {
  const [state, setState] = React.useState({ loading: true, error: null, data: {} });

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: {} });

    const run = async (key, sql) => {
      try {
        const res = await runQuery(projectId, sql, 1000);
        return [key, res && res.error ? { error: res.error } : { rows: (res && res.rows) || [] }];
      } catch (e) {
        return [key, { error: String((e && e.message) || e) }];
      }
    };

    (async () => {
      const jobs = Object.entries(SQL).map(([key, sql]) => run(key, sql));
      const entries = await Promise.all(jobs);
      if (cancelled) return;
      const data = Object.fromEntries(entries);
      // Fatal only when every query failed — one bad table must not blank
      // the whole report.
      const allFailed = entries.length > 0 && entries.every(([, v]) => v.error);
      setState({
        loading: false,
        error: allFailed ? entries[0][1].error : null,
        data,
      });
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  return state;
}
