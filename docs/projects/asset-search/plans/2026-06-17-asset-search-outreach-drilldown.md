# Asset Search — Outreach Drill-down + Raw Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user search-history modal (primary) and a raw CSV export (secondary) to the Asset Search **Editorial** dashboard's Outreach section, plus a GC-vs-platform "Source" identifier on the base table and modal.

**Architecture:** All data flows through the existing query path — a builder in `frontend/lib/queries/outreach.js` returns a read-only SQL string, executed on demand by `runQuery(projectId, sql, limit)` (`frontend/lib/api.ts`) → `POST /api/projects/{id}/query` → DuckDB. The modal fires a per-user query on row-click; no backend change. The modal is a small custom component (no modal primitive exists in the repo).

**Tech Stack:** Next.js (JS/JSX, "use client" components), DuckDB via FastAPI, plain CSS with `ed-*` Editorial design tokens. No JS test framework.

## Global Constraints

Copied verbatim from the spec / repo conventions — every task implicitly includes these:

- **Worktree:** all work in `.claude/worktrees/feat+asset-search-outreach-drilldown` (branch `feat/asset-search-outreach-drilldown`). Never edit the primary checkout.
- **Test users excluded everywhere:** `3, 4, 207871, 207875, 207878, 207879` (use the existing `EXC` / `TEST_USERS` from `lib/queries/assetSearch.js`).
- **`user_id` only — NO PII** (no email/name/phone) on any surface.
- **`invested`, `gc_name`, `gc_id`, `obpp_kyc_status` are W4+ traits** — absent in W1–W3. The per-user modal query targets **W4+ tables only**; the base-table rollup NULL-projects `gc_name` (VARCHAR) for pre-W4 weeks.
- **Mobile-first:** new UI cleared at 375 px first.
- **No JS test runner exists.** Verification per task = (a) a Node ESM assertion script on pure SQL-builder output, (b) `npm run build` (`next build`) for compile safety, (c) a documented manual / Playwright browser check for UI. Do NOT add Jest/Vitest (out of scope).
- **`next build` must pass before any task is "done."**
- **Delivery sequencing (hard):** finish + **deploy Phase 1 (modal) to `main`** before starting Phase 2 (CSV).
- Match existing code conventions in `AssetSearchOutreachSection.jsx` (the `cellStyle`, `ed-caption`, `HeaderCell`, `MiniExhibit` patterns).

---

# PHASE 1 — Drill-down modal (then commit + deploy to main)

### Task 1: Add GC-vs-platform "Source" to the outreach rollup + base table

**Files:**
- Modify: `frontend/lib/queries/outreach.js` (the `notifyMeOutreachDetail` builder ~lines 75–144; `decorateOutreachRow` ~line 158; the `_M` mock factory ~line 185 and `outreachMockSample`)
- Modify: `frontend/components/dashboards/AssetSearchOutreachSection.jsx` (table header ~line 586, body cells ~line 630, empty-row `colSpan` line 612, CSV export `handleExportCsv` lines 326–375)
- Test: `frontend/lib/queries/__checks__/outreach_source.mjs` (new Node assertion)

**Interfaces:**
- Produces: `notifyMeOutreachDetail({tables})` SQL now also selects `gc_name`; `decorateOutreachRow(row)` now returns `source_label` (string: `"Platform"` or `"GC · <partner>"`) and `is_gc` (bool).

- [ ] **Step 1: Write the failing check**

Create `frontend/lib/queries/__checks__/outreach_source.mjs`:

```js
// Run: node frontend/lib/queries/__checks__/outreach_source.mjs
import { notifyMeOutreachDetail } from "../outreach.js";
import { decorateOutreachRow } from "../outreach.js";

const sql = notifyMeOutreachDetail({
  query: ["W10_jun04-jun10_asset_search_query"],
  empty_state: ["W10_jun04-jun10_asset_search_empty_state"],
  notify_me_clicked: ["W10_jun04-jun10_asset_search_notify_me_clicked"],
});
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
assert(/gc_name/.test(sql), "SQL must select gc_name");

const platform = decorateOutreachRow({ mapped_issuer: "Navi", gc_name: null });
assert(platform.source_label === "Platform", `platform source_label was ${platform.source_label}`);
const gc = decorateOutreachRow({ mapped_issuer: "Navi", gc_name: "ET money" });
assert(gc.source_label === "GC · ET money", `gc source_label was ${gc.source_label}`);
assert(gc.is_gc === true && platform.is_gc === false, "is_gc flag wrong");
console.log("PASS: outreach_source");
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node frontend/lib/queries/__checks__/outreach_source.mjs`
Expected: `FAIL: SQL must select gc_name` (or a `source_label` failure). If it instead errors on import (the `@/` alias is not used in `outreach.js`/`assetSearch.js`/`engineComparison.js`, which use relative imports, so plain `node` resolves them), fix the import path before proceeding.

- [ ] **Step 3: NULL-project `gc_name` in the failure union**

In `outreach.js`, just after `colsWithEngineVersion` (~line 44), add a generalized late-column projection and use it in `notifyMeOutreachDetail`. `gc_name` first appears in **W4** (verified). Replace the two `colsWithEngineVersion("user_id, query_text, timestamp, active_tab")` calls in `queryFailures` and `emptyStates` with `colsWithEngineVersionAndGc(...)`:

```js
const GC_FROM_WEEK = 4; // gc_name/gc_id/obpp_kyc_status/investment_status first appear in W4

/** Like colsWithEngineVersion, but also NULL-projects gc_name (VARCHAR) for
 *  pre-W4 weeks so the all-week union binds. */
function colsWithEngineVersionAndGc(baseCols) {
  const withEv = colsWithEngineVersion(baseCols);
  return (t) => {
    const w = wkOf(t);
    const gc = w != null && w >= GC_FROM_WEEK
      ? "gc_name"
      : "CAST(NULL AS VARCHAR) AS gc_name";
    return `${withEv(t)}, ${gc}`;
  };
}
```

- [ ] **Step 4: Carry `gc_name` through the CTEs and final SELECT**

In `notifyMeOutreachDetail`, change the two `unionAll(..., colsWithEngineVersion("user_id, query_text, timestamp, active_tab"), ...)` to use `colsWithEngineVersionAndGc("user_id, query_text, timestamp, active_tab")`. Then in `classified` add `gc_name`, in `rolled` add `MAX(gc_name) AS gc_name`, and in the final `SELECT` add `r.gc_name`:

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
And add `r.gc_name,` to the final `SELECT` list (before `CASE WHEN n.user_id ...`).

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

- [ ] **Step 6: Give the mock rows a source so the column renders pre-live**

In the `_M` factory add `gc_name: opts.gc || null,` to the returned object, then set `{ gc: "ET money" }` on 2–3 `_MOCK_RAW` entries (e.g. items 6 and 14) so mock data exercises both states.

- [ ] **Step 7: Run the check, verify it passes**

Run: `node frontend/lib/queries/__checks__/outreach_source.mjs`
Expected: `PASS: outreach_source`

- [ ] **Step 8: Add the SOURCE column to the table**

In `AssetSearchOutreachSection.jsx`: add a header cell after ISSUER (line 588):
```jsx
<HeaderCell field="source_label" label="SOURCE" sort={sort} setSort={setSort} />
```
Add a body cell after the issuer `<td>` (after line 655):
```jsx
<td style={cellStyle}>
  <span className="ed-caption" style={{ letterSpacing: 0.4, opacity: r_is_gc(row) ? 1 : 0.7 }}>
    {row.source_label || "Platform"}
  </span>
</td>
```
(Inline the check: replace `r_is_gc(row)` with `row.is_gc`.) Bump the empty-state `colSpan` from `9` to `10` (line 612). Add `"Source"` to the CSV `headers` array and `r.source_label` to the CSV `rows` mapping in `handleExportCsv`.

- [ ] **Step 9: Build**

