/**
 * SQL builders for the Asset Search project dashboard.
 *
 * The data is loaded as one DuckDB view per (feature-week, event) pair, named
 *   {projectId}__W{n}_{daterange}_asset_search_{event}
 * e.g. asset_search__W4_apr23_apr29_asset_search_query
 *
 * Domain rules (see PRODUCT.md — keep these exact):
 *  - Exclude test users 3, 4, 207871, 207875, 207878, 207879 everywhere.
 *  - ZRR is QUERY-LEVEL: rows in *_query with results_count = 0, over all *_query rows.
 *  - Refinement = *_query.is_refinement = true.
 *  - "Clear" events (*_cleared): W4-W6 carry the had_results / any_result_clicked
 *    payload natively; W1-W3 predate it (abandonment reconstructed offline by
 *    search_analytics/reconstruct_abandonment.py).
 *  - Feature weeks W1..W6 from the Apr 2 2026 launch (W6 = May 7..13).
 *
 * Each builder takes a `tables` map: { event -> [tableName, ...in W1..Wn order] }
 * (built by groupTables below) and returns a SQL string. Run with lib/api.runQuery.
 */

export const TEST_USERS = [3, 4, 207871, 207875, 207878, 207879];
const EXC = `(user_id IS NULL OR user_id NOT IN (${TEST_USERS.join(",")}))`;
const EVENTS = ["initiated", "query", "result_clicked", "empty_state", "cleared", "suggestion_clicked"];

/** Group a project's table list into { event: [t1..tn ordered by week], ... } + week labels. */
export function groupTables(tableNames) {
  const byEvent = {};
  for (const t of tableNames) {
    const wk = t.match(/(?:^|_)W(\d+)_/);
    const ev = t.match(/_asset_search_(initiated|query|result_clicked|empty_state|cleared|suggestion_clicked)$/);
    if (!wk || !ev) continue;
    (byEvent[ev[1]] ||= []).push({ wk: Number(wk[1]), table: t });
  }
  for (const k of Object.keys(byEvent)) byEvent[k].sort((a, b) => a.wk - b.wk);
  const reference = byEvent.query || byEvent.initiated || Object.values(byEvent)[0] || [];
  const weeks = reference.map((x) => `W${x.wk}`);
  const tables = {};
  for (const ev of EVENTS) tables[ev] = (byEvent[ev] || []).map((x) => x.table);
  const ok = EVENTS.every((ev) => tables[ev].length === weeks.length && weeks.length > 0);
  return { tables, weeks, ok, lastWeek: weeks[weeks.length - 1] };
}

const q = (name) => `"${name}"`;

/** UNION ALL of `SELECT <cols> FROM <table> WHERE <exc>` across the given tables. */
function unionAll(tableList, cols, extraWhere) {
  const where = extraWhere ? `${EXC} AND (${extraWhere})` : EXC;
  return tableList.map((t) => `SELECT ${cols} FROM ${q(t)} WHERE ${where}`).join("\nUNION ALL\n");
}

/** UNION ALL with a `'W1' AS week` literal prepended per table (tables in week order). */
function unionAllWeeks(tableList, weeks, cols, extraWhere) {
  const where = extraWhere ? `${EXC} AND (${extraWhere})` : EXC;
  return tableList
    .map((t, i) => `SELECT '${weeks[i]}' AS week, ${cols} FROM ${q(t)} WHERE ${where}`)
    .join("\nUNION ALL\n");
}

// ── per-week series ─────────────────────────────────────────────────────────

/** Weekly query volume, zero-result count, ZRR%, refinement count, refinement%. */
export function queryHealthByWeek({ tables, weeks }) {
  return `SELECT week,
      COUNT(*) AS queries,
      SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct,
      SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) AS refinements,
      ROUND(100.0 * SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) / COUNT(*), 1) AS refinement_pct
    FROM (${unionAllWeeks(tables.query, weeks, "results_count, is_refinement")}) t
    GROUP BY week ORDER BY week`;
}

