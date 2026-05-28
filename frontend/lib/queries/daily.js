// Daily-grain SQL builders for the Asset Search dashboard's "Daily Signals"
// section. Same source tables every other QUERY_SPEC consumes — just grouped
// by IST calendar day (DATE_TRUNC('day', timestamp::TIMESTAMP)) instead of
// feature week. Limited to the trailing N days so the result set stays tight.
//
// All builders return `null` when the source tables are missing so the
// dashboard's run() helper treats it as a zero-row result and the section
// renders an empty state instead of crashing.

import { TEST_USERS } from "./assetSearch";

const EXC = `(user_id IS NULL OR user_id NOT IN (${TEST_USERS.join(",")}))`;

// 14 days × ~3,000 query events/day ≈ 42K rows max — comfortable for a
// browser to render and for DuckDB to compute over.
export const DAILY_WINDOW_DAYS = 14;

// Cutoff used by the V2-only events to drop the LEFT-JOIN-against-nothing
// branch. Same constant as engineComparison's CUTOVER_WEEK.
const CUTOVER_WEEK = 8;

const wkOf = (t) => {
  const m = t.match(/(?:^|_)W(\d+)_/);
  return m ? Number(m[1]) : null;
};

/** UNION ALL the row-level source tables, projecting only what each builder
 *  needs and applying the test-user exclusion in one place. Returns null when
 *  the table list is empty so callers can short-circuit. */
function unionRaw(tableList, cols, extraWhere) {
  if (!tableList || tableList.length === 0) return null;
  const where = extraWhere ? `${EXC} AND (${extraWhere})` : EXC;
  return tableList
    .map((t) => `SELECT ${cols} FROM "${t}" WHERE ${where}`)
    .join("\nUNION ALL\n");
}

/** Same as unionRaw but restricted to weeks ≥ CUTOVER_WEEK (V2 era). */
function unionV2(tableList, cols, extraWhere) {
  if (!tableList) return null;
  const eligible = tableList.filter((t) => {
    const w = wkOf(t);
    return w != null && w >= CUTOVER_WEEK;
  });
  return unionRaw(eligible, cols, extraWhere);
}

// IST-day extraction. Rudderstack timestamps are written with `+05:30`
// offsets, so casting to DATE strips the time portion correctly without
// double-converting. STRFTIME gives us a stable 'YYYY-MM-DD' string the
// charts can sort + render directly.
const DAY_EXPR = `STRFTIME(CAST(timestamp AS TIMESTAMP), '%Y-%m-%d')`;

// Trailing-window predicate using the dashboard's clock. DuckDB's `CURRENT_DATE`
// is the runtime date on the backend (UTC on Render). We add a 5h30m offset to
// hit IST midnight and look back N days.
function recentWindow(days = DAILY_WINDOW_DAYS) {
  return `CAST(timestamp AS TIMESTAMP) >= (CAST((CURRENT_TIMESTAMP + INTERVAL 5 HOUR + INTERVAL 30 MINUTE) AS DATE) - INTERVAL ${days} DAY)`;
}

// ── builders ────────────────────────────────────────────────────────────────

/**
 * Queries per day, split by engine (v1 vs v2). Drives the daily ramp chart.
 * NULL engine_version is coalesced to 'v1' to match the dashboard's existing
 * cutover SQL convention.
 */
