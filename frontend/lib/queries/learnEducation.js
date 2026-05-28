/**
 * Data hook for the Learn (Grip Education) dashboard.
 *
 * gi-client-web events live on develop (PR #6226, 2026-05-26). The
 * backend daily cron pulls the weekly A/B tracker into
 * `backend/data/learn_education/weekly_ab_tracker.csv`, which
 * build_duckdb bakes into the table
 * `learn_education__weekly_ab_tracker`. The hook queries that table
 * via runQuery; on empty rows (no W1 data yet) it falls back to the
 * canonical product-spreadsheet mock so the dashboard renders
 * meaningfully even pre-launch.
 *
 * `nonce` bumps from RefreshControl after a successful backend
 * refresh, re-triggering the live query. The mock fallback path
 * never refetches — it's a deterministic constant.
 *
 * Spec: docs/projects/learn-education/specs/2026-05-26-weekly-ab-tracker.md
 */

import * as React from 'react';
import { runQuery } from '@/lib/api';

export const PROJECT_ID = 'learn_education';

const LIVE_SQL = `
  SELECT
    week_start,
    variant,
    total_non_invested_users,
    learn_page_visitors,
    learn_visit_rate_pct,
    unique_video_players,
    total_video_plays,
    avg_videos_per_user,
    avg_watch_time_sec,
    fti_users,
    fti_users_who_watched,
    fti_rate_pct,
    engaged_visitor_rate_pct,
    plays_per_visitor,
    drop_after_first_pct,
    completion_rate_pct,
    median_time_to_first_play_sec,
    outbound_click_rate_pct,
    banner_ctr_on_learn_pct
  FROM learn_education__weekly_ab_tracker
  ORDER BY week_start, variant
`;

/* The canonical column set, in product-spreadsheet order. The component
 * uses this to drive both the table and the metric-strip headers.
 *
 * MUST match `CANONICAL_COLUMNS` in
 * backend/services/integrations/learn_education.py exactly. A mismatch
 * silently corrupts the table — there's a backend test pinning the order.
 */
export const COLUMNS = [
  // Tier 1 — product-spreadsheet columns.
  { key: 'total_non_invested_users',  label: 'Total Non-Invested Users', kind: 'count'   },
  { key: 'learn_page_visitors',       label: 'Learn Page Visitors',      kind: 'count'   },
  { key: 'learn_visit_rate_pct',      label: 'Learn Visit Rate',         kind: 'pct'     },
  { key: 'unique_video_players',      label: 'Unique Video Players',     kind: 'count'   },
  { key: 'total_video_plays',         label: 'Total Video Plays',        kind: 'count'   },
  { key: 'avg_videos_per_user',       label: 'Avg Videos / User',        kind: 'decimal' },
  { key: 'avg_watch_time_sec',        label: 'Avg Watch Time',           kind: 'seconds' },
  { key: 'fti_users',                 label: 'FTI Users',                kind: 'count'   },
  { key: 'fti_users_who_watched',     label: 'FTI ∩ Watched',            kind: 'count'   },
  { key: 'fti_rate_pct',              label: 'FTI Rate',                 kind: 'pct'     },
  // Tier 2 — derived metrics, V2.
  { key: 'engaged_visitor_rate_pct',  label: 'Engaged-Visitor Rate',     kind: 'pct',
    tier: 2, hint: 'of visitors who played at least one video' },
  { key: 'plays_per_visitor',         label: 'Plays / Visitor',          kind: 'decimal',
    tier: 2 },
  { key: 'drop_after_first_pct',      label: 'Drop After First',         kind: 'pct',
    tier: 2, hint: 'players who watched only one' },
  { key: 'completion_rate_pct',       label: 'Completion Rate (≥75%)',   kind: 'pct',
    tier: 2 },
  { key: 'median_time_to_first_play_sec', label: 'Time to First Play',   kind: 'seconds',
    tier: 2, hint: 'median, page-view → video-open' },
  { key: 'outbound_click_rate_pct',   label: 'Outbound CTR',             kind: 'pct',
    tier: 2, hint: 'in-grid banner taps off /learn' },
  { key: 'banner_ctr_on_learn_pct',   label: 'Banner CTR on /learn',     kind: 'pct',
    tier: 2 },
];