/** Distinct-session funnel per week: focused -> queried -> clicked a result. */
export function funnelByWeek({ tables, weeks }) {
  const part = (list, alias) =>
    `(${unionAllWeeks(list, weeks, "context_session_id AS sid")})`;
  return `WITH
      i AS (SELECT week, COUNT(DISTINCT sid) AS initiated FROM ${part(tables.initiated)} GROUP BY week),
      q AS (SELECT week, COUNT(DISTINCT sid) AS queried   FROM ${part(tables.query)}     GROUP BY week),
      c AS (SELECT week, COUNT(DISTINCT sid) AS clicked   FROM ${part(tables.result_clicked)} GROUP BY week)
    SELECT i.week, i.initiated, q.queried, c.clicked
    FROM i JOIN q USING (week) JOIN c USING (week) ORDER BY i.week`;
}

/** Suggestion clicks per week and click-through vs sessions that focused search. */
export function suggestionsByWeek({ tables, weeks }) {
  return `WITH
      s AS (SELECT week, COUNT(*) AS suggestion_clicks, COUNT(DISTINCT context_session_id) AS sessions_with_click
            FROM (${unionAllWeeks(tables.suggestion_clicked, weeks, "context_session_id")}) t GROUP BY week),
      i AS (SELECT week, COUNT(DISTINCT context_session_id) AS focused
            FROM (${unionAllWeeks(tables.initiated, weeks, "context_session_id")}) t GROUP BY week)
    SELECT i.week, COALESCE(s.suggestion_clicks, 0) AS suggestion_clicks, i.focused,
      ROUND(100.0 * COALESCE(s.sessions_with_click, 0) / NULLIF(i.focused, 0), 1) AS ctr_pct
    FROM i LEFT JOIN s USING (week) ORDER BY i.week`;
}

/** Clear events per week (abandonment proxy). */
export function clearsByWeek({ tables, weeks }) {
  return `SELECT week, COUNT(*) AS clears
    FROM (${unionAllWeeks(tables.cleared, weeks, "1 AS one")}) t GROUP BY week ORDER BY week`;
}

/**
 * Per-week SESSION OUTCOME funnel — the primary search-health metric.
 *
 * Every searched session (a distinct context_session_id that ran >=1 query that
 * week) is classified ONCE into exactly one of three mutually-exclusive buckets:
 *
 *   success       — the session clicked >=1 search result
 *   relevance_gap — never clicked, but >=1 query returned results (results shown,
 *                   nothing compelling enough to click — a ranking/relevance miss)
 *   dead_end      — never clicked, and every query returned zero results
 *                   (a catalog / alias gap — the user hit a wall)
 *
 * Unlike the asset_search_cleared-based abandonment split, this needs no event
 * payload reconstruction: it is computed from asset_search_query (results_count)
 * and asset_search_result_clicked, both fully populated across W1..W6. It is
 * exact for every week and disjoint by construction, so success + relevance_gap
 * + dead_end = searched.
 */
export function sessionOutcomeByWeek({ tables, weeks }) {
  const q = unionAllWeeks(tables.query, weeks, "context_session_id, results_count");
  const c = unionAllWeeks(tables.result_clicked, weeks, "context_session_id");
  return `WITH
      q AS (
        SELECT week, context_session_id AS sid,
               MAX(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) AS any_results
        FROM (${q}) t GROUP BY week, context_session_id
      ),
      c AS (SELECT DISTINCT week, context_session_id AS sid FROM (${c}) t)
    SELECT q.week,
        COUNT(*) AS searched,
        SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN c.sid IS NULL AND q.any_results = 1 THEN 1 ELSE 0 END) AS relevance_gap,
        SUM(CASE WHEN c.sid IS NULL AND q.any_results = 0 THEN 1 ELSE 0 END) AS dead_end,
        ROUND(100.0 * SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_pct
      FROM q LEFT JOIN c ON q.week = c.week AND q.sid = c.sid
      GROUP BY q.week ORDER BY q.week`;
}