Run: `npm run build` (from `frontend/`)
Expected: build succeeds, no type/lint errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/lib/queries/outreach.js frontend/lib/queries/__checks__/outreach_source.mjs frontend/components/dashboards/AssetSearchOutreachSection.jsx
git commit -m "feat(asset-search): add GC-vs-platform Source to outreach table"
```

---

### Task 2: `userSearchTimeline` builder (per-user history SQL)

**Files:**
- Modify: `frontend/lib/queries/outreach.js` (add export `userSearchTimeline`)
- Modify: `frontend/lib/queries/assetSearch.js` (add export `issuerForQuery` — pure JS keyword→issuer matcher mirroring `issuerCaseExpr`)
- Test: `frontend/lib/queries/__checks__/user_timeline.mjs` (new)

**Interfaces:**
- Produces: `userSearchTimeline({ tables, userId })` → SQL string, or `null` if `userId` is not an integer or no W4+ query tables exist. Result rows: `{ ts, day, query_text, results_count, is_refinement, active_tab, clicked_assets, clicked_types, invested, gc_name, kyc }`.
- Produces: `issuerForQuery(text)` → issuer name string or `null`.

- [ ] **Step 1: Write the failing check**

Create `frontend/lib/queries/__checks__/user_timeline.mjs`:
```js
// Run: node frontend/lib/queries/__checks__/user_timeline.mjs
import { userSearchTimeline } from "../outreach.js";
import { issuerForQuery } from "../assetSearch.js";

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

const tables = {
  query: ["W4_apr23-apr29_asset_search_query", "W10_jun04-jun10_asset_search_query"],
  result_clicked: ["W10_jun04-jun10_asset_search_result_clicked"],
};
const sql = userSearchTimeline({ tables, userId: 88231 });
assert(sql && /WHERE/.test(sql), "should build SQL for a valid integer userId");
assert(/user_id\s*=\s*88231/.test(sql), "must filter to the exact user_id");
assert(/investment_status/.test(sql), "must select invested (investment_status)");
assert(/clicked_asset_name/.test(sql), "must aggregate clicked assets");
assert(!/W1_/.test(sql) && !/W2_/.test(sql) && !/W3_/.test(sql), "must use W4+ tables only");

// Injection guard: non-integer userId returns null
assert(userSearchTimeline({ tables, userId: "1 OR 1=1" }) === null, "non-integer userId must return null");

