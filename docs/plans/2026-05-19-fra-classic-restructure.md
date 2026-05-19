# FRA Classic Dashboard — Tab Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the classic FRA YouTube dashboard from a single 1095-line scroll into a thin shell that renders six fixed-order tabs — **Overview · Reach & Growth · Content & Format · Audience · Cadence & SEO · AI Insights** — using the existing `@/components/ui` `Tabs`. Surface the expanded metric coverage (duration buckets, tag/SEO analysis, upload cadence, percentile ladder, per-video leaderboards, like/comment split, monthly detail) that the already-merged backend tables and the already-merged `fraYoutube.js` query specs now make available. The classic restructure is the symmetric twin of the editorial restructure (`2026-05-19-fra-editorial-restructure.md`, already executed and merged) — same tab set, same tab content, the classic design system instead of the editorial one.

**Architecture:** The data layer is unchanged — `fraYoutube.js` already carries the six query specs (`durationBuckets`, `tagAnalysis`, `uploadCadence`, `topVideosByViews`, `topVideosByEngagement`, `engagementOverall`) added by the editorial plan's Task 1; this plan consumes them, adds none. The mega-file `FraYoutubeDashboard.jsx` becomes a thin shell — it owns `useFraYoutube` + `useFraInsights`, derives the chart-ready series, and renders `@/components/ui` `Tabs`/`TabList`/`Tab`/`TabPanel` with the six fixed-order tabs. Theme-agnostic formatters are reused from the existing `fra/helpers.js`; the classic *rendering* primitives (`SectionHeading`, `Section`, `StatStripSkeleton`, `MiniBar`, `DeltaChip`, `DeltaLine`, `DualDelta`, `deltaFmt`, `discoveryVerdictBadge`, `useFraInsights`, `bucketViews`, `VIEW_BUCKETS`, `AiInsightsCard`, `insightItemText`, `InsightColumn`, the classic-only formatters) move to a new `fra/classic/primitives.jsx`; the six tabs become `fra/classic/*Tab.jsx`. Each tab is a pure presentational component fed the rows it needs as props by the shell.

**Tech Stack:** Next.js (App Router), React 18, Recharts, Tailwind. Classic design system — `@/components/ui` (`Card`/`CardHeader`/`CardTitle`/`CardSubtitle`/`CardBody`/`Badge`/`Stat`/`StatStrip`/`Skeleton`), `@/components/charts` (`ChartCard`/`TooltipBox`/`axisProps`/`gridProps`), navy/teal tokens from `@/lib/tokens` (`color`, `chartPalette`), Inter / IBM Plex Mono. Build tool `pnpm`. No JSX unit tests (repo convention, spec §7) — verification is `pnpm build` plus manual visual checks at 375px and desktop.

**Scope:** The **classic** dashboard only (spec §4). The editorial restructure and the backend metrics are done and merged — the six `fraYoutube.js` query specs and the backend tables (`fra_youtube__duration_buckets`, `fra_youtube__tag_analysis`, `fra_youtube__upload_cadence`, the extended `fra_youtube__distribution`) already exist. This plan adds **no** query specs and **no** backend work; it only restructures the classic frontend. The Wint Wealth competitive channel and the locked Retention panel are out of scope (spec §6) — the Retention panel is carried forward unchanged on the Overview tab.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/lib/queries/fraYoutube.js` | shared data layer — SQL specs + `useFraYoutube` hook | **No change** — the six new specs already exist (editorial plan, merged) |
| `frontend/components/dashboards/fra/helpers.js` | theme-agnostic utilities — `nf`, `fmt`, `pct1`, `compact`, `fmtDate`, `fmtMonth` | **No change** — already exists; the classic tabs import its formatters |
| `frontend/components/dashboards/fra/classic/primitives.jsx` | shared classic **rendering** primitives — `SectionHeading`, `Section`, `StatStripSkeleton`, `MiniBar`, `DeltaChip`, `deltaFmt`, `DeltaLine`, `DualDelta`, `discoveryVerdictBadge`, `useFraInsights`, `VIEW_BUCKETS`, `bucketViews`, `AiInsightsCard`, `insightItemText`, `InsightColumn`, and the classic-only formatters `toNum`, `pct`, `fmtDuration` | **Create** |
| `frontend/components/dashboards/fra/classic/OverviewTab.jsx` | Tab 1 — the whole current single-scroll report (every section at current depth) + the locked Retention panel; AI condensed to verdict + top-3 actions; each section links to its deep-dive tab | **Create** |
| `frontend/components/dashboards/fra/classic/ReachGrowthTab.jsx` | Tab 2 — Discovery + Growth + Catalog health in full, plus percentile ladder + monthly detail with MoM % | **Create** |
| `frontend/components/dashboards/fra/classic/ContentFormatTab.jsx` | Tab 3 — Content fit in full, plus duration-bucket performance + per-video leaderboards | **Create** |
| `frontend/components/dashboards/fra/classic/AudienceTab.jsx` | Tab 4 — Engagement in full, plus like-rate vs comment-rate split + engagement by duration | **Create** |
| `frontend/components/dashboards/fra/classic/CadenceSeoTab.jsx` | Tab 5 — Cadence + Titles & SEO in full, plus upload cadence & gap stats + tag-frequency/SEO analysis | **Create** |
| `frontend/components/dashboards/fra/classic/InsightsTab.jsx` | Tab 6 — full AI verdict + strengths / weaknesses / recommendations | **Create** |
| `frontend/components/dashboards/FraYoutubeDashboard.jsx` | thin shell — masthead + `@/components/ui` Tabs + active-tab render; owns `useFraYoutube` + `useFraInsights`, derives chart-ready series, passes props down | **Rewrite** (1095 → ~330 lines) |

### File-structure decision (justifies the spec §4.2 deviation)

Spec §4.2's tree is illustrative — it names `fra/helpers.js` and `fra/classic/*Tab.jsx` but does **not** name a home for the classic *rendering* primitives. Those primitives (`SectionHeading`, `Section`, `StatStripSkeleton`, `MiniBar`, `DeltaChip`, `DeltaLine`, `DualDelta`, `discoveryVerdictBadge`, `AiInsightsCard`, `InsightColumn`) are used by **every** classic tab and are unambiguously rendering code — they import `@/components/ui` and `@/lib/tokens` — so they cannot live in `helpers.js`, which the spec explicitly says is "per-theme-agnostic utility only … not rendering". This mirrors the editorial restructure exactly: that plan created `fra/editorial/primitives.jsx` for the editorial rendering primitives. The classic plan creates the symmetric `fra/classic/primitives.jsx`.

Two-file split:

- **`fra/helpers.js`** — already exists, theme-agnostic. Its formatters `fmt`, `pct1`, `compact`, `fmtMonth` are reused by the classic tabs directly. `fmtDate` is editorial-only in practice but harmless to leave; the classic shell does not need it. No React, no JSX. **Not modified by this plan.**
- **`fra/classic/primitives.jsx`** — every classic-themed rendering primitive and the classic-only formatters. New file, explicitly classic-namespaced (`fra/classic/`), so the no-cross-theme-sharing rule (spec §4.2) holds: editorial has its own `fra/editorial/primitives.jsx`, classic gets its own. There is **no** cross-theme primitive sharing — the editorial and classic dashboards remain genuinely separate renderings.

The classic-only formatters `toNum`, `pct`, `fmtDuration` (defined inline in the current `FraYoutubeDashboard.jsx:33-65`) are **not** promoted to `helpers.js`: `pct` and `fmtDuration` duplicate logic the editorial side renders differently, and `toNum` is a classic-specific null-coercion idiom. They ship in `classic/primitives.jsx` alongside the rendering primitives — the same judgment call the editorial plan made for `useFraInsights`. `fmt`, `pct1`, `compact`, `fmtMonth` are genuinely shared and come from `helpers.js`; the classic `nf`/`fmt`/`compact`/`fmtMonth` inline definitions are dropped (they are byte-identical to `helpers.js`).

`useFraInsights` is logically theme-agnostic but both `primitives.jsx` files now ship their own copy (editorial chose this); classic `primitives.jsx` keeps its own copy too — promoting it to `helpers.js` would be a cross-theme refactor outside this plan's scope.

### Tab data-prop contract

The shell owns both hooks (`useFraYoutube`, `useFraInsights`) and all derived series, and passes each tab exactly what it renders. All `*Rows` props are arrays; scalar `*Row` props are `null` when absent.

- **Common to every data tab:** `loading` (bool), `data` (the raw `useFraYoutube` data object — for `errOf` lookups).
- **OverviewTab:** `loading`, `data`, `overview`, `trend`, `distRow`, `catalogRow`, `distBuckets`, `growthWithReal`, `hasRealTrend`, `monthlySeries`, `contentSeries`, `categoryRows`, `engagementSeries`, `engMean`, `cadenceDaySeries`, `cadenceHourSeries`, `titleRows`, `titleMax`, `insightsState`, `onNavigate` (fn — switches the active tab).
- **ReachGrowthTab:** `loading`, `data`, `distRow`, `distBuckets`, `growthWithReal`, `hasRealTrend`, `monthlySeries`, `monthlyRows`, `catalogRow`.
- **ContentFormatTab:** `loading`, `data`, `contentSeries`, `categoryRows`, `durationBucketRows`, `topVideosByViewsRows`, `topVideosByEngagementRows`.
- **AudienceTab:** `loading`, `data`, `engagementSeries`, `engMean`, `engagementOverallRow`, `durationBucketRows`.
- **CadenceSeoTab:** `loading`, `data`, `cadenceDaySeries`, `cadenceHourSeries`, `titleRows`, `titleMax`, `uploadCadenceRow`, `tagAnalysisRows`.
- **InsightsTab:** `insightsState`.

---

## Task ordering rationale

Tasks are sequenced so the build stays green at every commit and **no section is ever moved twice** — mirroring the editorial plan's proven ordering:

1. **Task 1** creates `fra/classic/primitives.jsx` — a pure module extraction with no behavior change; nothing imports it yet so the build stays green. It must exist before any tab file imports it. (There is no data-layer task: the six query specs already exist.)
2. **Tasks 2–5** create the four deep-dive tabs — ReachGrowth, Content & Format, Audience, Cadence & SEO. Each extracts the shared section(s) it owns **directly from the original, still-intact `FraYoutubeDashboard.jsx`** (by the precise line ranges given), defining them as `export function`s, and adds its net-new UI. The original mega-file is not rewritten until Task 7, so extracting from it here is valid. Each tab file lands as an unreferenced module — the build compiles it but renders nothing, staying green.
3. **Task 6 builds OverviewTab** — pure composition. It *imports* the shared section `export function`s from the four deep-dive tabs (which now exist), then adds only the Overview-only pieces: the "At a glance" section, the `TabConnect` deep-dive-link primitive, the condensed AI block, and the locked Retention panel. No shared section is defined in OverviewTab, so nothing it touches is ever moved a second time.
4. **Task 7 builds InsightsTab** — the smallest, a thin wrapper over `AiInsightsCard`.
5. **Task 8** rewrites `FraYoutubeDashboard.jsx` into the shell that wires everything together. This is the only task that changes what users see; it lands last so the dashboard never renders a half-built tab set.

The build stays green because Tasks 1–7 add unreferenced modules and Task 8 wires them. Net-new sections carry full classic-design code; relocated sections are moved verbatim with precise line ranges given.

---

## Task 1: Create `fra/classic/primitives.jsx` — shared classic rendering primitives

**Files:**
- Create: `frontend/components/dashboards/fra/classic/primitives.jsx`

This file collects every classic rendering primitive and the classic-only formatters currently inline in `FraYoutubeDashboard.jsx`. The code is lifted **verbatim** from the existing file at the noted line ranges, with the shared formatters (`fmt`, `pct1`, `compact`, `fmtMonth`) now imported from `helpers.js` instead of defined locally.

- [ ] **Step 1: Create the primitives module**

Create `frontend/components/dashboards/fra/classic/primitives.jsx`. Start with this header and imports:

```jsx
"use client";
/**
 * Shared classic rendering primitives for the FRA YouTube dashboard tabs.
 *
 * The numbered section frame (`SectionHeading`, `Section`), the StatStrip
 * skeleton, the magnitude `MiniBar`, the delta chips/lines, the discovery
 * verdict badge, the AI-insights blocks, and the classic-only formatters.
 * Every classic FRA tab imports from here. Theme-agnostic formatters live
 * separately in `fra/helpers.js`.
 *
 * Lifted verbatim from the pre-restructure FraYoutubeDashboard.jsx; the only
 * change is that `fmt`/`compact` now resolve to the `helpers.js` exports.
 */

