/**
 * SQL builders for the Asset Search → invest conversion ("Business") tab.
 *
 * Joins the search events (asset_search_initiated / _result_clicked) to the
 * post-search funnel events (invest_now_button_clicked, quick_checkout_invest_clicked),
 * which are loaded as one DuckDB view per (feature-week, event) pair:
 *   {projectId}__W{n}_{daterange}_invest_now_button_clicked
 *   {projectId}__W{n}_{daterange}_quick_checkout_invest_clicked
 *
 * Conventions (must match the offline conversion validation):
 *  - "Converted" has two flavours, used deliberately:
 *      · same-day  — appears in an invest event on the SAME CALENDAR DAY (IST) as the
 *        search activity. Used by conversionHeadline / searchToInvestRate /
 *        topConvertingQueries / conversionByWeek (strict attribution).
 *      · in-window — appears in an invest event anywhere in the window. Used by the
 *        searcher-vs-non-searcher cohorts (cohortCvr / weeklyCohortCvr), since a
 *        non-searcher has no search day to anchor to.
 *    invest_now is an INTENT event (the "Invest Now" CTA), not a paid order.
 *  - Join key is user_id (the loaded asset_search_* views carry no anonymous_id;
 *    the deep-export 14_conversion_cohort_summary is anonymous_id-level).
 *  - Exclude test users 3, 4, 207871, 207875, 207878, 207879 on both sides.
 *  - W1–W3 search exports store user_id as a float ("622564.0"); the invest
 *    exports store it as an int. Parse via DOUBLE→BIGINT so the join lines up.
 *  - timestamp is loaded as a UTC TIMESTAMP; the source events are IST (+05:30).
 *    Add 330 min before taking the date so "same calendar day" is the IST day.
 *  - Asset-level match: clicked_asset_id = asset_id. The invest tables' `infinite`
 *    column is an eligibility flag, NOT the asset id.
 */

import { TEST_USERS } from "./assetSearch";

const TEST = `(${TEST_USERS.join(", ")})`;
const UID = (col = "user_id") => `TRY_CAST(TRY_CAST(${col} AS DOUBLE) AS BIGINT)`;
const AID = (col) => `TRY_CAST(TRY_CAST(${col} AS DOUBLE) AS BIGINT)`;
const DAY = "CAST(CAST(timestamp AS TIMESTAMP) + INTERVAL '330 minutes' AS DATE)";
const NOTEST = `${UID()} IS NOT NULL AND ${UID()} NOT IN ${TEST}`;
const qi = (name) => `"${name}"`;
const weekTag = (t) => {
  const m = t.match(/(?:^|_)W(\d+)_/);
  return m ? `W${m[1]}` : "W?";
};

/** Pull the conversion-relevant table names out of a project's full table list. */
export function conversionTables(tableNames = []) {
  const wk = (t) => {
    const m = t.match(/(?:^|_)W(\d+)_/);
    return m ? Number(m[1]) : null;
  };
  const pick = (suffix) =>
    tableNames.filter((t) => t.endsWith(suffix) && wk(t) != null).sort((a, b) => wk(a) - wk(b));
  const one = (suffix) => tableNames.find((t) => t.endsWith(suffix)) || null;
  const investNow = pick("_invest_now_button_clicked");
  const quickCheckout = pick("_quick_checkout_invest_clicked");
  const initiated = pick("_asset_search_initiated");
  const resultClicked = pick("_asset_search_result_clicked");
  const weeks = initiated.map((t) => weekTag(t));
  const ok = investNow.length > 0 && initiated.length > 0 && investNow.length === initiated.length;
  // From the deep launch-week export (asset-search/): a pre-computed visitor cohort
  // (anonymous_id × is_searcher × clicked_search_result × converted) and a daily funnel
  // — covers only Apr 2–9.
  const cohort = one("_14_conversion_cohort_summary");
  const dailyFunnel = one("_10_daily_funnel_summary");
  const cohortOk = !!cohort;
  // Weekly assets-page-views (W1–W6): the visitor population per week. With these we can
  // build the searcher-vs-non-searcher cohort over the full window, not just launch week.
  const pageViews = pick("_assets_page_views");
  const pageViewsOk = pageViews.length > 0 && pageViews.length === initiated.length;
  return { investNow, quickCheckout, initiated, resultClicked, weeks, ok, cohort, dailyFunnel, cohortOk, pageViews, pageViewsOk };
}

/** UNION ALL `SELECT <cols> FROM <t>` across tables; <cols> is raw column SQL. */
const unionP = (tables, cols) => tables.map((t) => `SELECT ${cols} FROM ${qi(t)}`).join("\nUNION ALL\n");
/** Same, with `'W1' AS week` derived from each table name. */
const unionW = (tables, cols) =>
  tables.map((t) => `SELECT '${weekTag(t)}' AS week, ${cols} FROM ${qi(t)}`).join("\nUNION ALL\n");