assert(issuerForQuery("muthoot finance") === "Muthoot Finance", "issuerForQuery should map muthoot");
assert(issuerForQuery("zzz unknown") === null, "issuerForQuery should return null for unmapped");
console.log("PASS: user_timeline");
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node frontend/lib/queries/__checks__/user_timeline.mjs`
Expected: FAIL (functions not exported yet).

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

- [ ] **Step 4: Add `userSearchTimeline` to `outreach.js`**

W4+ only, so no NULL-projection needed. Filter the table lists to weeks ≥ 4 with the existing `wkOf`.
```js
/**
 * Per-user search timeline for the Outreach drill-down modal. One row per
 * search event (W4+ only — that's where investment_status/gc_name exist),
 * with the assets the user clicked for that query LEFT-JOINed in.
 * Returns null for a non-integer userId (injection guard) or no W4+ tables.
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
    ? cTables
        .map((t) => `SELECT user_id, query_text, clicked_asset_name, clicked_asset_type FROM "${t}" WHERE user_id = ${uid}`)
        .join("\nUNION ALL\n")
    : `SELECT CAST(NULL AS BIGINT) AS user_id, CAST(NULL AS VARCHAR) AS query_text, CAST(NULL AS VARCHAR) AS clicked_asset_name, CAST(NULL AS VARCHAR) AS clicked_asset_type WHERE FALSE`;

  return `
    WITH s AS (${searches}),
    c AS (
      SELECT query_text,
             STRING_AGG(DISTINCT clicked_asset_name, ', ') AS clicked_assets,
             STRING_AGG(DISTINCT clicked_asset_type, ', ') AS clicked_types
      FROM (${clicks})
      GROUP BY query_text
    )
    SELECT s.timestamp                          AS ts,
           CAST(s.timestamp AS DATE)            AS day,
           s.query_text,
           s.results_count,
           s.is_refinement,
           s.active_tab,
           c.clicked_assets,
           c.clicked_types,
           s.investment_status                  AS invested,
           s.gc_name,
           s.obpp_kyc_status                    AS kyc
    FROM s LEFT JOIN c ON c.query_text = s.query_text
    ORDER BY s.timestamp DESC
  `;
}
```

- [ ] **Step 5: Run the check, verify it passes**

Run: `node frontend/lib/queries/__checks__/user_timeline.mjs`
Expected: `PASS: user_timeline`

- [ ] **Step 6: Smoke-test the SQL against real data (optional but recommended)**

If the backend is runnable in this worktree (symlink `backend/.venv` to the primary checkout's venv per the known-gotcha note, then `uvicorn`), POST the generated SQL for a real `user_id` from `backend/data/asset_search/W10_*_query.csv` to `/api/projects/asset_search/query` and confirm rows return. Otherwise rely on Step 5 + the manual check in Task 4.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/queries/outreach.js frontend/lib/queries/assetSearch.js frontend/lib/queries/__checks__/user_timeline.mjs
git commit -m "feat(asset-search): add per-user search-timeline query builder"
```

---

### Task 3: `UserSearchHistoryModal` component

**Files:**
- Create: `frontend/components/dashboards/UserSearchHistoryModal.jsx`

**Interfaces:**
- Consumes: timeline rows from `userSearchTimeline` (Task 2) and `issuerForQuery` (Task 2).
- Produces: `export default function UserSearchHistoryModal({ userId, rows, loading, error, onClose })`. Computes the scorecard from `rows`; renders overlay + panel.

- [ ] **Step 1: Create the component**

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

export default function UserSearchHistoryModal({ userId, rows, loading, error, onClose }) {
  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = Array.isArray(rows) ? rows : [];
  const summary = React.useMemo(() => {
    if (data.length === 0) return null;
    const keywords = new Set(data.map((r) => (r.query_text || "").trim()).filter(Boolean));
    const zero = data.filter((r) => Number(r.results_count) === 0).length;
    const withClicks = data.filter((r) => r.clicked_assets).length;
    const days = data.map((r) => r.day).filter(Boolean).sort();
    const invested = data.some((r) => isTrue(r.invested));
    const gc = data.map((r) => (r.gc_name || "").trim()).find(Boolean);
    const kyc = data.map((r) => (r.kyc || "").trim()).find(Boolean);
    return {
      searches: data.length,
      distinct: keywords.size,
      zero,
      withClicks,
      first: days[0],
      last: days[days.length - 1],
      invested,
      source: gc ? `GC · ${gc}` : "Platform",
      kyc: kyc || "—",
    };
  }, [data]);

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Search history for user ${userId}`}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(27,24,24,0.55)", zIndex: 50,
               display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "4vh 12px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--ed-paper, #f2ebdb)", border: "1px solid var(--ed-rule, #1b1818)",
                 width: "min(880px, 96vw)", maxWidth: "96vw", padding: "20px 22px",
                 fontFamily: "var(--ed-mono, ui-monospace)" }}
      >
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <div className="ed-overline">USER HISTORY</div>
            <h3 className="ed-headline" style={{ fontSize: 28 }}>#{userId}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ed-caption" style={{ border: "1px solid var(--ed-rule, #1b1818)", background: "transparent",
              padding: "4px 10px", cursor: "pointer" }}>✕ CLOSE</button>
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

const mCell = { padding: "8px 10px", borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)", color: "var(--ed-ink-soft, #2c2926)", verticalAlign: "top" };
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds (component compiles; not yet rendered anywhere).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/UserSearchHistoryModal.jsx
git commit -m "feat(asset-search): add UserSearchHistoryModal component"
```

---

### Task 4: Wire row-click → on-demand query → modal

**Files:**
- Modify: `frontend/components/dashboards/AssetSearchOutreachSection.jsx`
- Modify: `frontend/components/dashboards/AssetSearchDashboardEditorial.jsx` (the `<AssetSearchOutreachSection ... />` render site, ~line 737, and confirm `ctx`/`project.id` are in scope there)

**Interfaces:**
- Consumes: `userSearchTimeline` (Task 2), `runQuery` from `@/lib/api`, `UserSearchHistoryModal` (Task 3).
- The section gains props: `projectId` (string) and `tables` (the grouped `ctx.tables` object with `.query` and `.result_clicked` arrays).

- [ ] **Step 1: Read the render site**

Read `AssetSearchDashboardEditorial.jsx` around line 737 to see how `<AssetSearchOutreachSection liveRows=... sectionNumber=... />` is invoked, and confirm `project` and the `ctx` (with `.tables`) are in lexical scope there (they are — `ctx` is built at line 121, `project.id` is the project id).

- [ ] **Step 2: Pass the new props from the Editorial dashboard**

```jsx
<AssetSearchOutreachSection
  liveRows={/* existing */}
  sectionNumber={/* existing */}
  projectId={project.id}
  tables={ctx.tables}
