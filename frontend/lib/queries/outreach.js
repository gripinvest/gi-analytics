// Outreach query builder for the Asset Search dashboard's
// CS-facing Outreach section.
//
// The list is intent-driven: every user who hit a failed search (zero-result
// query or empty_state event) whose query maps to a known issuer via the
// registry. Notify Me is one signal column, not the filter — most demand
// never clicks the CTA. Same priority framing as the offline CS_call_list:
// P1 catalog_gap > P2 availability > P3 alias > P4 healthy.
//
// PII (email / phone / name / city) is NOT in this view. The DuckDB build
// has only event payloads — user_id is the join key CS uses against their
// CRM. This is deliberate: keeping PII off the analytics dashboard avoids
// duplicating sensitive data into the (auth-light) web tier.
//
// Status tracking (new / contacted / converted) lives in localStorage —
// keyed per `${user_id}:${issuer}` so the same lead under two issuers
// tracks separately.

import { TEST_USERS, ISSUER_MAP, issuerCaseExpr } from "./assetSearch";
import { CUTOVER_WEEK } from "./engineComparison";

const EXC = `(user_id IS NULL OR user_id NOT IN (${TEST_USERS.join(",")}))`;

const wkOf = (t) => {
  const m = t.match(/(?:^|_)W(\d+)_/);
  return m ? Number(m[1]) : null;
};

/** Per-table SELECT-list that NULL-projects `engine_version` for pre-cutover
 *  weeks. The column is V2-era — absent from the W1–W7 thin schemas — so
 *  selecting it directly across the all-week union raises a binder error.
 *  Pre-cutover tables get a NULL projection ("assume V1 if not found"); the
 *  consumer coalesces NULL → 'v1'. Same convention as daily.js /
 *  engineComparison.js (shared CUTOVER_WEEK). */
function colsWithEngineVersion(baseCols) {
  return (t) => {
    const w = wkOf(t);
    return w != null && w >= CUTOVER_WEEK
      ? `${baseCols}, engine_version`
      : `${baseCols}, CAST(NULL AS VARCHAR) AS engine_version`;
  };
}

const GC_FROM_WEEK = 4; // gc_name/gc_id/obpp_kyc_status/investment_status first appear in W4

/** Like colsWithEngineVersion, but also NULL-projects gc_name (VARCHAR) for
 *  pre-W4 weeks so the all-week union binds. */
function colsWithEngineVersionAndGc(baseCols) {
  const withEv = colsWithEngineVersion(baseCols);
  return (t) => {
    const w = wkOf(t);
    const gc = w != null && w >= GC_FROM_WEEK ? "gc_name" : "CAST(NULL AS VARCHAR) AS gc_name";
    return `${withEv(t)}, ${gc}`;
  };
}

/** UNION ALL helper — applies the test-user exclusion in one place. `cols` is
 *  either a string (same columns from every table) or a `(table) => string`
 *  function for per-table projection (e.g. NULL-filling a late-added column).
 *  Returns null when no tables are given so callers can short-circuit (the
 *  dashboard's run() treats null SQL as a zero-row result). */
function unionAll(tableList, cols, extraWhere) {
  if (!tableList || tableList.length === 0) return null;
  const where = extraWhere ? `${EXC} AND (${extraWhere})` : EXC;
  const colsOf = typeof cols === "function" ? cols : () => cols;
  return tableList
    .map((t) => `SELECT ${colsOf(t)} FROM "${t}" WHERE ${where}`)
    .join("\nUNION ALL\n");
}

// ── live SQL builders ───────────────────────────────────────────────────────

/**
 * Broad outreach rollup: every user × issuer pair where the user has hit
 * a failed search (zero-result query OR empty_state event) that the
 * registry can map to a known issuer. Notify Me click is a flag column,
 * not a filter. Sorted by Notified DESC → hit count DESC → recency, so
 * the warmest leads bubble to the top.
 *
 * Returns null when no failed-search tables exist; the section then
 * renders the pending "waiting for live data" state.
 */
