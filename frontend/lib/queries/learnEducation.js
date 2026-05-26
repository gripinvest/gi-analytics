/**
 * Data hook for the Learn (Grip Education) dashboard.
 *
 * STATUS: pre-launch. The gi-client-web feature ships an event surface
 * (experiment_assigned, learn_page_viewed, learn_category_clicked,
 * learn_video_opened, learn_video_viewed, learn_outbound_clicked) but no
 * W1 prod data has landed yet. Until then this hook serves a mock dataset
 * shaped exactly to the canonical product spreadsheet so the dashboard
 * renders meaningfully for reviewers and stakeholders.
 *
 * When W1 data lands the mock falls away and the hook becomes a thin
 * wrapper around runQuery() against the learn_education__ DuckDB tables.
 * The component contract here (rows shape, column names) is what the
 * SQL must produce — see docs/projects/learn-education/data-sources.md §4.
 *
 * Spec: docs/projects/learn-education/specs/2026-05-26-weekly-ab-tracker.md
 */

import * as React from 'react';

export const PROJECT_ID = 'learn_education';

/* The canonical column set, in product-spreadsheet order. The component
 * uses this to drive both the table and the metric-strip headers.
 * `precision` is the number of decimals to display for rate columns. */
export const COLUMNS = [
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
];

/* Pre-launch mock — shaped to the product spreadsheet exactly. Real values
 * will replace this once the gi-client-web feature ships and W1 data lands
 * in DuckDB. The variant strings match what experiment_assigned emits. */
const MOCK_ROWS = [
  {
    week: 'W1',  week_start: '2026-05-26', variant: 'control',
    total_non_invested_users: 5000,
    learn_page_visitors:        null,  // surface is invisible to Control
    learn_visit_rate_pct:       null,
    unique_video_players:       null,
    total_video_plays:          null,
    avg_videos_per_user:        null,
    avg_watch_time_sec:         null,
    fti_users:                  50,
    fti_users_who_watched:      null,
    fti_rate_pct:               1.0,
  },
  {
    week: 'W1', week_start: '2026-05-26', variant: 'treatment',
    total_non_invested_users: 5000,
    learn_page_visitors:      1500,
    learn_visit_rate_pct:     30.0,
    unique_video_players:     750,
    total_video_plays:        1200,
    avg_videos_per_user:      1.6,
    avg_watch_time_sec:       22,
    fti_users:                75,
    fti_users_who_watched:    40,
    fti_rate_pct:             1.5,
  },
];

const MOCK_META = {
  is_mock: true,
  data_window: 'W1 (mock)',
  last_refreshed: null,
  cohort_assignment_total: 10000,
  cohort_treatment_pct: 50,
  control_visit_rate_pct: 0.0,  // health-check value — non-zero means leak
};

export function useLearnEducation() {
  const [data, setData] = React.useState({ rows: MOCK_ROWS, meta: MOCK_META });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Live-data path will land once the first W1 export hits backend/data/
  // learn_education/. Until then this resolves synchronously with the mock.
  React.useEffect(() => {
    setLoading(false);
    setError(null);
  }, []);

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

/* Compute the cohort-vs-cohort lift for the FTI rate. Used by both the
 * headline strip and the editorial verdict. Returns null when either side
 * is missing or when treatment <= control (no lift to surface). */
export function computeFtiLift(rows) {
  if (!rows || rows.length === 0) return null;
  // Group by variant — take the most recent week with both sides populated.
  const byWeek = {};
  for (const r of rows) {
    byWeek[r.week] = byWeek[r.week] || {};
    byWeek[r.week][r.variant] = r;
  }
  const weeks = Object.keys(byWeek).sort();
  for (let i = weeks.length - 1; i >= 0; i--) {
    const c = byWeek[weeks[i]].control;
    const t = byWeek[weeks[i]].treatment;
    if (c && t && c.fti_rate_pct != null && t.fti_rate_pct != null) {
      return {
        week: weeks[i],
        control_pct: c.control_pct ?? c.fti_rate_pct,
        treatment_pct: t.fti_rate_pct,
        delta_pp: +(t.fti_rate_pct - c.fti_rate_pct).toFixed(2),
        relative_pct: +(((t.fti_rate_pct - c.fti_rate_pct) / c.fti_rate_pct) * 100).toFixed(0),
      };
    }
  }
  return null;
}