// ── leaderboards / distributions (all weeks) ────────────────────────────────

/** Top search terms by volume, with their query-level ZRR. */
export function topSearchTerms({ tables }, limit = 18, minCount = 25) {
  return `SELECT LOWER(TRIM(query_text)) AS term,
      COUNT(*) AS searches,
      SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct,
      ROUND(100.0 * SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) / COUNT(*), 1) AS refinement_pct
    FROM (${unionAll(tables.query, "query_text, results_count, is_refinement")}) t
    WHERE query_text IS NOT NULL AND TRIM(query_text) <> ''
    GROUP BY term HAVING COUNT(*) >= ${minCount}
    ORDER BY searches DESC LIMIT ${limit}`;
}

// NOTE: result_position in the raw events is 0-indexed (0 = the top result).
// We expose it 1-based here as `rank` so the dashboard reads naturally (rank 1 =
// top slot) and the position-bias chart actually includes the top slot.

/** Most-clicked assets from result_clicked, with the avg 1-based rank they were clicked at. */
export function topClickedAssets({ tables }, limit = 12) {
  return `SELECT clicked_asset_name AS asset, ANY_VALUE(clicked_asset_type) AS type,
      COUNT(*) AS clicks, ROUND(AVG(result_position) + 1, 1) AS avg_rank
    FROM (${unionAll(tables.result_clicked, "clicked_asset_name, clicked_asset_type, result_position")}) t
    WHERE clicked_asset_name IS NOT NULL AND result_position IS NOT NULL
    GROUP BY asset ORDER BY clicks DESC LIMIT ${limit}`;
}

/** Click distribution by 1-based result rank (position bias). */
export function clicksByPosition({ tables }, maxRank = 10) {
  return `SELECT result_position + 1 AS rank, COUNT(*) AS clicks
    FROM (${unionAll(tables.result_clicked, "result_position")}) t
    WHERE result_position IS NOT NULL AND result_position BETWEEN 0 AND ${maxRank - 1}
    GROUP BY rank ORDER BY rank`;
}

/** Top zero-result queries (from the dedicated empty_state event = unique-query level). */
export function topZeroResultQueries({ tables }, limit = 14) {
  return `SELECT LOWER(TRIM(query_text)) AS term, COUNT(*) AS hits, ROUND(AVG(query_length), 0) AS avg_len
    FROM (${unionAll(tables.empty_state, "query_text, query_length")}) t
    WHERE query_text IS NOT NULL AND TRIM(query_text) <> ''
    GROUP BY term ORDER BY hits DESC LIMIT ${limit}`;
}

/** Search volume + ZRR split by the tab the user was on. */
export function byTab({ tables }) {
  return `SELECT COALESCE(active_tab, '(none)') AS tab, COUNT(*) AS queries,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct
    FROM (${unionAll(tables.query, "active_tab, results_count")}) t
    GROUP BY tab ORDER BY queries DESC`;
}

/** Distinct query-sessions overall (denominator for headline framing). */
export function totalQuerySessions({ tables }) {
  return `SELECT COUNT(DISTINCT context_session_id) AS sessions
    FROM (${unionAll(tables.query, "context_session_id")}) t`;
}

// ── issuer roll-up ──────────────────────────────────────────────────────────
//
// The raw events have no issuer column — the offline reconstruct_abandonment.py
// does the query_text → issuer mapping with fuzzy prefix/alias rules. We reproduce a
// SQL-friendly version here: each issuer is matched by a small set of leading
// prefixes (the curated keyword lists collapse to these). `category` and `note`
// are Puru's analysis conclusions, not derivable from data, so they ride along
// as static metadata. abandoned / relevance-gap per issuer are produced offline
// by search_analytics/reconstruct_abandonment.py (native asset_search_cleared
// payload for W4-W6, joined reconstruction for W1-W3).