import * as React from "react";
import { fetchFraInsights } from "@/lib/api";
import {
  Card, CardBody, Badge, Skeleton,
} from "@/components/ui";
import { fmt } from "../helpers";
```

Then append, in this order, lifting **verbatim** from `FraYoutubeDashboard.jsx` (only the change noted per block):

1. **`toNum`** — lines 33-34. Classic-only null-coercion. Add `export`.
2. **`pct`** — lines 35-36. Classic-only. Add `export`.
3. **`fmtDuration`** — lines 59-65. Classic-only. Add `export function` (currently `const`; keep it `const` with `export`).
4. **`SectionHeading`** — lines 70-80. Add `export function`.
5. **`Section`** — lines 83-90. Add `export function`.
6. **`StatStripSkeleton`** — lines 95-106. Add `export function`.
7. **`MiniBar`** — lines 109-119. Add `export function`.
8. **`DeltaChip`** — lines 123-133. Add `export function`. References `fmt` (now the `helpers.js` import) and `Badge` (in-file import).
9. **`deltaFmt`** — lines 136-141. Add `export`. References `fmt`.
10. **`DeltaLine`** — lines 146-164. Add `export function`. Default param `format = fmt` now resolves to the imported `fmt`.
11. **`DualDelta`** — lines 168-186. Add `export function`.
12. **`discoveryVerdictBadge`** — lines 189-197. Add `export function`. References `Badge`.
13. **`useFraInsights`** — lines 202-225. Add `export function`. References `fetchFraInsights`.
14. **`VIEW_BUCKETS`** — lines 230-238. Add `export const`.
15. **`bucketViews`** — lines 240-253. Add `export function`. References `VIEW_BUCKETS`.
16. **`AiInsightsCard`** — lines 1000-1053. Add `export function`. References `Card`, `CardBody`, `Skeleton`, `InsightColumn`.
17. **`insightItemText`** — lines 1058-1072. Add `export function`.
18. **`InsightColumn`** — lines 1074-1094. Add `export function`. References `insightItemText`.

Drop the inline `nf`/`fmt`/`compact`/`fmtMonth` definitions (lines 28-29, 38-56) — they are byte-identical to the `helpers.js` exports; the consuming tabs import `fmt`/`compact`/`fmtMonth` from `helpers.js`.

Every block is moved unchanged except for the `export` keyword and the `fmt` resolution. `SectionHeading`, `Section`, `StatStripSkeleton`, `MiniBar` reference only Tailwind classes, `Skeleton`, and React — all in-file or imported.

- [ ] **Step 2: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. (Unreferenced module — confirms every primitive parses and `fmt` resolves.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/fra/classic/primitives.jsx
git commit -m "feat: extract FRA classic rendering primitives into primitives.jsx"
```

---

## Task 2: Create `classic/ReachGrowthTab.jsx` — Discovery + Growth + Catalog + new depth

**Files:**
- Create: `frontend/components/dashboards/fra/classic/ReachGrowthTab.jsx`

Reach & Growth = Discovery + Growth + Catalog health in full, plus the percentile ladder and the monthly detail table with MoM %.

- [ ] **Step 1: Scaffold the file**

Create `frontend/components/dashboards/fra/classic/ReachGrowthTab.jsx`:

```jsx
"use client";
/**
 * ReachGrowthTab — Tab 2 of the FRA classic dashboard.
 *
 * Discovery + Growth + Catalog health in full (extracted verbatim from the
 * original mega-file as DiscoverySection / GrowthSection / CatalogHealthSection
 * — exported so OverviewTab can import them), plus two net-new sections: the
 * percentile ladder and the monthly detail table with MoM %.
 */

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart,
  Area, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";
import { fmt, pct1, compact, fmtMonth } from "../helpers";
import {
  Section, StatStripSkeleton, DeltaChip, discoveryVerdictBadge, pct,
} from "./primitives";
```

- [ ] **Step 2: Extract the Discovery, Growth and Catalog sections from the original file**

These three sections are *also* rendered in OverviewTab. Per spec §4.2 the classic theme has no cross-theme sharing, but **within the classic theme** a section reused by two tabs should be defined once. ReachGrowthTab owns them: define them here as `export function`s, lifted **directly from the original, still-intact `FraYoutubeDashboard.jsx`** at the noted line ranges (the file is not rewritten until Task 8). OverviewTab (Task 6) imports them from here — `import { DiscoverySection, GrowthSection, CatalogHealthSection } from "./ReachGrowthTab";`.

The classic file uses a `<Section index={N} title=… deck=…>` wrapper around each block. To make the same section render under two different numbers (Overview numbers 1–9, Reach & Growth numbers 1–5), make `index`, `title` and `deck` props of each `*Section` function rather than hard-coding them. Each `*Section` returns its `<Section …>` wrapper plus the body, exactly as the original did.

- Extract the §02 Discovery section — original `FraYoutubeDashboard.jsx` lines 473-557 (the whole `<Section index={2} …>…</Section>` block) — into `export function DiscoverySection({ index, loading, data, distRow, distBuckets })`, verbatim, with `index` made a prop and `title`/`deck` hard-coded inside (they are fixed strings — `title="Discovery"`, the deck from line 477). The body references `loading`, `errOf(data, "distribution")`, `errOf(data, "videoViews")`, `distRow`, `distBuckets` — all now props.
- Extract the §03 Growth section — original lines 559-656 (`<Section index={3} …>…</Section>`) — into `export function GrowthSection({ index, loading, data, growthWithReal, hasRealTrend, monthlySeries })`, verbatim, `index` a prop. The body references `loading`, `errOf(data, "cumulativeViews")`, `errOf(data, "monthlyViews")`, `growthWithReal`, `hasRealTrend`, `monthlySeries`.
- Extract the §08 Catalog health section — original lines 921-968 (`<Section index={8} …>…</Section>`) — into `export function CatalogHealthSection({ index, loading, data, catalogRow })`, verbatim, `index` a prop. The body references `loading`, `errOf(data, "catalogHealth")`, `catalogRow`. `DeltaChip` and `pct` are imported from `primitives.jsx`.

This keeps the classic report DRY across its own tabs without crossing the theme boundary; each section is extracted once, by the tab that owns it.

- [ ] **Step 3: Build the percentile-ladder section (net-new)**

The extended `distribution` row now carries `p25_views`, `p75_views`, `p95_views`, `mean_median_ratio`, `top10pct_view_share` (plus the existing `p10_views`, `p50_views`, `p90_views`, `gini`). Net-new UI — a full percentile ladder in the classic idiom, a `Card` of ruled rungs plus a `StatStrip` of the concentration read-outs. Add as a file-local function:

