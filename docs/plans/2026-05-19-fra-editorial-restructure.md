# FRA Editorial Dashboard — Tab Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the editorial FRA YouTube dashboard from a single 1449-line scroll into a thin shell that renders six fixed-order tabs — **Overview · Reach & Growth · Content & Format · Audience · Cadence & SEO · AI Insights** — with a persistent masthead above a "Weekly"-idiom tab strip. Surface the expanded metric coverage (duration buckets, tag/SEO analysis, upload cadence, percentile ladder, per-video leaderboards, like/comment split, monthly detail) that Task 1's already-merged backend tables now make available.

**Architecture:** `fraYoutube.js` gains six new SQL query specs that read the new/extended backend tables (`fra_youtube__duration_buckets`, `fra_youtube__tag_analysis`, `fra_youtube__upload_cadence`, the extended `distribution`, `fra_youtube__video_snapshots`, `fra_youtube__engagement_breakdown`). The mega-file `FraYoutubeDashboardEditorial.jsx` becomes a thin shell — masthead + tab strip + active-tab render. Theme-agnostic formatters move to `fra/helpers.js`; the editorial *rendering* primitives (ED_* constants, chart props, `Figure`, `Exhibit`, `LedgerTable`, animation hooks, etc.) move to `fra/editorial/primitives.jsx`; the six tabs become `fra/editorial/*Tab.jsx`. Each tab is a pure presentational component fed the rows it needs as props by the shell, which owns the two data hooks (`useFraYoutube`, `useFraInsights`).

**Tech Stack:** Next.js (App Router), React 18, Recharts, Tailwind. Build tool `pnpm`. No JSX unit tests (repo convention, spec §7) — verification is `pnpm build` plus manual visual checks at 375px and desktop.

**Scope:** The **editorial** dashboard only (spec §4). The classic restructure is a separate later plan; the new `fraYoutube.js` query specs added here are shared and the classic plan will consume them unchanged. The backend tables and the five new `distribution` columns already exist and are merged (Task 1 / `2026-05-19-fra-backend-metrics.md`) — this plan only adds the frontend query specs that read them and the UI that surfaces them.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/lib/queries/fraYoutube.js` | shared data layer — SQL specs + `useFraYoutube` hook | **Modify** — add 6 new query specs (`durationBuckets`, `tagAnalysis`, `uploadCadence`, `topVideosByViews`, `topVideosByEngagement`, `engagementOverall`) |
| `frontend/components/dashboards/fra/helpers.js` | theme-agnostic utilities ONLY — the 5 number/date formatters (`fmt`, `pct1`, `compact`, `fmtDate`, `fmtMonth`) and `nf`. Renders nothing. | **Create** |
| `frontend/components/dashboards/fra/editorial/primitives.jsx` | shared editorial **rendering** primitives — ED_* palette constants, `CHART_ANIM_MS`, `edAxisProps`, `edGridProps`, `edDeltaFmt`, hooks (`usePrefersReducedMotion`, `useCountUp`), `RevealSection`, `EdTooltip`, `SectionHead`, `Figure`, `DeltaTick`, `DeltaTickLine`, `DualDeltaTick`, `Exhibit`, `LedgerTable`, `EmptyPlate`, `ErrorNote`, `useFraInsights`, `insightItemText`, `InsightColumn`, `AiInsights` | **Create** |
| `frontend/components/dashboards/fra/editorial/OverviewTab.jsx` | Tab 1 — the whole current single-scroll report (every section at current depth), AI section condensed to verdict + top-3 actions; each section links to its deep-dive tab | **Create** |
| `frontend/components/dashboards/fra/editorial/ReachGrowthTab.jsx` | Tab 2 — Discovery + Growth + Catalog health in full, plus percentile ladder + monthly detail with MoM % | **Create** |
| `frontend/components/dashboards/fra/editorial/ContentFormatTab.jsx` | Tab 3 — Content fit in full, plus duration-bucket performance + per-video leaderboards | **Create** |
| `frontend/components/dashboards/fra/editorial/AudienceTab.jsx` | Tab 4 — Engagement in full, plus like-rate vs comment-rate split + engagement by duration | **Create** |
| `frontend/components/dashboards/fra/editorial/CadenceSeoTab.jsx` | Tab 5 — Cadence + Titles & SEO in full, plus upload cadence & gap stats + tag-frequency/SEO analysis | **Create** |
| `frontend/components/dashboards/fra/editorial/InsightsTab.jsx` | Tab 6 — full AI verdict + strengths / weaknesses / recommendations | **Create** |
| `frontend/components/dashboards/FraYoutubeDashboardEditorial.jsx` | thin shell — masthead + persistent tab strip + active-tab render; owns `useFraYoutube` + `useFraInsights`, derives chart-ready series, passes props down | **Rewrite** (1449 → ~350 lines) |

### File-structure decision (justifies the spec §4.2 deviation)

Spec §4.2's tree is illustrative — it shows `fra/helpers.js` and `fra/editorial/*Tab.jsx` but does not name a home for the editorial *rendering* primitives. Those primitives (`Figure`, `Exhibit`, `LedgerTable`, `SectionHead`, `EdTooltip`, the ED_* palette, the animation hooks) are used by **every** editorial tab and are unambiguously rendering code, so they cannot live in `helpers.js` — the spec explicitly says `helpers.js` is "per-theme-agnostic utility only … not rendering". Two-file split:

- **`fra/helpers.js`** — the five number/date formatters and the `Intl.NumberFormat` instance. No React, no JSX, no `var(--ed-*)` references. Importable by classic tabs later without pulling in editorial styling.
- **`fra/editorial/primitives.jsx`** — every editorial-themed rendering primitive and hook. New file, explicitly editorial-namespaced (`fra/editorial/`), so the no-cross-theme-sharing rule (spec §4.2) holds: classic will get its own `fra/classic/primitives.jsx` in the later plan.

`AiInsights` / `InsightColumn` / `insightItemText` are editorial-styled rendering, so they live in `primitives.jsx`; `useFraInsights` is editorial-agnostic logically but only the editorial dashboard consumes it today — it ships in `primitives.jsx` for now and the classic plan can promote it to `helpers.js` if it needs it. This is the only judgment call; it keeps the editorial restructure self-contained.

### Tab data-prop contract

The shell owns both hooks and all derived series, and passes each tab exactly what it renders. Props per tab (all rows are arrays; scalars are `null` when absent):

- **Common to every data tab:** `reduced` (bool), `loading` (bool), `animProps` (object), `data` (the raw `useFraYoutube` data object — for `errOf` lookups).
- **OverviewTab:** `overview`, `trend`, `catalogRow`, `distRow`, `breakoutRate`, `ladder`, `distBuckets`, `growthSeries`, `growthSeriesWithReal`, `hasRealTrend`, `categoryScatter`, `categoryRows`, `engagementSeries`, `engMean`, `cadenceDaySeries`, `cadenceHourSeries`, `titleSeries`, `insightsState`, `onNavigate` (fn — switches the active tab).
- **ReachGrowthTab:** `loading`, `reduced`, `animProps`, `data`, `distRow`, `breakoutRate`, `ladder`, `distBuckets`, `growthSeries`, `growthSeriesWithReal`, `hasRealTrend`, `catalogRow`, `monthlyRows`.
- **ContentFormatTab:** `loading`, `reduced`, `animProps`, `data`, `categoryScatter`, `categoryRows`, `durationBucketRows`, `topVideosByViewsRows`, `topVideosByEngagementRows`.
- **AudienceTab:** `loading`, `reduced`, `animProps`, `data`, `engagementSeries`, `engMean`, `engagementOverallRow`, `durationBucketRows`.
- **CadenceSeoTab:** `loading`, `reduced`, `animProps`, `data`, `cadenceDaySeries`, `cadenceHourSeries`, `titleSeries`, `uploadCadenceRow`, `tagAnalysisRows`.
- **InsightsTab:** `insightsState`.

---

## Task ordering rationale

Tasks are sequenced so the build stays green at every commit:

1. **Task 1** adds the `fraYoutube.js` query specs first — pure data-layer change, no UI consumer yet, build stays green.
2. **Task 2** creates `helpers.js` and **Task 3** creates `primitives.jsx` — both pure module extractions with no behavior change; nothing imports them yet so the build stays green. They must exist before any tab file imports them.
3. **Tasks 4–9** create the six tab files. The shell does not import them until **Task 10**, so each tab file lands as an unreferenced module — the build compiles it but renders nothing, staying green.
4. **Task 10** rewrites `FraYoutubeDashboardEditorial.jsx` into the shell that wires everything together. This is the only task that changes what users see; it lands last so the dashboard never renders a half-built tab set.

Tab files are built **OverviewTab first** (Task 4) because Overview *is* the entire current report — relocating existing sections is the lowest-risk move and front-loads the bulk of the relocation work. The four deep-dive tabs (Tasks 5–8) then reuse those same sections and add net-new UI. InsightsTab (Task 9) is the smallest. Within a tab task, relocated sections are moved verbatim (precise line ranges given) and net-new sections carry full code.

---

## Task 1: Add the six new `fraYoutube.js` query specs

**Files:**
- Modify: `frontend/lib/queries/fraYoutube.js:21-97` (the `SQL` object)

- [ ] **Step 1: Add the new specs to the `SQL` object**

In `frontend/lib/queries/fraYoutube.js`, inside the `export const SQL = { … }` object, add these six keys immediately after the `videoViews` spec (before the closing `};` on line 97). `distribution` is unchanged — it is already `SELECT *` and picks up the five new percentile columns automatically.

```javascript
  /* Layer-2 duration-bucket performance — one row per bucket (Task 1 backend).
     Powers Content & Format's duration analysis and Audience's engagement-by-
     duration read. Buckets are emitted even when empty, so the chart axis is
     stable; ORDER BY snapshot_date keeps the latest snapshot's seven rows. */
  durationBuckets: `
    SELECT * FROM fra_youtube__duration_buckets
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__duration_buckets)
  `,
  /* Layer-2 tag/SEO analysis — top 30 tags by frequency, each keyword-classified.
     Powers Cadence & SEO's tag analysis. */
  tagAnalysis: `
    SELECT * FROM fra_youtube__tag_analysis
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__tag_analysis)
    ORDER BY frequency DESC
  `,
  /* Layer-2 upload cadence — a single channel-level row of pacing stats.
     Powers Cadence & SEO's pacing read. */
  uploadCadence: `
    SELECT * FROM fra_youtube__upload_cadence
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__upload_cadence)
  `,
  /* Per-video leaderboard — top 10 by lifetime views. Reads video_snapshots
     directly (no new table); pinned to the latest snapshot like every other
     query. Powers Content & Format's leaderboards. */
  topVideosByViews: `
    SELECT title, published_at, views, likes, comments, category
    FROM fra_youtube__video_snapshots
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__video_snapshots)
    ORDER BY views DESC
    LIMIT 10
  `,
  /* Per-video leaderboard — top 10 by engagement rate ((likes+comments)/views).
     NULLIF guards against divide-by-zero on a 0-view video. */
  topVideosByEngagement: `
    SELECT title, published_at, views, likes, comments, category
    FROM fra_youtube__video_snapshots
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__video_snapshots)
    ORDER BY (likes + comments) / NULLIF(views, 0) DESC
    LIMIT 10
  `,
  /* Channel-level engagement — the `overall` dimension row of the engagement
     breakdown, carrying like_rate_pct / comment_rate_pct. Powers Audience's
     like-rate vs comment-rate split. */
  engagementOverall: `
    SELECT * FROM fra_youtube__engagement_breakdown
    WHERE dimension = 'overall'
      AND snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__engagement_breakdown)
  `,
