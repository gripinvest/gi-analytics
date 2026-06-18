# Asset Search — Outreach Drill-down + Raw Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Asset Search **Editorial** dashboard: (1) stop showing dummy/sample data now that V2 is live — render a "waiting for live data" pending state until real data arrives; (2) add a per-user search-history modal (primary) to the Outreach section with a GC-vs-platform "Source" identifier; (3) add a raw CSV export (secondary).

**Architecture:** Data flows through the existing path — a builder in `frontend/lib/queries/outreach.js` returns a read-only SQL string, executed on demand by `runQuery(projectId, sql, limit)` (`frontend/lib/api.ts`) → `POST /api/projects/{id}/query` → DuckDB. The modal fires a per-user query on row-click; no backend change. The modal is a small custom component (no modal primitive exists). Sample/mock fallbacks are removed in favour of pending states.

**Tech Stack:** Next.js (JS/JSX, "use client"), DuckDB via FastAPI, plain CSS with `ed-*` Editorial design tokens. No JS test framework.

## Global Constraints

Every task implicitly includes these (verbatim values from the spec / repo conventions):

- **Worktree:** all work in `.claude/worktrees/feat+asset-search-outreach-drilldown` (branch `feat/asset-search-outreach-drilldown`). Never edit the primary checkout.
- **Three-state data display — loading → live | pending; NEVER mock.** The panic comes from ambiguous loading: live sections show skeletons while fetching, but the mock-backed sections (V1/V2 strip, outreach) render sample numbers *immediately* with no loading affordance, so mid-load the dashboard looks inconsistent. Fix: the cutover strip and outreach section must receive the dashboard's `loading` flag and render the **same skeleton/loading vocabulary** (`ed-skeleton` class / `Skeleton` component) while fetching; after load, show **live data or a clear "waiting for live data" pending panel** — never mock. Remove the mock datasets and their now-dead exports. `loading` is already in scope at both render sites (`AssetSearchDashboardEditorial.jsx:383`) and passed to peers as `loading={loading}`.
- **Test users excluded everywhere:** `3, 4, 207871, 207875, 207878, 207879` (reuse `EXC` / `TEST_USERS` from `lib/queries/assetSearch.js`).
- **`user_id` only — NO PII** (no email/name/phone) on any surface.
- **`invested`, `gc_name`, `gc_id`, `obpp_kyc_status` are W4+ traits** — absent W1–W3. The per-user modal + raw export query **W4+ tables only**; the base outreach rollup NULL-projects `gc_name` (VARCHAR) for pre-W4 weeks.
- **Mobile-first:** new UI cleared at 375 px first.
- **Verification (no JS test runner; `outreach.js` uses extensionless imports that bare `node` cannot resolve — only `assetSearch.js`, which has zero imports, is node-importable):**
  - Pure helpers added to `assetSearch.js` → a `node` `.mjs` assertion (import with explicit `.js`).
  - SQL builders in `outreach.js` → execute the generated SQL against the built `grip.duckdb` (see "DuckDB smoke harness" below) and confirm it runs + returns the expected columns / sane row count. This is the correctness gate for builders.
  - React/UI → `npm run build` (Next resolves imports) + a Playwright browser check at 375 px and desktop.
- **`npm run build` must pass before any task is "done."**
- **Delivery sequencing (hard):** finish + **deploy Phase 1 to `main`** (Task 6) before starting Phase 2.
- Match existing conventions (`cellStyle`, `ed-caption`, `HeaderCell`, `MiniExhibit`, the `ED_*` color consts in the cutover strip).

### DuckDB smoke harness (one-time setup, reused by builder tasks)

```bash
# from the worktree root
ln -sfn ../../../backend/.venv backend/.venv 2>/dev/null || true   # primary-checkout venv (sys py can't install duckdb 1.1.0)
backend/.venv/bin/python backend/build_duckdb.py                    # bakes CSVs -> grip.duckdb (skip if grip.duckdb is fresh)
# real table names are {project}__{csv_stem}; list them:
backend/.venv/bin/python - <<'PY'
import duckdb; con=duckdb.connect("backend/grip.duckdb")
print([r[0] for r in con.execute("SHOW TABLES").fetchall() if "asset_search" in r[0]][:5])
PY
```
A builder takes a `tables` object of these real names. To smoke-test a builder, import is impossible from Python — instead paste the builder's emitted SQL (copy from a `console.log` in a scratch `.mjs` that `next`/a bundler runs, OR reconstruct with real table names) into `con.execute(sql)`. Simplest reliable path: run the dashboard locally (`npm run dev` + backend) and confirm the network call to `/api/projects/asset_search/query` returns rows (DevTools / Playwright `browser_network_requests`).