// `abandoned` / `relgap` are per-week session counts produced offline by
// search_analytics/reconstruct_abandonment.py (true abandonment = cleared with
// had_results=false; relevance gap = cleared with had_results=true & no click).
// W4-W6 use the native asset_search_cleared payload; W1-W3, whose cleared
// export predates those fields, are reconstructed by joining each clear to the
// session's last query and to in-episode result clicks. They ride along as
// static metadata; the dashboard labels them as offline-derived.
export const ISSUER_MAP = [
  { name: "Govt / RBI Bonds", category: "catalog_gap", prefixes: ["rbi", "gov"],
    keywords: ["rbi", "rbi floating rate bond", "rbi savings bond", "govt", "government bond", "gov bond", "govt sec"],
    abandoned: [18, 11, 6, 12, 15, 15], relgap: [14, 13, 12, 12, 2, 5],
    note: "Category-level search intent: 'rbi' or 'govt' can't resolve to one asset. Needs category-level search routing in V2, not an alias fix." },
  { name: "Akara Capital", category: "alias", prefixes: ["aka"],
    keywords: ["aka", "akar", "akara", "akara capital", "akara capital advisors pvt ltd", "akara ncd"],
    abandoned: [0, 0, 17, 7, 9, 11], relgap: [19, 10, 9, 12, 17, 17],
    note: "Alias works well at >= 4 chars. The high relevance gap suggests results appear but rank order isn't ideal. A brief W3 ZRR spike was likely an asset that momentarily expired." },
  { name: "Muthoot Finance", category: "availability", prefixes: ["mut"],
    keywords: ["mut", "muth", "muthoot", "muthoot finance", "muthoot fincorp", "muthoot microfin", "muthoot capital"],
    abandoned: [18, 4, 14, 21, 24, 7], relgap: [3, 5, 10, 0, 1, 3],
    note: "ZRR swings 17% to 90%, too extreme for an alias issue. The asset cycles in and out of the catalog; abandonment spikes in the high-ZRR weeks confirm it. Needs an 'asset temporarily unavailable' state." },
  { name: "Navi", category: "healthy", prefixes: ["nav"],
    keywords: ["nav", "navi", "navi finserv", "navi finserve", "navi ncd"],
    abandoned: [1, 0, 0, 1, 8, 3], relgap: [12, 5, 5, 3, 13, 2],
    note: "Search works well. Low refinement means users find results in one or two variants. The residual ZRR is prefix-typing noise, not a real gap." },
  { name: "Keertana", category: "availability", prefixes: ["kee"],
    keywords: ["kee", "keer", "keert", "keertana", "keertana finserv", "keerthana"],
    abandoned: [0, 0, 7, 9, 10, 4], relgap: [2, 5, 5, 6, 4, 3],
    note: "The asset went offline around W3. Demand is growing while supply isn't keeping pace; nearly all abandonments are true zero-result ones. Add a 'notify me when available' action on the empty state." },
  { name: "Unifinz", category: "alias", prefixes: ["unif"],
    keywords: ["unif", "unifi", "unifin", "unifinz", "unifinz capital", "unifinj capital india"],
    abandoned: [4, 3, 0, 6, 3, 0], relgap: [21, 12, 3, 6, 3, 3],
    note: "0% ZRR in the weeks the asset is live: search works perfectly then. The volatility is asset availability, not the alias. Low true abandonment confirms the engine is fine." },
  { name: "Vedika Credit", category: "catalog_gap", prefixes: ["ved"],
    keywords: ["ved", "vedi", "vedik", "vedika", "vedika credit", "vedikacradit capital ltd"],
    abandoned: [7, 12, 5, 18, 7, 9], relgap: [0, 1, 3, 1, 0, 1],
    note: "Roughly 100% ZRR from day one. Near-zero relevance gap: results are never shown, so nothing can be irrelevant. The strongest BD signal, persistent demand for an asset not on the platform." },
  { name: "Mufin Finance", category: "alias", prefixes: ["muf"],
    keywords: ["muf", "mufi", "mufin", "mufin green", "mufin green finance", "mufin ncd"],
    abandoned: [2, 5, 1, 2, 11, 4], relgap: [10, 5, 2, 1, 6, 1],
    note: "Both alias and availability issues. ZRR drops near 3% when the asset is live, spikes again when it isn't. The engine finds partial matches when live but ranking isn't ideal." },
  { name: "Adani", category: "healthy", prefixes: ["ada"],
    keywords: ["ada", "adani", "adani green", "adani power", "adani energy solutions", "adani enterprise"],
    abandoned: [0, 1, 0, 1, 1, 0], relgap: [5, 2, 1, 1, 3, 0],
    note: "Some Adani assets are on the platform. Consistently low ZRR, growing demand. Low refinement means users find results fast." },
  { name: "Indel Money", category: "healthy", prefixes: ["inde"],
    keywords: ["inde", "indel", "indel money", "indel oct 27", "indel money ncd"],
    abandoned: [0, 0, 0, 0, 0, 0], relgap: [1, 3, 3, 0, 2, 1],
    note: "Near-perfect ZRR. The old session-level 34.7% figure was entirely prefix-typing noise. Lowest refinement: users find what they want on the first real query." },
];