```

No change to `useFraYoutube` — it iterates `Object.entries(SQL)`, so the six new specs are picked up automatically and resolve to `data.durationBuckets`, `data.tagAnalysis`, etc.

- [ ] **Step 2: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. (No UI consumes the new keys yet; this confirms the file still parses.)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/queries/fraYoutube.js
git commit -m "feat: add FRA query specs for duration, tags, cadence, leaderboards"
```

---

## Task 2: Create `fra/helpers.js` — theme-agnostic formatters

**Files:**
- Create: `frontend/components/dashboards/fra/helpers.js`

- [ ] **Step 1: Create the helpers module**

Create `frontend/components/dashboards/fra/helpers.js` with the five formatters lifted verbatim from `FraYoutubeDashboardEditorial.jsx:62-87`. No React import — this file renders nothing.

```javascript
/**
 * Theme-agnostic formatting utilities for the FRA YouTube dashboards.
 *
 * Number/date formatters only — no React, no JSX, no editorial styling. Both
 * the editorial and (later) classic renderings import these. Editorial
 * rendering primitives live in `fra/editorial/primitives.jsx`.
 */

export const nf = new Intl.NumberFormat("en-IN");

export const fmt = (v) => (v == null || v === "" ? "—" : nf.format(Number(v)));

export const pct1 = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`;

export const compact = (v) => {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return nf.format(n);
};