/>
```

- [ ] **Step 3: Add imports + modal state to the section**

Top of `AssetSearchOutreachSection.jsx`:
```jsx
import { runQuery } from "@/lib/api";
import { userSearchTimeline } from "@/lib/queries/outreach";
import UserSearchHistoryModal from "./UserSearchHistoryModal";
```
Update the signature and add state inside the component:
```jsx
export default function AssetSearchOutreachSection({
  liveRows, sectionNumber = "VI", projectId, tables,
}) {
  // ...existing state...
  const [modal, setModal] = React.useState(null); // { userId, loading, rows, error } | null

  const openUserHistory = React.useCallback(async (userId) => {
    setModal({ userId, loading: true, rows: null, error: null });
    const sql = userSearchTimeline({ tables, userId });
    if (!sql || !projectId) {
      setModal({ userId, loading: false, rows: [], error: null });
      return;
    }
    try {
      const res = await runQuery(projectId, sql, 2000);
      setModal({ userId, loading: false, rows: (res && res.rows) || [], error: res && res.error });
    } catch (e) {
      setModal({ userId, loading: false, rows: null, error: String((e && e.message) || e) });
    }
  }, [projectId, tables]);
```

- [ ] **Step 4: Make the user_id cell open the modal**

Replace the `user_id` `<td>` body (lines 630–636) so the id is a button:
```jsx
<td style={cellStyle}>
  <button type="button" onClick={() => openUserHistory(row.user_id)}
    title="View this user's search history"
    className="ed-caption"
    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer",
             color: "var(--ed-ink, #1b1818)", fontWeight: 500, font: "inherit",
             textDecoration: "underline", textDecorationStyle: "dotted" }}>
    {row.user_id}
  </button>
</td>
```

- [ ] **Step 5: Render the modal**

Just before the closing `</section>` (line 738), add:
```jsx
{modal && (
  <UserSearchHistoryModal
    userId={modal.userId}
    rows={modal.rows}
    loading={modal.loading}
    error={modal.error}
    onClose={() => setModal(null)}
  />
)}
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Manual / Playwright verification**

