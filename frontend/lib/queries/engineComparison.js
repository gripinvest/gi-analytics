// V1 vs V2 engine cutover comparison.
//
// Every asset_search_* event payload now carries `engine_version`:
//   - NULL  → V1 (pre-cutover; all historical W1-W{cutover-1} rows)
//   - 'v2'  → V2 (post-cutover from the gi-client-web PT-37900 release)
//
// This module slices headline metrics on that field so leadership can
// see "did the V2 push move the needle?" as a clean release-cut diff
// (no A/B traffic split required — the version stamp does the work).
//
// Until V2 deploys to prod, the query returns one row (V1 only) and the
// dashboard strip auto-renders a "Sample data — pending V2 deploy" state.

// ── live SQL builders ───────────────────────────────────────────────────────

/**
 * Headline-metric split: queries, ZRR, refinement, by engine_version.
 * Single source row per engine; the dashboard compares them side by side.
 *
 * `assetTbl` is the union of W{cutover-4..N} asset_search_query CSVs —
 * we look at a 4-week window straddling the cutover for a stable diff.
 */
export function engineHealthCutover({ assetTbl }) {
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
    ORDER BY engine;
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
    ORDER BY engine;
  `;
}

// ── mock data (used until V2 events flow) ──────────────────────────────────

/**
 * Mock pre/post-cutover snapshot. V1 numbers are realistic against the
 * W1-W8 baseline (~50K queries, 28% query-level ZRR, 52% session success).
 * V2 numbers are CONSERVATIVE projections — assume ZRR drops to ~19% and
 * dead-end rate halves once the 4-tier engine, alias map, Top Deals
 * fallback, and Notify Me CTA all land. Marked clearly as "projected"
 * in the UI so leadership doesn't mistake them for real measurements.
 */
export const engineHealthMockSample = [
  {
    engine: "v1",
    queries: 50441,
    sessions: 9252,
    zrr_pct: 28.3,
    refinement_pct: 58.4,
  },
  {
    engine: "v2",
    queries: 6800,   // projected first-week post-deploy
    sessions: 1320,
    zrr_pct: 19.1,
    refinement_pct: 51.8,
  },
];

export const engineOutcomeMockSample = [
  {
    engine: "v1",
    searched: 9252,
    success: 4811,        // 52.0%
    relevance_gap: 2683,  // 29.0%
    dead_end: 1758,       // 19.0%
  },
  {
    engine: "v2",
    searched: 1320,       // projected
    success: 871,         // 66.0%
    relevance_gap: 290,   // 22.0%
    dead_end: 159,        // 12.0%
  },
];

// ── data-state classifier ──────────────────────────────────────────────────

/**
 * Returns 'pending' until at least one row carries `engine_version='v2'`,
 * 'live' otherwise. Used by the dashboard strip to switch from mock data
 * to real data the moment V2 events start flowing.
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