export function dailyQueriesByEngine({ tables } = {}) {
  const inner = unionRaw(
    tables && tables.query,
    "timestamp, engine_version, results_count, context_session_id, user_id, query_text",
    `query_text IS NOT NULL AND ${recentWindow()}`
  );
  if (!inner) return null;
  return `
    SELECT
      ${DAY_EXPR}                              AS day,
      COALESCE(engine_version, 'v1')           AS engine,
      COUNT(*)                                 AS queries,
      COUNT(DISTINCT context_session_id)       AS sessions,
      COUNT(DISTINCT user_id)                  AS users
    FROM (${inner}) t
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

/**
 * Zero-result rate per day, overall (not engine-split — engineHealthCutover
 * already does that). Catches sudden ZRR spikes (e.g. alias broken, asset
 * cycled out) within the same day they happen.
 */
export function dailyZrr({ tables } = {}) {
  const inner = unionRaw(
    tables && tables.query,
    "timestamp, results_count, query_text",
    `query_text IS NOT NULL AND ${recentWindow()}`
  );
  if (!inner) return null;
  return `
    SELECT
      ${DAY_EXPR}                                                      AS day,
      COUNT(*)                                                         AS queries,
      SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END)               AS zero_results,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct
    FROM (${inner}) t
    GROUP BY 1
    ORDER BY 1
  `;
}

/**
 * Distinct users per day who hit at least one failed search (zero-result query
 * OR empty_state event). The actionable CS daily-queue size.
 */
export function dailyFailedUsers({ tables } = {}) {
  const queryFailures = unionRaw(
    tables && tables.query,
    "timestamp, user_id",
    `results_count = 0 AND user_id IS NOT NULL AND ${recentWindow()}`
  );
  const emptyStates = unionRaw(
    tables && tables.empty_state,
    "timestamp, user_id",
    `user_id IS NOT NULL AND ${recentWindow()}`
  );
  if (!queryFailures && !emptyStates) return null;
  const all = [queryFailures, emptyStates].filter(Boolean).join("\nUNION ALL\n");
  return `
    SELECT
      ${DAY_EXPR}             AS day,
      COUNT(DISTINCT user_id) AS failed_users,
      COUNT(*)                AS failure_events
    FROM (${all}) t
    GROUP BY 1
    ORDER BY 1
  `;
}

/**
 * Notify-me + chip-click counts per day. Tiny absolute numbers but the trend
 * is the V2 instrumentation health signal. V2-only events; returns null when
 * neither table is loaded.
 */
export function dailyNotifyChip({ tables } = {}) {
  const notify = unionV2(
    tables && tables.notify_me_clicked,
    "timestamp, user_id, 'notify' AS kind",
    `engine_version = 'v2' AND ${recentWindow()}`
  );
  const chip = unionV2(
    tables && tables.chip_clicked,
    "timestamp, user_id, 'chip' AS kind",
    `engine_version = 'v2' AND ${recentWindow()}`
  );
  if (!notify && !chip) return null;
  const all = [notify, chip].filter(Boolean).join("\nUNION ALL\n");
  return `
    SELECT
      ${DAY_EXPR}                                                AS day,
      SUM(CASE WHEN kind = 'notify' THEN 1 ELSE 0 END)           AS notify_clicks,
      SUM(CASE WHEN kind = 'chip'   THEN 1 ELSE 0 END)           AS chip_clicks,
      COUNT(DISTINCT user_id)                                    AS unique_users
    FROM (${all}) t
    GROUP BY 1
    ORDER BY 1
  `;
}

// ── client-side helpers ────────────────────────────────────────────────────

/** Today's IST date as 'YYYY-MM-DD' — used to mark the in-progress bucket. */
export function todayIST() {
  // Browser timezone may be anything; explicitly add +05:30 offset to UTC.
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 3600_000;
  const ist = new Date(istMs);
  return ist.toISOString().slice(0, 10);
}

/** Pad an irregular series with explicit zero-rows for every missing day in
 *  the trailing window, so the chart x-axis is continuous instead of jumping
 *  over zero-volume days. */
export function fillDailyGaps(rows, fields, days = DAILY_WINDOW_DAYS) {
  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  const out = [];
  const start = new Date(Date.now() + 5.5 * 3600_000);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    const r = byDay.get(day);
    if (r) {
      out.push(r);
    } else {
      const zero = { day };
      for (const f of fields) zero[f] = 0;
      out.push(zero);
    }
  }
  return out;
}

/** Stack engine-split rows from `dailyQueriesByEngine` into one row per day
 *  with `{day, v1: N, v2: N}` columns — the shape Recharts needs for a
 *  stacked bar / area. */
export function pivotByEngine(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const day = String(r.day);
    if (!byDay.has(day)) byDay.set(day, { day, v1: 0, v2: 0 });
    const bucket = byDay.get(day);
    const engine = String(r.engine || "v1").toLowerCase();
    bucket[engine] = (bucket[engine] || 0) + Number(r.queries || 0);
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0
  );
}