/* Empty-state shape — what the dashboard renders before the first cron
 * fills the DuckDB table. The Editorial dashboard's GALLEY PROOF /
 * "On the presses…" surfaces handle the no-rows case gracefully. */
const EMPTY_META = {
  is_mock: false,
  is_empty: true,
  data_window: '—',
  last_refreshed: null,
  cohort_assignment_total: 0,
  cohort_treatment_pct: 0,
  control_visit_rate_pct: 0,
};

/* Derive the headline meta strip from live rows. Used both by the
 * dashboard's masthead and as the source for SRM / Control-leak
 * health checks. Pure function — no I/O. */
function deriveMeta(rows) {
  if (!rows || rows.length === 0) return EMPTY_META;
  // Sum cohort across all weeks (the experiment denominator stays
  // sticky across time).
  let cohortTotal = 0;
  let treatmentTotal = 0;
  // Latest Control row provides the surface-leak check.
  let controlVisitRatePct = 0;
  const weeks = new Set();
  for (const r of rows) {
    cohortTotal += r.total_non_invested_users ?? 0;
    if (r.variant && r.variant !== 'control') {
      treatmentTotal += r.total_non_invested_users ?? 0;
    }
    if (r.variant === 'control' && r.learn_visit_rate_pct != null) {
      controlVisitRatePct = Math.max(controlVisitRatePct, r.learn_visit_rate_pct);
    }
    if (r.week_start) weeks.add(r.week_start);
  }
  const sortedWeeks = [...weeks].sort();
  return {
    is_mock: false,
    is_empty: false,
    data_window: sortedWeeks.length
      ? `${sortedWeeks[0]} → ${sortedWeeks[sortedWeeks.length - 1]}`
      : '—',
    last_refreshed: null,
    cohort_assignment_total: cohortTotal,
    cohort_treatment_pct: cohortTotal
      ? Math.round((treatmentTotal / cohortTotal) * 100)
      : 0,
    control_visit_rate_pct: controlVisitRatePct,
  };
}

/* Normalise a live SQL row to the shape the dashboard expects:
 * adds `week` (display label) when missing. */
function normaliseLiveRow(r) {
  return {
    ...r,
    week: r.week ?? r.week_start ?? '—',
  };
}

