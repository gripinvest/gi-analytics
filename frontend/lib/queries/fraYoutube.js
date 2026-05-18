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
  overview: `
    SELECT * FROM fra_youtube__overview
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__overview)
  `,
  distribution: `
    SELECT * FROM fra_youtube__distribution
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__distribution)
  `,
  channelSnapshots: `
    SELECT snapshot_date, subscribers, total_views
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
   The "At a glance" delta both dashboards show. The backend's
   overview.*_delta columns only diff against the single prior snapshot — with
   daily refreshes that is a same-day-ish read and reports ±0 whenever the
   channel was flat for a day. A week-over-week window is the more honest tick.

   computeTrend picks the comparison baseline from the channel_snapshots
   history: the most recent snapshot at least 7 days before the latest (a true
   week-over-week), or the earliest available row when the history is younger
   than a week. Returns null when there is only one snapshot — nothing to
   compare against yet. */
export function computeTrend(channelSnapshotRows) {
  if (!channelSnapshotRows || channelSnapshotRows.length < 2) return null;

  const rows = [...channelSnapshotRows].sort((a, b) =>
    String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const latest = rows[rows.length - 1];
  const dayMs = 86400000;
  const latestDay = new Date(String(latest.snapshot_date).slice(0, 10)).getTime();
  if (Number.isNaN(latestDay)) return null;

  // Baseline: the most recent snapshot ≥7 days older than the latest; when the
  // history is younger than a week, fall back to the earliest row.
  let baseline = rows[0];
  for (let i = rows.length - 2; i >= 0; i--) {
    const d = new Date(String(rows[i].snapshot_date).slice(0, 10)).getTime();
    if (!Number.isNaN(d) && (latestDay - d) / dayMs >= 7) { baseline = rows[i]; break; }
  }
  const baselineDay = new Date(String(baseline.snapshot_date).slice(0, 10)).getTime();
  const spanDays = Math.max(1, Math.round((latestDay - baselineDay) / dayMs));
  const diff = (a, b) => {
    const x = a == null || a === "" ? null : Number(a);
    const y = b == null || b === "" ? null : Number(b);
    return x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y) ? x - y : null;
  };

  return {
    baselineDate: String(baseline.snapshot_date).slice(0, 10),
    spanDays,
    subscribers: diff(latest.subscribers, baseline.subscribers),
    totalViews: diff(latest.total_views, baseline.total_views),
  };
}

/** Human label for a trend's comparison window — used as the delta's caption. */
export function trendLabel(trend) {
  if (!trend) return "";
  if (trend.spanDays === 1) return "vs yesterday";
  if (trend.spanDays >= 6 && trend.spanDays <= 8) return "vs last week";
  return `vs ${trend.spanDays} days ago`;
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