```jsx
/* The full percentile ladder — P10/P25/P50/P75/P90/P95 of per-video views as a
   ruled list of magnitude bars, plus the two concentration read-outs. Net-new
   in the restructure; reads the five extended distribution columns. */
function PercentileLadderSection({ index, loading, error, distRow }) {
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
    <Section
      index={index}
      title="The percentile ladder"
      deck="Where a video lands in the library by lifetime views — the full distribution from the quiet tenth percentile to the breakout ninety-fifth."
    >
      <Card pad="md">
        <CardHeader>
          <CardTitle>View distribution percentiles</CardTitle>
          <CardSubtitle>Per-video lifetime views at each percentile of the library</CardSubtitle>
        </CardHeader>
        <CardBody>
          {error ? (
            <p className="t-body-sm text-error-600">Could not load the distribution.</p>
          ) : loading ? (
            <Skeleton className="h-48 w-full" />
          ) : rungs.length === 0 ? (
            <p className="t-body-sm text-tertiary">No distribution data for the current snapshot.</p>
          ) : (
            <ul className="divide-y divide-border-default">
              {rungs.map((r, i) => {
                const w = Math.max(2, Math.round((r.value / top) * 100));
                return (
                  <li key={r.label} className="flex items-center gap-4 py-3">
                    <span className="t-overline text-tertiary w-28 shrink-0">{r.label}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-neutral-200">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${w}%`, background: chartPalette[0] }}
                      />
                    </div>
                    <span className="t-num text-heading t-emphasis-sm w-24 shrink-0 text-right">
                      {fmt(r.value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card pad="md">
        {loading ? (
          <StatStripSkeleton count={3} />
        ) : error ? (
          <p className="t-body-sm text-error-600">Could not load this section.</p>
        ) : !distRow ? (
          <p className="t-body-sm text-tertiary">No distribution data.</p>
        ) : (
          <StatStrip>
            <Stat
              label="Mean / median ratio"
              value={distRow.mean_median_ratio != null ? Number(distRow.mean_median_ratio).toFixed(2) : "—"}
              hint="above 1 means a few hits pull the mean up"
            />
            <Stat
              label="Top-10% view share"
              value={
                distRow.top10pct_view_share != null
                  ? pct1(Number(distRow.top10pct_view_share) * 100)
                  : "—"
              }
              hint="share of all views held by the top tenth of videos"
            />
            <Stat
              label="Gini coefficient"
              value={distRow.gini != null ? Number(distRow.gini).toFixed(3) : "—"}
              hint="0 even · 1 concentrated"
            />
          </StatStrip>
        )}
      </Card>
    </Section>
  );
}
```

- [ ] **Step 4: Build the monthly-detail section (net-new)**

A classic table over `monthlyRows` with a client-computed month-over-month %. Add as a file-local function:

```jsx
/* Monthly detail — video count and average views per calendar month, with the
   month-over-month change computed client-side. Net-new in the restructure;
   the monthly_views table already carries video_count + avg_views. */