export const ISSUER_CATEGORY = {
  healthy:      { label: "Healthy",      tone: "success" },
  alias:        { label: "Alias gap",    tone: "warning" },
  availability: { label: "Availability", tone: "warning" },
  catalog_gap:  { label: "Catalog gap",  tone: "error" },
};

// Metric definitions for the (?) info tooltips. `live` = computed from the
// loaded DuckDB views; otherwise the source notes where the number comes from.
export const METRIC_DEFS = {
  sessions: { title: "Search sessions", live: true,
    body: "Distinct browser sessions that ran at least one search query. For an issuer, sessions whose query text maps to that issuer via the prefix / alias rules; prefix variants (aka, akar, akara) collapse into one issuer before counting.",
    source: "asset_search_query -> COUNT(DISTINCT context_session_id)" },
  queries: { title: "Query events", live: true,
    body: "Individual debounced query events (one per query-text change, 300ms debounce, query >= 3 chars). The denominator for query-level ZRR and refinement.",
    source: "asset_search_query -> COUNT(*)" },
  zrr: { title: "Zero-result rate (query level)", live: true,
    body: "Share of query events that returned results_count = 0. Query-level is the right metric: session-level over-counts prefix-typing noise within a single session. On the issuer chart the dot colour encodes severity (green -> amber -> red).",
    source: "asset_search_query -> SUM(results_count = 0) / COUNT(*)" },
  refinement: { title: "Refinement rate", live: true,
    body: "Share of query events flagged is_refinement = true, meaning the previous debounced query was already >= 3 chars. High refinement means the user is iterating because the first result set wasn't good enough; it catches 'almost worked' searches that ZRR alone misses.",
    source: "asset_search_query -> SUM(is_refinement) / COUNT(*)" },
  abandoned: { title: "True abandonment", live: false,
    body: "Sessions where the user cleared the search bar after getting zero results (had_results = false in the cleared event). Exact session counts, not an estimate. The user saw nothing and gave up. Distinct from the relevance gap.",
    source: "asset_search_cleared -> had_results = 'false'  (W4-W6 native payload; W1-W3 reconstructed offline by reconstruct_abandonment.py)" },
  relgap: { title: "Relevance gap", live: false,
    body: "Sessions where results WERE shown (had_results = true) but the user cleared without clicking anything (any_result_clicked = false). The engine found something, it just wasn't relevant enough: a ranking problem, not a catalog gap.",
    source: "asset_search_cleared -> had_results = 'true' AND any_result_clicked = 'false'  (W4-W6 native payload; W1-W3 reconstructed offline)" },
  clears: { title: "Clear events", live: true,
    body: "Count of asset_search_cleared events (the user wiped the search bar after a query of >= 3 chars). The raw event total; the true-abandonment vs relevance-gap split is shown separately in `abandoned` / `relgap` (native had_results / any_result_clicked payload for W4-W6, reconstructed for W1-W3).",
    source: "asset_search_cleared -> COUNT(*)" },
  clicks: { title: "Result clicks", live: true,
    body: "Clicks on a result inside the search dropdown. Carries the clicked asset, its type, and the 1-based result position, so we can see what search actually drives and whether the top slot dominates.",
    source: "asset_search_result_clicked -> COUNT(*)" },
  suggestionCtr: { title: "Suggestion click-through", live: true,
    body: "Of the sessions that focused the search box, the share that clicked one of the focus-time top-asset suggestions (top YTM picks shown before the user types). It is pre-search discovery, not a zero-result fallback.",
    source: "asset_search_suggestion_clicked distinct sessions / asset_search_initiated distinct sessions" },
};