// Normalised sub-selects: (uid, dt) / (uid) / (week, uid, dt), test users + nulls dropped.
const searchDays = (tables) =>
  `SELECT DISTINCT ${UID()} AS uid, ${DAY} AS dt FROM (${unionP(tables, "user_id, timestamp")}) _r WHERE ${NOTEST}`;
const searchUsers = (tables) =>
  `SELECT DISTINCT ${UID()} AS uid FROM (${unionP(tables, "user_id")}) _r WHERE ${NOTEST}`;
const searchWeekDays = (tables) =>
  `SELECT DISTINCT week, ${UID()} AS uid, ${DAY} AS dt FROM (${unionW(tables, "user_id, timestamp")}) _r WHERE ${NOTEST}`;
const investDays = ({ investNow, quickCheckout }) =>
  `SELECT DISTINCT ${UID()} AS uid, ${DAY} AS dt FROM (${unionP([...investNow, ...quickCheckout], "user_id, timestamp")}) _r WHERE ${NOTEST}`;
const investUsers = ({ investNow, quickCheckout }) =>
  `SELECT DISTINCT ${UID()} AS uid FROM (${unionP([...investNow, ...quickCheckout], "user_id")}) _r WHERE ${NOTEST}`;

/* ── 1. headline cohort + sub-cohort, one row ───────────────────────────────── */
export function conversionHeadline(conv) {
  const { initiated, resultClicked } = conv;
  return `WITH
  ini_d AS (${searchDays(initiated)}),
  clk_u AS (${searchUsers(resultClicked)}),
  inv_d AS (${investDays(conv)}),
  inv_u AS (${investUsers(conv)}),
  conv AS (SELECT DISTINCT i.uid, (i.uid IN (SELECT uid FROM clk_u)) AS clicked
           FROM ini_d i JOIN inv_d v ON v.uid = i.uid AND v.dt = i.dt)
SELECT
  (SELECT COUNT(DISTINCT uid) FROM ini_d) AS searchers,
  (SELECT COUNT(DISTINCT uid) FROM ini_d WHERE uid IN (SELECT uid FROM clk_u)) AS clickers,
  (SELECT COUNT(DISTINCT uid) FROM conv) AS conv_searchers,
  (SELECT COUNT(DISTINCT uid) FROM conv WHERE clicked) AS conv_clickers,
  (SELECT COUNT(*) FROM (SELECT uid FROM ini_d INTERSECT SELECT uid FROM inv_u)) AS searchers_invested_ever,
  (SELECT COUNT(DISTINCT uid) FROM inv_u) AS invest_users`;
}

/* ── 2. search → invest rate (asset-level, same-day) ────────────────────────── */
export function searchToInvestRate(conv) {
  const { resultClicked, investNow, quickCheckout } = conv;
  return `WITH
  clk AS (SELECT DISTINCT ${UID()} AS uid, ${AID("clicked_asset_id")} AS asset_id, ${DAY} AS dt
          FROM (${unionP(resultClicked, "user_id, clicked_asset_id, timestamp")}) _r
          WHERE ${NOTEST} AND ${AID("clicked_asset_id")} IS NOT NULL),
  inv AS (SELECT DISTINCT ${UID()} AS uid, ${AID("asset_id")} AS asset_id, ${DAY} AS dt
          FROM (${unionP([...investNow, ...quickCheckout], "user_id, asset_id, timestamp")}) _r
          WHERE ${NOTEST} AND ${AID("asset_id")} IS NOT NULL)
SELECT COUNT(*) AS click_events,
  SUM(CASE WHEN EXISTS (SELECT 1 FROM inv v WHERE v.uid = clk.uid AND v.asset_id = clk.asset_id AND v.dt = clk.dt) THEN 1 ELSE 0 END) AS matched
FROM clk`;
}

/* ── 3. top converting queries ──────────────────────────────────────────────── */
export function topConvertingQueries(conv, limit = 14, minClickers = 5) {
  const { resultClicked } = conv;
  return `WITH
  ck AS (SELECT DISTINCT LOWER(TRIM(query_text)) AS qt, ${UID()} AS uid, ${DAY} AS dt
         FROM (${unionP(resultClicked, "query_text, user_id, timestamp")}) _r
         WHERE ${NOTEST} AND query_text IS NOT NULL AND LENGTH(TRIM(query_text)) > 0),
  inv_d AS (${investDays(conv)}),
  cu AS (SELECT qt, COUNT(DISTINCT uid) AS clickers FROM ck GROUP BY qt),
  cv AS (SELECT c.qt, COUNT(DISTINCT c.uid) AS converters FROM ck c JOIN inv_d v ON v.uid = c.uid AND v.dt = c.dt GROUP BY c.qt)
SELECT cu.qt AS query, cu.clickers, COALESCE(cv.converters, 0) AS converters,
  ROUND(100.0 * COALESCE(cv.converters, 0) / cu.clickers, 0) AS rate_pct
FROM cu LEFT JOIN cv USING (qt)
WHERE cu.clickers >= ${minClickers}
ORDER BY converters DESC, clickers DESC
LIMIT ${limit}`;
}

