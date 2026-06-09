// Outreach query builder + mock dataset for the Asset Search dashboard's
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
 * renders mock data + a pending pill.
 */
export function notifyMeOutreachDetail({ tables } = {}) {
  // Zero-result rows of the query event — the strongest failure signal
  // (we know the user typed something the engine couldn't resolve).
  // `engine_version` is NULL-projected for pre-cutover weeks (they lack the
  // column) so the all-week union binds; seen_v2 coalesces NULL → 'v1'.
  const queryFailures = unionAll(
    tables && tables.query,
    colsWithEngineVersion("user_id, query_text, timestamp, active_tab"),
    "results_count = 0 AND user_id IS NOT NULL AND query_text IS NOT NULL"
  );
  // Empty-state event — fires whether the failure was zero-result or
  // near-match (had_mlt_results=true). Together with the zero-query rows
  // this covers all flavours of dead-end on the search dropdown.
  const emptyStates = unionAll(
    tables && tables.empty_state,
    colsWithEngineVersion("user_id, query_text, timestamp, active_tab"),
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
      SELECT user_id, query_text, timestamp, active_tab, engine_version,
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
             MAX(active_tab)                           AS active_tab
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
      CASE WHEN n.user_id IS NOT NULL THEN 1 ELSE 0 END AS notified
    FROM rolled r
    LEFT JOIN notified n
      ON n.user_id = r.user_id
     AND n.mapped_issuer = r.mapped_issuer
    ORDER BY notified DESC, hit_count DESC, last_active DESC
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
  return {
    ...row,
    issuer_category: category,
    priority_rank: priority.rank,
    priority_label: priority.label,
    notified: Number(row.notified) === 1 || row.notified === true,
    seen_v2: Number(row.seen_v2) === 1 || row.seen_v2 === true,
  };
}

// ── mock data (used until events flow) ──────────────────────────────────────

/**
 * Mock dataset sized to reflect realistic per-week volume per the V1
 * analytics — Vedika ~310 zero-result queries across 8 weeks (~39/week),
 * Muthoot ~187, Keertana ~140. The `notified` flag is set on a minority
 * (most demand never clicks the CTA — Notify Me is one signal of many).
 *
 * Schema matches the live SQL: user_id only (no PII). Mock user_ids are
 * obviously synthetic seven-digit numbers; the real CRM has the contact
 * detail, the dashboard surfaces the intent.
 */
const _MOCK_USER_BASE = 9000000;
const _M = (i, issuer, qs, hits, opts = {}) => ({
  user_id: _MOCK_USER_BASE + i,
  mapped_issuer: issuer,
  query_text: qs[0],
  top_searches: qs.join(" | "),
  active_tab: opts.tab || "bonds",
  hit_count: hits,
  first_active: opts.first || "2026-05-20T13:00:00+05:30",
  last_active: opts.last || "2026-05-26T18:00:00+05:30",
  notified: opts.notified === true ? 1 : 0,
  seen_v2: opts.v2 === false ? 0 : 1,
});
const _MOCK_RAW = [
  // Vedika — catalog_gap, the strongest persistent demand
  _M(1, "Vedika Credit",     ["vedika credit", "vedika", "ved"], 3, { notified: true,  last: "2026-05-26T09:14:22+05:30" }),
  _M(2, "Vedika Credit",     ["vedika", "vedik"],                 2, {                  last: "2026-05-26T11:38:01+05:30" }),
  _M(3, "Vedika Credit",     ["vedik"],                           1, {                  last: "2026-05-25T17:21:47+05:30" }),
  _M(4, "Vedika Credit",     ["ved", "vedika credit"],            3, { notified: true,  last: "2026-05-26T08:02:09+05:30" }),
  _M(5, "Vedika Credit",     ["vedika credit"],                   1, {                  last: "2026-05-24T20:11:55+05:30" }),
  // Muthoot — availability, cycles in/out
  _M(6, "Muthoot Finance",   ["muthoot", "muthoot finance"],      2, { notified: true,  last: "2026-05-26T10:55:12+05:30" }),
  _M(7, "Muthoot Finance",   ["muth"],                            1, {                  last: "2026-05-26T16:08:30+05:30" }),
  _M(8, "Muthoot Finance",   ["muthoot finance"],                 1, {                  last: "2026-05-25T11:45:01+05:30" }),
  _M(9, "Muthoot Finance",   ["muthoot"],                         1, {                  last: "2026-05-24T09:38:44+05:30" }),
  // Keertana — availability
  _M(10, "Keertana",         ["keertana", "keer"],                2, {                  last: "2026-05-26T07:18:33+05:30" }),
  _M(11, "Keertana",         ["keer"],                            1, {                  last: "2026-05-26T13:42:50+05:30" }),
  _M(12, "Keertana",         ["keerthana"],                       1, {                  last: "2026-05-25T15:14:09+05:30" }),
  // Mufin — alias + availability
  _M(13, "Mufin Finance",    ["mufin"],                           1, {                  last: "2026-05-26T19:55:00+05:30" }),
  _M(14, "Mufin Finance",    ["mufin green", "mufin"],            2, { notified: true,  last: "2026-05-26T11:02:17+05:30" }),
  // Govt / RBI — catalog_gap (category-level)
  _M(15, "Govt / RBI Bonds", ["rbi", "rbi floating rate bond"],   2, {                  last: "2026-05-26T08:08:08+05:30" }),
  _M(16, "Govt / RBI Bonds", ["govt", "government bond"],         2, {                  last: "2026-05-26T16:33:21+05:30" }),
  _M(17, "Govt / RBI Bonds", ["rbi"],                             1, {                  last: "2026-05-25T20:01:42+05:30" }),
  // Akara — alias gap, low priority
  _M(18, "Akara Capital",    ["akara", "akar"],                   2, {                  last: "2026-05-26T14:22:55+05:30" }),
  _M(19, "Akara Capital",    ["aka"],                             1, {                  last: "2026-05-26T09:11:30+05:30" }),
  // Unifinz — alias gap
  _M(20, "Unifinz",          ["unifinz", "unifin"],               2, { notified: true,  last: "2026-05-26T12:48:11+05:30" }),
  _M(21, "Unifinz",          ["unif"],                            1, {                  last: "2026-05-26T17:55:44+05:30" }),
];
export const outreachMockSample = _MOCK_RAW;

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