export function useLearnEducation(nonce = 0) {
  const [data, setData] = React.useState({ rows: [], meta: EMPTY_META });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runQuery(PROJECT_ID, LIVE_SQL, 100)
      .then((res) => {
        if (cancelled) return;
        const rawRows =
          res && Array.isArray(res.rows) ? res.rows : [];
        const rows = rawRows.map(normaliseLiveRow);
        setData({ rows, meta: deriveMeta(rows) });
      })
      .catch((e) => {
        if (cancelled) return;
        // Pre-launch: the DuckDB table doesn't exist yet, so runQuery
        // errors. Surface the error and show the empty state — the
        // dashboard renders GALLEY PROOF / "On the presses…" gracefully.
        // Once the first cron fills the table, this branch goes quiet.
        setError(String((e && e.message) || e));
        setData({ rows: [], meta: EMPTY_META });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { data, loading, error };
}

/* Formatters used by both dashboards — kept here so the contract stays
 * single-sourced with COLUMNS above. */
export function formatCell(value, kind) {
  if (value === null || value === undefined) return '—';
  switch (kind) {
    case 'count':
      return value.toLocaleString('en-IN');
    case 'pct':
      return value.toFixed(1) + '%';
    case 'decimal':
      return value.toFixed(1);
    case 'seconds':
      return value + 's';
    default:
      return String(value);
  }
}

/* Variant landscape — post the develop-branch experiment refactor:
 *   'control'                            → bucket > treatmentPercentage
 *   'treatment'                          → binary mode (no variants[] config)
 *   'treatmentv1', 'treatmentv2', ...    → named-variants mode (variants[])
 *
 * Today's learn_page uses binary mode; the helpers below handle both shapes. */

export const isControlVariant = (variant) => variant === 'control';
export const isTreatmentVariant = (variant) =>
  typeof variant === 'string' && variant !== 'control';

/* Human label for a variant. 'treatment' → 'Treatment'; 'treatmentv1' →
 * 'Treatment v1'; arbitrary 'foo' → 'Foo'. */
export function formatVariantLabel(variant) {
  if (variant === 'control') return 'Control';
  if (variant === 'treatment') return 'Treatment';
  const namedMatch = variant.match(/^treatment(.+)$/i);
  if (namedMatch) {
    const tail = namedMatch[1].replace(/^v?(\d+)$/i, 'v$1');
    return `Treatment ${tail}`;
  }
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

/* Unique non-control variants present in the data, in stable order. */
export function getTreatmentVariants(rows) {
  if (!rows) return [];
  const seen = new Set();
  for (const r of rows) {
    if (isTreatmentVariant(r.variant)) seen.add(r.variant);
  }
  return Array.from(seen).sort();
}

/* Compute the cohort-vs-cohort FTI lift for every treatment variant
 * against Control, for the most recent week with both Control and at
 * least one treatment arm populated.
 *
 * Returns an array sorted by delta_pp descending (so [0] is the
 * best-performing arm). Empty array when no week qualifies.
 *
 * Each entry: { week, variant, control_pct, treatment_pct, delta_pp,
 *               relative_pct (null if control_pct = 0) }.
 *
 * For a binary experiment (today's learn_page) this returns 0 or 1
 * entries — same shape as the old single-lift behaviour, just wrapped
 * in an array. */
export function computeFtiLifts(rows) {
  if (!rows || rows.length === 0) return [];
  const byWeek = {};
  for (const r of rows) {
    byWeek[r.week] = byWeek[r.week] || {};
    byWeek[r.week][r.variant] = r;
  }
  const weeks = Object.keys(byWeek).sort();

  for (let i = weeks.length - 1; i >= 0; i--) {
    const wk = byWeek[weeks[i]];
    const c = wk.control;
    if (!c || c.fti_rate_pct == null) continue;

    const lifts = [];
    for (const [variant, r] of Object.entries(wk)) {
      if (variant === 'control') continue;
      if (r.fti_rate_pct == null) continue;
      const delta_pp = +(r.fti_rate_pct - c.fti_rate_pct).toFixed(2);
      const relative_pct =
        c.fti_rate_pct > 0
          ? +(((r.fti_rate_pct - c.fti_rate_pct) / c.fti_rate_pct) * 100).toFixed(0)
          : null;
      lifts.push({
        week: weeks[i],
        variant,
        control_pct: c.fti_rate_pct,
        treatment_pct: r.fti_rate_pct,
        delta_pp,
        relative_pct,
      });
    }
    if (lifts.length > 0) {
      lifts.sort((a, b) => b.delta_pp - a.delta_pp);
      return lifts;
    }
  }
  return [];
}

/* Backward-compat — single best lift (or null). Existing callers that
 * only care about the headline number keep working unchanged. */
export function computeFtiLift(rows) {
  const lifts = computeFtiLifts(rows);
  return lifts[0] || null;
}

/* ═══════════════════════════════ §V THE DAILY ═══════════════════════════════
 * Hourly-source breakdown rolled up to the dropdown-selected granularity.
 * One source CSV (`hourly_breakdown.csv` → DuckDB table
 * `learn_education__hourly_breakdown`) serves all four grains: Hour, Day,
 * Week, Month. DuckDB's date_trunc does the rollup at query time.
 */

export const DAILY_GRANULARITIES = [
  { key: 'hour',  label: 'Hour-on-Hour',  trunc: 'hour'  },
  { key: 'day',   label: 'Day-on-Day',    trunc: 'day'   },
  { key: 'week',  label: 'Week-on-Week',  trunc: 'week'  },
  { key: 'month', label: 'Month-on-Month', trunc: 'month' },
];

/* Columns rendered in The Daily table, in display order. The 4 treatment
 * FTI columns nest (total ⊇ visited ⊇ played_1p ⊇ played_2p); the table
 * indents them so the nesting reads at a glance. */
export const DAILY_COLUMNS = [
  { key: 'new_cohort_control',      label: 'Control · new',         arm: 'control'   },
  { key: 'new_cohort_treatment',    label: 'Treatment · new',       arm: 'treatment' },
  { key: 'new_visitors_treatment',  label: 'T · visited /learn',    arm: 'treatment' },
  { key: 'fti_control',             label: 'C · FTI',               arm: 'control',   fti: true },
  { key: 'fti_treatment_total',     label: 'T · FTI',               arm: 'treatment', fti: true },
  { key: 'fti_treatment_visited',   label: 'T · FTI · visited',     arm: 'treatment', fti: true, indent: 1 },
  { key: 'fti_treatment_played_1p', label: 'T · FTI · played ≥1',   arm: 'treatment', fti: true, indent: 2 },
  { key: 'fti_treatment_played_2p', label: 'T · FTI · played ≥2',   arm: 'treatment', fti: true, indent: 3 },
];

/* Granularity-aware SQL: rolls up the hourly CSV via DuckDB date_trunc
 * to the selected grain. For week we anchor on Monday (matches the
 * weekly_ab_tracker's convention). */
function buildDailySql(trunc) {
  return [
    "SELECT",
    `  strftime(date_trunc('${trunc}', CAST(hour_start AS TIMESTAMP)), '%Y-%m-%d %H:%M:%S') AS bucket,`,
    "  SUM(new_cohort_control)       AS new_cohort_control,",
    "  SUM(new_cohort_treatment)     AS new_cohort_treatment,",
    "  SUM(new_visitors_control)     AS new_visitors_control,",
    "  SUM(new_visitors_treatment)   AS new_visitors_treatment,",
    "  SUM(fti_control)              AS fti_control,",
    "  SUM(fti_treatment_total)      AS fti_treatment_total,",
    "  SUM(fti_treatment_visited)    AS fti_treatment_visited,",
    "  SUM(fti_treatment_played_1p)  AS fti_treatment_played_1p,",
    "  SUM(fti_treatment_played_2p)  AS fti_treatment_played_2p",
    "FROM learn_education__hourly_breakdown",
    "GROUP BY bucket",
    "ORDER BY bucket DESC",
  ].join("\n");
}

export function useDailyBreakdown(nonce = 0, granularity = 'day') {
  const [data, setData] = React.useState({ rows: [], granularity });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const trunc =
    DAILY_GRANULARITIES.find((g) => g.key === granularity)?.trunc ?? 'day';

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runQuery(PROJECT_ID, buildDailySql(trunc), 1000)
      .then((res) => {
        if (cancelled) return;
        const rows = res && Array.isArray(res.rows) ? res.rows : [];
        setData({ rows, granularity });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String((e && e.message) || e));
        setData({ rows: [], granularity });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, granularity, trunc]);

  return { data, loading, error };
}

/* Display a bucket label per granularity: human-readable, no timezone
 * shenanigans (the bucket is already truncated to the right grain). */
export function formatDailyBucket(bucket, granularity) {
  if (!bucket) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(bucket);
  if (!m) return bucket;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  const opts =
    granularity === 'hour'
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : granularity === 'day'
        ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
        : granularity === 'week'
          ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
          : { month: 'long', year: 'numeric', timeZone: 'UTC' };
  const label = date.toLocaleString('en-IN', opts);
  return granularity === 'week' ? `Week of ${label}` : label;
}