/* ── 4. week-on-week ────────────────────────────────────────────────────────── */
export function conversionByWeek(conv) {
  const { initiated, resultClicked, investNow, quickCheckout } = conv;
  return `WITH
  ini_d AS (${searchWeekDays(initiated)}),
  clk_d AS (${searchWeekDays(resultClicked)}),
  inv_d AS (${investDays(conv)}),
  inv_w AS (SELECT week, COUNT(*) AS invest_events, COUNT(DISTINCT ${UID()}) AS invest_users
            FROM (${unionW([...investNow, ...quickCheckout], "user_id")}) _r WHERE ${NOTEST} GROUP BY week),
  s  AS (SELECT week, COUNT(DISTINCT uid) AS searchers FROM ini_d GROUP BY week),
  sc AS (SELECT i.week, COUNT(DISTINCT i.uid) AS conv_searchers FROM ini_d i JOIN inv_d v ON v.uid = i.uid AND v.dt = i.dt GROUP BY i.week),
  c  AS (SELECT week, COUNT(DISTINCT uid) AS clickers FROM clk_d GROUP BY week),
  cc AS (SELECT x.week, COUNT(DISTINCT x.uid) AS conv_clickers FROM clk_d x JOIN inv_d v ON v.uid = x.uid AND v.dt = x.dt GROUP BY x.week)
SELECT s.week, s.searchers,
  COALESCE(sc.conv_searchers, 0) AS conv_searchers,
  COALESCE(c.clickers, 0) AS clickers,
  COALESCE(cc.conv_clickers, 0) AS conv_clickers,
  COALESCE(iw.invest_events, 0) AS invest_events,
  COALESCE(iw.invest_users, 0) AS invest_users
FROM s
LEFT JOIN sc USING (week)
LEFT JOIN c  USING (week)
LEFT JOIN cc USING (week)
LEFT JOIN inv_w iw USING (week)
ORDER BY s.week`;
}

/* ── 5. invest events by product category (light context) ───────────────────── */
export function investByCategory(conv, limit = 10) {
  const { investNow, quickCheckout } = conv;
  return `SELECT COALESCE(NULLIF(TRIM(CAST(product_category AS VARCHAR)), ''), '(none)') AS category,
    COUNT(*) AS events, COUNT(DISTINCT ${UID()}) AS users
  FROM (${unionP([...investNow, ...quickCheckout], "user_id, product_category, timestamp")}) _r
  WHERE ${NOTEST}
  GROUP BY category ORDER BY events DESC LIMIT ${limit}`;
}

/* ── 6. launch-week cohort: searchers vs non-searchers (anon-id level) ───────── */
// From the deep export's pre-computed 14_conversion_cohort_summary
// (anonymous_id, is_searcher, clicked_search_result, converted), Apr 2–9 2026.
// This is the one place we have the non-searcher population, so it's the only
// place a real search lift is computable.
const BOOL = (c) => `CAST(${c} AS BOOLEAN)`;
export function cohortCvr({ cohort }) {
  return `SELECT
    COUNT(*) AS n_total,
    COUNT(*) FILTER (WHERE ${BOOL("converted")}) AS conv_total,
    COUNT(*) FILTER (WHERE ${BOOL("is_searcher")}) AS n_searchers,
    COUNT(*) FILTER (WHERE ${BOOL("is_searcher")} AND ${BOOL("converted")}) AS conv_searchers,
    COUNT(*) FILTER (WHERE ${BOOL("is_searcher")} AND ${BOOL("clicked_search_result")}) AS n_clicked,
    COUNT(*) FILTER (WHERE ${BOOL("is_searcher")} AND ${BOOL("clicked_search_result")} AND ${BOOL("converted")}) AS conv_clicked,
    COUNT(*) FILTER (WHERE NOT ${BOOL("is_searcher")}) AS n_nonsearchers,
    COUNT(*) FILTER (WHERE NOT ${BOOL("is_searcher")} AND ${BOOL("converted")}) AS conv_nonsearchers
  FROM ${qi(cohort)}`;
}
export function cohortDaily({ dailyFunnel }) {
  if (!dailyFunnel) return `SELECT NULL AS day WHERE FALSE`;
  return `SELECT day, unique_visitors, unique_initiators, result_clickers, converters, overall_cvr_pct
    FROM ${qi(dailyFunnel)} ORDER BY day`;
}