export function notifyMeOutreachDetail({ tables } = {}) {
  // Zero-result rows of the query event — the strongest failure signal
  // (we know the user typed something the engine couldn't resolve).
  // `engine_version` is NULL-projected for pre-cutover weeks (they lack the
  // column) so the all-week union binds; seen_v2 coalesces NULL → 'v1'.
  const queryFailures = unionAll(
    tables && tables.query,
    colsWithEngineVersionAndGc("user_id, query_text, timestamp, active_tab"),
    "results_count = 0 AND user_id IS NOT NULL AND query_text IS NOT NULL"
  );
  // Empty-state event — fires whether the failure was zero-result or
  // near-match (had_mlt_results=true). Together with the zero-query rows
  // this covers all flavours of dead-end on the search dropdown.
  const emptyStates = unionAll(
    tables && tables.empty_state,
    colsWithEngineVersionAndGc("user_id, query_text, timestamp, active_tab"),
    "user_id IS NOT NULL AND query_text IS NOT NULL"
  );
  if (!queryFailures && !emptyStates) return null;
  const failureUnion = [queryFailures, emptyStates].filter(Boolean).join("\nUNION ALL\n");

  // Notify-me events keyed by (user_id, mapped_issuer) — flagged onto the
  // rollup with a LEFT JOIN. Treated as optional; falls back to a stub
  // that returns no rows so the LEFT JOIN works even when the cutover-
  // era table is missing.
  const notifyMe = unionAll(
    tables && tables.notify_me_clicked,
    "user_id, mapped_issuer",
    "user_id IS NOT NULL"
  ) || `SELECT CAST(NULL AS BIGINT) AS user_id, CAST(NULL AS VARCHAR) AS mapped_issuer WHERE FALSE`;

  return `
    WITH failures AS (
      ${failureUnion}
    ),
    classified AS (
      SELECT user_id, query_text, timestamp, active_tab, engine_version, gc_name,
             ${issuerCaseExpr("query_text")} AS mapped_issuer
      FROM failures
    ),
    rolled AS (
      SELECT user_id, mapped_issuer,
             COUNT(*)                                  AS hit_count,
             MAX(timestamp)                            AS last_active,
             MIN(timestamp)                            AS first_active,
             STRING_AGG(DISTINCT query_text, ' | ')    AS top_searches,
             -- "assume V1 if not found": pre-cutover weeks NULL-project
             -- engine_version, COALESCE'd to 'v1', so only a real 'v2' counts.
             MAX(CASE WHEN COALESCE(engine_version, 'v1') = 'v2' THEN 1 ELSE 0 END) AS seen_v2,
             MAX(active_tab)                           AS active_tab,
             MAX(gc_name)                              AS gc_name
      FROM classified
      WHERE mapped_issuer IS NOT NULL
      GROUP BY user_id, mapped_issuer
    ),
    notified AS (
      SELECT DISTINCT user_id, mapped_issuer
      FROM (${notifyMe}) n
    )
    SELECT
      r.user_id,
      r.mapped_issuer,
      r.hit_count,
      r.last_active,
      r.first_active,
      r.top_searches,
      r.active_tab,
      r.seen_v2,
      r.gc_name,
      CASE WHEN n.user_id IS NOT NULL THEN 1 ELSE 0 END AS notified
    FROM rolled r
    LEFT JOIN notified n
      ON n.user_id = r.user_id
     AND n.mapped_issuer = r.mapped_issuer
    ORDER BY notified DESC, hit_count DESC, last_active DESC
  `;
}

/**
 * Per-user search timeline for the Outreach drill-down modal. One row per
 * search event (W4+ only — where investment_status/gc_name exist), with the
 * assets the user clicked for that query LEFT-JOINed in. Returns null for a
 * non-integer userId or no W4+ tables.
 */