Start the app (frontend dev server + backend, or against the deployed-style build). Per the tool-routing convention, write a short Playwright script (not MCP step-by-step) that: logs in, navigates to `/projects/asset_search`, switches to the Editorial dashboard, scrolls to the Outreach section, clicks a `user_id`, and asserts the modal appears with a non-empty timeline (or the "no W4+ history" message). Capture one screenshot at 375 px width (mobile-first gate) and one at desktop. Save the script under `frontend/` test-scripts or `scripts/` per repo convention.
Expected: modal opens, scorecard + timeline render, Escape and ✕ close it, layout holds at 375 px.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/dashboards/AssetSearchOutreachSection.jsx frontend/components/dashboards/AssetSearchDashboardEditorial.jsx
git commit -m "feat(asset-search): open per-user history modal from outreach table"
```

---

### Task 5: Phase 1 — merge to main + deploy (hard checkpoint)

**Files:** none (release task)

- [ ] **Step 1: Final build + self-check**

Run: `npm run build`. Re-run both Node checks (`node frontend/lib/queries/__checks__/*.mjs`). Confirm green.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin feat/asset-search-outreach-drilldown
gh pr create --repo gripinvest/gi-analytics --fill --title "feat(asset-search): outreach per-user history modal + GC source"
```
(Note: canonical repo is `gripinvest/gi-analytics`; pass `--repo` explicitly.)

- [ ] **Step 3: Merge to main**

Per the user's instruction, land Phase 1 on `main` (squash-merge the PR, or fast-forward per repo norms).

- [ ] **Step 4: Deploy + verify it actually deployed**

Trigger the deploy. **The org move may have broken Vercel/Render auto-deploy** — do not assume the push deployed. Verify the live build stamp updates on the prod URL (`grip-analytics-psi.vercel.app`); if not, trigger a manual Vercel deploy. Confirm the modal works in prod.

- [ ] **Step 5: Checkpoint**

Only after the modal is live on `main` and verified, proceed to Phase 2.

---

# PHASE 2 — Raw CSV export (only after Phase 1 deployed)

### Task 6: `rawSearchExport` builder

**Files:**
- Modify: `frontend/lib/queries/outreach.js` (add export `rawSearchExport`)
- Test: `frontend/lib/queries/__checks__/raw_export.mjs` (new)

**Interfaces:**
- Produces: `rawSearchExport({ tables, grain })` → SQL string, or `null` if no W4+ query tables. `grain` ∈ `"query"` (default, one row per search) | `"user_keyword"`. Grain `"query"` columns: `user_id, day, search_keyword, results_count, clicked_results, invested, source`. Grain `"user_keyword"`: `user_id, search_keyword, times_searched, first_date, last_date, clicked_results, invested, source`.

- [ ] **Step 1: Write the failing check**

Create `frontend/lib/queries/__checks__/raw_export.mjs`:
```js
// Run: node frontend/lib/queries/__checks__/raw_export.mjs
import { rawSearchExport } from "../outreach.js";
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
const tables = {
  query: ["W4_apr23-apr29_asset_search_query", "W10_jun04-jun10_asset_search_query"],
  result_clicked: ["W10_jun04-jun10_asset_search_result_clicked"],
};
const a = rawSearchExport({ tables, grain: "query" });
assert(/search_keyword/.test(a) && /investment_status|invested/.test(a), "grain query must have keyword + invested");
assert(!/W1_/.test(a) && !/W3_/.test(a), "W4+ only");
assert(/NOT IN \(3, 4, 207871/.test(a), "must exclude test users");
const b = rawSearchExport({ tables, grain: "user_keyword" });
assert(/times_searched/.test(b), "grain user_keyword must aggregate times_searched");
console.log("PASS: raw_export");
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node frontend/lib/queries/__checks__/raw_export.mjs` → FAIL (not exported).

- [ ] **Step 3: Implement `rawSearchExport`**

Reuse `EXC` (test-user exclusion), `wkOf`, `GC_FROM_WEEK`. Mirror the validated `generate_samples.py` logic (clicks joined on `user_id + query_text`).
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

  const base = `
    WITH s AS (${searches}),
    c AS (SELECT query_text, STRING_AGG(DISTINCT clicked_asset_name, '; ') AS clicked_results
          FROM (${clicks}) GROUP BY query_text)`;

  if (grain === "user_keyword") {
    return `${base}
      SELECT s.user_id,
             s.query_text                              AS search_keyword,
             COUNT(*)                                  AS times_searched,
             MIN(CAST(s.timestamp AS DATE))            AS first_date,
             MAX(CAST(s.timestamp AS DATE))            AS last_date,
             ANY_VALUE(c.clicked_results)              AS clicked_results,
             MAX(CASE WHEN s.investment_status THEN 1 ELSE 0 END) AS invested,
             ANY_VALUE(s.gc_name)                      AS source
      FROM s LEFT JOIN c ON c.query_text = s.query_text
      GROUP BY s.user_id, s.query_text
      ORDER BY s.user_id, times_searched DESC`;
  }
  return `${base}
    SELECT s.user_id,
           CAST(s.timestamp AS DATE) AS day,
           s.query_text              AS search_keyword,
           s.results_count,
           c.clicked_results,
           s.investment_status       AS invested,
           s.gc_name                 AS source
    FROM s LEFT JOIN c ON c.query_text = s.query_text
    ORDER BY s.user_id, s.timestamp`;
}
```
(Note: if `investment_status` is stored as VARCHAR `'True'`/`'False'` rather than BOOLEAN, change the `user_keyword` CASE to `MAX(CASE WHEN s.investment_status = 'True' THEN 1 ELSE 0 END)`. Verify the column type during the smoke test and adjust.)

- [ ] **Step 4: Run the check, verify it passes**

Run: `node frontend/lib/queries/__checks__/raw_export.mjs` → `PASS: raw_export`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/queries/outreach.js frontend/lib/queries/__checks__/raw_export.mjs
git commit -m "feat(asset-search): add raw search-behaviour export query builder"
```

---

### Task 7: Raw export download button

**Files:**
- Modify: `frontend/components/dashboards/AssetSearchOutreachSection.jsx`

**Interfaces:**
- Consumes: `rawSearchExport` (Task 6), `runQuery`, the existing CSV-escape helper pattern in `handleExportCsv`.

- [ ] **Step 1: Add a download handler**

Add near `handleExportCsv`:
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
Add `import { rawSearchExport } from "@/lib/queries/outreach";` to the imports.

- [ ] **Step 2: Add the button**

Next to the existing EXPORT CSV button (line 552), add:
```jsx
<button type="button" onClick={handleRawExport} disabled={rawBusy}
  className="ed-caption"
  style={{ padding: "6px 12px", background: "transparent", color: "var(--ed-ink, #1b1818)",
           border: "1px solid var(--ed-rule, #1b1818)", cursor: rawBusy ? "wait" : "pointer", fontWeight: 600, letterSpacing: 0.6 }}>
  {rawBusy ? "BUILDING…" : "RAW SEARCH CSV"}
</button>
```

- [ ] **Step 3: Build + manual verify**

Run: `npm run build`. Then in the browser, click RAW SEARCH CSV, confirm a CSV downloads with the 7 columns and plausible row count (cross-check magnitude against the validated sample: ~33k rows for grain A across W4–W10).

- [ ] **Step 4: Commit + PR + deploy**

```bash
git add frontend/components/dashboards/AssetSearchOutreachSection.jsx
git commit -m "feat(asset-search): add raw search-behaviour CSV download to outreach"
git push
```
Open/extend the PR to `gripinvest/gi-analytics`, merge to main, verify deploy (same auto-deploy caveat as Task 5).

---

## Self-Review

**Spec coverage:** modal (Tasks 2–4), CSV export (Tasks 6–7), GC/platform source on base table + modal (Tasks 1, 3), user_id-only/no-PII (all builders select no PII), invested W4+ (Tasks 2/6 filter W4+), keep full table (Task 4 adds, removes nothing), two-phase deploy sequencing (Task 5 checkpoint). ✅ All spec sections map to a task.

**Placeholder scan:** SQL, Node checks, and component code are provided in full. The one conditional (`investment_status` VARCHAR vs BOOLEAN) is flagged with the exact alternative to use. No TODO/TBD left.

**Type consistency:** `userSearchTimeline` returns rows with `{ts, day, query_text, results_count, is_refinement, active_tab, clicked_assets, clicked_types, invested, gc_name, kyc}` — consumed exactly by the modal's `summary`/timeline. `decorateOutreachRow` adds `source_label`/`is_gc` — consumed by the SOURCE cell. `rawSearchExport` grain values `"query"`/`"user_keyword"` match between builder and check.

## Open items routed to growth (do not block this plan)
- "result keywords" definition (shown/clicked/count) — would add/alter a column later.
- Confirm `investment_status` semantics (ever vs active).
- Pick CSV grain A (shipped default) vs B (already supported via `grain` param).
- Asset code → readable name catalog (enrichment; both surfaces show `type · code` until then).