const esc = (s) => String(s).replace(/'/g, "''").replace(/([%_\\])/g, "\\$1");

/**
 * SQL CASE that maps a query string to an issuer the way reconstruct_abandonment.py does:
 * a query matches an issuer if, for any of that issuer's keywords, the query is a
 * prefix of the keyword (early typing: "uni" -> "unifinz") OR the keyword is a
 * prefix of the query (typed past it: "muthoot finance ltd" -> "muthoot"). That
 * naturally catches partial typing while excluding lookalikes ("india" is neither
 * a prefix of nor prefixed by any "indel..." keyword). First matching issuer wins.
 */
function issuerCaseExpr(col = "query_text") {
  const q = `LOWER(TRIM(${col}))`;
  const arms = ISSUER_MAP.map((m) => {
    const conds = m.keywords
      .map((k) => k.toLowerCase().trim())
      .map((k) => `(${q} LIKE '${esc(k)}%' ESCAPE '\\' OR '${esc(k)}' LIKE ${q} || '%')`)
      .join(" OR ");
    return `WHEN ${conds} THEN '${m.name.replace(/'/g, "''")}'`;
  });
  return `CASE ${arms.join(" ")} ELSE NULL END`;
}

/** Sessions / queries / ZRR / refinement per issuer per feature week. */
export function issuerHealthByWeek({ tables, weeks }) {
  const raw = unionAllWeeks(tables.query, weeks, "context_session_id, query_text, results_count, is_refinement");
  return `SELECT week, issuer,
      COUNT(DISTINCT context_session_id) AS sessions,
      COUNT(*) AS queries,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct,
      ROUND(100.0 * SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) / COUNT(*), 1) AS refinement_pct
    FROM (
      SELECT week, context_session_id, results_count, is_refinement, ${issuerCaseExpr("query_text")} AS issuer
      FROM (${raw}) raw
    ) classified
    WHERE issuer IS NOT NULL
    GROUP BY week, issuer
    ORDER BY issuer, week`;
}

/**
 * Per-(issuer, keyword) rollup across the whole window. Groups by case-folded
 * query text so 'Mut' and 'mut' aggregate together — clean for the default
 * roll-up. The data tells the same story either way (Muthoot is hard to find);
 * splitting on case is the analyst's optional drill-down, captured in a
 * separate query when we need it.
 *
 * HAVING ≥ 3 trims long-tail typos but keeps small-population terms visible —
 * a high-ZRR keyword with 5 occurrences is still a real signal, just one a UI
 * caller should mark with an asterisk.
 */
export function keywordsByIssuer({ tables, weeks }) {
  const raw = unionAllWeeks(tables.query, weeks, "context_session_id, query_text, results_count");
  return `SELECT issuer, term,
      COUNT(*) AS searches,
      COUNT(DISTINCT context_session_id) AS sessions,
      ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct
    FROM (
      SELECT context_session_id, results_count,
             LOWER(TRIM(query_text)) AS term,
             ${issuerCaseExpr("query_text")} AS issuer
      FROM (${raw}) raw
      WHERE query_text IS NOT NULL AND LENGTH(TRIM(query_text)) >= 2
    ) classified
    WHERE issuer IS NOT NULL
    GROUP BY issuer, term
    HAVING COUNT(*) >= 3
    ORDER BY issuer, searches DESC`;
}