export const fmtDate = (s) => {
  const d = new Date(String(s ?? "").slice(0, 10));
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

export const fmtMonth = (s) => {
  // "2025-07" → "Jul ’25"
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return String(s ?? "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : `${d.toLocaleDateString("en-IN", { month: "short" })} ’${m[1].slice(2)}`;
};
```

- [ ] **Step 2: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. (Unreferenced module — confirms it parses.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/fra/helpers.js
git commit -m "feat: extract FRA theme-agnostic formatters into fra/helpers.js"
```

---

## Task 3: Create `fra/editorial/primitives.jsx` — shared editorial rendering primitives

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/primitives.jsx`

This file collects every editorial rendering primitive currently inline in `FraYoutubeDashboardEditorial.jsx`. The code is lifted **verbatim** from the existing file at the noted line ranges, with the formatter calls now imported from `helpers.js` instead of defined locally.

- [ ] **Step 1: Create the primitives module**

Create `frontend/components/dashboards/fra/editorial/primitives.jsx`. Start with this header and imports, then append the lifted blocks below:

```jsx
"use client";
/**
 * Shared editorial rendering primitives for the FRA YouTube dashboard tabs.
 *
 * The ED_* palette, Recharts chart props, the editorial chart frame (`Figure`),
 * the ledger table, the stat exhibit, delta ticks, the animation hooks and the
 * AI-insights blocks. Every editorial FRA tab imports from here. Theme-agnostic
 * formatters live separately in `fra/helpers.js`.
 *
 * Lifted verbatim from the pre-restructure FraYoutubeDashboardEditorial.jsx.
 */

import * as React from "react";
import { Tooltip } from "recharts";
import { fetchFraInsights } from "@/lib/api";
import { fmt } from "../helpers";
```

> **Note on the `Tooltip` import:** `EdTooltip` is a *content* component, not the Recharts `<Tooltip>` element — it does **not** need a Recharts import. The line above is wrong; **drop it**. The correct import block is just `React`, `fetchFraInsights`, and `fmt`. (The tabs that render charts import the Recharts elements themselves.)

Corrected imports:

```jsx
import * as React from "react";
import { fetchFraInsights } from "@/lib/api";
import { fmt } from "../helpers";
```

Then append, in this order, lifting verbatim from `FraYoutubeDashboardEditorial.jsx`:

1. **The ED_* palette + chart props** — lines 35-59 (`ED_PAPER` … `edGridProps`). Add `export` to each `const`.
2. **`edDeltaFmt`** — lines 272-277. Add `export`.
3. **`usePrefersReducedMotion`** — lines 92-103. Add `export function`.
4. **`RevealSection`** — lines 120-131. Add `export function`.
5. **`useCountUp`** — lines 137-162. Add `export function`.
6. **`EdTooltip`** — lines 165-195. Add `export function`.
7. **`SectionHead`** — lines 199-214. Add `export function`.
8. **`Figure`** — lines 218-252. Add `export function`.
9. **`DeltaTick`** — lines 257-269. Add `export function`.
10. **`DeltaTickLine`** — lines 282-300. Add `export function`.
11. **`DualDeltaTick`** — lines 304-322. Add `export function`.
12. **`Exhibit`** — lines 326-340. Add `export function`.
13. **`LedgerTable`** — lines 344-385. Add `export function`.
14. **`EmptyPlate`** — lines 389-399. Add `export function`.
15. **`ErrorNote`** — lines 401-405. Add `export function`.
16. **`useFraInsights`** — lines 449-472. Add `export function`.
17. **`insightItemText`** — lines 1406-1420. Add `export function`.
18. **`InsightColumn`** — lines 1422-1449. Add `export function`.
19. **`AiInsights`** — lines 1348-1401. Add `export function`.

Every block is moved unchanged except for the `export` keyword. The formatter references inside these blocks (`fmt` in `DeltaTick`, `DeltaTickLine`, `Exhibit`) now resolve to the `fmt` imported from `helpers.js` — no other formatter is used by any primitive, so the single `import { fmt }` is sufficient. `usePrefersReducedMotion`, `useCountUp`, `Figure`, `EdTooltip`, `LedgerTable` etc. reference only ED_* constants and React, all in-file.

- [ ] **Step 2: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. (Unreferenced module — confirms every primitive parses and `fmt` resolves.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/primitives.jsx
git commit -m "feat: extract FRA editorial rendering primitives into primitives.jsx"
```

---

## Task 4: Create `editorial/OverviewTab.jsx` — the whole current report

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/OverviewTab.jsx`

OverviewTab is the entire current single-scroll body — every section at its current depth — except the AI section, which is condensed to verdict + top-3 action items. Each section gets a "connects to" link to its deep-dive tab.

- [ ] **Step 1: Scaffold the file and imports**

Create `frontend/components/dashboards/fra/editorial/OverviewTab.jsx`:

```jsx
"use client";
/**
 * Overview tab — the FRA Weekly in full. Every section of the original single-
 * scroll report at its current depth: At a glance, Discovery, Growth, Content
 * fit, Engagement, Cadence, Titles & SEO, Catalog health. The AI section is
 * condensed to the verdict + top-3 action items; each section carries a
 * "read the full analysis" link to its deep-dive tab.
 */

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, AreaChart, BarChart, ScatterChart,
  Area, Bar, Line, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  Cell, ReferenceLine, LabelList,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { fmt, pct1, compact } from "../helpers";
import {
  ED_PAPER, ED_INK, ED_INK_SOFT, ED_INK_MUTED, ED_INK_FAINT,
  ED_RUST, ED_FOREST, ED_GOLD, ED_RULE_FAINT,
  edAxisProps, edGridProps, edDeltaFmt,
  useCountUp, RevealSection, EdTooltip, SectionHead, Figure,
  DeltaTick, DualDeltaTick, Exhibit, LedgerTable, EmptyPlate, ErrorNote,
  insightItemText,
} from "./primitives";
import { fmtMonth } from "../helpers";
```

(Recharts elements unused by a given section can be trimmed from the import after Step 5's build flags them — keep the full list while moving code.)

- [ ] **Step 2: Add the `TabConnect` link primitive**

A small "connects to" rail used at the foot of each Overview section. It is Overview-specific (no other tab links *out*), so it lives in this file, not `primitives.jsx`. Add after the imports:

```jsx
/* The "connects to" link at the foot of an Overview section — sends the reader
   to the matching deep-dive tab. Styled in the ed-section-link rail idiom. */
function TabConnect({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ed-section-link mt-5 inline-flex items-center gap-1.5"
      style={{ minHeight: 36, background: "none", border: "none", cursor: "pointer" }}
    >
      {label} <span aria-hidden>→</span>
    </button>
  );
}
```

- [ ] **Step 3: Move the section render bodies**

Move these section blocks out of `FraYoutubeDashboardEditorial.jsx` into `OverviewTab.jsx` as the tab's render body, **verbatim** at the noted line ranges:

- **§II At a glance** — lines 697-776 (`<RevealSection … id="sec-glance">` … `</RevealSection>`).
- **§III Discovery** — the `<DiscoverySection … />` call at lines 778-789 **and** the `DiscoverySection` component definition at lines 1223-1345. Move the whole `function DiscoverySection(...)` into `OverviewTab.jsx` as a file-local `function DiscoverySection(...)`.
- **§IV Growth** — lines 791-875.
- **§V Content fit** — lines 877-987.
- **§VI Engagement** — lines 989-1036.
- **§VII Cadence** — lines 1038-1094.
- **§VIII Titles & SEO** — lines 1096-1138.
- **§IX Catalog health** — lines 1140-1188.

These blocks reference `loading`, `errOf(data, …)`, `trend`, `reduced`, `animProps` and the derived series. They become props (see the data-prop contract above) — the section JSX itself is unchanged; only the surrounding component signature changes.

- [ ] **Step 4: Assemble the `OverviewTab` component**

Wrap the moved sections in the tab component. Signature and shape:

```jsx
export default function OverviewTab({
  reduced, loading, animProps, data,
  overview, trend, catalogRow, distRow, breakoutRate, ladder, distBuckets,
  growthSeries, growthSeriesWithReal, hasRealTrend,
  categoryScatter, categoryRows, engagementSeries, engMean,
  cadenceDaySeries, cadenceHourSeries, titleSeries,
  insightsState, onNavigate,
}) {
  return (
    <>
      {/* §II At a glance — moved verbatim from lines 697-776 */}
      {/* …followed by: */}
      <TabConnect label="Reach & Growth — the full discovery analysis" onClick={() => onNavigate("reach-growth")} />

      {/* §III Discovery — <DiscoverySection … /> as moved from lines 778-789 */}
      <TabConnect label="Reach & Growth — percentile ladder & concentration" onClick={() => onNavigate("reach-growth")} />

      {/* §IV Growth — moved verbatim from lines 791-875 */}
      <TabConnect label="Reach & Growth — monthly detail with MoM %" onClick={() => onNavigate("reach-growth")} />

      {/* §V Content fit — moved verbatim from lines 877-987 */}
      <TabConnect label="Content & Format — duration buckets & leaderboards" onClick={() => onNavigate("content-format")} />

      {/* §VI Engagement — moved verbatim from lines 989-1036 */}
      <TabConnect label="Audience — like vs comment split & engagement by duration" onClick={() => onNavigate("audience")} />

      {/* §VII Cadence — moved verbatim from lines 1038-1094 */}
      <TabConnect label="Cadence & SEO — upload pacing & gap stats" onClick={() => onNavigate("cadence-seo")} />

      {/* §VIII Titles & SEO — moved verbatim from lines 1096-1138 */}
      <TabConnect label="Cadence & SEO — tag-frequency analysis" onClick={() => onNavigate("cadence-seo")} />

      {/* §IX Catalog health — moved verbatim from lines 1140-1188 */}
      <TabConnect label="Reach & Growth — catalog health in context" onClick={() => onNavigate("reach-growth")} />

      {/* Condensed AI section — verdict + top-3 actions */}
      <OverviewInsightsCondensed insightsState={insightsState} reduced={reduced} onNavigate={onNavigate} />
    </>
  );
}
```

Renumber the moved `SectionHead` `number` props so they read I–IX within the tab (At a glance becomes `number="I"`, Discovery `"II"`, … Catalog health `"VIII"`, condensed AI `"IX"`) — the original masthead-as-I numbering no longer applies, the masthead now lives outside the tab in the shell. The section anchors (`id="sec-glance"` etc.) stay; they remain valid within-page anchors.

- [ ] **Step 5: Add the condensed AI section**

The Overview AI section is verdict + top-3 recommendations only (spec §4.3) — full strengths/weaknesses live in the AI Insights tab. Add this file-local component:

```jsx
/* The condensed AI block for Overview — the verdict and at most three action
   items. The full strengths/weaknesses/recommendations live in the AI Insights
   tab; this is the executive read. */
function OverviewInsightsCondensed({ insightsState, reduced, onNavigate }) {
  const { loading, error, insights } = insightsState;
  const actions = (insights?.recommendations || []).slice(0, 3);
  return (
    <RevealSection reduced={reduced} id="sec-insights">
      <SectionHead
        number="IX"
        italic="The verdict"
        deck="The automated read on this snapshot, in brief — the headline call and the three moves that matter most."
      />
      {loading ? (
        <div className="flex flex-col gap-3">
          {["70%", "92%", "60%"].map((w, i) => (
            <span key={i} className="ed-skeleton" style={{ width: w, height: "0.8em" }} aria-label="loading" />
          ))}
        </div>
      ) : (
        <>
          {error && (
            <p className="ed-caption mb-4" style={{ color: ED_RUST, lineHeight: 1.7 }}>
              ⚠ The AI brief fell back to a cached read — {error}
            </p>
          )}
          {insights?.verdict ? (
            <p className="ed-lede ed-dropcap" style={{ maxWidth: "62ch" }}>{insights.verdict}</p>
          ) : (
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>
              No verdict available for this snapshot yet.
            </p>
          )}
          {actions.length > 0 && (
            <div className="mt-7">
              <p className="ed-overline mb-3">TOP THREE ACTIONS</p>
              <ul className="flex flex-col gap-3">
                {actions.map((it, i) => (
                  <li key={i} className="ed-prose flex gap-2.5" style={{ fontSize: 14 }}>
                    <span className="ed-num shrink-0" style={{ color: ED_GOLD, fontWeight: 700, lineHeight: 1.5 }} aria-hidden>→</span>
                    <span>{insightItemText(it)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => onNavigate("ai-insights")}
            className="ed-section-link mt-6 inline-flex items-center gap-1.5"
            style={{ minHeight: 36, background: "none", border: "none", cursor: "pointer" }}
          >
            AI Insights — the full strengths &amp; weaknesses read <span aria-hidden>→</span>
          </button>
        </>
      )}
    </RevealSection>
  );
}
```

- [ ] **Step 6: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. (Tab file is not yet imported by the shell — confirms it compiles and every import resolves.) Trim any genuinely unused Recharts imports the build warns about.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/OverviewTab.jsx
git commit -m "feat: add FRA editorial OverviewTab — full report with deep-dive links"
```

---

## Task 5: Create `editorial/ReachGrowthTab.jsx` — Discovery + Growth + Catalog + new depth

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/ReachGrowthTab.jsx`

Reach & Growth = Discovery + Growth + Catalog health in full, plus the percentile ladder and the monthly detail table with MoM %.

- [ ] **Step 1: Scaffold the file**

Create `frontend/components/dashboards/fra/editorial/ReachGrowthTab.jsx` with the imports OverviewTab uses (Recharts elements `ComposedChart, AreaChart, BarChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer`; `errOf`; `fmt, pct1, compact, fmtMonth`; the primitives `ED_*`, `edAxisProps`, `edGridProps`, `useCountUp`, `RevealSection`, `EdTooltip`, `SectionHead`, `Figure`, `DeltaTick`, `Exhibit`, `LedgerTable`, `EmptyPlate`, `ErrorNote`).

- [ ] **Step 2: Reuse the Discovery, Growth and Catalog sections**

These three sections are *also* rendered in OverviewTab. Per spec §4.2 the editorial theme has no cross-theme sharing, but **within the editorial theme** a section reused by two tabs should be defined once. Define `DiscoverySection`, `GrowthSection` and `CatalogHealthSection` as file-local functions in `ReachGrowthTab.jsx`, and have `OverviewTab.jsx` import them from here:

- In Task 4 you moved `DiscoverySection` into `OverviewTab.jsx`. **Now move it again** — out of `OverviewTab.jsx` and into `ReachGrowthTab.jsx` as `export function DiscoverySection(...)`. `OverviewTab.jsx` imports it: `import { DiscoverySection, GrowthSection, CatalogHealthSection } from "./ReachGrowthTab";`.
- Extract the §IV Growth body (the two `<Figure>` blocks from old lines 791-875) into `export function GrowthSection({ loading, data, growthSeries, growthSeriesWithReal, hasRealTrend, animProps })` in `ReachGrowthTab.jsx`. Replace the inline block in `OverviewTab.jsx` with `<GrowthSection … />`.
- Extract the §IX Catalog health body (old lines 1140-1188) into `export function CatalogHealthSection({ loading, data, catalogRow })`. Replace the inline block in `OverviewTab.jsx` with `<CatalogHealthSection … />`.

This keeps the editorial report DRY across its own tabs without crossing the theme boundary. The `SectionHead` `number` prop is passed in by each consuming tab (Overview numbers I–IX; Reach & Growth numbers I–V), so make `number` a prop of each `*Section` function rather than hard-coding it.

- [ ] **Step 3: Build the percentile-ladder section (net-new)**

The extended `distribution` row now carries `p25_views`, `p75_views`, `p95_views`, `mean_median_ratio`, `top10pct_view_share` (plus the existing `p10_views`, `p50_views`, `p90_views`). Net-new UI — a full percentile ladder. Add as a file-local function:

```jsx
/* The full percentile ladder — P10/P25/P50/P75/P90/P95 of per-video views as a
   ruled horizontal exhibit, plus the two concentration read-outs. Net-new in
   the restructure; reads the five extended distribution columns. */
function PercentileLadderSection({ number, loading, error, distRow }) {
  const rungs = distRow
    ? [
        { label: "P10", value: Number(distRow.p10_views) },
        { label: "P25", value: Number(distRow.p25_views) },
        { label: "P50 · median", value: Number(distRow.p50_views) },
        { label: "P75", value: Number(distRow.p75_views) },
        { label: "P90", value: Number(distRow.p90_views) },
        { label: "P95", value: Number(distRow.p95_views) },
      ].filter((r) => Number.isFinite(r.value))
    : [];
  const top = rungs.length ? Math.max(...rungs.map((r) => r.value), 1) : 1;
  return (
    <RevealSection reduced={false} id="sec-percentiles">
      <SectionHead
        number={number}
        italic="The percentile ladder"
        deck="Where a video lands in the library by lifetime views — the full distribution from the quiet tenth percentile to the breakout ninety-fifth."
      />
      {error ? (
        <ErrorNote>Could not load the distribution: {error}</ErrorNote>
      ) : loading ? (
        <div className="ed-skeleton" style={{ width: "100%", height: 200, borderRadius: 2 }} aria-label="loading" />
      ) : rungs.length === 0 ? (
        <EmptyPlate>No distribution row for the current snapshot.</EmptyPlate>
      ) : (
        <>
          <div className="border-t border-b mt-2" style={{ borderColor: ED_INK }}>
            {rungs.map((r, i) => {
              const w = Math.max(3, Math.round((r.value / top) * 100));
              return (
                <div key={r.label} className="py-3" style={{ borderTop: i ? `1px solid ${ED_RULE_FAINT}` : "none" }}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="ed-caption" style={{ color: ED_INK }}>{r.label}</span>
                    <span className="ed-num" style={{ fontSize: 15, fontWeight: 600 }}>{fmt(r.value)} views</span>
                  </div>
                  <div style={{ height: 6, background: "rgba(27,24,24,0.07)" }}>
                    <div style={{ height: "100%", width: `${w}%`, background: i >= 4 ? ED_FOREST : i >= 2 ? ED_INK : ED_GOLD }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid gap-x-8 gap-y-8 grid-cols-2 lg:grid-cols-3 mt-9">
            <Exhibit
              label="Mean / median ratio"
              value={distRow.mean_median_ratio != null ? Number(distRow.mean_median_ratio).toFixed(2) : "—"}
              sub="a ratio above 1 means a few hits pull the mean up"
            />
            <Exhibit
              label="Top-10% view share"
              value={distRow.top10pct_view_share != null ? pct1(Number(distRow.top10pct_view_share) * 100) : "—"}
              sub="share of all views held by the top tenth of videos"
            />
            <Exhibit
              label="Gini coefficient"
              value={distRow.gini != null ? Number(distRow.gini).toFixed(3) : "—"}
              sub="0 is perfectly even, 1 is one video taking everything"
            />
          </div>
        </>
      )}
    </RevealSection>
  );
}
```

- [ ] **Step 4: Build the monthly-detail section (net-new)**

A `LedgerTable` over `monthlyRows` with a client-computed month-over-month %. Add as a file-local function:

```jsx
/* Monthly detail — video count and average views per calendar month, with the
   month-over-month change computed client-side. Net-new in the restructure;
   the monthly_views table already carries video_count + avg_views. */
function MonthlyDetailSection({ number, loading, error, monthlyRows }) {
  const rows = React.useMemo(() => {
    const sorted = [...(monthlyRows || [])].sort((a, b) =>
      String(a.month).localeCompare(String(b.month)));
    return sorted.map((r, i) => {
      const prev = i > 0 ? Number(sorted[i - 1].total_views) : null;
      const cur = Number(r.total_views);
      const mom = prev != null && prev !== 0 ? ((cur - prev) / prev) * 100 : null;
      return { ...r, _mom: mom };
    });
  }, [monthlyRows]);
  return (
    <RevealSection reduced={false} id="sec-monthly">
      <SectionHead
        number={number}
        italic="Monthly detail"
        deck="Every calendar month of uploads — how many videos shipped, the views they earned, and the swing against the month before."
      />
      {error ? (
        <ErrorNote>Could not load monthly detail: {error}</ErrorNote>
      ) : (
        <LedgerTable
          loading={loading}
          empty="No monthly data for the current snapshot."
          rows={rows}
          cols={[
            { key: "month", label: "Month", render: (r) => fmtMonth(r.month) },
            { key: "video_count", label: "Videos", align: "right", mono: true, render: (r) => fmt(r.video_count) },
            { key: "total_views", label: "Total views", align: "right", mono: true, render: (r) => compact(r.total_views) },
            { key: "avg_views", label: "Avg / video", align: "right", mono: true, render: (r) => fmt(r.avg_views) },
            {
              key: "_mom", label: "MoM", align: "right", mono: true,
              render: (r) =>
                r._mom == null ? (
                  <span style={{ color: ED_INK_FAINT }}>—</span>
                ) : (
                  <span style={{ color: r._mom >= 0 ? ED_FOREST : ED_RUST, fontWeight: 600 }}>
                    {r._mom >= 0 ? "▲" : "▼"} {pct1(Math.abs(r._mom))}
                  </span>
                ),
            },
          ]}
        />
      )}
    </RevealSection>
  );
}
```

- [ ] **Step 5: Assemble the `ReachGrowthTab` component**

```jsx
export default function ReachGrowthTab({
  loading, reduced, animProps, data,
  distRow, breakoutRate, ladder, distBuckets,
  growthSeries, growthSeriesWithReal, hasRealTrend, catalogRow, monthlyRows,
}) {
  return (
    <>
      <DiscoverySection number="I" reduced={reduced} loading={loading} distRow={distRow}
        error={errOf(data, "distribution")} videoViewsError={errOf(data, "videoViews")}
        breakoutRate={breakoutRate} ladder={ladder} distBuckets={distBuckets} animProps={animProps} />
      <PercentileLadderSection number="II" loading={loading} error={errOf(data, "distribution")} distRow={distRow} />
      <GrowthSection number="III" loading={loading} data={data} growthSeries={growthSeries}
        growthSeriesWithReal={growthSeriesWithReal} hasRealTrend={hasRealTrend} animProps={animProps} />
      <MonthlyDetailSection number="IV" loading={loading} error={errOf(data, "monthlyViews")} monthlyRows={monthlyRows} />
      <CatalogHealthSection number="V" loading={loading} data={data} catalogRow={catalogRow} />
    </>
  );
}
```

- [ ] **Step 6: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. Manual visual check deferred until the shell wires the tab (Task 10) — note here that the percentile ladder and monthly table must be re-checked at 375px once visible.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/ReachGrowthTab.jsx frontend/components/dashboards/fra/editorial/OverviewTab.jsx
git commit -m "feat: add FRA editorial ReachGrowthTab with percentile ladder & monthly detail"
```

---

## Task 6: Create `editorial/ContentFormatTab.jsx` — Content fit + duration buckets + leaderboards

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/ContentFormatTab.jsx`

Content & Format = Content fit in full, plus duration-bucket performance and the two per-video leaderboards.

- [ ] **Step 1: Scaffold the file and extract the Content-fit section**

Create `frontend/components/dashboards/fra/editorial/ContentFormatTab.jsx`. Extract the §V Content fit body (old `FraYoutubeDashboardEditorial.jsx` lines 877-987 — the scatter `Figure` and the category `LedgerTable`) into `export function ContentFitSection({ number, loading, data, categoryScatter, categoryRows, animProps })` here, and update `OverviewTab.jsx` to import and render `<ContentFitSection … />` instead of its inline copy.

Imports: Recharts `ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Cell, LabelList, BarChart, Bar, ResponsiveContainer`; `errOf`; `fmt, pct1, compact`; primitives `ED_*, edAxisProps, edGridProps, RevealSection, EdTooltip, SectionHead, Figure, LedgerTable, EmptyPlate, ErrorNote`.

- [ ] **Step 2: Build the duration-bucket performance section (net-new)**

Reads `durationBucketRows` (`data.durationBuckets`) — one row per bucket with `bucket`, `video_count`, `avg_views`, `engagement_rate_pct`. A `Figure`-framed bar chart of avg views per bucket. Add as a file-local function:

```jsx
/* Duration-bucket performance — average views per duration bucket. Net-new in
   the restructure; reads the fra_youtube__duration_buckets table. Buckets are
   emitted even when empty so the x-axis is stable. */
function DurationBucketSection({ number, loading, error, durationBucketRows, animProps }) {
  const series = (durationBucketRows || []).map((r) => ({
    bucket: r.bucket,
    avgViews: Number(r.avg_views) || 0,
    videos: Number(r.video_count) || 0,
  }));
  return (
    <RevealSection reduced={false} id="sec-duration">
      <SectionHead
        number={number}
        italic="Format & length"
        deck="How the channel's videos perform by running time — which lengths the audience rewards, and which the channel over-produces."
      />
      <Figure
        figNum={`${number}.1`}
        title="Average views by video length"
        caption="Each bar is a duration bucket; its height is the mean views of videos in that bucket. The count beneath names how many videos sit there."
        loading={loading}
        error={error}
        height={280}
        footnote="Buckets are upper-bound-inclusive: a 30-second video falls in 0–30s, the final bucket is open-ended."
      >
        {series.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No duration data for this snapshot.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="bucket" {...edAxisProps} />
              <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
              <Tooltip
                cursor={{ fill: "rgba(27,24,24,0.05)" }}
                content={<EdTooltip valueFmt={(v) => fmt(v)} />}
              />
              <Bar dataKey="avgViews" name="Avg views" fill={ED_INK} maxBarSize={48} {...animProps}>
                <LabelList
                  dataKey="videos"
                  position="top"
                  formatter={(v) => `${v} vid`}
                  style={{ fontFamily: "var(--ed-mono)", fontSize: 9, fill: ED_INK_MUTED }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Figure>
    </RevealSection>
  );
}
```

- [ ] **Step 3: Build the per-video leaderboard section (net-new)**

Reads `topVideosByViewsRows` and `topVideosByEngagementRows` — two `LedgerTable`s. Add a shared row-formatter helper and the section:

```jsx
/* Engagement rate of a leaderboard row, as a percentage — (likes+comments)/views. */
function _engRate(r) {
  const views = Number(r.views) || 0;
  if (views === 0) return null;
  return ((Number(r.likes) + Number(r.comments)) / views) * 100;
}

/* Per-video leaderboards — the top ten videos by lifetime views and by
   engagement rate. Net-new in the restructure; reads video_snapshots directly
   via the topVideosByViews / topVideosByEngagement query specs. */
function LeaderboardSection({ number, loading, viewsError, engError, topByViews, topByEngagement }) {
  const titleCol = {
    key: "title", label: "Title",
    render: (r) => (
      <span style={{ display: "inline-block", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {r.title}
      </span>
    ),
  };
  return (
    <RevealSection reduced={false} id="sec-leaderboard">
      <SectionHead
        number={number}
        italic="The leaderboard"
        deck="The ten videos that reached furthest — first by raw views, then by the rate at which viewers engaged."
      />
      <div className="mt-7">
        <p className="ed-overline mb-3">TOP TEN · BY VIEWS</p>
        {viewsError ? (
          <ErrorNote>Could not load the views leaderboard: {viewsError}</ErrorNote>
        ) : (
          <LedgerTable
            loading={loading}
            empty="No video data for the current snapshot."
            rows={topByViews}
            cols={[
              titleCol,
              { key: "category", label: "Category" },
              { key: "views", label: "Views", align: "right", mono: true, render: (r) => fmt(r.views) },
              { key: "likes", label: "Likes", align: "right", mono: true, render: (r) => fmt(r.likes) },
              { key: "comments", label: "Comments", align: "right", mono: true, render: (r) => fmt(r.comments) },
            ]}
          />
        )}
      </div>
      <div className="mt-9">
        <p className="ed-overline mb-3">TOP TEN · BY ENGAGEMENT RATE</p>
        {engError ? (
          <ErrorNote>Could not load the engagement leaderboard: {engError}</ErrorNote>
        ) : (
          <LedgerTable
            loading={loading}
            empty="No video data for the current snapshot."
            rows={topByEngagement}
            cols={[
              titleCol,
              { key: "category", label: "Category" },
              { key: "views", label: "Views", align: "right", mono: true, render: (r) => fmt(r.views) },
              {
                key: "_eng", label: "Engagement", align: "right", mono: true,
                render: (r) => {
                  const e = _engRate(r);
                  return (
                    <span style={{ color: ED_FOREST, fontWeight: 600 }}>
                      {e == null ? "—" : pct1(e)}
                    </span>
                  );
                },
              },
            ]}
          />
        )}
      </div>
    </RevealSection>
  );
}
```

- [ ] **Step 4: Assemble the `ContentFormatTab` component**

```jsx
export default function ContentFormatTab({
  loading, reduced, animProps, data,
  categoryScatter, categoryRows, durationBucketRows,
  topVideosByViewsRows, topVideosByEngagementRows,
}) {
  return (
    <>
      <ContentFitSection number="I" loading={loading} data={data}
        categoryScatter={categoryScatter} categoryRows={categoryRows} animProps={animProps} />
      <DurationBucketSection number="II" loading={loading} error={errOf(data, "durationBuckets")}
        durationBucketRows={durationBucketRows} animProps={animProps} />
      <LeaderboardSection number="III" loading={loading}
        viewsError={errOf(data, "topVideosByViews")} engError={errOf(data, "topVideosByEngagement")}
        topByViews={topVideosByViewsRows} topByEngagement={topVideosByEngagementRows} />
    </>
  );
}
```

- [ ] **Step 5: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. Note: the leaderboard tables and duration chart re-checked at 375px once the shell wires the tab (Task 10) — `LedgerTable` already wraps in an `overflow-x:auto` scroller, so wide rows scroll rather than break.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/ContentFormatTab.jsx frontend/components/dashboards/fra/editorial/OverviewTab.jsx
git commit -m "feat: add FRA editorial ContentFormatTab with duration buckets & leaderboards"
```

---

## Task 7: Create `editorial/AudienceTab.jsx` — Engagement + like/comment split + engagement by duration

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/AudienceTab.jsx`

Audience = Engagement in full, plus the like-rate vs comment-rate split and engagement by video duration.

- [ ] **Step 1: Scaffold the file and extract the Engagement section**

Create `frontend/components/dashboards/fra/editorial/AudienceTab.jsx`. Extract the §VI Engagement body (old lines 989-1036 — the diverging `Figure` bar chart) into `export function EngagementSection({ number, loading, data, engagementSeries, engMean, animProps })` here, and update `OverviewTab.jsx` to import and render `<EngagementSection … />` instead of its inline copy.

Imports: Recharts `BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine, ResponsiveContainer`; `errOf`; `fmt, pct1, compact`; primitives `ED_*, edAxisProps, edGridProps, RevealSection, EdTooltip, SectionHead, Figure, Exhibit, EmptyPlate, ErrorNote`.

- [ ] **Step 2: Build the like-rate vs comment-rate split section (net-new)**

Reads `engagementOverallRow` (`data.engagementOverall[0]`) — the `overall`-dimension engagement row carrying `like_rate_pct`, `comment_rate_pct`, `engagement_rate_pct`. A two-bar split plus stat exhibits. Add as a file-local function:

```jsx
/* Like-rate vs comment-rate split — the channel-level engagement breakdown
   read as two component rates. Net-new in the restructure; reads the `overall`
   dimension row of fra_youtube__engagement_breakdown. */
function EngagementSplitSection({ number, loading, error, overallRow }) {
  const likeRate = overallRow?.like_rate_pct != null ? Number(overallRow.like_rate_pct) : null;
  const commentRate = overallRow?.comment_rate_pct != null ? Number(overallRow.comment_rate_pct) : null;
  const split = [
    { label: "Like rate", value: likeRate, color: ED_FOREST },
    { label: "Comment rate", value: commentRate, color: ED_GOLD },
  ].filter((s) => s.value != null);
  const max = split.length ? Math.max(...split.map((s) => s.value), 0.01) : 0.01;
  return (
    <RevealSection reduced={false} id="sec-split">
      <SectionHead
        number={number}
        italic="How they respond"
        deck="The channel's engagement split into its two signals — the quiet tap of a like against the higher-effort act of leaving a comment."
      />
      {error ? (
        <ErrorNote>Could not load the engagement split: {error}</ErrorNote>
      ) : loading ? (
        <div className="ed-skeleton" style={{ width: "100%", height: 140, borderRadius: 2 }} aria-label="loading" />
      ) : split.length === 0 ? (
        <EmptyPlate>No channel-level engagement row for the current snapshot.</EmptyPlate>
      ) : (
        <>
          <div className="border-t border-b mt-2" style={{ borderColor: ED_INK }}>
            {split.map((s, i) => (
              <div key={s.label} className="py-3.5" style={{ borderTop: i ? `1px solid ${ED_RULE_FAINT}` : "none" }}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="ed-caption" style={{ color: ED_INK }}>{s.label}</span>
                  <span className="ed-num" style={{ fontSize: 15, fontWeight: 600 }}>{pct1(s.value)}</span>
                </div>
                <div style={{ height: 8, background: "rgba(27,24,24,0.07)" }}>
                  <div style={{ height: "100%", width: `${Math.max(3, Math.round((s.value / max) * 100))}%`, background: s.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-x-8 gap-y-8 grid-cols-2 mt-9">
            <Exhibit
              label="Overall engagement"
              value={overallRow?.engagement_rate_pct != null ? pct1(overallRow.engagement_rate_pct) : "—"}
              sub="likes + comments over views, channel-wide"
            />
            <Exhibit
              label="Like-to-comment ratio"
              value={
                likeRate != null && commentRate != null && commentRate !== 0
                  ? `${(likeRate / commentRate).toFixed(1)} : 1`
                  : "—"
              }
              sub="likes earned per comment"
            />
          </div>
        </>
      )}
    </RevealSection>
  );
}
```

- [ ] **Step 3: Build the engagement-by-duration section (net-new)**

Reads `durationBucketRows` — the same `fra_youtube__duration_buckets` rows used by Content & Format, but here read on `engagement_rate_pct` instead of `avg_views`. A `Figure`-framed bar chart. Add as a file-local function:

```jsx
/* Engagement by video duration — the engagement_rate_pct column of the
   duration-buckets table, read as a bar per length bucket. Net-new in the
   restructure. Shares the duration-buckets table with Content & Format. */
function EngagementByDurationSection({ number, loading, error, durationBucketRows, animProps }) {
  const series = (durationBucketRows || []).map((r) => ({
    bucket: r.bucket,
    rate: Number(r.engagement_rate_pct) || 0,
    videos: Number(r.video_count) || 0,
  }));
  return (
    <RevealSection reduced={false} id="sec-eng-duration">
      <SectionHead
        number={number}
        italic="Engagement by length"
        deck="Whether longer or shorter videos draw the warmer response — engagement rate read across the same duration buckets."
      />
      <Figure
        figNum={`${number}.1`}
        title="Engagement rate by video length"
        caption="Each bar is the mean engagement rate — likes plus comments over views — of the videos in that duration bucket."
        loading={loading}
        error={error}
        height={280}
      >
        {series.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No duration data for this snapshot.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="bucket" {...edAxisProps} />
              <YAxis {...edAxisProps} width={48} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                cursor={{ fill: "rgba(27,24,24,0.05)" }}
                content={<EdTooltip valueFmt={(v) => `${Number(v).toFixed(2)}%`} />}
              />
              <Bar dataKey="rate" name="Engagement rate" fill={ED_GOLD} maxBarSize={48} {...animProps} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Figure>
    </RevealSection>
  );
}
```

- [ ] **Step 4: Assemble the `AudienceTab` component**

```jsx
export default function AudienceTab({
  loading, reduced, animProps, data,
  engagementSeries, engMean, engagementOverallRow, durationBucketRows,
}) {
  return (
    <>
      <EngagementSection number="I" loading={loading} data={data}
        engagementSeries={engagementSeries} engMean={engMean} animProps={animProps} />
      <EngagementSplitSection number="II" loading={loading}
        error={errOf(data, "engagementOverall")} overallRow={engagementOverallRow} />
      <EngagementByDurationSection number="III" loading={loading}
        error={errOf(data, "durationBuckets")} durationBucketRows={durationBucketRows} animProps={animProps} />
    </>
  );
}
```

- [ ] **Step 5: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. 375px check deferred to Task 10.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/AudienceTab.jsx frontend/components/dashboards/fra/editorial/OverviewTab.jsx
git commit -m "feat: add FRA editorial AudienceTab with like/comment split & engagement by duration"
```

---

## Task 8: Create `editorial/CadenceSeoTab.jsx` — Cadence + Titles & SEO + upload pacing + tag analysis

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/CadenceSeoTab.jsx`

Cadence & SEO = Cadence + Titles & SEO in full, plus upload cadence & gap stats and tag-frequency/SEO analysis.

- [ ] **Step 1: Scaffold the file and extract the Cadence + Titles sections**

Create `frontend/components/dashboards/fra/editorial/CadenceSeoTab.jsx`. Extract two section bodies from the old file:

- §VII Cadence body (old lines 1038-1094 — the two posting-day/posting-hour `Figure` blocks) into `export function CadenceSection({ number, loading, data, cadenceDaySeries, cadenceHourSeries, animProps })`.
- §VIII Titles & SEO body (old lines 1096-1138 — the title-pattern `Figure`) into `export function TitlesSeoSection({ number, loading, data, titleSeries, animProps })`.

Update `OverviewTab.jsx` to import and render `<CadenceSection … />` and `<TitlesSeoSection … />` instead of its inline copies.

Imports: Recharts `BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer`; `errOf`; `fmt, compact`; primitives `ED_*, edAxisProps, edGridProps, RevealSection, EdTooltip, SectionHead, Figure, Exhibit, LedgerTable, EmptyPlate, ErrorNote`.

- [ ] **Step 2: Build the upload-cadence section (net-new)**

Reads `uploadCadenceRow` (`data.uploadCadence[0]`) — the single channel-level row with `avg_uploads_per_month`, `avg_gap_days`, `median_gap_days`, `longest_gap_days`. Four `Exhibit`s. Add as a file-local function:

```jsx
/* Upload cadence — the channel's pacing: how often it ships, and the gaps
   between uploads. Net-new in the restructure; reads fra_youtube__upload_cadence
   (a single channel-level row). */
function UploadCadenceSection({ number, loading, error, cadenceRow }) {
  return (
    <RevealSection reduced={false} id="sec-pacing">
      <SectionHead
        number={number}
        italic="The pace of it"
        deck="How steadily the channel publishes — its monthly rhythm, and the gaps that open up between one upload and the next."
      />
      {error ? (
        <ErrorNote>Could not load upload cadence: {error}</ErrorNote>
      ) : !loading && !cadenceRow ? (
        <EmptyPlate>No upload-cadence row for the current snapshot.</EmptyPlate>
      ) : (
        <div className="grid gap-x-8 gap-y-8 grid-cols-2 lg:grid-cols-4">
          <Exhibit
            label="Uploads / month"
            loading={loading}
            value={cadenceRow?.avg_uploads_per_month != null ? Number(cadenceRow.avg_uploads_per_month).toFixed(2) : "—"}
            sub="averaged over active months"
          />
          <Exhibit
            label="Avg gap"
            loading={loading}
            value={cadenceRow?.avg_gap_days != null ? `${Number(cadenceRow.avg_gap_days).toFixed(1)} d` : "—"}
            sub="mean days between uploads"
          />
          <Exhibit
            label="Median gap"
            loading={loading}
            value={cadenceRow?.median_gap_days != null ? `${Number(cadenceRow.median_gap_days).toFixed(1)} d` : "—"}
            sub="the typical wait"
          />
          <Exhibit
            label="Longest gap"
            loading={loading}
            value={cadenceRow?.longest_gap_days != null ? `${fmt(cadenceRow.longest_gap_days)} d` : "—"}
            sub="the channel's quietest stretch"
          />
        </div>
      )}
    </RevealSection>
  );
}
```

- [ ] **Step 3: Build the tag-analysis section (net-new)**

Reads `tagAnalysisRows` (`data.tagAnalysis`) — up to 30 rows with `tag`, `frequency`, `tag_type`. A horizontal-bar `Figure` of the top tags by frequency, plus a `LedgerTable` carrying the tag type. Add as a file-local function:

```jsx
/* Tag-type accent colours — keeps the SEO read scannable at a glance. */
const TAG_TYPE_COLOR = {
  product: ED_FOREST,
  aspirational: ED_GOLD,
  platform: ED_INK_MUTED,
  brand: ED_RUST,
  educational: ED_INK_SOFT,
  other: ED_INK_FAINT,
};

/* Tag-frequency / SEO analysis — the channel's most-used SEO tags, ranked, each
   keyword-classified into a coarse type. Net-new in the restructure; reads
   fra_youtube__tag_analysis (top 30 tags). */
function TagAnalysisSection({ number, loading, error, tagRows, animProps }) {
  const top = (tagRows || []).slice(0, 12);
  const series = top.map((r) => ({
    tag: r.tag,
    frequency: Number(r.frequency) || 0,
    type: r.tag_type || "other",
  }));
  return (
    <RevealSection reduced={false} id="sec-tags">
      <SectionHead
        number={number}
        italic="The keywords"
        deck="The SEO tags the channel reaches for most, ranked by how many videos carry them — and what kind of word each one is."
      />
      <Figure
        figNum={`${number}.1`}
        title="Most-used SEO tags"
        caption="Each bar is a tag; its length is the number of videos that carry it. Bars are tinted by tag type — product, aspirational, platform, brand, educational."
        loading={loading}
        error={error}
        height={Math.max(220, series.length * 34 + 40)}
      >
        {series.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No tag data for this snapshot.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={series} margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" horizontal={false} />
              <XAxis type="number" {...edAxisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="tag" {...edAxisProps} width={130} />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => `${fmt(v)} videos`} />} />
              <Bar dataKey="frequency" name="Videos" maxBarSize={20} {...animProps}>
                {series.map((d, i) => (
                  <Cell key={i} fill={TAG_TYPE_COLOR[d.type] || ED_INK} />
                ))}
                <LabelList
                  dataKey="frequency"
                  position="right"
                  style={{ fontFamily: "var(--ed-mono)", fontSize: 9, fill: ED_INK_MUTED }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Figure>
      <div className="mt-7">
        <p className="ed-overline mb-3">THE LEDGER · TAGS BY TYPE</p>
        <LedgerTable
          loading={loading}
          empty="No tag data for the current snapshot."
          rows={tagRows}
          cols={[
            { key: "tag", label: "Tag" },
            { key: "frequency", label: "Videos", align: "right", mono: true, render: (r) => fmt(r.frequency) },
            {
              key: "tag_type", label: "Type",
              render: (r) => (
                <span style={{ color: TAG_TYPE_COLOR[r.tag_type] || ED_INK, fontWeight: 600, textTransform: "capitalize" }}>
                  {r.tag_type || "other"}
                </span>
              ),
            },
          ]}
        />
      </div>
    </RevealSection>
  );
}
```

The `<Cell>` and `LabelList` imports must be present — extend the Step 1 Recharts import with `Cell`.

- [ ] **Step 4: Assemble the `CadenceSeoTab` component**

```jsx
export default function CadenceSeoTab({
  loading, reduced, animProps, data,
  cadenceDaySeries, cadenceHourSeries, titleSeries, uploadCadenceRow, tagAnalysisRows,
}) {
  return (
    <>
      <CadenceSection number="I" loading={loading} data={data}
        cadenceDaySeries={cadenceDaySeries} cadenceHourSeries={cadenceHourSeries} animProps={animProps} />
      <UploadCadenceSection number="II" loading={loading}
        error={errOf(data, "uploadCadence")} cadenceRow={uploadCadenceRow} />
      <TitlesSeoSection number="III" loading={loading} data={data} titleSeries={titleSeries} animProps={animProps} />
      <TagAnalysisSection number="IV" loading={loading}
        error={errOf(data, "tagAnalysis")} tagRows={tagAnalysisRows} animProps={animProps} />
    </>
  );
}
```

- [ ] **Step 5: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. 375px check deferred to Task 10.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/CadenceSeoTab.jsx frontend/components/dashboards/fra/editorial/OverviewTab.jsx
git commit -m "feat: add FRA editorial CadenceSeoTab with upload pacing & tag analysis"
```

---

## Task 9: Create `editorial/InsightsTab.jsx` — the full AI read

**Files:**
- Create: `frontend/components/dashboards/fra/editorial/InsightsTab.jsx`

AI Insights = the full verdict + strengths / weaknesses / recommendations. The `AiInsights` component is already in `primitives.jsx` (Task 3) — this tab is a thin wrapper that frames it with a `SectionHead`.

- [ ] **Step 1: Create the file**

Create `frontend/components/dashboards/fra/editorial/InsightsTab.jsx`:

```jsx
"use client";
/**
 * AI Insights tab — the full automated read on the latest snapshot: the
 * headline verdict and the three-column strengths / weaknesses /
 * recommendations grid. The condensed verdict + top-3 lives on the Overview
 * tab; this is the unabridged version.
 */

import * as React from "react";
import { RevealSection, SectionHead, AiInsights } from "./primitives";

export default function InsightsTab({ insightsState }) {
  return (
    <RevealSection reduced={false} id="sec-insights">
      <SectionHead
        number="I"
        italic="AI Insights"
        deck="The automated read on this snapshot — what the channel is doing well, where it is leaking, and what to try next."
      />
      <AiInsights state={insightsState} />
    </RevealSection>
  );
}
```

- [ ] **Step 2: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/fra/editorial/InsightsTab.jsx
git commit -m "feat: add FRA editorial InsightsTab — full AI verdict & recommendations"
```

---

## Task 10: Rewrite `FraYoutubeDashboardEditorial.jsx` as the tab shell

**Files:**
- Rewrite: `frontend/components/dashboards/FraYoutubeDashboardEditorial.jsx`

The shell keeps the masthead, owns the two data hooks and all derived series, renders a persistent "Weekly"-idiom tab strip below the masthead, and renders the active tab. After this task the 1449-line file is ~350 lines and every primitive/section now lives in the `fra/` tree.

- [ ] **Step 1: Replace the file with the shell**

Replace the entire contents of `FraYoutubeDashboardEditorial.jsx` with:

```jsx
"use client";
// FraYoutubeDashboardEditorial — tab shell
// ─────────────────────────────────────────────────────────────────────────
// The editorial-theme rendering of the FRA YouTube project dashboard. A thin
// shell: a persistent masthead, a "Weekly"-idiom tab strip, and the active
// tab. Six fixed-order tabs — Overview, Reach & Growth, Content & Format,
// Audience, Cadence & SEO, AI Insights — each a focused component under
// fra/editorial/. The data layer (SQL specs + useFraYoutube) lives in
// lib/queries/fraYoutube.js; the shared rendering primitives in
// fra/editorial/primitives.jsx; theme-agnostic formatters in fra/helpers.js.

import * as React from "react";
import Link from "next/link";
import { useFraYoutube, rowsOf, errOf, computeTrend } from "@/lib/queries/fraYoutube";
import { fmtDate } from "./fra/helpers";
import {
  ED_INK_MUTED, ED_INK_FAINT, ED_RUST, CHART_ANIM_MS,
  usePrefersReducedMotion, useFraInsights, RevealSection, EmptyPlate,
} from "./fra/editorial/primitives";
import OverviewTab from "./fra/editorial/OverviewTab";
import ReachGrowthTab from "./fra/editorial/ReachGrowthTab";
import ContentFormatTab from "./fra/editorial/ContentFormatTab";
import AudienceTab from "./fra/editorial/AudienceTab";
import CadenceSeoTab from "./fra/editorial/CadenceSeoTab";
import InsightsTab from "./fra/editorial/InsightsTab";

/* The six tabs, in fixed order (spec §4.1). `key` is the stable identifier the
   tabs' onNavigate() calls and the active-tab state both use. */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reach-growth", label: "Reach & Growth" },
  { key: "content-format", label: "Content & Format" },
  { key: "audience", label: "Audience" },
  { key: "cadence-seo", label: "Cadence & SEO" },
  { key: "ai-insights", label: "AI Insights" },
];

/* The "Weekly"-idiom tab strip — mono labels on a ruled rail, in the spirit of
   the old TableOfContents. Horizontally scrollable on narrow viewports so all
   six tabs are reachable at 375px without wrapping. */
function TabStrip({ active, onSelect }) {
  return (
    <nav
      className="mt-8 overflow-x-auto"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      aria-label="Report sections"
    >
      <div
        className="flex gap-x-1"
        style={{ borderTop: "1px solid var(--ed-ink)", borderBottom: "1px solid var(--ed-rule-faint)" }}
      >
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onSelect(t.key)}
              className="ed-section-link shrink-0 whitespace-nowrap"
              aria-current={on ? "page" : undefined}
              style={{
                minHeight: 40,
                padding: "0 14px",
                display: "inline-flex",
                alignItems: "center",
                background: on ? "var(--ed-ink)" : "none",
                color: on ? "var(--ed-paper)" : "var(--ed-ink-muted)",
                border: "none",
                cursor: "pointer",
                fontWeight: on ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function FraYoutubeDashboardEditorial({ project }) {
  const reduced = usePrefersReducedMotion();
  const { loading, error, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();
  const [activeTab, setActiveTab] = React.useState("overview");

  /* On tab change, return the reader to the top of the report. */
  const onNavigate = React.useCallback((key) => {
    setActiveTab(key);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);

  /* ── row extraction (existing) ───────────────────────────────────────────*/
  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;
  const distRow = rowsOf(data, "distribution")[0] || null;
  const catalogRow = rowsOf(data, "catalogHealth")[0] || null;
  const videoViewsRows = rowsOf(data, "videoViews");
  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyRows = rowsOf(data, "monthlyViews");
  const cumulativeRows = rowsOf(data, "cumulativeViews");
  const categoryRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceDayRows = rowsOf(data, "cadenceDay");
  const cadenceHourRows = rowsOf(data, "cadenceHour");
  const titleRows = rowsOf(data, "titlePatterns");

  /* ── row extraction (new, Task 1 specs) ──────────────────────────────────*/
  const durationBucketRows = rowsOf(data, "durationBuckets");
  const tagAnalysisRows = rowsOf(data, "tagAnalysis");
  const uploadCadenceRow = rowsOf(data, "uploadCadence")[0] || null;
  const topVideosByViewsRows = rowsOf(data, "topVideosByViews");
  const topVideosByEngagementRows = rowsOf(data, "topVideosByEngagement");
  const engagementOverallRow = rowsOf(data, "engagementOverall")[0] || null;

  const snapshotDate = overview?.snapshot_date ?? null;
  const noSnapshotYet = !loading && overviewRows.length === 0 && !errOf(data, "overview");

  /* Fatal — every query failed. */
  if (error && !overview && !loading) {
    return (
      <article className="ed-article">
        <header className="ed-set">
          <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
            ← BACK TO INDEX
          </Link>
          <h1 className="ed-headline mt-6 mb-3" style={{ fontSize: "clamp(34px,6vw,56px)" }}>
            We couldn’t set <em>The FRA Weekly</em>.
          </h1>
          <p className="ed-prose-italic" style={{ color: ED_RUST }}>{error}</p>
        </header>
      </article>
    );
  }

  /* ── derived chart-ready series (moved verbatim from the old render body) ─*/
  const growthSeries = cumulativeRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: Number(r.total_views) || 0,
    cumulative: Number(r.cumulative_views) || 0,
  }));
  const channelByMonth = {};
  for (const r of channelSnapshotRows) {
    const m = String(r.snapshot_date ?? "").slice(0, 7);
    if (m) channelByMonth[m] = Number(r.total_views) || 0;
  }
  const growthSeriesWithReal = growthSeries.map((d) => ({
    ...d,
    real: channelByMonth[d.month] != null ? channelByMonth[d.month] : null,
  }));
  const hasRealTrend = Object.keys(channelByMonth).length > 0;

  const trend = computeTrend(overviewRows);

  const distBuckets = (() => {
    if (!videoViewsRows || videoViewsRows.length === 0) return [];
    const BUCKETS = [
      { label: "0–99", min: 0, max: 100 },
      { label: "100–499", min: 100, max: 500 },
      { label: "500–999", min: 500, max: 1000 },
      { label: "1K–4.9K", min: 1000, max: 5000 },
      { label: "5K–9.9K", min: 5000, max: 10000 },
      { label: "10K–49K", min: 10000, max: 50000 },
      { label: "50K+", min: 50000, max: Infinity },
    ];
    const counts = BUCKETS.map((b) => ({ bucket: b.label, count: 0 }));
    for (const row of videoViewsRows) {
      const v = Number(row.views) || 0;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (v >= BUCKETS[i].min && v < BUCKETS[i].max) { counts[i].count++; break; }
      }
    }
    return counts;
  })();

  const ladder = distRow
    ? [
        { tier: "≥ 1K views", count: Number(distRow.videos_ge_1k) || 0 },
        { tier: "≥ 10K views", count: Number(distRow.videos_ge_10k) || 0 },
        { tier: "≥ 100K views", count: Number(distRow.videos_ge_100k) || 0 },
      ]
    : [];

  const breakoutRate =
    distRow && distRow.breakout_1k_rate != null ? Number(distRow.breakout_1k_rate) * 100 : null;

  const categoryScatter = categoryRows.map((r) => ({
    category: r.category,
    videos: Number(r.video_count) || 0,
    avgViews: Number(r.avg_views) || 0,
    vsMean: r.perf_vs_mean_pct != null ? Number(r.perf_vs_mean_pct) : null,
  }));

  const engRaw = engagementRows.map((r) => ({
    bucket: r.bucket,
    rate: Number(r.engagement_rate_pct) || 0,
  }));
  const engMean = engRaw.length > 0 ? engRaw.reduce((a, r) => a + r.rate, 0) / engRaw.length : 0;
  const engagementSeries = engRaw
    .map((r) => ({ ...r, diff: Math.round((r.rate - engMean) * 100) / 100 }))
    .sort((a, b) => b.diff - a.diff);

  const cadenceDaySeries = cadenceDayRows.map((r) => ({ bucket: r.bucket, avgViews: Number(r.avg_views) || 0 }));
  const cadenceHourSeries = cadenceHourRows.map((r) => ({ bucket: r.bucket, avgViews: Number(r.avg_views) || 0 }));
  const titleSeries = titleRows
    .map((r) => ({ pattern: r.pattern, avgViews: Number(r.avg_views) || 0, videos: Number(r.video_count) || 0 }))
    .slice(0, 9);

  const animProps = reduced
    ? { isAnimationActive: false }
    : { isAnimationActive: true, animationDuration: CHART_ANIM_MS, animationEasing: "ease-out" };

  /* ── shared tab props ────────────────────────────────────────────────────*/
  const commonProps = { reduced, loading, animProps, data };
  const tabProps = {
    overview: {
      ...commonProps, overview, trend, catalogRow, distRow, breakoutRate, ladder, distBuckets,
      growthSeries, growthSeriesWithReal, hasRealTrend, categoryScatter, categoryRows,
      engagementSeries, engMean, cadenceDaySeries, cadenceHourSeries, titleSeries,
      insightsState, onNavigate,
    },
    "reach-growth": {
      ...commonProps, distRow, breakoutRate, ladder, distBuckets,
      growthSeries, growthSeriesWithReal, hasRealTrend, catalogRow, monthlyRows,
    },
    "content-format": {
      ...commonProps, categoryScatter, categoryRows, durationBucketRows,
      topVideosByViewsRows, topVideosByEngagementRows,
    },
    audience: {
      ...commonProps, engagementSeries, engMean, engagementOverallRow, durationBucketRows,
    },
    "cadence-seo": {
      ...commonProps, cadenceDaySeries, cadenceHourSeries, titleSeries, uploadCadenceRow, tagAnalysisRows,
    },
    "ai-insights": { insightsState },
  };

  const TabComponent = {
    overview: OverviewTab,
    "reach-growth": ReachGrowthTab,
    "content-format": ContentFormatTab,
    audience: AudienceTab,
    "cadence-seo": CadenceSeoTab,
    "ai-insights": InsightsTab,
  }[activeTab];

  return (
    <article className="ed-article">
      {/* ════════ MASTHEAD (persistent above the tab strip) ═════════════════ */}
      <header className="ed-set">
        <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
          ← BACK TO INDEX
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ed-caption mb-2">A CHANNEL REVIEW · INTERNAL EDITION</p>
            <h1 className="ed-masthead" style={{ fontSize: "clamp(56px, 11.5vw, 132px)" }}>
              The FRA<br/>Weekly.
            </h1>
          </div>
          <p className="ed-section-no" style={{ fontSize: "clamp(16px, 2.6vw, 26px)" }}>
            one channel,<br/>
            <em style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 80" }}>read closely</em>
          </p>
        </div>
        <hr className="ed-rule-double mt-5" />
        <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>VOL. I</span><span>·</span>
          <span>NO. 01</span><span>·</span>
          <span>{overview?.channel_name ? String(overview.channel_name).toUpperCase() : "FRA YOUTUBE"}</span>
          {overview?.channel_handle && (<><span>·</span><span>{overview.channel_handle}</span></>)}
          <span>·</span>
          <span>AS OF {snapshotDate ? fmtDate(snapshotDate).toUpperCase() : "—"}</span>
          {loading && (
            <>
              <span>·</span>
              <span className="ed-prose-italic inline-flex items-center gap-1.5" style={{ color: ED_INK_FAINT }}>
                <span className="ed-skeleton" style={{ width: "0.4em", height: "0.4em", borderRadius: "50%" }} aria-hidden />
                ON THE PRESSES
              </span>
            </>
          )}
        </p>
        <TabStrip active={activeTab} onSelect={onNavigate} />
      </header>

      {/* ════════ ACTIVE TAB ════════════════════════════════════════════════ */}
      {noSnapshotYet ? (
        <RevealSection reduced={reduced} className="mt-12">
          <EmptyPlate>
            No snapshots yet — the first daily refresh has not run. The report sets
            itself once the FRA channel has been crawled.
          </EmptyPlate>
        </RevealSection>
      ) : (
        <div className="mt-2">
          <TabComponent {...tabProps[activeTab]} />
        </div>
      )}

      {/* ════════ COLOPHON ══════════════════════════════════════════════════ */}
      <footer className="mt-16">
        <hr className="ed-rule" />
        <p className="ed-byline mt-4 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 12 }}>
          <span>
            Figures are drawn from the latest committed snapshot
            {snapshotDate ? ` of ${fmtDate(snapshotDate)}` : ""}. The cumulative-views
            series is a library-accumulation proxy — see the Growth section.
          </span>
          <span>·</span>
          <span>© Grip Invest 2026 · Internal use only.</span>
        </p>
      </footer>
    </article>
  );
}
```

- [ ] **Step 2: Verify nothing else still imports the old internals**

The old file exported only the default component, and `dashboards/index.js` imports it by default — no named imports to fix. Confirm with: `cd frontend && grep -rn "FraYoutubeDashboardEditorial" --include=*.js --include=*.jsx app components lib` — expect only `dashboards/index.js` (the default import) and no references to the removed inline `DiscoverySection` / `AiInsights` / primitives.

- [ ] **Step 3: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS — the full editorial dashboard now compiles as a shell + six tab modules + primitives + helpers.

- [ ] **Step 4: Manual visual check**

Run `cd frontend && pnpm dev`, open the FRA YouTube project in editorial mode, and verify at **375px first** then desktop:
- Masthead renders and stays above the tab strip; the strip scrolls horizontally at 375px with all six tabs reachable.
- Each tab renders: Overview shows all sections + the "connects to" links navigate; Reach & Growth shows the percentile ladder + monthly MoM table; Content & Format shows duration buckets + both leaderboards; Audience shows the like/comment split + engagement-by-duration; Cadence & SEO shows upload pacing + tag analysis; AI Insights shows the full grid.
- Switching tabs scrolls to top; the active tab is highlighted in the strip.
- The empty state (`noSnapshotYet`) and the fatal-error state still render.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboards/FraYoutubeDashboardEditorial.jsx
git commit -m "feat: convert FRA editorial dashboard to a six-tab shell"
```

---

## Self-Review

**Spec coverage** (against §4 of `2026-05-19-fra-metric-coverage-expansion-design.md`):

- **§4.1 Navigation** — six fixed-order tabs (Overview · Reach & Growth · Content & Format · Audience · Cadence & SEO · AI Insights) → `TABS` const, Task 10 ✓. "Weekly"-idiom tab strip (mono labels, ruled, `ed-section-link` rail) → `TabStrip`, Task 10 ✓. Masthead persistent above the tab bar → shell `<header>` with `<TabStrip>` inside it, Task 10 ✓.
- **§4.2 File organization** — thin shell → Task 10 (1449 → ~350 lines) ✓. `fra/helpers.js` theme-agnostic utility only → Task 2 ✓. `fra/editorial/` six tab components → Tasks 4–9 ✓. `fraYoutube.js` stays the single shared data layer + new specs → Task 1 ✓. No cross-theme sharing → all new code is under `fra/editorial/` or theme-agnostic in `helpers.js`; the File-Structure decision section documents why `primitives.jsx` exists and stays editorial-namespaced ✓.
- **§4.3 Tab contents:**
  - Overview = whole report at current depth, AI condensed to verdict + top-3, each section links to its deep-dive → Task 4 (`OverviewTab`, `TabConnect`, `OverviewInsightsCondensed`) ✓.
  - Reach & Growth = Discovery + Growth + Catalog health in full + percentile ladder + monthly MoM → Task 5 ✓.
  - Content & Format = Content fit in full + duration buckets + per-video leaderboards → Task 6 ✓.
  - Audience = Engagement in full + like/comment split + engagement by duration → Task 7 ✓.
  - Cadence & SEO = Cadence + Titles & SEO in full + upload cadence + tag analysis → Task 8 ✓.
  - AI Insights = full verdict + strengths/weaknesses/recommendations → Task 9 (`InsightsTab` wrapping `AiInsights`) ✓.
- **§4.4 New data-layer query specs** — `durationBuckets`, `tagAnalysis`, `uploadCadence` (`SELECT * … latest`), `topVideosByViews` (`ORDER BY views DESC LIMIT 10`), `topVideosByEngagement` (`ORDER BY (likes+comments)/NULLIF(views,0) DESC`), `engagementOverall` (`dimension='overall'`) → Task 1 ✓. `distribution` left unchanged (already `SELECT *`) → noted in Task 1 ✓.

**Net-new UI carries full code:** percentile ladder (Task 5), monthly detail with MoM (Task 5), duration-bucket chart (Task 6), both leaderboards (Task 6), like/comment split (Task 7), engagement-by-duration (Task 7), upload cadence stats (Task 8), tag-frequency/SEO analysis (Task 8) — every one has complete JSX following the existing `Figure`/`Exhibit`/`LedgerTable` patterns.

**Relocated code carries precise instructions:** every moved section names its source line range in the pre-restructure `FraYoutubeDashboardEditorial.jsx` and its destination function signature. Sections reused by two editorial tabs (Discovery, Growth, Catalog health, Content fit, Engagement, Cadence, Titles & SEO) are defined once as `export function`s in their deep-dive tab and imported by `OverviewTab` — DRY within the editorial theme, no theme boundary crossed.

**Build stays green at every commit:** Tasks 1–9 add unreferenced modules (data specs / helpers / primitives / tab files); Task 10 wires them. Each frontend-touching task ends with an explicit `cd frontend && pnpm build` step; Task 10 adds the manual 375px + desktop visual pass.

**No JSX unit tests** — per repo convention and spec §7; verification is `pnpm build` + manual visual check.

**Out of scope (correctly excluded):** the classic dashboard restructure (separate later plan), backend transforms (Task 1 / `2026-05-19-fra-backend-metrics.md`, already merged), the Wint Wealth competitive channel (spec §6).