---

# PHASE 1 — Real-data-only + drill-down modal (then commit + deploy to main)

### Task 1: Remove V1-vs-V2 cutover-strip sample data → pending state

**Files:**
- Modify: `frontend/components/dashboards/AssetSearchCutoverStrip.jsx` (signature line 106; imports line 10–13; `sourceHealth`/`sourceOutcome` lines 110–111; pending pill lines ~166–182; metric rows 212–248; footnote 257–259)
- Modify: `frontend/lib/queries/engineComparison.js` (remove `engineHealthMockSample`, `engineOutcomeMockSample` exports ~lines 135–170; keep `engineDataState`, `CUTOVER_WEEK`)
- Modify: `frontend/components/dashboards/AssetSearchDashboardEditorial.jsx` (the `<AssetSearchCutoverStrip .../>` render ~line 810 — pass `loading`)

**Interfaces:**
- Consumes: `engineDataState(rows)` (unchanged) — `"pending"` when no live engine rows; the dashboard's `loading` flag (in scope at `:383`).
- Produces: cutover strip is three-state — **loading skeleton → live metrics → pending panel**. No mock exports remain.

- [ ] **Step 1: Stop importing the mocks; add a `loading` prop; use live rows directly**

In `AssetSearchCutoverStrip.jsx` change the import (lines 10–13) to drop the two mock names, keeping `engineDataState`:
```jsx
import { engineDataState } from "@/lib/queries/engineComparison";
```
Add `loading` to the signature (line 106) and replace lines 109–111:
```jsx
export default function AssetSearchCutoverStrip({ healthRows, outcomeRows, loading = false }) {
  const health = Array.isArray(healthRows) ? healthRows : [];
  const outcome = Array.isArray(outcomeRows) ? outcomeRows : [];
  const combinedState = loading ? "loading" : engineDataState(health) === "live" ? "live" : "pending";
  const sourceHealth = health;
  const sourceOutcome = outcome;
```

- [ ] **Step 2: Render loading → live → pending (no mock numbers)**

Change the status pill: `loading` → `LOADING…`; `pending` → `WAITING FOR LIVE V2 DATA`; `live` → the existing LIVE pill. Then replace the column-headers + five `<MetricRow>` region (lines 185–248) with a three-way branch — only `live` shows the metric table:
```jsx
      {combinedState === "loading" ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }} aria-label="loading">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="ed-skeleton" style={{ height: 22, width: "100%" }} />)}
        </div>
      ) : combinedState === "pending" ? (
        <p className="ed-prose-italic" style={{ marginTop: 12, maxWidth: "70ch" }}>
          V2 is live. This comparison appears once the daily refresh has fetched
          post-cutover events — no sample numbers are shown.
        </p>
      ) : (
        <>
          {/* existing Column headers div + the five MetricRow blocks move here unchanged */}
        </>
      )}
```
Update the footnote (257–259): for non-live say "Comparison appears once live V2 events are fetched." Remove the `(projected)` label logic (line 202) — it only existed for the mock state. (If `ed-skeleton` needs a width/height to show, the existing class already pulses; match how `Exhibit` uses `ed-skeleton ed-skeleton-num` at line 313.)

- [ ] **Step 1b: Pass `loading` at the render site**

In `AssetSearchDashboardEditorial.jsx` (~line 810) add `loading={loading}` to the `<AssetSearchCutoverStrip .../>` props.

- [ ] **Step 3: Remove the dead mock exports**

In `engineComparison.js` delete the `engineHealthMockSample` and `engineOutcomeMockSample` arrays/exports (~135–170). Leave `engineDataState` and `CUTOVER_WEEK`.

- [ ] **Step 4: Verify no dangling references + build**

Run:
```bash
rg -n "engineHealthMockSample|engineOutcomeMockSample" frontend/   # expect: no matches
cd frontend && npm run build
```
Expected: grep returns nothing; build succeeds.

- [ ] **Step 5: Manual check**