/* ── 7. full-window cohort (W1–W6) from the weekly assets-page-views ─────────── */
// visitors = anyone who viewed the assets page (∪ anyone who initiated a search);
// searchers = initiated a search; non-searchers = visited but never searched;
// converted = appeared in invest_now / quick_checkout in the window. user_id-level.
// Same column shape as cohortCvr() so the UI renders either interchangeably.
export function weeklyCohortCvr(conv) {
  const { pageViews, initiated, resultClicked, investNow, quickCheckout } = conv;
  return `WITH
  pv  AS (${searchUsers(pageViews)}),
  ini AS (${searchUsers(initiated)}),
  clk AS (${searchUsers(resultClicked)}),
  inv AS (${searchUsers([...investNow, ...quickCheckout])}),
  vis AS (SELECT uid FROM pv UNION SELECT uid FROM ini),
  nons AS (SELECT uid FROM pv EXCEPT SELECT uid FROM ini)
SELECT
  (SELECT COUNT(*) FROM vis) AS n_total,
  (SELECT COUNT(*) FROM (SELECT uid FROM vis INTERSECT SELECT uid FROM inv)) AS conv_total,
  (SELECT COUNT(*) FROM ini) AS n_searchers,
  (SELECT COUNT(*) FROM (SELECT uid FROM ini INTERSECT SELECT uid FROM inv)) AS conv_searchers,
  (SELECT COUNT(*) FROM clk) AS n_clicked,
  (SELECT COUNT(*) FROM (SELECT uid FROM clk INTERSECT SELECT uid FROM inv)) AS conv_clicked,
  (SELECT COUNT(*) FROM nons) AS n_nonsearchers,
  (SELECT COUNT(*) FROM (SELECT uid FROM nons INTERSECT SELECT uid FROM inv)) AS conv_nonsearchers`;
}

// Info-tooltip definitions for the conversion metrics (mirrors METRIC_DEFS shape).
export const CONV_METRIC_DEFS = {
  searchLift: { title: "Search lift", live: true,
    body: "Searchers' conversion rate ÷ non-searchers' conversion rate. 'Searcher' = focused the search box at least once in the window; 'non-searcher' = viewed an assets page but never searched; 'converted' = appeared in invest_now_button_clicked / quick_checkout_invest_clicked. Computed over W1–W6 when the weekly assets-page-views are loaded (user-id level), otherwise over the launch week from the deep export's pre-computed cohort (anon-id level). invest_now is an intent event, not a paid order. Target > 1.5×.",
    source: "assets_page_views ∪ asset_search_initiated as the visitor base; CVR(searcher) / CVR(non-searcher)" },
  overallCvr: { title: "Overall visitor CVR", live: true,
    body: "Of everyone who viewed an assets page (or initiated a search) in the window, the share who clicked Invest Now / Quick Checkout — deduped by user. This is the denominator the search lift is measured against.",
    source: "assets_page_views ∪ asset_search_initiated ⋈ invest events" },
  searchersCvr: { title: "Searchers CVR (same-day)", live: true,
    body: "Of users who focused the search box (asset_search_initiated), the share who clicked the Invest Now CTA — or a Quick Checkout invest — on the same calendar day (IST). 'Any day in the window' rides alongside as the upper bound; true considered-window conversion sits between the two.",
    source: "asset_search_initiated ⋈ (invest_now_button_clicked ∪ quick_checkout_invest_clicked) on user_id + IST calendar day" },
  clickedCvr: { title: "Result-clicker CVR", live: true,
    body: "Searchers split by whether they clicked a search result. 'Clicked' = appeared in asset_search_result_clicked; 'no-click' = initiated a search but never clicked a result. Same-day conversion as above. The clicked vs no-click gap is the cleanest read on search adding value beyond self-selection.",
    source: "asset_search_result_clicked vs asset_search_initiated, each ⋈ invest events on user_id + day" },
  searchToInvest: { title: "Search → invest rate (asset-level)", live: true,
    body: "Of distinct (user, clicked-asset, day) search-result-click events, the share followed the same day by an Invest Now / Quick Checkout event on that exact asset (clicked_asset_id = asset_id). Direct asset-level follow-through, harder to explain by self-selection alone.",
    source: "asset_search_result_clicked ⋈ invest events on user_id + clicked_asset_id + IST day" },
  invest: { title: "Invest events", live: true,
    body: "Count of invest_now_button_clicked + quick_checkout_invest_clicked rows (test users excluded). invest_now fires on the 'Invest Now' CTA — an intent signal, not a confirmed/paid order; a drop-off between this and a completed order isn't visible in these events.",
    source: "invest_now_button_clicked ∪ quick_checkout_invest_clicked → COUNT(*)" },
};