function MonthlyDetailSection({ index, loading, error, monthlyRows }) {
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
    <Section
      index={index}
      title="Monthly detail"
      deck="Every calendar month of uploads — how many videos shipped, the views they earned, and the swing against the month before."
    >
      <Card pad="md">
        <CardHeader>
          <CardTitle>Views by month, with MoM change</CardTitle>
          <CardSubtitle>Sorted oldest to newest</CardSubtitle>
        </CardHeader>
        <CardBody>
          {error ? (
            <p className="t-body-sm text-error-600">Could not load monthly detail.</p>
          ) : loading ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="t-body-sm text-tertiary">No monthly data for the current snapshot.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="py-2 pr-4 text-left t-overline text-tertiary">Month</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Total views</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Avg / video</th>
                    <th className="py-2 text-right t-overline text-tertiary">MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border-default last:border-0">
                      <td className="py-2 pr-4 text-body">{fmtMonth(r.month)}</td>
                      <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.video_count)}</td>
                      <td className="py-2 pr-4 text-right t-num text-secondary">{compact(r.total_views)}</td>
                      <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.avg_views)}</td>
                      <td className="py-2 text-right">
                        {r._mom == null ? (
                          <span className="t-num text-tertiary">—</span>
                        ) : (
                          <Badge tone={r._mom >= 0 ? "success" : "error"} variant="soft">
                            {r._mom >= 0 ? "▲" : "▼"} {pct1(Math.abs(r._mom))}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
```

- [ ] **Step 5: Assemble the `ReachGrowthTab` component**

```jsx
export default function ReachGrowthTab({
  loading, data,
  distRow, distBuckets,
  growthWithReal, hasRealTrend, monthlySeries, monthlyRows, catalogRow,
}) {
  return (
    <div className="flex flex-col gap-10">
      <DiscoverySection index={1} loading={loading} data={data}
        distRow={distRow} distBuckets={distBuckets} />
      <PercentileLadderSection index={2} loading={loading}
        error={errOf(data, "distribution")} distRow={distRow} />
      <GrowthSection index={3} loading={loading} data={data}
        growthWithReal={growthWithReal} hasRealTrend={hasRealTrend} monthlySeries={monthlySeries} />
      <MonthlyDetailSection index={4} loading={loading}
        error={errOf(data, "monthlyViews")} monthlyRows={monthlyRows} />
      <CatalogHealthSection index={5} loading={loading} data={data} catalogRow={catalogRow} />
    </div>
  );
}
```

- [ ] **Step 6: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. Manual visual check deferred until the shell wires the tab (Task 8) — note here that the percentile ladder and monthly table must be re-checked at 375px once visible (the monthly table wraps in an `overflow-x-auto` scroller, so wide rows scroll rather than break).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/dashboards/fra/classic/ReachGrowthTab.jsx
git commit -m "feat: add FRA classic ReachGrowthTab with percentile ladder & monthly detail"
```

---

## Task 3: Create `classic/ContentFormatTab.jsx` — Content fit + duration buckets + leaderboards

**Files:**
- Create: `frontend/components/dashboards/fra/classic/ContentFormatTab.jsx`

Content & Format = Content fit in full, plus duration-bucket performance and the two per-video leaderboards.

- [ ] **Step 1: Scaffold the file and extract the Content-fit section**

Create `frontend/components/dashboards/fra/classic/ContentFormatTab.jsx`. Extract the §04 Content fit section **directly from the original, still-intact `FraYoutubeDashboard.jsx`** (lines 658-753 — the diverging `ChartCard` bar chart plus the category-ledger `Card`) into `export function ContentFitSection({ index, loading, data, contentSeries, categoryRows })` here, verbatim, `index` made a prop. OverviewTab (Task 6) imports `ContentFitSection` from this file.

```jsx
"use client";
/**
 * ContentFormatTab — Tab 3 of the FRA classic dashboard.
 *
 * Content fit in full (extracted from the original mega-file as
 * ContentFitSection — exported so OverviewTab can import it), plus two net-new
 * sections: duration-bucket performance and the per-video leaderboards.
 */

import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";
import { fmt, pct1, compact } from "../helpers";
import { Section } from "./primitives";
```

The body of `ContentFitSection` references `loading`, `errOf(data, "categoryMix")`, `contentSeries`, `categoryRows` — all now props. `title="Content fit"` and the deck (original line 662) are hard-coded inside.

- [ ] **Step 2: Build the duration-bucket performance section (net-new)**

Reads `durationBucketRows` (`data.durationBuckets`) — one row per bucket with `bucket`, `video_count`, `avg_views`, `engagement_rate_pct`. A `ChartCard`-framed bar chart of avg views per bucket, with the video count as a bar label. Add as a file-local function:

```jsx
/* Duration-bucket performance — average views per duration bucket. Net-new in
   the restructure; reads the fra_youtube__duration_buckets table. Buckets are
   emitted even when empty so the x-axis is stable. */
function DurationBucketSection({ index, loading, error, durationBucketRows }) {
  const series = (durationBucketRows || []).map((r) => ({
    bucket: r.bucket,
    avgViews: Number(r.avg_views) || 0,
    videos: Number(r.video_count) || 0,
  }));
  return (
    <Section
      index={index}
      title="Format & length"
      deck="How the channel's videos perform by running time — which lengths the audience rewards, and which the channel over-produces."
    >
      <ChartCard
        title="Average views by video length"
        subtitle="Each bar is a duration bucket; its height is the mean views of videos there. The label names how many videos sit in that bucket."
        loading={loading}
        error={error}
        height={280}
        footer="Buckets are upper-bound-inclusive: a 30-second video falls in 0–30s, the final bucket is open-ended."
      >
        {series.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No duration data for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 16, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="bucket" {...axisProps} />
              <YAxis {...axisProps} width={52} tickFormatter={compact} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => fmt(v)} />}
              />
              <Bar
                dataKey="avgViews"
                name="Avg views"
                fill={chartPalette[0]}
                radius={[3, 3, 0, 0]}
                maxBarSize={56}
              >
                <LabelList
                  dataKey="videos"
                  position="top"
                  formatter={(v) => `${v} vid`}
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, fill: color.neutral[500] }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </Section>
  );
}
```

- [ ] **Step 3: Build the per-video leaderboard section (net-new)**

Reads `topVideosByViewsRows` and `topVideosByEngagementRows` — two classic tables inside one `Section`, each in its own `Card`. Add a shared engagement-rate helper and the section:

```jsx
/* Engagement rate of a leaderboard row, as a percentage — (likes+comments)/views. */
function _engRate(r) {
  const views = Number(r.views) || 0;
  if (views === 0) return null;
  return ((Number(r.likes) + Number(r.comments)) / views) * 100;
}

/* A classic leaderboard table — rank, truncated title, category, and the
   numeric columns its caller supplies. */
function LeaderboardTable({ loading, error, rows, valueCols }) {
  if (error) return <p className="t-body-sm text-error-600">Could not load this leaderboard.</p>;
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!rows || rows.length === 0)
    return <p className="t-body-sm text-tertiary">No video data for the current snapshot.</p>;
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-border-default">
            <th className="py-2 pr-3 text-right t-overline text-tertiary">#</th>
            <th className="py-2 pr-4 text-left t-overline text-tertiary">Title</th>
            <th className="py-2 pr-4 text-left t-overline text-tertiary">Category</th>
            {valueCols.map((c) => (
              <th key={c.key} className="py-2 pr-4 text-right t-overline text-tertiary">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-default last:border-0">
              <td className="py-2 pr-3 text-right t-num text-tertiary">{i + 1}</td>
              <td className="py-2 pr-4 text-body">
                <span className="block max-w-[16rem] truncate">{r.title}</span>
              </td>
              <td className="py-2 pr-4 text-secondary">{r.category}</td>
              {valueCols.map((c) => (
                <td key={c.key} className="py-2 pr-4 text-right">{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Per-video leaderboards — the top ten videos by lifetime views and by
   engagement rate. Net-new in the restructure; reads video_snapshots directly
   via the topVideosByViews / topVideosByEngagement query specs. */
function LeaderboardSection({ index, loading, viewsError, engError, topByViews, topByEngagement }) {
  return (
    <Section
      index={index}
      title="The leaderboard"
      deck="The ten videos that reached furthest — first by raw views, then by the rate at which viewers engaged."
    >
      <Card pad="md">
        <CardHeader>
          <CardTitle>Top ten · by views</CardTitle>
          <CardSubtitle>The channel's highest-reach videos</CardSubtitle>
        </CardHeader>
        <CardBody>
          <LeaderboardTable
            loading={loading}
            error={viewsError}
            rows={topByViews}
            valueCols={[
              { key: "views", label: "Views", render: (r) => <span className="t-num text-secondary">{fmt(r.views)}</span> },
              { key: "likes", label: "Likes", render: (r) => <span className="t-num text-secondary">{fmt(r.likes)}</span> },
              { key: "comments", label: "Comments", render: (r) => <span className="t-num text-secondary">{fmt(r.comments)}</span> },
            ]}
          />
        </CardBody>
      </Card>

      <Card pad="md">
        <CardHeader>
          <CardTitle>Top ten · by engagement rate</CardTitle>
          <CardSubtitle>(likes + comments) ÷ views — the videos that landed warmest</CardSubtitle>
        </CardHeader>
        <CardBody>
          <LeaderboardTable
            loading={loading}
            error={engError}
            rows={topByEngagement}
            valueCols={[
              { key: "views", label: "Views", render: (r) => <span className="t-num text-secondary">{fmt(r.views)}</span> },
              {
                key: "_eng", label: "Engagement",
                render: (r) => {
                  const e = _engRate(r);
                  return (
                    <Badge tone="success" variant="soft">
                      {e == null ? "—" : pct1(e)}
                    </Badge>
                  );
                },
              },
            ]}
          />
        </CardBody>
      </Card>
    </Section>
  );
}
```

- [ ] **Step 4: Assemble the `ContentFormatTab` component**

```jsx
export default function ContentFormatTab({
  loading, data,
  contentSeries, categoryRows, durationBucketRows,
  topVideosByViewsRows, topVideosByEngagementRows,
}) {
  return (
    <div className="flex flex-col gap-10">
      <ContentFitSection index={1} loading={loading} data={data}
        contentSeries={contentSeries} categoryRows={categoryRows} />
      <DurationBucketSection index={2} loading={loading}
        error={errOf(data, "durationBuckets")} durationBucketRows={durationBucketRows} />
      <LeaderboardSection index={3} loading={loading}
        viewsError={errOf(data, "topVideosByViews")} engError={errOf(data, "topVideosByEngagement")}
        topByViews={topVideosByViewsRows} topByEngagement={topVideosByEngagementRows} />
    </div>
  );
}
```

- [ ] **Step 5: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. Note: the leaderboard tables and duration chart re-checked at 375px once the shell wires the tab (Task 8) — the tables wrap in an `overflow-x-auto` scroller, so wide rows scroll rather than break.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/fra/classic/ContentFormatTab.jsx
git commit -m "feat: add FRA classic ContentFormatTab with duration buckets & leaderboards"
```

---

## Task 4: Create `classic/AudienceTab.jsx` — Engagement + like/comment split + engagement by duration

**Files:**
- Create: `frontend/components/dashboards/fra/classic/AudienceTab.jsx`

Audience = Engagement in full, plus the like-rate vs comment-rate split and engagement by video duration.

- [ ] **Step 1: Scaffold the file and extract the Engagement section**

Create `frontend/components/dashboards/fra/classic/AudienceTab.jsx`. Extract the §05 Engagement section **directly from the original, still-intact `FraYoutubeDashboard.jsx`** (lines 755-800 — the diverging `ChartCard` bar chart) into `export function EngagementSection({ index, loading, data, engagementSeries, engMean })` here, verbatim, `index` made a prop. OverviewTab (Task 6) imports `EngagementSection` from this file.

```jsx
"use client";
/**
 * AudienceTab — Tab 4 of the FRA classic dashboard.
 *
 * Engagement in full (extracted from the original mega-file as
 * EngagementSection — exported so OverviewTab can import it), plus two net-new
 * sections: the like-rate vs comment-rate split and engagement by video
 * duration.
 */

import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Stat, StatStrip,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";
import { fmt, pct1, compact } from "../helpers";
import { Section, StatStripSkeleton } from "./primitives";
```

The body of `EngagementSection` references `loading`, `errOf(data, "engagement")`, `engagementSeries`, `engMean` — all now props. `title="Engagement"` and the deck (original line 759) are hard-coded inside; the subtitle string keeps its inline `engMean` interpolation.

- [ ] **Step 2: Build the like-rate vs comment-rate split section (net-new)**

Reads `engagementOverallRow` (`data.engagementOverall[0]`) — the `overall`-dimension engagement row carrying `like_rate_pct`, `comment_rate_pct`, `engagement_rate_pct`. A `Card` with two magnitude rows plus a `StatStrip` of derived figures. Add as a file-local function:

```jsx
/* Like-rate vs comment-rate split — the channel-level engagement breakdown
   read as two component rates. Net-new in the restructure; reads the `overall`
   dimension row of fra_youtube__engagement_breakdown. */
function EngagementSplitSection({ index, loading, error, overallRow }) {
  const likeRate = overallRow?.like_rate_pct != null ? Number(overallRow.like_rate_pct) : null;
  const commentRate = overallRow?.comment_rate_pct != null ? Number(overallRow.comment_rate_pct) : null;
  const split = [
    { label: "Like rate", value: likeRate, color: chartPalette[0] },
    { label: "Comment rate", value: commentRate, color: color.teal[600] },
  ].filter((s) => s.value != null);
  const max = split.length ? Math.max(...split.map((s) => s.value), 0.01) : 0.01;
  return (
    <Section
      index={index}
      title="How they respond"
      deck="The channel's engagement split into its two signals — the quiet tap of a like against the higher-effort act of leaving a comment."
    >
      <Card pad="md">
        <CardHeader>
          <CardTitle>Like rate vs comment rate</CardTitle>
          <CardSubtitle>Channel-wide component engagement rates</CardSubtitle>
        </CardHeader>
        <CardBody>
          {error ? (
            <p className="t-body-sm text-error-600">Could not load the engagement split.</p>
          ) : loading ? (
            <StatStripSkeleton count={2} />
          ) : split.length === 0 ? (
            <p className="t-body-sm text-tertiary">No channel-level engagement row for the current snapshot.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {split.map((s) => (
                <li key={s.label} className="flex items-center gap-4">
                  <span className="t-overline text-tertiary w-32 shrink-0">{s.label}</span>
                  <div className="h-2 flex-1 rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(2, Math.round((s.value / max) * 100))}%`, background: s.color }}
                    />
                  </div>
                  <span className="t-num text-heading t-emphasis-sm w-16 shrink-0 text-right">
                    {pct1(s.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card pad="md">
        {loading ? (
          <StatStripSkeleton count={2} />
        ) : error ? (
          <p className="t-body-sm text-error-600">Could not load this section.</p>
        ) : !overallRow ? (
          <p className="t-body-sm text-tertiary">No channel-level engagement row.</p>
        ) : (
          <StatStrip>
            <Stat
              label="Overall engagement"
              value={overallRow.engagement_rate_pct != null ? pct1(overallRow.engagement_rate_pct) : "—"}
              hint="likes + comments over views, channel-wide"
            />
            <Stat
              label="Like-to-comment ratio"
              value={
                likeRate != null && commentRate != null && commentRate !== 0
                  ? `${(likeRate / commentRate).toFixed(1)} : 1`
                  : "—"
              }
              hint="likes earned per comment"
            />
          </StatStrip>
        )}
      </Card>
    </Section>
  );
}
```

- [ ] **Step 3: Build the engagement-by-duration section (net-new)**

Reads `durationBucketRows` — the same `fra_youtube__duration_buckets` rows used by Content & Format, but here read on `engagement_rate_pct` instead of `avg_views`. A `ChartCard`-framed bar chart. Add as a file-local function:

```jsx
/* Engagement by video duration — the engagement_rate_pct column of the
   duration-buckets table, read as a bar per length bucket. Net-new in the
   restructure. Shares the duration-buckets table with Content & Format. */
function EngagementByDurationSection({ index, loading, error, durationBucketRows }) {
  const series = (durationBucketRows || []).map((r) => ({
    bucket: r.bucket,
    rate: Number(r.engagement_rate_pct) || 0,
  }));
  return (
    <Section
      index={index}
      title="Engagement by length"
      deck="Whether longer or shorter videos draw the warmer response — engagement rate read across the same duration buckets."
    >
      <ChartCard
        title="Engagement rate by video length"
        subtitle="Each bar is the mean engagement rate — likes plus comments over views — of the videos in that duration bucket."
        loading={loading}
        error={error}
        height={280}
      >
        {series.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No duration data for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="bucket" {...axisProps} />
              <YAxis {...axisProps} width={48} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => `${Number(v).toFixed(2)}%`} />}
              />
              <Bar
                dataKey="rate"
                name="Engagement rate"
                fill={color.teal[600]}
                radius={[3, 3, 0, 0]}
                maxBarSize={56}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </Section>
  );
}
```

- [ ] **Step 4: Assemble the `AudienceTab` component**

```jsx
export default function AudienceTab({
  loading, data,
  engagementSeries, engMean, engagementOverallRow, durationBucketRows,
}) {
  return (
    <div className="flex flex-col gap-10">
      <EngagementSection index={1} loading={loading} data={data}
        engagementSeries={engagementSeries} engMean={engMean} />
      <EngagementSplitSection index={2} loading={loading}
        error={errOf(data, "engagementOverall")} overallRow={engagementOverallRow} />
      <EngagementByDurationSection index={3} loading={loading}
        error={errOf(data, "durationBuckets")} durationBucketRows={durationBucketRows} />
    </div>
  );
}
```

- [ ] **Step 5: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. 375px check deferred to Task 8.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/fra/classic/AudienceTab.jsx
git commit -m "feat: add FRA classic AudienceTab with like/comment split & engagement by duration"
```

---

## Task 5: Create `classic/CadenceSeoTab.jsx` — Cadence + Titles & SEO + upload pacing + tag analysis

**Files:**
- Create: `frontend/components/dashboards/fra/classic/CadenceSeoTab.jsx`

Cadence & SEO = Cadence + Titles & SEO in full, plus upload cadence & gap stats and tag-frequency/SEO analysis.

- [ ] **Step 1: Scaffold the file and extract the Cadence + Titles sections**

Create `frontend/components/dashboards/fra/classic/CadenceSeoTab.jsx`. Extract two sections **directly from the original, still-intact `FraYoutubeDashboard.jsx`** at the noted line ranges, verbatim, `index` made a prop in each:

- §06 Cadence section — original lines 802-875 (`<Section index={6} …>…</Section>` — the two posting-day / posting-hour `ChartCard` blocks) — into `export function CadenceSection({ index, loading, data, cadenceDaySeries, cadenceHourSeries })`.
- §07 Titles & SEO section — original lines 877-919 (`<Section index={7} …>…</Section>` — the title-patterns `Card` with the `MiniBar` list) — into `export function TitlesSeoSection({ index, loading, data, titleRows, titleMax })`.

OverviewTab (Task 6) imports `CadenceSection` and `TitlesSeoSection` from this file.

```jsx
"use client";
/**
 * CadenceSeoTab — Tab 5 of the FRA classic dashboard.
 *
 * Cadence + Titles & SEO in full (extracted from the original mega-file as
 * CadenceSection / TitlesSeoSection — exported so OverviewTab can import them),
 * plus two net-new sections: upload cadence & gap stats and the tag-frequency
 * / SEO analysis.
 */

import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";
import { fmt, compact } from "../helpers";
import { Section, StatStripSkeleton, MiniBar } from "./primitives";
```

The §06 Cadence body references `loading`, `errOf(data, "cadenceDay")`, `errOf(data, "cadenceHour")`, `cadenceDaySeries`, `cadenceHourSeries`; the §07 Titles body references `loading`, `errOf(data, "titlePatterns")`, `titleRows`, `titleMax` — all now props. `MiniBar` is imported from `primitives.jsx`.

- [ ] **Step 2: Build the upload-cadence section (net-new)**

Reads `uploadCadenceRow` (`data.uploadCadence[0]`) — the single channel-level row with `avg_uploads_per_month`, `avg_gap_days`, `median_gap_days`, `longest_gap_days`. A `Card` with a four-`Stat` `StatStrip`. Add as a file-local function:

```jsx
/* Upload cadence — the channel's pacing: how often it ships, and the gaps
   between uploads. Net-new in the restructure; reads fra_youtube__upload_cadence
   (a single channel-level row). */
function UploadCadenceSection({ index, loading, error, cadenceRow }) {
  return (
    <Section
      index={index}
      title="The pace of it"
      deck="How steadily the channel publishes — its monthly rhythm, and the gaps that open up between one upload and the next."
    >
      <Card pad="md">
        {loading ? (
          <StatStripSkeleton count={4} />
        ) : error ? (
          <p className="t-body-sm text-error-600">Could not load upload cadence.</p>
        ) : !cadenceRow ? (
          <p className="t-body-sm text-tertiary">No upload-cadence row for the current snapshot.</p>
        ) : (
          <StatStrip>
            <Stat
              label="Uploads / month"
              value={cadenceRow.avg_uploads_per_month != null ? Number(cadenceRow.avg_uploads_per_month).toFixed(2) : "—"}
              hint="averaged over active months"
            />
            <Stat
              label="Avg gap"
              value={cadenceRow.avg_gap_days != null ? `${Number(cadenceRow.avg_gap_days).toFixed(1)} d` : "—"}
              hint="mean days between uploads"
            />
            <Stat
              label="Median gap"
              value={cadenceRow.median_gap_days != null ? `${Number(cadenceRow.median_gap_days).toFixed(1)} d` : "—"}
              hint="the typical wait"
            />
            <Stat
              label="Longest gap"
              value={cadenceRow.longest_gap_days != null ? `${fmt(cadenceRow.longest_gap_days)} d` : "—"}
              hint="the channel's quietest stretch"
            />
          </StatStrip>
        )}
      </Card>
    </Section>
  );
}
```

- [ ] **Step 3: Build the tag-analysis section (net-new)**

Reads `tagAnalysisRows` (`data.tagAnalysis`) — up to 30 rows with `tag`, `frequency`, `tag_type`. A `ChartCard`-framed horizontal bar chart of the top 12 tags by frequency (tinted by tag type), plus a `Card` table carrying the tag type. Add the tag-type colour map and the section:

```jsx
/* Tag-type accent colours — keeps the SEO read scannable at a glance. */
const TAG_TYPE_COLOR = {
  product: color.success[500],
  aspirational: chartPalette[1],
  platform: color.teal[600],
  brand: color.error[400],
  educational: chartPalette[0],
  other: color.neutral[400],
};

/* Tag-frequency / SEO analysis — the channel's most-used SEO tags, ranked, each
   keyword-classified into a coarse type. Net-new in the restructure; reads
   fra_youtube__tag_analysis (top 30 tags). */
function TagAnalysisSection({ index, loading, error, tagRows }) {
  const top = (tagRows || []).slice(0, 12);
  const series = top.map((r) => ({
    tag: r.tag,
    frequency: Number(r.frequency) || 0,
    type: r.tag_type || "other",
  }));
  return (
    <Section
      index={index}
      title="The keywords"
      deck="The SEO tags the channel reaches for most, ranked by how many videos carry them — and what kind of word each one is."
    >
      <ChartCard
        title="Most-used SEO tags"
        subtitle="Each bar is a tag; its length is the number of videos that carry it. Bars are tinted by tag type."
        loading={loading}
        error={error}
        height={Math.max(220, series.length * 34 + 48)}
      >
        {series.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No tag data for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={series} margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="tag" {...axisProps} width={130} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => `${fmt(v)} videos`} />}
              />
              <Bar dataKey="frequency" name="Videos" maxBarSize={20} radius={[2, 2, 2, 2]}>
                {series.map((d, i) => (
                  <Cell key={i} fill={TAG_TYPE_COLOR[d.type] || chartPalette[0]} />
                ))}
                <LabelList
                  dataKey="frequency"
                  position="right"
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, fill: color.neutral[500] }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <Card pad="md">
        <CardHeader>
          <CardTitle>Tags by type</CardTitle>
          <CardSubtitle>Every tag the analysis surfaced, with its keyword classification</CardSubtitle>
        </CardHeader>
        <CardBody>
          {error ? (
            <p className="t-body-sm text-error-600">Could not load this section.</p>
          ) : loading ? (
            <Skeleton className="h-32 w-full" />
          ) : !tagRows || tagRows.length === 0 ? (
            <p className="t-body-sm text-tertiary">No tag data for the current snapshot.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="py-2 pr-4 text-left t-overline text-tertiary">Tag</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                    <th className="py-2 text-left t-overline text-tertiary">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {tagRows.map((r, i) => (
                    <tr key={i} className="border-b border-border-default last:border-0">
                      <td className="py-2 pr-4 text-body">{r.tag}</td>
                      <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.frequency)}</td>
                      <td className="py-2">
                        <span
                          className="t-emphasis-sm capitalize"
                          style={{ color: TAG_TYPE_COLOR[r.tag_type] || color.neutral[600] }}
                        >
                          {r.tag_type || "other"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
```

- [ ] **Step 4: Assemble the `CadenceSeoTab` component**

```jsx
export default function CadenceSeoTab({
  loading, data,
  cadenceDaySeries, cadenceHourSeries, titleRows, titleMax, uploadCadenceRow, tagAnalysisRows,
}) {
  return (
    <div className="flex flex-col gap-10">
      <CadenceSection index={1} loading={loading} data={data}
        cadenceDaySeries={cadenceDaySeries} cadenceHourSeries={cadenceHourSeries} />
      <UploadCadenceSection index={2} loading={loading}
        error={errOf(data, "uploadCadence")} cadenceRow={uploadCadenceRow} />
      <TitlesSeoSection index={3} loading={loading} data={data}
        titleRows={titleRows} titleMax={titleMax} />
      <TagAnalysisSection index={4} loading={loading}
        error={errOf(data, "tagAnalysis")} tagRows={tagAnalysisRows} />
    </div>
  );
}
```

- [ ] **Step 5: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. 375px check deferred to Task 8.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/dashboards/fra/classic/CadenceSeoTab.jsx
git commit -m "feat: add FRA classic CadenceSeoTab with upload pacing & tag analysis"
```

---

## Task 6: Create `classic/OverviewTab.jsx` — the whole current report

**Files:**
- Create: `frontend/components/dashboards/fra/classic/OverviewTab.jsx`

OverviewTab is the entire current single-scroll body — every section at its current depth — except the AI section, which is condensed to verdict + top-3 action items. Each section gets a "connects to" link to its deep-dive tab. The locked Retention panel (out of scope to change, spec §6) is carried forward unchanged at the foot of this tab.

OverviewTab is **pure composition**: it does **not** define the shared section bodies. Discovery, Growth, Catalog health, Content fit, Engagement, Cadence and Titles & SEO were already extracted as `export function`s by the four deep-dive tabs (Tasks 2–5); OverviewTab imports them and only adds the Overview-only pieces — the "At a glance" section, the `TabConnect` deep-dive-link primitive, the condensed AI block, and the locked Retention panel. Nothing here is moved a second time.

- [ ] **Step 1: Scaffold the file and imports**

Create `frontend/components/dashboards/fra/classic/OverviewTab.jsx`. The shared sections are imported from the deep-dive tab files; only the §01 At a glance body is extracted from the original `FraYoutubeDashboard.jsx`.

```jsx
"use client";
/**
 * OverviewTab — Tab 1 of the FRA classic dashboard.
 *
 * The whole current single-scroll report at its current depth: At a glance,
 * Discovery, Growth, Content fit, Engagement, Cadence, Titles & SEO, Catalog
 * health. The AI section is condensed to the verdict + top-3 action items;
 * each section carries a "read the full analysis" link to its deep-dive tab.
 * The locked Retention panel is carried forward unchanged at the foot.
 *
 * OverviewTab is pure composition — the seven shared sections are imported
 * from the four deep-dive tab files, not redefined here.
 */

import * as React from "react";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Skeleton,
} from "@/components/ui";
import { errOf } from "@/lib/queries/fraYoutube";
import { fmt } from "../helpers";
import {
  Section, StatStripSkeleton, DualDelta, deltaFmt, fmtDuration, insightItemText,
} from "./primitives";
import { DiscoverySection, GrowthSection, CatalogHealthSection } from "./ReachGrowthTab";
import { ContentFitSection } from "./ContentFormatTab";
import { EngagementSection } from "./AudienceTab";
import { CadenceSection, TitlesSeoSection } from "./CadenceSeoTab";
```

The seven shared section components are the `export function`s defined by Tasks 2–5 — OverviewTab does not redefine them.

- [ ] **Step 2: Add the `TabConnect` link primitive**

A small "connects to" link rendered at the foot of each Overview section. It is Overview-specific (no other tab links *out*), so it lives in this file, not `primitives.jsx`. Add after the imports:

```jsx
/* The "connects to" link at the foot of an Overview section — sends the reader
   to the matching deep-dive tab. Classic idiom: a navy text button with an
   arrow, minimum 36px tap target for mobile. */
function TabConnect({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-emphasis-sm text-navy-700 hover:text-navy-900 inline-flex items-center gap-1.5"
      style={{ minHeight: 36, background: "none", border: "none", cursor: "pointer", padding: 0 }}
    >
      {label} <span aria-hidden>→</span>
    </button>
  );
}
```

- [ ] **Step 3: Extract the §01 At a glance section body**

Extract the **§01 At a glance** section **directly from the original, still-intact `FraYoutubeDashboard.jsx`** (lines 409-471 — the whole `<Section index={1} …>…</Section>` block, the seven-`Stat` `StatStrip` with `DualDelta` deltas), verbatim, into a file-local `function AtAGlanceSection({ index, loading, data, overview, trend, catalogRow })` in `OverviewTab.jsx`. This is the only section body OverviewTab itself carries — the seven shared sections are imported from the deep-dive tabs and not re-extracted here. `index` is a prop; `title="At a glance"` and the deck (original line 413) are hard-coded inside. The block references `loading`, `errOf(data, "overview")`, `overview`, `trend`, `catalogRow`, `DualDelta`, `deltaFmt`, `fmtDuration`, `StatStripSkeleton` — all props or imports.

- [ ] **Step 4: Add the condensed AI section**

The Overview AI section is verdict + top-3 recommendations only (spec §4.3) — full strengths/weaknesses live in the AI Insights tab. Add this file-local component:

```jsx
/* The condensed AI block for Overview — the verdict and at most three action
   items. The full strengths/weaknesses/recommendations live in the AI Insights
   tab; this is the executive read. */
function OverviewInsightsCondensed({ index, insightsState, onNavigate }) {
  const { loading, error, insights } = insightsState;
  const actions = (insights?.recommendations || []).slice(0, 3);
  return (
    <Section
      index={index}
      title="AI insights"
      deck="The automated read on this snapshot, in brief — the headline call and the three moves that matter most."
    >
      <Card pad="md">
        <CardBody>
          {loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {error && (
                <p className="t-body-sm text-warning-700">
                  ⚠ The AI brief fell back to a cached read — {error}
                </p>
              )}
              {insights?.verdict ? (
                <p className="t-body-md text-body font-medium">{insights.verdict}</p>
              ) : (
                <p className="t-body-sm text-tertiary">No verdict available for this snapshot yet.</p>
              )}
              {actions.length > 0 && (
                <div>
                  <div className="t-overline text-tertiary mb-2 border-t border-border-default pt-2">
                    Top three actions
                  </div>
                  <ul className="flex flex-col gap-2">
                    {actions.map((it, i) => (
                      <li key={i} className="t-body-sm text-body flex gap-2">
                        <span className="shrink-0 text-navy-700" aria-hidden>→</span>
                        <span>{insightItemText(it)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <TabConnect
                label="AI Insights — the full strengths & weaknesses read"
                onClick={() => onNavigate("ai-insights")}
              />
            </div>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
```

- [ ] **Step 5: Add the locked Retention panel**

The locked Retention panel (original `FraYoutubeDashboard.jsx` lines 979-991) stays as-is per spec §6 — it is not a section, it sits below the numbered run. Add it as a file-local component, lifted verbatim:

```jsx
/* Retention & traffic sources — a locked teaser panel. Unchanged from the
   original single-scroll dashboard; the YouTube Analytics API integration that
   would fill it is out of scope (spec §6). Carried on the Overview tab. */
function RetentionLockedPanel() {
  return (
    <Card pad="md">
      <CardHeader>
        <CardTitle>Retention &amp; traffic sources</CardTitle>
        <Badge tone="neutral" variant="outline">locked</Badge>
      </CardHeader>
      <CardBody>
        <p className="t-body-sm text-tertiary">
          Retention, impressions CTR, and traffic sources unlock when the YouTube
          Analytics API is integrated.
        </p>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 6: Assemble the `OverviewTab` component**

Wrap the At-a-glance section, the imported shared sections, the condensed AI block and the Retention panel in the tab component. Each section is followed by a `TabConnect` link to its deep-dive tab. The imported shared sections take `index` as a prop, so the Overview numbering (1–9) and the deep-dive tabs' own numbering coexist without conflict.

```jsx
export default function OverviewTab({
  loading, data,
  overview, trend, distRow, catalogRow, distBuckets,
  growthWithReal, hasRealTrend, monthlySeries,
  contentSeries, categoryRows, engagementSeries, engMean,
  cadenceDaySeries, cadenceHourSeries, titleRows, titleMax,
  insightsState, onNavigate,
}) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <AtAGlanceSection index={1} loading={loading} data={data}
          overview={overview} trend={trend} catalogRow={catalogRow} />
        <TabConnect label="Reach & Growth — the full discovery analysis"
          onClick={() => onNavigate("reach-growth")} />
      </div>

      <div className="flex flex-col gap-3">
        <DiscoverySection index={2} loading={loading} data={data}
          distRow={distRow} distBuckets={distBuckets} />
        <TabConnect label="Reach & Growth — percentile ladder & concentration"
          onClick={() => onNavigate("reach-growth")} />
      </div>

      <div className="flex flex-col gap-3">
        <GrowthSection index={3} loading={loading} data={data}
          growthWithReal={growthWithReal} hasRealTrend={hasRealTrend} monthlySeries={monthlySeries} />
        <TabConnect label="Reach & Growth — monthly detail with MoM %"
          onClick={() => onNavigate("reach-growth")} />
      </div>

      <div className="flex flex-col gap-3">
        <ContentFitSection index={4} loading={loading} data={data}
          contentSeries={contentSeries} categoryRows={categoryRows} />
        <TabConnect label="Content & Format — duration buckets & leaderboards"
          onClick={() => onNavigate("content-format")} />
      </div>

      <div className="flex flex-col gap-3">
        <EngagementSection index={5} loading={loading} data={data}
          engagementSeries={engagementSeries} engMean={engMean} />
        <TabConnect label="Audience — like vs comment split & engagement by duration"
          onClick={() => onNavigate("audience")} />
      </div>

      <div className="flex flex-col gap-3">
        <CadenceSection index={6} loading={loading} data={data}
          cadenceDaySeries={cadenceDaySeries} cadenceHourSeries={cadenceHourSeries} />
        <TabConnect label="Cadence & SEO — upload pacing & gap stats"
          onClick={() => onNavigate("cadence-seo")} />
      </div>

      <div className="flex flex-col gap-3">
        <TitlesSeoSection index={7} loading={loading} data={data}
          titleRows={titleRows} titleMax={titleMax} />
        <TabConnect label="Cadence & SEO — tag-frequency analysis"
          onClick={() => onNavigate("cadence-seo")} />
      </div>

      <div className="flex flex-col gap-3">
        <CatalogHealthSection index={8} loading={loading} data={data} catalogRow={catalogRow} />
        <TabConnect label="Reach & Growth — catalog health in context"
          onClick={() => onNavigate("reach-growth")} />
      </div>

      <OverviewInsightsCondensed index={9} insightsState={insightsState} onNavigate={onNavigate} />

      <RetentionLockedPanel />
    </div>
  );
}
```

- [ ] **Step 7: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS. (Tab file is not yet imported by the shell — confirms it compiles and every import resolves, including the seven shared sections imported from the four deep-dive tabs created in Tasks 2–5.)

- [ ] **Step 8: Commit**

```bash
git add frontend/components/dashboards/fra/classic/OverviewTab.jsx
git commit -m "feat: add FRA classic OverviewTab — full report with deep-dive links"
```

---

## Task 7: Create `classic/InsightsTab.jsx` — the full AI read

**Files:**
- Create: `frontend/components/dashboards/fra/classic/InsightsTab.jsx`

AI Insights = the full verdict + strengths / weaknesses / recommendations. The `AiInsightsCard` component is already in `primitives.jsx` (Task 1) — this tab is a thin wrapper that frames it with a `Section` heading.

- [ ] **Step 1: Create the file**

Create `frontend/components/dashboards/fra/classic/InsightsTab.jsx`:

```jsx
"use client";
/**
 * InsightsTab — Tab 6 of the FRA classic dashboard.
 *
 * The full automated read on the latest snapshot: the headline verdict and the
 * three-column strengths / weaknesses / recommendations grid. The condensed
 * verdict + top-3 lives on the Overview tab; this is the unabridged version.
 */

import * as React from "react";
import { Section, AiInsightsCard } from "./primitives";

export default function InsightsTab({ insightsState }) {
  return (
    <div className="flex flex-col gap-10">
      <Section
        index={1}
        title="AI insights"
        deck="The automated read on this snapshot — what the channel is doing well, where it is leaking, and what to try next."
      >
        <AiInsightsCard state={insightsState} />
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboards/fra/classic/InsightsTab.jsx
git commit -m "feat: add FRA classic InsightsTab — full AI verdict & recommendations"
```

---

## Task 8: Rewrite `FraYoutubeDashboard.jsx` as the tab shell

**Files:**
- Rewrite: `frontend/components/dashboards/FraYoutubeDashboard.jsx`

The shell keeps the masthead, owns the two data hooks and all derived series, renders the `@/components/ui` `Tabs` strip below the masthead, and renders the active tab. After this task the 1095-line file is ~330 lines and every primitive/section now lives in the `fra/` tree.

- [ ] **Step 1: Replace the file with the shell**

Replace the entire contents of `FraYoutubeDashboard.jsx` with:

```jsx
"use client";
// FraYoutubeDashboard — classic-theme tab shell
// ─────────────────────────────────────────────────────────────────────────
// The classic rendering of the FRA YouTube project dashboard. A thin shell: a
// masthead Card, the platform's @/components/ui Tabs strip, and the active
// tab. Six fixed-order tabs — Overview, Reach & Growth, Content & Format,
// Audience, Cadence & SEO, AI Insights — each a focused component under
// fra/classic/. The data layer (SQL specs + useFraYoutube) lives in
// lib/queries/fraYoutube.js; the shared classic rendering primitives in
// fra/classic/primitives.jsx; theme-agnostic formatters in fra/helpers.js.

import * as React from "react";
import { useFraYoutube, rowsOf, errOf, computeTrend } from "@/lib/queries/fraYoutube";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Stat, StatStrip, Tabs, TabList, Tab, TabPanel,
} from "@/components/ui";
import { fmt } from "./fra/helpers";
import {
  StatStripSkeleton, discoveryVerdictBadge, useFraInsights, bucketViews, toNum,
} from "./fra/classic/primitives";
import OverviewTab from "./fra/classic/OverviewTab";
import ReachGrowthTab from "./fra/classic/ReachGrowthTab";
import ContentFormatTab from "./fra/classic/ContentFormatTab";
import AudienceTab from "./fra/classic/AudienceTab";
import CadenceSeoTab from "./fra/classic/CadenceSeoTab";
import InsightsTab from "./fra/classic/InsightsTab";

/* The six tabs, in fixed order (spec §4.1). `key` is the stable identifier the
   tabs' onNavigate() calls and the Tabs `value` both use. */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reach-growth", label: "Reach & Growth" },
  { key: "content-format", label: "Content & Format" },
  { key: "audience", label: "Audience" },
  { key: "cadence-seo", label: "Cadence & SEO" },
  { key: "ai-insights", label: "AI Insights" },
];

export default function FraYoutubeDashboard({ project }) {
  const { loading, error, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();
  const [activeTab, setActiveTab] = React.useState("overview");

  /* row extraction — every key is { rows } | { error } */
  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;

  /* Hard empty state — no snapshot has been crawled yet. */
  if (!loading && overviewRows.length === 0 && !errOf(data, "overview")) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-secondary">
          No snapshots yet — the first daily refresh has not run. The report
          fills in once the FRA channel has been crawled.
        </p>
      </Card>
    );
  }

  /* Fatal — the data hook only sets a top-level error when EVERY query
     failed; one bad table is handled per-section. */
  if (error && !overview && !loading) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-error-600">
          Could not load the dashboard — {error}
        </p>
      </Card>
    );
  }

  const snapshotDate = overview?.snapshot_date ?? "—";
  const distRow = rowsOf(data, "distribution")[0] || null;
  const catalogRow = rowsOf(data, "catalogHealth")[0] || null;
  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyRows = rowsOf(data, "monthlyViews");
  const cumulativeRows = rowsOf(data, "cumulativeViews");
  const categoryRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceDayRows = rowsOf(data, "cadenceDay");
  const cadenceHourRows = rowsOf(data, "cadenceHour");
  const titleRows = rowsOf(data, "titlePatterns");
  const videoViewsRows = rowsOf(data, "videoViews");

  /* row extraction — the six specs the editorial plan added (already merged) */
  const durationBucketRows = rowsOf(data, "durationBuckets");
  const tagAnalysisRows = rowsOf(data, "tagAnalysis");
  const uploadCadenceRow = rowsOf(data, "uploadCadence")[0] || null;
  const topVideosByViewsRows = rowsOf(data, "topVideosByViews");
  const topVideosByEngagementRows = rowsOf(data, "topVideosByEngagement");
  const engagementOverallRow = rowsOf(data, "engagementOverall")[0] || null;

  // Day- and week-over-week trend from the overview history — see computeTrend.
  const trend = computeTrend(overviewRows);

  /* ── chart-ready series (moved verbatim from the old render body) ─────────*/
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
  const growthWithReal = growthSeries.map((d) => ({
    ...d,
    real: channelByMonth[d.month] != null ? channelByMonth[d.month] : null,
  }));
  const hasRealTrend = Object.keys(channelByMonth).length > 0;

  const monthlySeries = monthlyRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: toNum(r.total_views),
  }));

  const distBuckets = bucketViews(videoViewsRows);

  const contentSeries = categoryRows.map((r) => ({
    category: r.category,
    perf: toNum(r.perf_vs_mean_pct),
  }));

  const engRaw = engagementRows
    .map((r) => ({ bucket: r.bucket, rate: toNum(r.engagement_rate_pct) }))
    .filter((r) => r.rate != null);
  const engMean =
    engRaw.length > 0 ? engRaw.reduce((a, r) => a + r.rate, 0) / engRaw.length : 0;
  const engagementSeries = engRaw
    .map((r) => ({ ...r, diff: Math.round((r.rate - engMean) * 100) / 100 }))
    .sort((a, b) => b.diff - a.diff);

  const cadenceDaySeries = cadenceDayRows.map((r) => ({
    bucket: r.bucket,
    avg_views: toNum(r.avg_views),
  }));
  const cadenceHourSeries = cadenceHourRows.map((r) => ({
    bucket: r.bucket,
    avg_views: toNum(r.avg_views),
  }));

  const titleMax = titleRows.reduce((m, r) => Math.max(m, Number(r.avg_views) || 0), 0);

  /* On tab change, return the reader to the top of the report. */
  const onNavigate = React.useCallback((key) => {
    setActiveTab(key);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* ── per-tab props ───────────────────────────────────────────────────────*/
  const tabProps = {
    overview: {
      loading, data, overview, trend, distRow, catalogRow, distBuckets,
      growthWithReal, hasRealTrend, monthlySeries,
      contentSeries, categoryRows, engagementSeries, engMean,
      cadenceDaySeries, cadenceHourSeries, titleRows, titleMax,
      insightsState, onNavigate,
    },
    "reach-growth": {
      loading, data, distRow, distBuckets,
      growthWithReal, hasRealTrend, monthlySeries, monthlyRows, catalogRow,
    },
    "content-format": {
      loading, data, contentSeries, categoryRows, durationBucketRows,
      topVideosByViewsRows, topVideosByEngagementRows,
    },
    audience: {
      loading, data, engagementSeries, engMean, engagementOverallRow, durationBucketRows,
    },
    "cadence-seo": {
      loading, data, cadenceDaySeries, cadenceHourSeries, titleRows, titleMax,
      uploadCadenceRow, tagAnalysisRows,
    },
    "ai-insights": { insightsState },
  };

  return (
    <div className="flex flex-col gap-8">

      {/* ════════ MASTHEAD ══════════════════════════════════════════════════ */}
      <Card pad="lg">
        <CardHeader>
          <div>
            <CardTitle>{overview?.channel_name || "FRA YouTube"}</CardTitle>
            <CardSubtitle>
              {overview?.channel_handle ? `${overview.channel_handle} · ` : ""}
              channel health · as of {snapshotDate}
            </CardSubtitle>
          </div>
          {!loading && distRow && discoveryVerdictBadge(distRow)}
        </CardHeader>
        <CardBody>
          {loading ? (
            <StatStripSkeleton count={4} />
          ) : (
            <StatStrip>
              <Stat label="Subscribers" value={overview ? fmt(overview.subscribers) : "—"} />
              <Stat label="Total views" value={overview ? fmt(overview.total_views) : "—"} />
              <Stat label="Videos" value={overview ? fmt(overview.video_count) : "—"} />
              <Stat label="Avg views / video" value={overview ? fmt(overview.avg_views) : "—"} />
            </StatStrip>
          )}
        </CardBody>
      </Card>

      {/* ════════ TAB STRIP + ACTIVE TAB ════════════════════════════════════ */}
      <Tabs value={activeTab} defaultValue="overview" onValueChange={onNavigate}>
        <TabList>
          {TABS.map((t) => (
            <Tab key={t.key} value={t.key}>{t.label}</Tab>
          ))}
        </TabList>
        <div className="mt-6">
          <TabPanel value="overview"><OverviewTab {...tabProps.overview} /></TabPanel>
          <TabPanel value="reach-growth"><ReachGrowthTab {...tabProps["reach-growth"]} /></TabPanel>
          <TabPanel value="content-format"><ContentFormatTab {...tabProps["content-format"]} /></TabPanel>
          <TabPanel value="audience"><AudienceTab {...tabProps.audience} /></TabPanel>
          <TabPanel value="cadence-seo"><CadenceSeoTab {...tabProps["cadence-seo"]} /></TabPanel>
          <TabPanel value="ai-insights"><InsightsTab {...tabProps["ai-insights"]} /></TabPanel>
        </div>
      </Tabs>
    </div>
  );
}
```

> **Note on `Tabs` controlled mode:** the shell drives `Tabs` as a *controlled* component — `value={activeTab}` plus `onValueChange={onNavigate}`. `defaultValue="overview"` is still required by the `TabsProps` contract even in controlled mode. `onNavigate` both sets `activeTab` and scrolls to top, so the strip taps and the in-page `TabConnect` links share one handler. `TabPanel` renders only the active panel (it returns `null` otherwise), so only one tab's charts mount at a time.

- [ ] **Step 2: Verify nothing else still imports the old internals**

The old file exported only the default component, and `dashboards/index.js` imports it by default — no named imports to fix. Confirm with: `cd frontend && grep -rn "FraYoutubeDashboard\b" --include=*.js --include=*.jsx app components lib` — expect only `dashboards/index.js` (the default import). Confirm no file still references the removed inline `AiInsightsCard` / `discoveryVerdictBadge` / `bucketViews` / classic primitives from the old `FraYoutubeDashboard.jsx`.

- [ ] **Step 3: Build-verify**

Run: `cd frontend && pnpm build`
Expected: PASS — the full classic dashboard now compiles as a shell + six tab modules + primitives, reusing `fra/helpers.js`.

- [ ] **Step 4: Manual visual check**

Run `cd frontend && pnpm dev`, open the FRA YouTube project in **classic** mode (the design toggle in the top-right pill — classic is the secondary theme), and verify at **375px first** then desktop:
- Masthead Card renders above the tab strip; the `TabList` scrolls horizontally at 375px with all six tabs reachable (it has `overflow-x-auto` built in).
- Each tab renders: Overview shows all nine sections + the Retention panel + the "connects to" links navigate; Reach & Growth shows the percentile ladder + monthly MoM table; Content & Format shows duration buckets + both leaderboards; Audience shows the like/comment split + engagement-by-duration; Cadence & SEO shows upload pacing + tag analysis; AI Insights shows the full grid.
- Switching tabs scrolls to top; the active tab is highlighted in the strip (the `border-action` underline).
- The empty state (no snapshot) and the fatal-error state still render.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboards/FraYoutubeDashboard.jsx
git commit -m "feat: convert FRA classic dashboard to a six-tab shell"
```

---

## Self-Review

**Spec coverage** (against §4 of `2026-05-19-fra-metric-coverage-expansion-design.md`):

- **§4.1 Navigation** — six fixed-order tabs (Overview · Reach & Growth · Content & Format · Audience · Cadence & SEO · AI Insights) → `TABS` const, Task 8 ✓. "Classic reuses the existing `@/components/ui` Tabs" → the shell renders `Tabs`/`TabList`/`Tab`/`TabPanel` from `@/components/ui`, Task 8 ✓. Masthead persistent above the tab bar → the masthead `Card` sits above `<Tabs>` in the shell, Task 8 ✓.
- **§4.2 File organization** — thin shell → Task 8 (1095 → ~330 lines) ✓. `fra/helpers.js` theme-agnostic utility reused, not re-created → Tasks 2–6 import its formatters; the File-Structure decision documents why it is not modified ✓. `fra/classic/` six tab components → Tasks 2–7 ✓. `fraYoutube.js` unchanged — the six specs already exist (editorial plan, merged) → noted in Scope and Architecture ✓. No cross-theme sharing → all new code is under `fra/classic/`; the File-Structure decision documents why `classic/primitives.jsx` exists and stays classic-namespaced, symmetric to `editorial/primitives.jsx` ✓.
- **§4.3 Tab contents** (the spec's §4.3 tab contents apply to both themes — "Both themes render all six tabs"):
  - Reach & Growth = Discovery + Growth + Catalog health in full + percentile ladder + monthly MoM → Task 2 ✓.
  - Content & Format = Content fit in full + duration buckets + per-video leaderboards → Task 3 ✓.
  - Audience = Engagement in full + like/comment split + engagement by duration → Task 4 ✓.
  - Cadence & SEO = Cadence + Titles & SEO in full + upload cadence + tag analysis → Task 5 ✓.
  - Overview = whole report at current depth, AI condensed to verdict + top-3, each section links to its deep-dive → Task 6 (`OverviewTab`, `AtAGlanceSection`, `TabConnect`, `OverviewInsightsCondensed`, `RetentionLockedPanel`) ✓.
  - AI Insights = full verdict + strengths/weaknesses/recommendations → Task 7 (`InsightsTab` wrapping `AiInsightsCard`) ✓.
- **§4.4 New data-layer query specs** — already merged by the editorial plan's Task 1; this plan consumes `durationBuckets`, `tagAnalysis`, `uploadCadence`, `topVideosByViews`, `topVideosByEngagement`, `engagementOverall` and the extended `distribution` columns unchanged. No data-layer task here, as the Scope states ✓.

**Net-new UI carries full classic-design code:** percentile ladder (Task 2), monthly detail with MoM (Task 2), duration-bucket chart (Task 3), both leaderboards (Task 3), like/comment split (Task 4), engagement-by-duration (Task 4), upload cadence stats (Task 5), tag-frequency/SEO analysis (Task 5) — every one has complete JSX using the classic `Card`/`ChartCard`/`StatStrip`/Recharts patterns with navy/teal tokens, mirroring how the editorial tabs rendered the symmetric sections in the editorial design system.

**Relocated code carries precise instructions, and no section is moved twice:** every moved section names its source line range in the pre-restructure `FraYoutubeDashboard.jsx` and its destination `export function` signature. Each shared section is extracted exactly once — directly from the original, still-intact mega-file — by the deep-dive tab that owns it (Tasks 2–5), defined there as an `export function` with `index` made a prop. `OverviewTab` (Task 6) imports those `export function`s rather than redefining them. This is DRY within the classic theme, crosses no theme boundary, and eliminates any "move into OverviewTab then move back out" round-trip.

**Build stays green at every commit:** Tasks 1–7 add unreferenced modules (primitives / tab files); Task 8 wires them. Each task ends with an explicit `cd frontend && pnpm build` step; Task 8 adds the manual 375px + desktop visual pass.

**Mobile-first:** every net-new table wraps in an `overflow-x-auto` scroller; the `@/components/ui` `TabList` already scrolls horizontally with a hidden scrollbar; the visual pass clears 375px first.

**No JSX unit tests** — per repo convention and spec §7; verification is `pnpm build` + manual visual check.

**Out of scope (correctly excluded):** the editorial dashboard restructure (separate, already-merged plan), the backend transforms and the `fraYoutube.js` query specs (already merged), the Wint Wealth competitive channel (spec §6), and the locked Retention panel — carried forward unchanged on the Overview tab per spec §6.