export function userSearchTimeline({ tables, userId } = {}) {
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return null;
  const w4 = (list) => (list || []).filter((t) => (wkOf(t) || 0) >= GC_FROM_WEEK);
  const qTables = w4(tables && tables.query);
  if (qTables.length === 0) return null;
  const cTables = w4(tables && tables.result_clicked);

  const searches = qTables
    .map((t) => `SELECT user_id, timestamp, query_text, results_count, is_refinement, active_tab, investment_status, gc_name, obpp_kyc_status FROM "${t}" WHERE user_id = ${uid}`)
    .join("\nUNION ALL\n");
  const clicks = cTables.length
    ? cTables.map((t) => `SELECT user_id, query_text, clicked_asset_name, clicked_asset_type FROM "${t}" WHERE user_id = ${uid}`).join("\nUNION ALL\n")
    : `SELECT CAST(NULL AS BIGINT) AS user_id, CAST(NULL AS VARCHAR) AS query_text, CAST(NULL AS VARCHAR) AS clicked_asset_name, CAST(NULL AS VARCHAR) AS clicked_asset_type WHERE FALSE`;

  return `
    WITH s AS (${searches}),
    c AS (
      SELECT query_text,
             STRING_AGG(DISTINCT clicked_asset_name, ', ') AS clicked_assets,
             STRING_AGG(DISTINCT clicked_asset_type, ', ') AS clicked_types
      FROM (${clicks}) GROUP BY query_text
    )
    SELECT s.timestamp AS ts, CAST(s.timestamp AS DATE) AS day, s.query_text,
           s.results_count, s.is_refinement, s.active_tab,
           c.clicked_assets, c.clicked_types,
           s.investment_status AS invested, s.gc_name, s.obpp_kyc_status AS kyc
    FROM s LEFT JOIN c ON c.query_text = s.query_text
    ORDER BY s.timestamp DESC
  `;
}

// ── client-side enrichment ──────────────────────────────────────────────────

const ISSUER_CATEGORY_BY_NAME = Object.fromEntries(
  ISSUER_MAP.map((i) => [i.name, i.category])
);

const PRIORITY_BY_CATEGORY = {
  catalog_gap:  { rank: 1, label: "P1 — catalog gap"   },
  availability: { rank: 2, label: "P2 — availability"  },
  alias:        { rank: 3, label: "P3 — alias gap"     },
  healthy:      { rank: 4, label: "P4 — healthy"       },
};

/** Decorate a SQL row with derived priority + intent fields. The category
 *  comes from the in-repo ISSUER_MAP, not the event payload, so it stays
 *  consistent with the rest of the dashboard. */
export function decorateOutreachRow(row) {
  const category = ISSUER_CATEGORY_BY_NAME[row.mapped_issuer] || "healthy";
  const priority = PRIORITY_BY_CATEGORY[category] || PRIORITY_BY_CATEGORY.healthy;
  const gc = (row.gc_name || "").trim();
  return {
    ...row,
    issuer_category: category,
    priority_rank: priority.rank,
    priority_label: priority.label,
    notified: Number(row.notified) === 1 || row.notified === true,
    seen_v2: Number(row.seen_v2) === 1 || row.seen_v2 === true,
    is_gc: gc.length > 0,
    source_label: gc.length > 0 ? `GC · ${gc}` : "Platform",
  };
}

// ── data-state classifier ───────────────────────────────────────────────────

/**
 * Three-state classifier so panel components can render an appropriate
 * affordance (pending pill / sparse-warning / live).
 */
export function dataState(rows, { minRows = 5 } = {}) {
  if (!rows || rows.length === 0) return 'pending';
  if (rows.length < minRows) return 'sparse';
  return 'live';
}

// ── localStorage-backed status tracking ─────────────────────────────────────
//
// Status lifecycle: new → contacted → converted (terminal). Stored as a
// single JSON map under one key so we can serialize a list export easily.
// Migrate this to a server-backed status field whenever the CRM team
// owns the workflow.

const STATUS_KEY = 'gripAnalyticsOutreachStatus';
export const OUTREACH_STATUSES = ['new', 'contacted', 'converted'];

function loadStatusMap() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STATUS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    // Corrupted storage — self-heal by clearing the bad value.
    try { window.localStorage.removeItem(STATUS_KEY); } catch { /* ignore */ }
    return {};
  }
}

function saveStatusMap(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STATUS_KEY, JSON.stringify(map));
  } catch {
    /* quota exceeded — accept the loss, CS can re-mark */
  }
}

export function statusKey(row) {
  return `${row.user_id}:${row.mapped_issuer}`;
}

export function getOutreachStatus(row) {
  return loadStatusMap()[statusKey(row)]?.status ?? 'new';
}

export function setOutreachStatus(row, status) {
  if (!OUTREACH_STATUSES.includes(status)) return;
  const map = loadStatusMap();
  map[statusKey(row)] = {
    status,
    updated_at: new Date().toISOString(),
  };
  saveStatusMap(map);
}

export function getAllStatuses() {
  return loadStatusMap();
}