Run the app; open the Editorial dashboard. Because prod V2 rows aren't in this dev window’s tables, the strip should show the **pending panel** (no dummy V1/V2 numbers). Capture a 375 px screenshot.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/AssetSearchCutoverStrip.jsx frontend/lib/queries/engineComparison.js
git commit -m "feat(asset-search): drop V1/V2 sample data, show pending until live"
```

---

### Task 2: Outreach — remove mock fallback + add GC-vs-platform Source column

**Files:**
- Modify: `frontend/lib/queries/outreach.js` (`notifyMeOutreachDetail` ~75–144; `decorateOutreachRow` ~158; delete `_MOCK_USER_BASE`/`_M`/`_MOCK_RAW`/`outreachMockSample` ~187–230)
- Modify: `frontend/components/dashboards/AssetSearchOutreachSection.jsx` (signature line 203; import line 25; `sourceRows` line 214; pending copy ~409–413; table header ~586; body cells ~630–655; empty `colSpan` 612; `handleExportCsv` 326–375)
- Modify: `frontend/components/dashboards/AssetSearchDashboardEditorial.jsx` (the `<AssetSearchOutreachSection .../>` render — pass `loading`)

**Interfaces:**
- Produces: `notifyMeOutreachDetail({tables})` SQL now also selects `gc_name`; `decorateOutreachRow(row)` returns `source_label` (`"Platform"` | `"GC · <partner>"`) and `is_gc` (bool). Section is three-state — **loading skeleton → live table → pending panel**; no mock. Gains a `loading` prop (Task 5 adds `projectId`/`tables` to the same signature).

- [ ] **Step 1: Remove the mock fallback + add a `loading` prop and affordance**

In `AssetSearchOutreachSection.jsx`: drop `outreachMockSample` from the import (line 25). Add `loading` to the signature (line 203): `export default function AssetSearchOutreachSection({ liveRows, sectionNumber = "VI", loading = false }) {`. Replace line 214:
```jsx
  const sourceRows = live; // real data only — no mock fallback
```
Immediately after the section header/intro `<p>` (so the heading still shows), short-circuit to a loading affordance while fetching — place this before the KPI exhibits block (~line 417):
```jsx
{loading ? (
  <div className="mt-8 flex flex-col gap-2" aria-label="loading">
    {[0, 1, 2, 3, 4].map((i) => <span key={i} className="ed-skeleton" style={{ height: 28, width: "100%" }} />)}
  </div>
) : (
  <>
    {/* the existing pending callout + KPI exhibits + filter bar + table all move inside this fragment */}
  </>
)}
```
Update the pending callout copy (~409–413) to: **"Waiting for live data — no failed-search rows in the current window yet."** (Drop the "rows below preview the queue shape" sentence — there are no preview rows now.)

- [ ] **Step 1b: Pass `loading` at the render site**

In `AssetSearchDashboardEditorial.jsx`, add `loading={loading}` to the `<AssetSearchOutreachSection .../>` props.

- [ ] **Step 2: Delete the mock dataset from `outreach.js`**

Remove `_MOCK_USER_BASE`, `_M`, `_MOCK_RAW`, and `export const outreachMockSample` (~185–230) and the mock-data comment block.

- [ ] **Step 3: NULL-project `gc_name` in the failure union**

In `outreach.js`, after `colsWithEngineVersion` (~line 44) add:
```js
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
```
In `notifyMeOutreachDetail`, change the two `unionAll(..., colsWithEngineVersion("user_id, query_text, timestamp, active_tab"), ...)` calls to `colsWithEngineVersionAndGc("user_id, query_text, timestamp, active_tab")`.

- [ ] **Step 4: Carry `gc_name` through the CTEs + final SELECT**

`classified` adds `gc_name`; `rolled` adds `MAX(gc_name) AS gc_name`; final `SELECT` adds `r.gc_name,`:
```sql
    classified AS (
      SELECT user_id, query_text, timestamp, active_tab, engine_version, gc_name,
             ${issuerCaseExpr("query_text")} AS mapped_issuer
      FROM failures
    ),
    rolled AS (
      SELECT user_id, mapped_issuer,
             COUNT(*) AS hit_count,
             MAX(timestamp) AS last_active,
             MIN(timestamp) AS first_active,
             STRING_AGG(DISTINCT query_text, ' | ') AS top_searches,
             MAX(CASE WHEN COALESCE(engine_version, 'v1') = 'v2' THEN 1 ELSE 0 END) AS seen_v2,
             MAX(active_tab) AS active_tab,
             MAX(gc_name) AS gc_name
      FROM classified
      WHERE mapped_issuer IS NOT NULL
      GROUP BY user_id, mapped_issuer
    ),
```
Add `r.gc_name,` to the final SELECT (before the `CASE WHEN n.user_id ...` line).

- [ ] **Step 5: Derive `source_label` in `decorateOutreachRow`**

```js
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
```

- [ ] **Step 6: Add the SOURCE column to the table + CSV**

Header cell after ISSUER (after line 588):
```jsx
<HeaderCell field="source_label" label="SOURCE" sort={sort} setSort={setSort} />
```
Body cell after the issuer `<td>` (after line 655):
```jsx
<td style={cellStyle}>
  <span className="ed-caption" style={{ letterSpacing: 0.4, opacity: row.is_gc ? 1 : 0.7 }}>
    {row.source_label || "Platform"}
  </span>
</td>
```
Bump empty-state `colSpan` 9 → 10 (line 612). In `handleExportCsv` add `"Source"` to `headers` and `r.source_label` to the row mapping.

- [ ] **Step 7: Build + manual check**

Run: `cd frontend && npm run build`. Manually: the outreach table shows a SOURCE column ("Platform" / "GC · ET money"); with no live rows the section shows the pending panel (no mock leads). 375 px screenshot.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/queries/outreach.js frontend/components/dashboards/AssetSearchOutreachSection.jsx
git commit -m "feat(asset-search): outreach real-data-only + GC-vs-platform Source column"
```

---

### Task 3: `userSearchTimeline` builder + `issuerForQuery` helper

**Files:**
- Modify: `frontend/lib/queries/assetSearch.js` (add `issuerForQuery`)
- Modify: `frontend/lib/queries/outreach.js` (add `userSearchTimeline`)
- Test: `frontend/lib/queries/__checks__/issuer_for_query.mjs` (new — node-runnable since it imports only `assetSearch.js`)

**Interfaces:**
- Produces: `issuerForQuery(text)` → issuer name | null.
- Produces: `userSearchTimeline({ tables, userId })` → SQL string, or `null` for a non-integer `userId` or no W4+ query tables. Rows: `{ ts, day, query_text, results_count, is_refinement, active_tab, clicked_assets, clicked_types, invested, gc_name, kyc }`.

- [ ] **Step 1: Write the failing `issuerForQuery` check**

Create `frontend/lib/queries/__checks__/issuer_for_query.mjs`:
```js
// Run: node frontend/lib/queries/__checks__/issuer_for_query.mjs
import { issuerForQuery } from "../assetSearch.js";
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
assert(issuerForQuery("muthoot finance") === "Muthoot Finance", "muthoot");
assert(issuerForQuery("ved") === "Vedika Credit", "vedika prefix");
assert(issuerForQuery("zzz nope") === null, "unmapped -> null");
assert(issuerForQuery("") === null, "empty -> null");
console.log("PASS: issuer_for_query");
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node frontend/lib/queries/__checks__/issuer_for_query.mjs`
Expected: FAIL (`issuerForQuery` not exported).

- [ ] **Step 3: Add `issuerForQuery` to `assetSearch.js`**

```js
/** Pure-JS mirror of issuerCaseExpr: map a query string to an issuer name
 *  using the same prefix-match semantics, or null when unmapped. */
export function issuerForQuery(text) {
  const q = (text || "").toLowerCase().trim();
  if (!q) return null;
  for (const m of ISSUER_MAP) {
    for (const k of m.keywords) {
      const kw = k.toLowerCase().trim();
      if (q.startsWith(kw) || kw.startsWith(q)) return m.name;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the check, verify it passes**

Run: `node frontend/lib/queries/__checks__/issuer_for_query.mjs`
Expected: `PASS: issuer_for_query`

- [ ] **Step 5: Add `userSearchTimeline` to `outreach.js`**

W4+ only (so no NULL-projection needed); integer-guard the userId (injection).
```js
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
```
(If `GC_FROM_WEEK` was not added in Task 2 for any reason, define it here.)

- [ ] **Step 6: Smoke-test the SQL against grip.duckdb**

Set up the DuckDB smoke harness (Global Constraints). Get a real W4+ user_id and the real table names, build the timeline SQL for that user, `con.execute(sql)`, and confirm it returns rows with the 11 expected columns. Adjust quoting if a real table name differs from the dev sample.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/queries/assetSearch.js frontend/lib/queries/outreach.js frontend/lib/queries/__checks__/issuer_for_query.mjs
git commit -m "feat(asset-search): per-user search-timeline builder + issuerForQuery"
```

---

### Task 4: `UserSearchHistoryModal` component

**Files:** Create `frontend/components/dashboards/UserSearchHistoryModal.jsx`

**Interfaces:**
- Consumes: timeline rows (Task 3), `issuerForQuery` (Task 3).
- Produces: `export default function UserSearchHistoryModal({ userId, rows, loading, error, onClose })`.

- [ ] **Step 1: Create the component** (full code)

```jsx
"use client";
import * as React from "react";
import { issuerForQuery } from "@/lib/queries/assetSearch";

const isTrue = (v) => v === true || v === "True" || v === 1 || v === "1";

function Scorecard({ label, value, sub }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="ed-caption" style={{ opacity: 0.75 }}>{label}</div>
      <div className="ed-headline" style={{ fontSize: 26, lineHeight: 1.05 }}>{value ?? "—"}</div>
      {sub && <div className="ed-caption" style={{ opacity: 0.7 }}>{sub}</div>}
    </div>
  );
}

const mCell = { padding: "8px 10px", borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)", color: "var(--ed-ink-soft, #2c2926)", verticalAlign: "top" };

export default function UserSearchHistoryModal({ userId, rows, loading, error, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = Array.isArray(rows) ? rows : [];
  const summary = React.useMemo(() => {
    if (data.length === 0) return null;
    const keywords = new Set(data.map((r) => (r.query_text || "").trim()).filter(Boolean));
    const days = data.map((r) => r.day).filter(Boolean).sort();
    const gc = data.map((r) => (r.gc_name || "").trim()).find(Boolean);
    const kyc = data.map((r) => (r.kyc || "").trim()).find(Boolean);
    return {
      searches: data.length,
      distinct: keywords.size,
      zero: data.filter((r) => Number(r.results_count) === 0).length,
      withClicks: data.filter((r) => r.clicked_assets).length,
      first: days[0], last: days[days.length - 1],
      invested: data.some((r) => isTrue(r.invested)),
      source: gc ? `GC · ${gc}` : "Platform",
      kyc: kyc || "—",
    };
  }, [data]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Search history for user ${userId}`} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(27,24,24,0.55)", zIndex: 50,
               display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "4vh 12px" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--ed-paper, #f2ebdb)", border: "1px solid var(--ed-rule, #1b1818)",
                 width: "min(880px, 96vw)", padding: "20px 22px", fontFamily: "var(--ed-mono, ui-monospace)" }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <div className="ed-overline">USER HISTORY</div>
            <h3 className="ed-headline" style={{ fontSize: 28 }}>#{userId}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ed-caption"
            style={{ border: "1px solid var(--ed-rule, #1b1818)", background: "transparent", padding: "4px 10px", cursor: "pointer" }}>✕ CLOSE</button>
        </div>

        {loading && <p className="ed-prose-italic" style={{ marginTop: 16 }}>Loading history…</p>}
        {error && <p className="ed-prose-italic" style={{ marginTop: 16, color: "var(--ed-rust, #a6242b)" }}>Could not load history: {String(error)}</p>}

        {!loading && !error && summary && (
          <>
            <div className="grid gap-x-6 gap-y-4 mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              <Scorecard label="SEARCHES" value={summary.searches} sub={`${summary.distinct} distinct`} />
              <Scorecard label="ZERO-RESULT" value={summary.zero} sub="dead ends" />
              <Scorecard label="W/ CLICKS" value={summary.withClicks} sub="searches → click" />
              <Scorecard label="INVESTED" value={summary.invested ? "Yes" : "No"} />
              <Scorecard label="SOURCE" value={summary.source} sub={`KYC ${summary.kyc}`} />
              <Scorecard label="ACTIVE" value={summary.first === summary.last ? summary.first : `${summary.first} → ${summary.last}`} />
            </div>
            <div className="mt-6" style={{ overflowX: "auto", maxHeight: "46vh", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 600 }}>
                <thead><tr>
                  {["DATE", "KEYWORD", "ISSUER", "RESULTS", "CLICKED"].map((h) => (
                    <th key={h} scope="col" className="ed-caption"
                      style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.map((r, i) => {
                    const issuer = issuerForQuery(r.query_text);
                    const zero = Number(r.results_count) === 0;
                    return (
                      <tr key={i} style={{ background: i % 2 ? "var(--ed-paper-deep, #ece2cd)" : "transparent" }}>
                        <td style={mCell}>{r.day}</td>
                        <td style={{ ...mCell, fontStyle: "italic" }}>“{r.query_text}”{isTrue(r.is_refinement) ? " ↻" : ""}</td>
                        <td style={mCell}>{issuer || "—"}</td>
                        <td style={mCell}>{zero ? <span style={{ color: "var(--ed-rust, #a6242b)" }}>0 · dead end</span> : r.results_count}</td>
                        <td style={mCell}>{r.clicked_assets ? `${r.clicked_types ? r.clicked_types + " · " : ""}${r.clicked_assets}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!loading && !error && !summary && (
          <p className="ed-prose-italic" style={{ marginTop: 16 }}>No W4+ search history for this user.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build` → succeeds (compiles; not yet rendered).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/UserSearchHistoryModal.jsx
git commit -m "feat(asset-search): add UserSearchHistoryModal component"
```

---

### Task 5: Wire row-click → on-demand query → modal

**Files:**
- Modify: `frontend/components/dashboards/AssetSearchOutreachSection.jsx`
- Modify: `frontend/components/dashboards/AssetSearchDashboardEditorial.jsx` (the `<AssetSearchOutreachSection .../>` render ~line 737; `ctx`/`project.id` are in scope)

**Interfaces:**
- Consumes: `userSearchTimeline` (Task 3), `runQuery` from `@/lib/api`, `UserSearchHistoryModal` (Task 4).
- Section gains props `projectId` (string) and `tables` (grouped `ctx.tables`, with `.query` and `.result_clicked`).

- [ ] **Step 1: Read the render site** — confirm how `<AssetSearchOutreachSection liveRows=... sectionNumber=.../>` is invoked (~line 737) and that `project` + `ctx` are in scope.

- [ ] **Step 2: Pass the new props** (`loading={loading}` was already added in Task 2; add `projectId`/`tables`)
```jsx
<AssetSearchOutreachSection
  liveRows={/* existing */}
  sectionNumber={/* existing */}
  loading={loading}
  projectId={project.id}
  tables={ctx.tables}
/>
```

- [ ] **Step 3: Imports + state in the section**
```jsx
import { runQuery } from "@/lib/api";
import { userSearchTimeline } from "@/lib/queries/outreach";
import UserSearchHistoryModal from "./UserSearchHistoryModal";
```
```jsx
// Task 2 already added `loading`; this task adds `projectId, tables`:
export default function AssetSearchOutreachSection({ liveRows, sectionNumber = "VI", loading = false, projectId, tables }) {
  // ...existing...
  const [modal, setModal] = React.useState(null); // { userId, loading, rows, error } | null
  const openUserHistory = React.useCallback(async (userId) => {
    setModal({ userId, loading: true, rows: null, error: null });
    const sql = userSearchTimeline({ tables, userId });
    if (!sql || !projectId) { setModal({ userId, loading: false, rows: [], error: null }); return; }
    try {
      const res = await runQuery(projectId, sql, 2000);
      setModal({ userId, loading: false, rows: (res && res.rows) || [], error: res && res.error });
    } catch (e) {
      setModal({ userId, loading: false, rows: null, error: String((e && e.message) || e) });
    }
  }, [projectId, tables]);
```

- [ ] **Step 4: Make the user_id cell open the modal** — replace the user_id `<td>` body (lines 630–636):
```jsx
<td style={cellStyle}>
  <button type="button" onClick={() => openUserHistory(row.user_id)} title="View this user's search history"
    className="ed-caption"
    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--ed-ink, #1b1818)",
             fontWeight: 500, font: "inherit", textDecoration: "underline", textDecorationStyle: "dotted" }}>
    {row.user_id}
  </button>
</td>
```

- [ ] **Step 5: Render the modal** — before `</section>` (line 738):
```jsx
{modal && (
  <UserSearchHistoryModal userId={modal.userId} rows={modal.rows} loading={modal.loading} error={modal.error}
    onClose={() => setModal(null)} />
)}
```

- [ ] **Step 6: Build** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 7: Playwright verification** — write a short Playwright script (not MCP step-by-step): log in, go to `/projects/asset_search`, switch to Editorial, scroll to Outreach, click a `user_id`, assert the modal appears (scorecard + timeline, or the "no W4+ history" message), confirm Escape/✕ close it, and that layout holds at 375 px. Use `browser_network_requests` to confirm the `/query` call returned rows. Save the script under `scripts/`.

- [ ] **Step 8: Commit**
```bash
git add frontend/components/dashboards/AssetSearchOutreachSection.jsx frontend/components/dashboards/AssetSearchDashboardEditorial.jsx
git commit -m "feat(asset-search): open per-user history modal from outreach table"
```

---

### Task 6: Phase 1 — merge to main + deploy (HARD CHECKPOINT — pause for human)

**Files:** none (release task). **Stop and get the human's go-ahead before merging/deploying — this is the deploy gate.**

- [ ] **Step 1: Final build + checks** — `cd frontend && npm run build`; re-run `node frontend/lib/queries/__checks__/issuer_for_query.mjs`. Green.
- [ ] **Step 2: Push + PR** — `git push -u origin feat/asset-search-outreach-drilldown`; `gh pr create --repo gripinvest/gi-analytics --fill` (canonical repo is `gripinvest/gi-analytics`).
- [ ] **Step 3: Merge to main** (with human approval).
- [ ] **Step 4: Deploy + verify it actually deployed** — org move may have broken Vercel/Render auto-deploy; verify the live build stamp updates on `grip-analytics-psi.vercel.app`, trigger a manual Vercel deploy if not. Confirm the modal + real-data-only states work in prod.
- [ ] **Step 5: Only after prod-verified, proceed to Phase 2.**

---

# PHASE 2 — Raw CSV export (only after Phase 1 deployed)

### Task 7: `rawSearchExport` builder

**Files:**
- Modify: `frontend/lib/queries/outreach.js` (add `rawSearchExport`)

**Interfaces:**
- Produces: `rawSearchExport({ tables, grain })` → SQL or `null`. `grain` ∈ `"query"` (default) | `"user_keyword"`. Grain `"query"`: `user_id, day, search_keyword, results_count, clicked_results, invested, source`. Grain `"user_keyword"`: `user_id, search_keyword, times_searched, first_date, last_date, clicked_results, invested, source`.

- [ ] **Step 1: Implement** (mirrors the validated `asset_search_report_samples/generate_samples.py` logic; clicks joined on `user_id + query_text`; W4+; `EXC` test-user exclusion)
```js
export function rawSearchExport({ tables, grain = "query" } = {}) {
  const w4 = (list) => (list || []).filter((t) => (wkOf(t) || 0) >= GC_FROM_WEEK);
  const qTables = w4(tables && tables.query);
  if (qTables.length === 0) return null;
  const cTables = w4(tables && tables.result_clicked);
  const searches = qTables
    .map((t) => `SELECT user_id, timestamp, query_text, results_count, investment_status, gc_name FROM "${t}" WHERE ${EXC} AND user_id IS NOT NULL AND query_text IS NOT NULL`)
    .join("\nUNION ALL\n");
  const clicks = cTables.length
    ? cTables.map((t) => `SELECT user_id, query_text, clicked_asset_name FROM "${t}" WHERE ${EXC}`).join("\nUNION ALL\n")
    : `SELECT CAST(NULL AS BIGINT) AS user_id, CAST(NULL AS VARCHAR) AS query_text, CAST(NULL AS VARCHAR) AS clicked_asset_name WHERE FALSE`;
  const base = `WITH s AS (${searches}),
    c AS (SELECT query_text, STRING_AGG(DISTINCT clicked_asset_name, '; ') AS clicked_results FROM (${clicks}) GROUP BY query_text)`;
  if (grain === "user_keyword") {
    return `${base}
      SELECT s.user_id, s.query_text AS search_keyword, COUNT(*) AS times_searched,
             MIN(CAST(s.timestamp AS DATE)) AS first_date, MAX(CAST(s.timestamp AS DATE)) AS last_date,
             ANY_VALUE(c.clicked_results) AS clicked_results,
             MAX(CASE WHEN s.investment_status THEN 1 ELSE 0 END) AS invested,
             ANY_VALUE(s.gc_name) AS source
      FROM s LEFT JOIN c ON c.query_text = s.query_text
      GROUP BY s.user_id, s.query_text ORDER BY s.user_id, times_searched DESC`;
  }
  return `${base}
    SELECT s.user_id, CAST(s.timestamp AS DATE) AS day, s.query_text AS search_keyword,
           s.results_count, c.clicked_results, s.investment_status AS invested, s.gc_name AS source
    FROM s LEFT JOIN c ON c.query_text = s.query_text ORDER BY s.user_id, s.timestamp`;
}
```
(If the smoke test shows `investment_status` is VARCHAR `'True'`/`'False'`, change the `user_keyword` CASE to `s.investment_status = 'True'`.)

- [ ] **Step 2: Smoke-test both grains against grip.duckdb** — confirm each executes and grain "query" row count is in the ~30k range across W4–W10 (matches the validated sample's 33,225).

- [ ] **Step 3: Commit**
```bash
git add frontend/lib/queries/outreach.js
git commit -m "feat(asset-search): add raw search-behaviour export query builder"
```

---

### Task 8: Raw export download button

**Files:** Modify `frontend/components/dashboards/AssetSearchOutreachSection.jsx`

- [ ] **Step 1: Handler** (add `import { rawSearchExport } from "@/lib/queries/outreach";`)
```jsx
const [rawBusy, setRawBusy] = React.useState(false);
const handleRawExport = async () => {
  if (!projectId || rawBusy) return;
  setRawBusy(true);
  try {
    const sql = rawSearchExport({ tables, grain: "query" });
    const res = sql ? await runQuery(projectId, sql, 100000) : { rows: [] };
    const rows = (res && res.rows) || [];
    const escape = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cols = rows.length ? Object.keys(rows[0]) : ["user_id","day","search_keyword","results_count","clicked_results","invested","source"];
    const body = rows.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
    const blob = new Blob([[cols.join(","), body].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `asset-search-raw-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  } finally { setRawBusy(false); }
};
```

- [ ] **Step 2: Button** next to EXPORT CSV (line 552):
```jsx
<button type="button" onClick={handleRawExport} disabled={rawBusy} className="ed-caption"
  style={{ padding: "6px 12px", background: "transparent", color: "var(--ed-ink, #1b1818)",
           border: "1px solid var(--ed-rule, #1b1818)", cursor: rawBusy ? "wait" : "pointer", fontWeight: 600, letterSpacing: 0.6 }}>
  {rawBusy ? "BUILDING…" : "RAW SEARCH CSV"}
</button>
```

- [ ] **Step 3: Build + manual** — `npm run build`; click RAW SEARCH CSV, confirm a CSV with the 7 columns and ~30k rows downloads.

- [ ] **Step 4: Commit + PR + deploy** (same auto-deploy caveat as Task 6)
```bash
git add frontend/components/dashboards/AssetSearchOutreachSection.jsx
git commit -m "feat(asset-search): add raw search-behaviour CSV download to outreach"
git push
```

---

## Self-Review

**Spec coverage:** loading-clarity / three-state, no sample (Tasks 1–2: cutover strip + outreach both gain `loading` skeleton → live → pending) ✅; GC-vs-platform Source on base table + modal (Tasks 2, 4) ✅; per-user modal (Tasks 3–5) ✅; raw CSV (Tasks 7–8) ✅; user_id-only/no-PII (all builders select no PII) ✅; invested/Source W4+ (Tasks 3/7 filter W4+; Task 2 NULL-projects) ✅; keep full table (Task 5 adds, removes nothing) ✅; two-phase deploy gate (Task 6) ✅.

**Placeholder scan:** all code provided in full; the one runtime branch (`investment_status` VARCHAR vs BOOLEAN) is flagged with the exact alternative. No TODO/TBD.

**Type consistency:** `userSearchTimeline` rows `{ts, day, query_text, results_count, is_refinement, active_tab, clicked_assets, clicked_types, invested, gc_name, kyc}` ↔ modal `summary`/timeline. `decorateOutreachRow` → `source_label`/`is_gc` ↔ SOURCE cell. `GC_FROM_WEEK` defined once (Task 2) and reused (Tasks 3, 7). `rawSearchExport` grain values match builder ↔ caller.

## Open items routed to growth (do not block this plan)
- "result keywords" definition (shown/clicked/count).
- Confirm `investment_status` semantics (ever vs active).
- CSV grain A (shipped default) vs B (supported via `grain` param).
- Asset code → readable name catalog (enrichment; surfaces show `type · code` until then).
