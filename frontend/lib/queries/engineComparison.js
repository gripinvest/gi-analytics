// V1 vs V2 engine cutover comparison.
//
// Every asset_search_* event payload carries `engine_version`:
//   - NULL  → V1 (pre-cutover)
//   - 'v2'  → V2 (post-cutover)
//
// This module slices headline metrics on that field — a clean release-cut
// diff without A/B traffic routing. engineDataState() classifies the
// returned rows so the strip can render a pending state until v2 rows
// appear.

import { TEST_USERS } from "./assetSearch";

// First feature week that carries the `engine_version` column. The V2 rollout
// landed mid-W8 (2026-05-27); pre-W8 CSVs predate the instrumentation and
// would error on a column reference. The trailing-window union below filters
// to weeks ≥ this so the SQL never references a missing column.
export const CUTOVER_WEEK = 8;

const EXC = `(user_id IS NULL OR user_id NOT IN (${TEST_USERS.join(",")}))`;
const wkOf = (t) => {
  const m = t.match(/(?:^|_)W(\d+)_/);
  return m ? Number(m[1]) : null;
};

/**
 * Build a UNION ALL subquery over the cutover-window tables, projecting only
 * the columns the cutover SQL needs (test-users filtered). Returns null when
 * no eligible weeks exist yet — callers should skip running their SQL.
 */
function unionCutover(tables, cols) {
  const eligible = (tables || []).filter((t) => {
    const w = wkOf(t);
    return w != null && w >= CUTOVER_WEEK;
  });
  if (eligible.length === 0) return null;
  const parts = eligible.map(
    (t) => `  SELECT ${cols} FROM "${t}" WHERE ${EXC}`
  );
  return `(\n${parts.join("\n  UNION ALL\n")}\n)`;
}

/**
 * Resolve the cutover-window subqueries the SQL builders consume. Takes the
 * same `{ tables, weeks }` context every other dashboard QUERY_SPEC uses.
 * Returns null fields when no cutover-window data exists yet.
 */
export function cutoverContext({ tables } = {}) {
  const assetTbl = unionCutover(
    tables && tables.query,
    "engine_version, context_session_id, query_text, results_count, is_refinement"
  );
  const clickTbl = unionCutover(
    tables && tables.result_clicked,
    "id, context_session_id"
  );
  return { assetTbl, queryTbl: assetTbl, clickTbl };
}

// ── live SQL builders ───────────────────────────────────────────────────────

/**
 * Headline-metric split: queries, ZRR, refinement, by engine_version.
 * Single source row per engine; the dashboard compares them side by side.
 *
 * `assetTbl` is the union of W{cutover-4..N} asset_search_query CSVs —
 * we look at a 4-week window straddling the cutover for a stable diff.
 */
export function engineHealthCutover({ assetTbl }) {
  // No trailing `;` — the dashboard's runQuery wraps user SQL as
  // `SELECT * FROM (${sql}) _q LIMIT N`, which makes any in-statement
  // semicolon a syntax error.
  return `
    SELECT
      COALESCE(engine_version, 'v1')           AS engine,
      COUNT(*)                                 AS queries,
      COUNT(DISTINCT context_session_id)       AS sessions,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END)
                  / COUNT(*), 1)               AS zrr_pct,
      ROUND(100.0 * SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END)
                  / COUNT(*), 1)               AS refinement_pct
    FROM ${assetTbl}
    WHERE query_text IS NOT NULL
    GROUP BY 1
    ORDER BY engine
  `;
}

/**
 * Session-outcome split: success / relevance-gap / dead-end percentages
 * by engine. Pairs with engineHealthCutover for the side-by-side card.
 */
export function engineOutcomeCutover({ queryTbl, clickTbl }) {
  return `
    WITH sessions_with_engine AS (
      SELECT
        COALESCE(engine_version, 'v1') AS engine,
        context_session_id
      FROM ${queryTbl}
      GROUP BY 1, 2
    ),
    classified AS (
      SELECT
        s.engine,
        s.context_session_id,
        COUNT(DISTINCT c.id) > 0 AS clicked,
        SUM(CASE WHEN q.results_count > 0 THEN 1 ELSE 0 END) > 0 AS any_results
      FROM sessions_with_engine s
      LEFT JOIN ${queryTbl} q
        ON q.context_session_id = s.context_session_id
      LEFT JOIN ${clickTbl} c
        ON c.context_session_id = s.context_session_id
      GROUP BY 1, 2
    )
    SELECT
      engine,
      COUNT(*)                                       AS searched,
      SUM(CASE WHEN clicked THEN 1 ELSE 0 END)       AS success,
      SUM(CASE WHEN NOT clicked AND any_results THEN 1 ELSE 0 END) AS relevance_gap,
      SUM(CASE WHEN NOT clicked AND NOT any_results THEN 1 ELSE 0 END) AS dead_end
    FROM classified
    GROUP BY engine
    ORDER BY engine
  `;
}

// ── data-state classifier ──────────────────────────────────────────────────

/**
 * 'pending' until at least one row carries `engine_version='v2'`,
 * 'live' otherwise. Drives the mock-to-live cutover in the strip.
 */
export function engineDataState(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "pending";
  const hasV2 = rows.some((r) => r.engine === "v2");
  return hasV2 ? "live" : "pending";
}

// ── derived helpers for the strip ──────────────────────────────────────────

/**
 * Pair two row sets by `engine` value so the strip can compute deltas
 * without each consumer re-doing the array search.
 */
export function pairByEngine(rows) {
  const get = (engine) => rows.find((r) => r.engine === engine) ?? null;
  return { v1: get("v1"), v2: get("v2") };
}

/** Percentage-point delta with explicit sign + good/bad polarity. */
export function ppDelta(v1, v2, { goodIsDown = true } = {}) {
  if (v1 == null || v2 == null) return null;
  const diff = Math.round((v2 - v1) * 10) / 10;
  if (diff === 0) return { value: 0, sign: "0", good: null };
  const good = goodIsDown ? diff < 0 : diff > 0;
  return { value: Math.abs(diff), sign: diff > 0 ? "+" : "−", good };
}
