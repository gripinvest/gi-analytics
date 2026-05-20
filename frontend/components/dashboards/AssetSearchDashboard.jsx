"use client";

/**
 * CLASSIC ASSET SEARCH DASHBOARD.
 *
 * One of two maintained renderings of the Asset Search project, shown when the
 * design toggle is set to "classic" (the Editorial variant,
 * AssetSearchDashboardEditorial.jsx, is the other). Both are first-class and
 * kept at data parity — every metric here reads the same builders in
 * lib/queries/assetSearch.js, so the two dashboards always show identical
 * numbers. Keep them in sync when a metric changes.
 */

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, AreaChart,
  Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, Legend,
  ReferenceLine,
} from "recharts";

// Compact top-aligned legend props for multi-series charts. Centralised so
// every chart reads the same on mobile (small swatches, wraps cleanly).
const legendProps = {
  verticalAlign: "top",
  align: "left",
  height: 28,
  iconType: "circle",
  iconSize: 8,
  wrapperStyle: { paddingBottom: 6, fontSize: 12, color: "var(--gi-text-tertiary)" },
};
import { runQuery } from "@/lib/api";
import * as Q from "@/lib/queries/assetSearch";
import { ISSUER_MAP, ISSUER_CATEGORY, METRIC_DEFS } from "@/lib/queries/assetSearch";
import * as C from "@/lib/queries/conversion";
import { CONV_METRIC_DEFS } from "@/lib/queries/conversion";
import { color, zrrColor, zrrBg } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Tabs, TabList, Tab, TabPanel, Skeleton, InfoTip,
} from "@/components/ui";

/** A metric label with a (?) tooltip pulled from METRIC_DEFS / CONV_METRIC_DEFS. */
function Metric({ k, children, align }) {
  const d = METRIC_DEFS[k] || CONV_METRIC_DEFS[k];
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      {d && <InfoTip title={d.title} body={d.body} source={d.source} live={d.live} align={align} />}
    </span>
  );
}
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";
import { useProjectRefresh, RefreshControl } from "@/components/RefreshControl";

/* ── data loading ─────────────────────────────────────────────────────────── */

const QUERY_SPECS = {
  health:        (ctx) => Q.queryHealthByWeek(ctx),
  funnel:        (ctx) => Q.funnelByWeek(ctx),
  suggestions:   (ctx) => Q.suggestionsByWeek(ctx),
  clears:        (ctx) => Q.clearsByWeek(ctx),
  sessionOutcome:(ctx) => Q.sessionOutcomeByWeek(ctx),
  tabs:          (ctx) => Q.byTab(ctx),
  sessions:      (ctx) => Q.totalQuerySessions(ctx),
  terms:         (ctx) => Q.topSearchTerms(ctx),
  assets:        (ctx) => Q.topClickedAssets(ctx),
  positions:     (ctx) => Q.clicksByPosition(ctx),
  zeroQueries:   (ctx) => Q.topZeroResultQueries(ctx),
  issuers:       (ctx) => Q.issuerHealthByWeek(ctx),
  issuerOutcome: (ctx) => Q.sessionOutcomeByIssuerWeek(ctx),
};

// Conversion ("Business") queries — run when the invest_now / quick_checkout tables
// are loaded (conv.ok). Keyed conv_* so they don't collide with the search queries.
const CONV_SPECS = {
  conv_headline:  (conv) => C.conversionHeadline(conv),
  conv_assetRate: (conv) => C.searchToInvestRate(conv),
  conv_queries:   (conv) => C.topConvertingQueries(conv),
  conv_byWeek:    (conv) => C.conversionByWeek(conv),
  conv_byCat:     (conv) => C.investByCategory(conv),
};
// Visitor cohorts (searchers vs non-searchers). conv_cohortW = full W1–W6 window,
// built from the weekly assets-page-views (conv.pageViewsOk). conv_cohort/conv_daily =
// the launch-week deep export's pre-computed Apr 2–9 cohort (conv.cohortOk) — kept as a
// fallback when the weekly page-views aren't loaded.
const COHORT_SPECS = {
  conv_cohort: (conv) => C.cohortCvr(conv),
  conv_daily:  (conv) => C.cohortDaily(conv),
};
const COHORT_W_SPECS = {
  conv_cohortW:        (conv) => C.weeklyCohortCvr(conv),
  conv_adoption:       (conv) => C.weeklyAdoption(conv),
  conv_cohortW_byWeek: (conv) => C.weeklyCohortCvrByWeek(conv),
};

function useDashboard(project, nonce) {
  const grouped = React.useMemo(() => Q.groupTables(project.tables || []), [project.tables]);
  const conv = React.useMemo(() => C.conversionTables(project.tables || []), [project.tables]);
  const [state, setState] = React.useState({ loading: true, fatal: null, data: {} });

  React.useEffect(() => {
    if (!grouped.ok) {
      setState({ loading: false, fatal: "This project's tables don't match the Asset Search layout.", data: {} });
      return;
    }
    let cancelled = false;
    setState({ loading: true, fatal: null, data: {} });
    const ctx = { tables: grouped.tables, weeks: grouped.weeks };
    const run = async (key, sql) => {
      try {
        const res = await runQuery(project.id, sql, 1000);
        return [key, res && res.error ? { error: res.error } : { rows: (res && res.rows) || [] }];
      } catch (e) {
        return [key, { error: String((e && e.message) || e) }];
      }
    };
    (async () => {
      const jobs = [
        ...Object.entries(QUERY_SPECS).map(([key, build]) => run(key, build(ctx))),
        ...(conv.ok ? Object.entries(CONV_SPECS).map(([key, build]) => run(key, build(conv))) : []),
        ...(conv.cohortOk ? Object.entries(COHORT_SPECS).map(([key, build]) => run(key, build(conv))) : []),
        ...(conv.pageViewsOk ? Object.entries(COHORT_W_SPECS).map(([key, build]) => run(key, build(conv))) : []),
      ];
      const entries = await Promise.all(jobs);
      if (!cancelled) setState({ loading: false, fatal: null, data: Object.fromEntries(entries) });
    })();
    return () => { cancelled = true; };
    // `nonce` bumps after a refresh — re-runs the fetch so the report updates.
  }, [project.id, grouped, conv, nonce]);

  return { ...state, weeks: grouped.weeks, lastWeek: grouped.lastWeek, convOk: conv.ok };
}

/* ── small helpers ────────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("en-IN");
const pct = (v) => (v == null ? "—" : `${v}%`);
const get = (data, key) => (data && data[key]) || {};
const rowsOf = (data, key) => get(data, key).rows || [];
const errOf = (data, key) => get(data, key).error || null;

function sum(rows, col) { return rows.reduce((a, r) => a + (Number(r[col]) || 0), 0); }
function weightedPct(rows, numCol, denCol) {
  const d = sum(rows, denCol); if (!d) return null;
  return Math.round((1000 * sum(rows, numCol)) / d) / 10;
}

function DeltaChip({ from, to, goodIsDown = true, suffix = "" }) {
  if (from == null || to == null) return null;
  const diff = Math.round((to - from) * 10) / 10;
  if (diff === 0) return <span className="t-emphasis-sm text-tertiary">±0{suffix}</span>;
  const good = goodIsDown ? diff < 0 : diff > 0;
  return (
    <Badge tone={good ? "success" : "error"} variant="soft" className="gap-0.5">
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)}{suffix}
    </Badge>
  );
}

/* ── component ────────────────────────────────────────────────────────────── */

export default function AssetSearchDashboard({ project }) {
  const refreshState = useProjectRefresh(project);
  const { loading, fatal, data, weeks, lastWeek, convOk } = useDashboard(project, refreshState.nonce);

  const health = rowsOf(data, "health");
  const funnel = rowsOf(data, "funnel");
  const sessionOutcome = rowsOf(data, "sessionOutcome");
  const suggestions = rowsOf(data, "suggestions");
  const clears = rowsOf(data, "clears");
  const tabs = rowsOf(data, "tabs");
  const terms = rowsOf(data, "terms");
  const assets = rowsOf(data, "assets");
  const positions = rowsOf(data, "positions");
  const zeroQueries = rowsOf(data, "zeroQueries");
  const sessions = rowsOf(data, "sessions")[0]?.sessions;

  // headline numbers (computed from the loaded rows; honest if a query failed)
  const overallZrr = weightedPct(health, "zero_result", "queries");
  const overallRefine = weightedPct(health, "refinements", "queries");
  const totalQueries = sum(health, "queries");
  const totalClears = sum(clears, "clears");
  const totalClicks = sum(funnel, "clicked") || sum(assets, "clicks");
  const ctrLast = suggestions.length ? suggestions[suggestions.length - 1].ctr_pct : null;
  const zrrFirst = health.length ? health[0].zrr_pct : null;
  const zrrLast = health.length ? health[health.length - 1].zrr_pct : null;
  // Session-outcome funnel — the primary search-health metric. Search Success
  // Rate is the headline; the weekly Success / Relevance-gap / Dead-end split
  // drives the outcome chart on the Overview tab. Same builders the Editorial
  // dashboard uses, so both renderings show identical numbers.
  const outcomeSuccessPct = weightedPct(sessionOutcome, "success", "searched");
  const successFirst = sessionOutcome.length ? Number(sessionOutcome[0].success_pct) : null;
  const successLast = sessionOutcome.length ? Number(sessionOutcome[sessionOutcome.length - 1].success_pct) : null;
  // Searcher-vs-non-searcher conversion cohort, surfaced as a "Conversion impact" block
  // at the top of the Overview tab. Prefer the full W1–W6 cohort (built from the weekly
  // assets-page-views); fall back to the launch-week deep-export cohort (Apr 2–9, anon-id).
  const cohortW = rowsOf(data, "conv_cohortW")[0] || null;
  const cohort8 = rowsOf(data, "conv_cohort")[0] || null;
  const cohort = cohortW || cohort8;
  const cohortLabel = cohortW
    ? `${weeks[0]}–${lastWeek} · Apr 2 – May 13 2026 · user-id level`
    : "launch week · Apr 2–9 2026 · anon-id level";
  const daily = cohortW ? [] : rowsOf(data, "conv_daily");

  // Search adoption — the reach metric framing the entire funnel. Only available when
  // assets_page_views are loaded (same gate as cohortW). Compute overall as sum-of-
  // searchers ÷ sum-of-visitors so weeks with more traffic count proportionally; this
  // does double-count repeat visitors across weeks, which is the right denominator for
  // "weekly adoption" (same person counted each week they came back).
  const adoption = rowsOf(data, "conv_adoption");
  const adoptionSeries = adoption.map((r) => ({
    week: r.week, visitors: Number(r.visitors), searchers: Number(r.searchers), adoption: Number(r.adoption_pct),
  }));
  const adoptionOverallPct = (() => {
    const v = sum(adoption, "visitors"); const s = sum(adoption, "searchers");
    return v ? Math.round((1000 * s) / v) / 10 : null;
  })();
  const adoptionFirst = adoption.length ? Number(adoption[0].adoption_pct) : null;
  const adoptionLast = adoption.length ? Number(adoption[adoption.length - 1].adoption_pct) : null;

  // chart-ready series
  const healthSeries = health.map((r) => ({
    week: r.week, queries: Number(r.queries), zrr: Number(r.zrr_pct), refinement: Number(r.refinement_pct),
  }));
  const funnelSeries = funnel.map((r) => ({
    week: r.week, Focused: Number(r.initiated), Queried: Number(r.queried), Clicked: Number(r.clicked),
  }));
  // Session-outcome funnel series — each searched session classified once.
  const outcomeSeries = sessionOutcome.map((r) => ({
    week: r.week,
    Success: Number(r.success),
    "Relevance gap": Number(r.relevance_gap),
    "Dead end": Number(r.dead_end),
  }));
  const suggSeries = suggestions.map((r) => ({ week: r.week, clicks: Number(r.suggestion_clicks), ctr: Number(r.ctr_pct) }));
  const posSeries = positions.map((r) => ({ rank: `#${r.rank}`, clicks: Number(r.clicks) }));

  return (
    <div className="flex flex-col gap-6">
      {/* live-data refresh — present only when project.refreshable is true */}
      <RefreshControl project={project} state={refreshState} variant="classic" />

      {/* headline stat strip — inline, not a card grid */}
      <Card pad="lg">
        {loading ? (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <StatStrip>
            <Stat label={<Metric k="sessions">Search sessions</Metric>} value={sessions != null ? nf.format(sessions) : "—"}
              hint={`${weeks.length} feature weeks · ${weeks[0]}–${lastWeek}`} />
            {adoptionOverallPct != null && (
              <Stat label={<Metric k="adoption">Search adoption</Metric>} value={pct(adoptionOverallPct)}
                hint={`${nf.format(sum(adoption, "searchers"))} of ${nf.format(sum(adoption, "visitors"))} visitors used search`}
                delta={<DeltaChip from={adoptionFirst} to={adoptionLast} goodIsDown={false} suffix="pt" />} />
            )}
            <Stat label={<Metric k="successRate">Search success rate</Metric>} value={pct(outcomeSuccessPct)}
              valueColor={outcomeSuccessPct != null ? color.teal[600] : undefined}
              hint="searched sessions ending in a result click"
              delta={<DeltaChip from={successFirst} to={successLast} goodIsDown={false} suffix="pt" />} />
            <Stat label={<Metric k="zrr">Query-level ZRR</Metric>} value={pct(overallZrr)}
              valueColor={overallZrr != null ? zrrColor(overallZrr) : undefined}
              hint={`${nf.format(totalQueries)} queries`}
              delta={<DeltaChip from={zrrFirst} to={zrrLast} suffix="pt" />} />
            <Stat label={<Metric k="refinement">Refinement rate</Metric>} value={pct(overallRefine)} hint="user iterating mid-search" />
            <Stat label={<Metric k="clicks">Result clicks</Metric>} value={totalClicks ? nf.format(totalClicks) : "—"} hint="from search results" />
            <Stat label={<Metric k="clears">Clear events</Metric>} value={totalClears ? nf.format(totalClears) : "—"} hint="search bar cleared · friction signal" />
            <Stat label={<Metric k="suggestionCtr">Suggestion CTR</Metric>} value={pct(ctrLast)} hint={`focus-time picks · ${lastWeek}`} />
          </StatStrip>
        )}
        {!loading && (
          <p className="mt-4 t-body-xs text-tertiary">
            Search success rate is the headline: every searched session is classified once into success, relevance gap,
            or dead end (see the Search outcome chart below). ZRR is query-level (the correct metric); session-level
            over-counts prefix-typing noise. Clear events are a secondary friction signal, not the primary measure.
          </p>
        )}
      </Card>

      <Tabs defaultValue="overview">
        <TabList>
          <Tab value="overview">Overview</Tab>
          {convOk && <Tab value="conversion">Conversion</Tab>}
          <Tab value="issuers">Issuers</Tab>
          <Tab value="terms">Terms &amp; assets</Tab>
          <Tab value="tracking">Instrumentation</Tab>
        </TabList>

        {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
        <TabPanel value="overview" className="mt-5 flex flex-col gap-6">
          {cohort && <ConversionImpactCard cohort={cohort} daily={daily} label={cohortLabel} />}
          {adoption.length > 0 && (
            <ChartCard
              title={<Metric k="adoption">Search adoption by week</Metric>}
              subtitle="Bars: weekly visitors to the assets page. Line: share that focused the search box at least once."
              loading={loading} error={errOf(data, "conv_adoption")} height={260}
              footer={`Adoption: ${pct(adoptionFirst)} (${weeks[0]}) → ${pct(adoptionLast)} (${lastWeek}). A 1pt move ≈ 160 more searchers/wk.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={adoptionSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="week" {...axisProps} />
                  <YAxis yAxisId="v" {...axisProps} width={48} />
                  <YAxis yAxisId="a" orientation="right" {...axisProps} width={40} unit="%" domain={[0, "dataMax + 2"]} />
                  <Tooltip cursor={{ fill: color.neutral[100] }}
                    content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "adoption" ? `${v}%` : nf.format(v))} />} />
                  <Legend {...legendProps} />
                  <Bar yAxisId="v" dataKey="visitors" name="Visitors" fill={color.navy[200]} radius={[3, 3, 0, 0]} maxBarSize={46} />
                  <Line yAxisId="a" dataKey="adoption" name="Adoption rate" stroke={color.teal[600]} strokeWidth={2.5}
                    dot={{ r: 3, fill: color.teal[600], strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          <ChartCard
            title={<Metric k="zrr">Zero-result rate &amp; query volume by feature week</Metric>}
            subtitle="Bars: queries run. Line: % of queries returning zero results."
            loading={loading} error={errOf(data, "health")} height={300}
            footer={`Launch baseline ${pct(zrrFirst)} → latest ${pct(zrrLast)}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={healthSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} />
                <YAxis yAxisId="v" {...axisProps} width={48} />
                <YAxis yAxisId="z" orientation="right" {...axisProps} width={40} unit="%" domain={[0, "dataMax + 10"]} />
                <Tooltip cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "zrr" ? `${v}%` : nf.format(v))} />} />
                <Legend {...legendProps} />
                <Bar yAxisId="v" dataKey="queries" name="Queries" fill={color.navy[400]} radius={[3, 3, 0, 0]} maxBarSize={46}>
                  {healthSeries.map((d, i) => <Cell key={i} fill={i === healthSeries.length - 1 ? color.navy[200] : color.navy[400]} />)}
                </Bar>
                <Line yAxisId="z" dataKey="zrr" name="Zero-result rate" stroke={color.error[500]} strokeWidth={2.5}
                  dot={{ r: 3, fill: color.error[500], strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={<Metric k="successRate">Search outcome — every searched session, one of three ends</Metric>}
            subtitle="Each searched session counted once. Success: clicked a result. Relevance gap: results shown, nothing clicked. Dead end: every query returned zero results."
            loading={loading} error={errOf(data, "sessionOutcome")} height={300}
            footer={`${pct(outcomeSuccessPct)} of searched sessions end in a result click; the rest split between a relevance gap and a dead end.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={outcomeSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} />
                <YAxis {...axisProps} width={48} />
                <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
                <Legend {...legendProps} />
                <Bar dataKey="Success" stackId="o" fill={color.teal[500]} maxBarSize={46} />
                <Bar dataKey="Relevance gap" stackId="o" fill={color.warning[400]} maxBarSize={46} />
                <Bar dataKey="Dead end" stackId="o" fill={color.error[400]} radius={[3, 3, 0, 0]} maxBarSize={46} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title={<Metric k="sessions">Search funnel by week</Metric>} subtitle="Distinct sessions: focused search → ran a query → clicked a result."
              loading={loading} error={errOf(data, "funnel")} height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="week" {...axisProps} />
                  <YAxis {...axisProps} width={48} />
                  <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
                  <Legend {...legendProps} />
                  <Bar dataKey="Focused" fill={color.navy[200]} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Queried" fill={color.navy[400]} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Clicked" fill={color.teal[500]} radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={<Metric k="suggestionCtr">Suggestion click-through by week</Metric>} subtitle="Sessions that clicked a focus-time top-asset suggestion, ÷ sessions that focused search."
              loading={loading} error={errOf(data, "suggestions")} height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={suggSeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="week" {...axisProps} />
                  <YAxis {...axisProps} width={44} unit="%" />
                  <Tooltip cursor={{ stroke: color.neutral[300] }} content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "ctr" ? `${v}%` : nf.format(v))} />} />
                  <Line dataKey="ctr" name="Suggestion CTR" stroke={color.teal[600]} strokeWidth={2.5}
                    dot={{ r: 3, fill: color.teal[600], strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <ChartCard title={<Metric k="refinement">Refinement rate by week</Metric>} subtitle="Share of queries flagged is_refinement: the user iterating because the first result set wasn't good enough."
              loading={loading} error={errOf(data, "health")} height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={healthSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="week" {...axisProps} />
                  <YAxis {...axisProps} width={44} unit="%" />
                  <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => `${v}%`} />} />
                  <Bar dataKey="refinement" name="Refinement rate" fill={color.warning[400]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <Card pad="md">
              <CardHeader><div><CardTitle>Searches by tab the user was on</CardTitle>
                <CardSubtitle>Search is <span className="t-emphasis-sm">global</span> — it returns every asset type regardless of tab. <code className="font-mono">active_tab</code> is just the surface the user happened to be on; the ZRR / volume split here is <span className="t-emphasis-sm">who searches from where</span>, not the engine being scoped to a tab.</CardSubtitle></div></CardHeader>
              <CardBody>
                {loading ? <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div> : errOf(data, "tabs") ? (
                  <p className="t-body-sm text-tertiary">Could not load.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border-default">
                    {tabs.map((r) => {
                      const max = Math.max(...tabs.map((x) => Number(x.queries) || 0)) || 1;
                      const w = Math.max(4, Math.round((100 * Number(r.queries)) / max));
                      return (
                        <li key={r.tab} className="flex items-center gap-3 py-2">
                          <span className="t-emphasis-md text-body w-16 shrink-0 truncate">{r.tab}</span>
                          <span className="relative h-2 flex-1 rounded-full bg-muted">
                            <span className="absolute inset-y-0 left-0 rounded-full bg-navy-400" style={{ width: `${w}%` }} />
                          </span>
                          <span className="t-body-sm t-num text-secondary w-14 text-right shrink-0">{nf.format(r.queries)}</span>
                          <Badge tone="neutral" variant="soft" className="w-12 justify-center shrink-0"
                            style={{ background: zrrBg(Number(r.zrr_pct)), color: zrrColor(Number(r.zrr_pct)) }}>
                            {r.zrr_pct}%
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </TabPanel>

        {/* ── CONVERSION ───────────────────────────────────────────────── */}
        {convOk && (
          <TabPanel value="conversion" className="mt-5">
            <ConversionView data={data} loading={loading} weeks={weeks} lastWeek={lastWeek} />
          </TabPanel>
        )}

        {/* ── ISSUERS ──────────────────────────────────────────────────── */}
        <TabPanel value="issuers" className="mt-5">
          <IssuersView rows={rowsOf(data, "issuers")} outcomeRows={rowsOf(data, "issuerOutcome")}
            weeks={weeks} lastWeek={lastWeek}
            loading={loading} error={errOf(data, "issuers") || errOf(data, "issuerOutcome")} />
        </TabPanel>

        {/* ── TERMS & ASSETS ───────────────────────────────────────────── */}
        <TabPanel value="terms" className="mt-5 flex flex-col gap-6">
          <Card pad="md">
            <CardHeader>
              <div><CardTitle>Top search terms</CardTitle>
                <CardSubtitle>By volume, with query-level zero-result rate. (Issuer roll-ups come from the offline analysis; here we show raw terms.)</CardSubtitle></div>
            </CardHeader>
            <CardBody>
              {loading ? <TableSkeleton cols={4} /> : errOf(data, "terms") ? <p className="t-body-sm text-tertiary">Could not load.</p> : (
                <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[28rem] border-collapse">
                  <thead>
                    <tr className="t-overline text-tertiary text-left">
                      <th className="pb-2 font-semibold">Term</th>
                      <th className="pb-2 font-semibold text-right">Searches</th>
                      <th className="pb-2 font-semibold text-right">Zero-result rate</th>
                      <th className="pb-2 font-semibold text-right">Refinement</th>
                    </tr>
                  </thead>
                  <tbody className="t-body-sm">
                    {terms.map((r, i) => {
                      const zr = Number(r.zrr_pct);
                      const maxN = Math.max(...terms.map((x) => Number(x.searches) || 0)) || 1;
                      return (
                        <tr key={r.term} className="border-t border-border-default">
                          <td className="py-2 pr-3">
                            <span className="font-mono t-emphasis-md text-heading">{r.term}</span>
                            <span className="ml-2 inline-block h-1.5 rounded-full bg-muted align-middle" style={{ width: 64 }}>
                              <span className="block h-full rounded-full bg-navy-300" style={{ width: `${Math.round((100 * Number(r.searches)) / maxN)}%` }} />
                            </span>
                          </td>
                          <td className="py-2 text-right t-num text-body">{nf.format(r.searches)}</td>
                          <td className="py-2 text-right">
                            <span className="inline-block rounded-xs px-1.5 py-0.5 t-emphasis-sm t-num"
                              style={{ background: zrrBg(zr), color: zrrColor(zr) }}>{zr}%</span>
                          </td>
                          <td className="py-2 text-right t-num text-secondary">{r.refinement_pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Card pad="md">
              <CardHeader><div><CardTitle>Most-clicked assets</CardTitle><CardSubtitle>Where search clicks actually land, and the average result position.</CardSubtitle></div></CardHeader>
              <CardBody>
                {loading ? <TableSkeleton cols={3} /> : errOf(data, "assets") ? <p className="t-body-sm text-tertiary">Could not load.</p> : (
                  <ul className="flex flex-col divide-y divide-border-default">
                    {assets.map((r) => (
                      <li key={r.asset} className="flex items-center gap-3 py-2">
                        <span className="t-emphasis-md text-heading min-w-0 flex-1 truncate">{r.asset}</span>
                        {r.type && <Badge tone="navy" variant="soft" className="shrink-0">{r.type}</Badge>}
                        <span className="t-body-sm text-tertiary shrink-0">avg rank {r.avg_rank ?? "—"}</span>
                        <span className="t-emphasis-md t-num text-body w-12 text-right shrink-0">{nf.format(r.clicks)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <ChartCard title="Click position bias" subtitle="Where in the result list clicks land (rank 1 = top result). The top slot dominates."
              loading={loading} error={errOf(data, "positions")} height={240}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={posSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="rank" {...axisProps} />
                  <YAxis {...axisProps} width={48} />
                  <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
                  <Bar dataKey="clicks" name="Clicks" fill={color.navy[500]} radius={[3, 3, 0, 0]} maxBarSize={34}>
                    <LabelList dataKey="clicks" position="top" className="fill-tertiary" style={{ fontSize: 10 }} formatter={(v) => nf.format(v)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <Card pad="md">
            <CardHeader><div><CardTitle>Top zero-result queries</CardTitle><CardSubtitle>From <code className="font-mono">asset_search_empty_state</code> — one row per unique query that returned nothing. These are the catalog/alias gaps.</CardSubtitle></div></CardHeader>
            <CardBody>
              {loading ? <TableSkeleton cols={2} /> : errOf(data, "zeroQueries") ? <p className="t-body-sm text-tertiary">Could not load.</p> : (
                <div className="flex flex-wrap gap-2">
                  {zeroQueries.map((r) => (
                    <span key={r.term} className="inline-flex items-center gap-2 rounded-xs border border-border-default bg-page px-2 py-1">
                      <span className="font-mono t-emphasis-sm text-heading">{r.term}</span>
                      <span className="t-body-xs t-num text-error-600">{nf.format(r.hits)}×</span>
                    </span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </TabPanel>

        {/* ── INSTRUMENTATION ──────────────────────────────────────────── */}
        <TabPanel value="tracking" className="mt-5 flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card pad="md">
              <CardHeader><div><CardTitle>Captured well</CardTitle></div></CardHeader>
              <CardBody>
                <ul className="flex flex-col gap-3 t-body-sm">
                  {[
                    ["asset_search_query", "query_text, results_count, is_refinement, active_tab — query-level ZRR & refinement are exact."],
                    ["asset_search_result_clicked", "result_position, clicked_asset_name/type — position bias and click destinations are exact."],
                    ["asset_search_empty_state", "one row per unique zero-result query — clean catalog-gap list."],
                    ["asset_search_suggestion_clicked", "focus-time top-asset picks (suggestion_type, item_position) — pre-search discovery is measurable."],
                    ["invest_now_button_clicked + quick_checkout_invest_clicked", "post-search funnel events (user_id, asset_id, timestamp, product_category) — Searchers CVR, the clicked vs no-click split, and the asset-level search→invest rate are all live in the Conversion tab."],
                  ].map(([ev, note]) => (
                    <li key={ev} className="flex gap-3">
                      <Badge tone="success" variant="soft" dot className="mt-0.5 shrink-0">live</Badge>
                      <span><code className="font-mono t-emphasis-sm text-heading">{ev}</code> — {note}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card pad="md">
              <CardHeader><div><CardTitle>Gaps to close</CardTitle></div></CardHeader>
              <CardBody>
                <ul className="flex flex-col gap-3 t-body-sm">
                  {[
                    ["asset_search_cleared payload (W1–W3)", "The W1–W3 export only has timestamp/session/user/active_tab; W4+ carry had_results & any_result_clicked. Low priority — the primary search-health metric is the session-outcome funnel, which needs no cleared payload; clears are now only a secondary friction signal."],
                    ["Conversion: window + paid orders", "The Conversion tab joins search to invest_now / quick_checkout on same-day user_id. invest_now is an intent event, not a paid order; same-day misses multi-day journeys; and there's no browse-population table, so a true search lift vs non-searchers isn't computable. Add tblorders + a 1–3 day window + a page/asset-view event to close these."],
                  ].map(([ev, note]) => (
                    <li key={ev} className="flex gap-3">
                      <Badge tone="warning" variant="soft" dot className="mt-0.5 shrink-0">todo</Badge>
                      <span><span className="t-emphasis-sm text-heading">{ev}</span> — {note}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>
          <p className="t-body-xs text-tertiary">
            Every figure on this page is computed live from the DuckDB views via <code className="font-mono">POST /api/projects/{project.id}/query</code>.
            The query builders live in <code className="font-mono">lib/queries/assetSearch.js</code> — edit there to change a metric definition.
          </p>
        </TabPanel>
      </Tabs>
    </div>
  );
}

function TableSkeleton({ cols = 3, rows = 6 }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-6 ${c === 0 ? "flex-1" : "w-16"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Issuers view ─────────────────────────────────────────────────────────── */

const CAT_BADGE = {
  healthy:      { tone: "success", variant: "soft" },
  alias:        { tone: "warning", variant: "soft" },
  availability: { tone: "error",   variant: "soft" },
  catalog_gap:  { tone: "error",   variant: "solid" },
};
const CAT_ORDER = ["catalog_gap", "availability", "alias", "healthy"];

const ZrrDot = (props) => {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={4.5} fill={zrrColor(Number(payload.zrr))} stroke={color.neutral[0]} strokeWidth={1.5} />;
};

// Joins the per-week issuer DB rows (issuerHealthByWeek) with the per-week
// session-outcome rows (sessionOutcomeByIssuerWeek) and ISSUER_MAP's curated
// metadata. Success / relevance gap / dead end are live from DuckDB — the same
// builders the Editorial dashboard uses, so both renderings agree.
function buildIssuers(rows, outcomeRows, weeks) {
  const byIssuer = new Map();
  for (const r of rows) {
    if (!byIssuer.has(r.issuer)) byIssuer.set(r.issuer, {});
    byIssuer.get(r.issuer)[r.week] = r;
  }
  const byOutcome = new Map();
  for (const r of outcomeRows || []) {
    if (!byOutcome.has(r.issuer)) byOutcome.set(r.issuer, {});
    byOutcome.get(r.issuer)[r.week] = r;
  }
  return ISSUER_MAP.map((meta) => {
    const wkMap = byIssuer.get(meta.name) || {};
    const oMap = byOutcome.get(meta.name) || {};
    const series = weeks.map((w) => {
      const r = wkMap[w] || {};
      const o = oMap[w] || {};
      return {
        week: w,
        sessions: Number(r.sessions) || 0,
        queries: Number(r.queries) || 0,
        zrr: r.zrr_pct == null ? 0 : Number(r.zrr_pct),
        refinement: r.refinement_pct == null ? 0 : Number(r.refinement_pct),
        success: Number(o.success) || 0,
        relgap: Number(o.relevance_gap) || 0,
        deadEnd: Number(o.dead_end) || 0,
        outcomeSearched: Number(o.searched) || 0,
      };
    });
    const sumKey = (k) => series.reduce((a, s) => a + (s[k] || 0), 0);
    const totSessions = sumKey("sessions"), totQueries = sumKey("queries");
    const totSuccess = sumKey("success"), totRelgap = sumKey("relgap"),
          totDeadEnd = sumKey("deadEnd"), totOutcomeSearched = sumKey("outcomeSearched");
    const successPct = totOutcomeSearched ? Math.round((1000 * totSuccess) / totOutcomeSearched) / 10 : null;
    const avgZrr = totQueries ? Math.round((10 * series.reduce((a, s) => a + s.zrr * s.queries, 0)) / totQueries) / 10 : null;
    const avgRefine = totQueries ? Math.round((10 * series.reduce((a, s) => a + s.refinement * s.queries, 0)) / totQueries) / 10 : null;
    const half = Math.ceil(weeks.length / 2);
    const early = avgOf(series.slice(0, half).map((s) => s.zrr));
    const late = avgOf(series.slice(half).map((s) => s.zrr));
    const zrrDelta = early == null || late == null ? null : Math.round((late - early) * 10) / 10;
    const peak = series.reduce((m, s) => (s.zrr > (m?.zrr ?? -1) ? s : m), null);
    return { ...meta, series, totSessions, totQueries, totSuccess, totRelgap, totDeadEnd,
      totOutcomeSearched, successPct, avgZrr, avgRefine, zrrDelta, peak, early, late };
  }).filter((i) => i.totSessions > 0)
    .sort((a, b) => (b.avgZrr ?? 0) - (a.avgZrr ?? 0));
}
function avgOf(xs) { return xs.length ? Math.round((10 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 10 : null; }

function CardStat({ k, label, value, valueColor, align }) {
  return (
    <span className="min-w-0">
      <span className="block t-overline text-tertiary">{k ? <Metric k={k} align={align}>{label}</Metric> : label}</span>
      <span className="block t-display-sm t-num mt-0.5" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </span>
  );
}
function InlineStat({ k, label, value, valueColor, align }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="t-overline text-tertiary">{k ? <Metric k={k} align={align}>{label}</Metric> : label}</span>
      <span className="t-emphasis-md t-num" style={valueColor ? { color: valueColor } : { color: color.neutral[900] }}>{value}</span>
    </span>
  );
}

function IssuersView({ rows, outcomeRows, weeks, lastWeek, loading, error }) {
  const issuers = React.useMemo(() => buildIssuers(rows, outcomeRows, weeks), [rows, outcomeRows, weeks]);
  const [filter, setFilter] = React.useState("all");
  const [selected, setSelected] = React.useState(null);
  // Scroll the detail panel into view when the user picks an issuer. Mobile
  // would otherwise leave the chart far below the fold — the cards take the
  // whole viewport, so a tap appears to "do nothing" until you scroll. We skip
  // the initial render so the detail of the auto-picked first issuer doesn't
  // hijack the page on load.
  const detailRef = React.useRef(null);
  const userInteractedRef = React.useRef(false);
  const pickIssuer = React.useCallback((name) => {
    userInteractedRef.current = true;
    setSelected(name);
  }, []);
  React.useEffect(() => {
    if (!userInteractedRef.current || !detailRef.current) return;
    detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  const shown = filter === "all" ? issuers : issuers.filter((i) => i.category === filter);
  // Detail panel stays hidden until the user explicitly picks an issuer card
  // — no auto-fallback to shown[0]/issuers[0]. The cards above are the index;
  // the detail is the deep-dive, opened on demand.
  const current = selected ? issuers.find((i) => i.name === selected) || null : null;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Card pad="md"><Skeleton className="h-8 w-72" /></Card>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i} pad="md"><Skeleton className="h-28 w-full" /></Card>)}
        </div>
      </div>
    );
  }
  if (error) return <Card pad="lg" className="text-center t-body-sm text-tertiary">Could not load the issuer roll-up. {error}</Card>;
  if (!issuers.length) return <Card pad="lg" className="text-center t-body-sm text-tertiary">No issuer-mappable searches found.</Card>;

  const counts = CAT_ORDER.reduce((m, c) => ({ ...m, [c]: issuers.filter((i) => i.category === c).length }), {});
  const totalSessions = issuers.reduce((a, i) => a + i.totSessions, 0);
  // Per-issuer session-outcome funnel for the selected issuer's detail panel.
  const outcomeSeries = current
    ? current.series.map((s) => ({ week: s.week, Success: s.success, "Relevance gap": s.relgap, "Dead end": s.deadEnd }))
    : [];
  const outcomePct = (n) => (current && current.totOutcomeSearched
    ? Math.round((1000 * (n || 0)) / current.totOutcomeSearched) / 10
    : null);

  return (
    <div className="flex flex-col gap-6">
      <Card pad="md">
        <CardHeader>
          <div>
            <CardTitle>Search health by issuer</CardTitle>
            <CardSubtitle>
              <code className="font-mono">query_text</code> mapped to an issuer by leading-prefix / alias rules; prefix variants (aka, akar, akara) collapse into one issuer.
              Sessions, query-level ZRR, refinement and the search-outcome split (success / relevance gap / dead end) are all computed live from the DuckDB views.
              Only the category and the read on each issuer are human-written. Hover any{" "}
              <span className="inline-flex size-3.5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-tertiary align-middle">?</span> for the exact definition and source.
            </CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All <span className="t-body-xs text-tertiary">({issuers.length})</span></FilterChip>
            {CAT_ORDER.filter((c) => counts[c]).map((c) => (
              <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)} tone={CAT_BADGE[c].tone}>
                {ISSUER_CATEGORY[c].label} <span className="t-body-xs opacity-70">({counts[c]})</span>
              </FilterChip>
            ))}
            <span className="ml-auto t-body-xs text-tertiary">{nf.format(totalSessions)} issuer-mapped sessions across {weeks.length} weeks</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((iss) => {
          const active = current && current.name === iss.name;
          return (
            <div key={iss.name} role="button" tabIndex={0} onClick={() => pickIssuer(iss.name)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickIssuer(iss.name); } }}
              className={`cursor-pointer rounded-md border bg-surface p-4 text-left transition-shadow duration-200 outline-none ${active ? "border-navy-300 shadow-md ring-1 ring-navy-200" : "border-border-default shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-navy-300"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="t-heading-md text-heading">{iss.name}</span>
                <Badge tone={CAT_BADGE[iss.category].tone} variant={CAT_BADGE[iss.category].variant} className="shrink-0">{ISSUER_CATEGORY[iss.category].label}</Badge>
              </div>
              <div className="mt-2 flex items-end gap-3 sm:gap-5">
                <CardStat label="Sessions" value={nf.format(iss.totSessions)} valueColor={color.neutral[900]} />
                <CardStat label="Avg ZRR" value={iss.avgZrr == null ? "—" : `${iss.avgZrr}%`} valueColor={iss.avgZrr == null ? color.neutral[400] : zrrColor(iss.avgZrr)} />
                <CardStat k="successRate" label="Success" value={iss.successPct == null ? "—" : `${iss.successPct}%`}
                  valueColor={iss.successPct == null ? color.neutral[400] : color.teal[700]} />
                <div className="ml-auto self-center"><DeltaChip from={iss.early} to={iss.late} suffix="pt" /></div>
              </div>
              <div className="mt-3 h-11" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={iss.series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <Area dataKey="sessions" stroke={color.navy[400]} strokeWidth={1.5} fill={color.navy[100]} fillOpacity={0.7} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>

      {current && (
        <Card pad="lg" ref={detailRef}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-display-md text-heading">{current.name}</span>
              <Badge tone={CAT_BADGE[current.category].tone} variant={CAT_BADGE[current.category].variant}>{ISSUER_CATEGORY[current.category].label}</Badge>
              {current.peak && current.peak.zrr > 0 && <span className="t-body-sm text-tertiary">peak ZRR {current.peak.zrr}% in {current.peak.week}</span>}
            </div>
          </CardHeader>
          <CardBody className="grid gap-7 lg:grid-cols-[1.55fr_1fr]">
            <div className="flex flex-col gap-6">
              <div>
                <div className="t-label-md text-tertiary mb-1 flex items-center gap-1.5">
                  <Metric k="sessions">Sessions</Metric> <span className="text-neutral-300">(area)</span> and <Metric k="zrr">zero-result rate</Metric> <span className="text-neutral-300">(line, dot colour = severity)</span> by feature week
                </div>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={current.series} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="week" {...axisProps} />
                      <YAxis yAxisId="s" {...axisProps} width={40} />
                      <YAxis yAxisId="z" orientation="right" {...axisProps} width={42} unit="%" domain={[0, (m) => Math.max(20, Math.ceil((m + 10) / 10) * 10)]} />
                      <Tooltip cursor={{ fill: color.neutral[100] }}
                        content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "zrr" || p.dataKey === "refinement" ? `${v}%` : nf.format(v))} />} />
                      <Legend {...legendProps} />
                      <Area yAxisId="s" dataKey="sessions" name="Sessions" stroke={color.navy[400]} strokeWidth={2} fill={color.navy[100]} fillOpacity={0.6} />
                      <Line yAxisId="z" dataKey="zrr" name="Zero-result rate" stroke={color.neutral[400]} strokeWidth={2} dot={<ZrrDot />} activeDot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="t-label-md text-tertiary mb-1 flex items-center gap-1.5">
                  <Metric k="successRate">Search outcome</Metric> by feature week — each searched session classified once
                </div>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outcomeSeries} margin={{ top: 28, right: 8, bottom: 0, left: -16 }} barGap={2}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="week" {...axisProps} />
                      <YAxis {...axisProps} width={36} allowDecimals={false} />
                      <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
                      <Legend {...legendProps} />
                      <Bar dataKey="Success" stackId="a" fill={color.teal[500]} maxBarSize={26} />
                      <Bar dataKey="Relevance gap" stackId="a" fill={color.warning[400]} maxBarSize={26} />
                      <Bar dataKey="Dead end" stackId="a" fill={color.error[400]} radius={[3, 3, 0, 0]} maxBarSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 t-body-xs text-tertiary">Live from <code className="font-mono">asset_search_query</code> + <code className="font-mono">asset_search_result_clicked</code> — success, relevance gap and dead end are exact for every week.</p>
              </div>
              <div className="flex flex-wrap gap-x-7 gap-y-2">
                <InlineStat k="sessions" label="Sessions" value={nf.format(current.totSessions)} />
                <InlineStat k="queries" label="Queries" value={nf.format(current.totQueries)} />
                <InlineStat k="zrr" label="Avg ZRR" value={current.avgZrr == null ? "—" : `${current.avgZrr}%`} valueColor={current.avgZrr == null ? color.neutral[400] : zrrColor(current.avgZrr)} />
                <InlineStat k="refinement" label="Refinement" value={current.avgRefine == null ? "—" : `${current.avgRefine}%`} />
                <InlineStat k="successRate" label="Success" align="right"
                  value={outcomePct(current.totSuccess) == null ? nf.format(current.totSuccess) : `${nf.format(current.totSuccess)} · ${outcomePct(current.totSuccess)}%`}
                  valueColor={color.teal[700]} />
                <InlineStat k="relevanceGap" label="Rel. gap" align="right"
                  value={outcomePct(current.totRelgap) == null ? nf.format(current.totRelgap) : `${nf.format(current.totRelgap)} · ${outcomePct(current.totRelgap)}%`}
                  valueColor={color.warning[700]} />
                <InlineStat k="deadEnd" label="Dead end" align="right"
                  value={outcomePct(current.totDeadEnd) == null ? nf.format(current.totDeadEnd) : `${nf.format(current.totDeadEnd)} · ${outcomePct(current.totDeadEnd)}%`}
                  valueColor={color.error[600]} />
                <span className="inline-flex items-baseline gap-1.5"><span className="t-overline text-tertiary">Early → late ZRR</span><DeltaChip from={current.early} to={current.late} suffix="pt" /></span>
              </div>
            </div>
            <div className="flex flex-col gap-5">
              <div>
                <div className="t-overline text-tertiary mb-1.5">The read</div>
                <p className="t-body-sm text-body leading-relaxed">{current.note}</p>
              </div>
              <div>
                <div className="t-overline text-tertiary mb-1.5">Matched on</div>
                <div className="flex flex-wrap gap-1.5">
                  {current.keywords.map((k) => (
                    <span key={k} className="rounded-xs bg-page border border-border-default px-1.5 py-0.5 font-mono t-emphasis-sm text-secondary">{k}</span>
                  ))}
                </div>
                <p className="mt-2 t-body-xs text-tertiary">SQL prefix rule: {current.prefixes.map((p) => `LOWER(query_text) LIKE '${p}%'`).join(" OR ")}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, tone, children }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-3 py-1 t-emphasis-sm transition-colors ${
        active
          ? tone === "success" ? "border-success-300 bg-status-success-bg text-success-700"
            : tone === "warning" ? "border-warning-300 bg-status-warning-bg text-warning-800"
            : tone === "error" ? "border-error-300 bg-status-error-bg text-error-700"
            : "border-navy-300 bg-tint-navy text-navy-700"
          : "border-border-default bg-surface text-secondary hover:bg-muted"
      }`}>
      {children}
    </button>
  );
}

/* ── Conversion ("Business") view ─────────────────────────────────────────── */

const pct1 = (v) => (v == null || !isFinite(v) ? "—" : `${Math.round(v * 10) / 10}%`);
const lift1 = (x) => (x == null || !isFinite(x) ? "—" : `${Math.round(x * 100) / 100}×`);

/**
 * "Conversion impact" block for the Overview tab — searchers vs non-searchers CVR and
 * the real search lift. Fed either the full W1–W6 cohort (built from the weekly
 * assets-page-views) or the launch-week deep-export cohort; same column shape either way.
 * `label` describes the window/grain; `daily` (the launch-week funnel) is optional.
 */
function ConversionImpactCard({ cohort, daily, label }) {
  if (!cohort) return null;
  const n = (k) => Number(cohort[k]) || 0;
  const cvr = (a, b) => (b ? (100 * a) / b : null);
  const overall = cvr(n("conv_total"), n("n_total"));
  const srch = cvr(n("conv_searchers"), n("n_searchers"));
  const nonsrch = cvr(n("conv_nonsearchers"), n("n_nonsearchers"));
  const clk = cvr(n("conv_clicked"), n("n_clicked"));
  const lift = srch != null && nonsrch ? srch / nonsrch : null;
  const clkLift = clk != null && nonsrch ? clk / nonsrch : null;
  const maxCvr = Math.max(clk || 0, srch || 0, nonsrch || 0, 1);
  const isFullWindow = !(daily && daily.length); // the 8-day cohort ships a daily funnel; the W1–W6 one doesn't
  const cvrVals = (daily || []).map((d) => Number(d.overall_cvr_pct)).filter((x) => isFinite(x));
  const dRange = cvrVals.length ? `${Math.min(...cvrVals)}–${Math.max(...cvrVals)}%` : null;
  const liftGood = lift != null && lift >= 1.5;
  const rows = [
    { key: "non", label: "Non-searchers — browsed, never searched", n: n("n_nonsearchers"), conv: n("conv_nonsearchers"), cvr: nonsrch, fill: color.navy[400], lift: null },
    { key: "srch", label: "Searchers — focused the search box", n: n("n_searchers"), conv: n("conv_searchers"), cvr: srch, fill: color.teal[500], lift },
    { key: "clk", label: "…and clicked a search result", n: n("n_clicked"), conv: n("conv_clicked"), cvr: clk, fill: color.teal[700], lift: clkLift, indent: true },
  ];
  return (
    <Card pad="lg">
      <CardHeader>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <CardTitle>Conversion impact</CardTitle>
          <span className="t-body-sm text-tertiary">{label}</span>
        </div>
      </CardHeader>
      <CardBody className="grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(11rem,auto)_1fr] lg:items-center">
        {/* hero: the lift */}
        <div className="lg:border-r lg:border-border-default lg:pr-12">
          <div className="t-overline text-tertiary"><Metric k="searchLift">Search lift</Metric></div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="t-display-xl t-num leading-none" style={{ color: color.teal[700] }}>{lift1(lift)}</span>
            <Badge tone={liftGood ? "success" : "warning"} variant="soft">{liftGood ? "above target" : "below 1.5× target"}</Badge>
          </div>
          <p className="mt-2 t-body-sm text-secondary max-w-[15rem]">Searchers convert {lift1(lift)} the rate of visitors who never searched. Clicking a result pushes it to {lift1(clkLift)}.</p>
        </div>
        {/* the three cohorts as proportional bars */}
        <div className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <div key={row.key} className={row.indent ? "pl-3 sm:pl-4" : ""}>
              {/* mobile: stack label over metrics; sm+: same row, right-aligned columns */}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
                <span className="t-emphasis-md text-heading">{row.label}</span>
                <span className="inline-flex items-baseline gap-2 sm:gap-2.5">
                  {row.lift != null && <span className="t-emphasis-sm t-num" style={{ color: color.teal[700] }}>↑ {lift1(row.lift)}</span>}
                  <span className="t-emphasis-md t-num text-heading sm:w-14 sm:text-right">{pct1(row.cvr)}</span>
                  <span className="t-body-xs t-num text-tertiary sm:w-28 sm:text-right">{nf.format(row.conv)} / {nf.format(row.n)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round(((row.cvr || 0) / maxCvr) * 100))}%`, background: row.fill }} />
              </div>
            </div>
          ))}
        </div>
      </CardBody>
      <p className="mt-2 t-body-xs text-tertiary">
        Overall visitor CVR <span className="t-emphasis-sm">{pct1(overall)}</span> &mdash; {nf.format(n("conv_total"))} of {nf.format(n("n_total"))} visitors clicked Invest&nbsp;Now / Quick&nbsp;Checkout{dRange ? `; daily CVR ranged ${dRange}` : ""}.{" "}
        {isFullWindow
          ? <>Visitors = anyone who viewed an assets page (or initiated a search) in the window; converted = appeared in an invest event. <code className="font-mono">invest_now</code> is intent, not a paid order. The <span className="t-emphasis-sm">Conversion</span> tab has the per-week trend, top converting queries, and asset-level detail.</>
          : <>From the launch-week deep export's pre-computed cohort &amp; daily funnel (Apr 2–9, anon-id level). The <span className="t-emphasis-sm">Conversion</span> tab has the W1–W6 view; load the weekly assets-page-views to extend this card to the full window.</>}
      </p>
    </Card>
  );
}

function ConversionView({ data, loading, weeks, lastWeek }) {
  const h = rowsOf(data, "conv_headline")[0] || {};
  const a = rowsOf(data, "conv_assetRate")[0] || {};
  const byWeek = rowsOf(data, "conv_byWeek");
  const queries = rowsOf(data, "conv_queries");
  const byCat = rowsOf(data, "conv_byCat");
  const cohort = rowsOf(data, "conv_cohortW")[0] || rowsOf(data, "conv_cohort")[0] || null;
  const cohortIsFullWindow = !!rowsOf(data, "conv_cohortW")[0];
  const headlineErr = errOf(data, "conv_headline");
  // real searcher-vs-non-searcher lift + CVRs, from the cohort (W1–W6 if available, else launch week)
  const cohortSrchCvr = cohort && Number(cohort.n_searchers) ? (100 * Number(cohort.conv_searchers)) / Number(cohort.n_searchers) : null;
  const cohortNonCvr = cohort && Number(cohort.n_nonsearchers) ? (100 * Number(cohort.conv_nonsearchers)) / Number(cohort.n_nonsearchers) : null;
  const cohortLift = cohortSrchCvr != null && cohortNonCvr ? cohortSrchCvr / cohortNonCvr : null;

  // Weekly cohort lift trend — same math as the cumulative `cohortLift` above
  // but emitted per feature week so the dashboard shows the lift TREND, not
  // only the W1–{lastWeek} average. Empty when pageViewsOk is false (the
  // by-week query is gated on it in COHORT_W_SPECS).
  const liftSeries = rowsOf(data, "conv_cohortW_byWeek").map((r) => ({
    week: r.week,
    lift: r.lift == null ? null : Number(r.lift),
    "Searcher CVR": r.srch_cvr_pct == null ? null : Number(r.srch_cvr_pct),
    "Non-searcher CVR": r.non_cvr_pct == null ? null : Number(r.non_cvr_pct),
  }));

  const searchers = Number(h.searchers) || 0;
  const clickers = Number(h.clickers) || 0;
  const noclick = Math.max(0, searchers - clickers);
  const convSearchers = Number(h.conv_searchers) || 0;
  const convClickers = Number(h.conv_clickers) || 0;
  const convNoclick = Math.max(0, convSearchers - convClickers);
  const everSearchers = Number(h.searchers_invested_ever) || 0;
  const investUsers = Number(h.invest_users) || 0;

  const searchersCvr = searchers ? (100 * convSearchers) / searchers : null;
  const everCvr = searchers ? (100 * everSearchers) / searchers : null;
  const clickedCvr = clickers ? (100 * convClickers) / clickers : null;
  const noclickCvr = noclick ? (100 * convNoclick) / noclick : null;
  const ratio = clickedCvr != null && noclickCvr ? clickedCvr / noclickCvr : null;
  const assetClicks = Number(a.click_events) || 0;
  const assetMatched = Number(a.matched) || 0;
  const assetRate = assetClicks ? (100 * assetMatched) / assetClicks : null;
  // Investor-base split: of everyone who hit an invest event in the window, how many
  // also used search ("search-influenced") vs never searched. A true non-searcher CVR
  // would need a total-visitor / page-view table, which this 8-event export doesn't have.
  const browseOnlyInvestors = Math.max(0, investUsers - everSearchers);
  const searchPenetration = investUsers ? (100 * everSearchers) / investUsers : null;
  const round2 = (x) => (x == null || !isFinite(x) ? "—" : `${Math.round(x * 100) / 100}×`);

  const investEvents = byWeek.reduce((s, r) => s + (Number(r.invest_events) || 0), 0);
  const weekSeries = byWeek.map((r) => {
    const s = Number(r.searchers) || 0, c = Number(r.clickers) || 0;
    return {
      week: r.week,
      searcherCvr: s ? Math.round((1000 * Number(r.conv_searchers)) / s) / 10 : 0,
      clickerCvr: c ? Math.round((1000 * Number(r.conv_clickers)) / c) / 10 : 0,
      investEvents: Number(r.invest_events) || 0,
    };
  });
  const cvrEarly = weekSeries.length ? weekSeries[0].searcherCvr : null;
  const cvrLate = weekSeries.length ? weekSeries[weekSeries.length - 1].searcherCvr : null;
  const maxCat = Math.max(1, ...byCat.map((r) => Number(r.events) || 0));
  const maxConv = Math.max(1, ...queries.map((r) => Number(r.converters) || 0));

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Card pad="lg"><div className="flex flex-wrap gap-x-10 gap-y-4">{Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-16" /></div>))}</div></Card>
        <div className="grid gap-6 lg:grid-cols-2"><Card pad="md"><Skeleton className="h-44 w-full" /></Card><Card pad="md"><Skeleton className="h-44 w-full" /></Card></div>
      </div>
    );
  }
  if (headlineErr) {
    return <Card pad="lg" className="text-center t-body-sm text-tertiary">Could not load the conversion roll-up. {headlineErr}</Card>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card pad="lg">
        {/* Searchers vs everyone who invested — the headline comparison */}
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[1.05fr_1px_1fr]">
          <div>
            <div className="t-overline text-tertiary"><Metric k="searchersCvr">Searchers → invest · same-day</Metric></div>
            <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="t-display-md t-num" style={{ color: color.teal[600] }}>{pct1(searchersCvr)}</span>
              <span className="t-body-sm text-tertiary pb-0.5">of the {nf.format(searchers)} who focused the search box · up to {pct1(everCvr)} within the window</span>
            </div>
            <div className="mt-3 flex flex-col gap-1.5 t-body-sm">
              <span className="text-body">{nf.format(convSearchers)} invested the same day</span>
              <span className="inline-flex items-center gap-2 text-body">
                <Badge tone="success" variant="soft">↑ {round2(ratio)}</Badge>
                when they click a result&nbsp;&mdash;&nbsp;{pct1(clickedCvr)} vs {pct1(noclickCvr)} for no click
              </span>
            </div>
          </div>
          <div className="hidden lg:block w-px bg-border-default" />
          <div>
            <div className="t-overline text-tertiary">Everyone who invested · {weeks[0]}–{lastWeek}</div>
            <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="t-display-md t-num text-heading">{nf.format(investUsers)}</span>
              <span className="t-body-sm text-tertiary pb-0.5">distinct users hit Invest&nbsp;Now / Quick&nbsp;Checkout ({nf.format(investEvents)} events)</span>
            </div>
            <div className="mt-3 h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full" style={{ width: `${searchPenetration ?? 0}%`, background: color.teal[500] }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 t-body-sm">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: color.teal[500] }} /> <span className="t-emphasis-md text-heading">{pct1(searchPenetration)}</span> <span className="text-secondary">search-influenced ({nf.format(everSearchers)})</span></span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: color.neutral[400] }} /> <span className="text-body">{pct1(searchPenetration == null ? null : 100 - searchPenetration)}</span> <span className="text-secondary">never searched ({nf.format(browseOnlyInvestors)})</span></span>
            </div>
            <p className="mt-2 t-body-xs text-tertiary">
              {cohortLift != null ? (
                <>A true search <span className="t-emphasis-sm">lift</span> &mdash; searchers vs visitors who never searched &mdash; is <span className="t-emphasis-sm">{lift1(cohortLift)}</span> ({pct1(cohortSrchCvr)} vs {pct1(cohortNonCvr)}{cohortIsFullWindow ? ", W1–W6" : ", launch week"}). The full breakdown is in <span className="t-emphasis-sm">Conversion impact</span> on the Overview tab; this panel is the stricter same-day <code className="font-mono">user_id</code> view. Also: search touches {pct1(searchPenetration)} of all converters, and {pct1(assetRate)} of result clicks become a same-day invest on that exact asset.</>
              ) : (
                <>A non-searcher <span className="t-emphasis-sm">CVR</span> &mdash; and a true search lift &mdash; needs a total-visitor / page-view event, which isn't loaded. What <em>is</em> measurable here: search touches {pct1(searchPenetration)} of all converters, and {pct1(assetRate)} of result clicks become a same-day invest on that exact asset.</>
              )}
            </p>
          </div>
        </div>

        {/* supporting CVRs — fixed 3-up grid, no awkward wrap */}
        <div className="mt-6 border-t border-border-default pt-5 grid gap-x-8 gap-y-5 sm:grid-cols-3">
          <Stat label={<Metric k="clickedCvr">Clicked a result → CVR</Metric>} value={pct1(clickedCvr)} valueColor={color.teal[700]}
            hint={`${nf.format(convClickers)} of ${nf.format(clickers)} result-clickers invested same-day`} />
          <Stat label="Searched, no click → CVR" value={pct1(noclickCvr)}
            hint={`${nf.format(convNoclick)} of ${nf.format(noclick)} — the conversion floor for searchers`} />
          <Stat label={<Metric k="searchToInvest">Search → invest rate · asset-level</Metric>} value={pct1(assetRate)}
            hint={`${nf.format(assetMatched)} of ${nf.format(assetClicks)} result clicks → same-day invest on that asset`} />
        </div>

        <p className="mt-4 t-body-xs text-tertiary">
          "Converted" = clicked the <span className="t-emphasis-sm">Invest Now</span> CTA (or a Quick Checkout invest) on the same calendar day (IST) as the search activity, joined on <code className="font-mono">user_id</code>.
          <code className="font-mono">invest_now_button_clicked</code> is an <span className="t-emphasis-sm">intent</span> event, not a paid order; same-day attribution undercounts multi-day journeys, so the real searcher conversion sits between {pct1(searchersCvr)} and {pct1(everCvr)}.
        </p>
      </Card>

      {/* Search lift, week by week — the cumulative cohortLift above is the
          W1–{lastWeek} average; this chart shows the per-week ratio so the
          trend behind the headline number is visible. Hidden when the
          by-week cohort data is unavailable (pageViewsOk gates the SQL). */}
      {liftSeries.length > 0 && (
        <ChartCard
          title={<Metric k="searchLift">Search lift, by week</Metric>}
          subtitle="Same-week conversion rate of searchers ÷ same-week CVR of non-searchers, per feature week. Cross-week conversions (search one week, invest the next) sit outside this view, so the per-week ratio is a lower bound on the cumulative lift. Reference lines: 1× (no lift) and 1.5× (target)."
          loading={loading} error={errOf(data, "conv_cohortW_byWeek")} height={260}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={liftSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="week" {...axisProps} />
              <YAxis {...axisProps} width={44}
                domain={[0, (m) => Math.max(2.5, Math.ceil((m + 0.3) * 2) / 2)]}
                tickFormatter={(v) => `${v}×`} />
              <Tooltip cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "lift" ? `${v}×` : `${v}%`)} />} />
              <Legend {...legendProps} />
              <ReferenceLine y={1.0} stroke={color.neutral[400]} strokeDasharray="3 3"
                label={{ value: "no lift", position: "insideTopRight", fill: color.neutral[500], fontSize: 10 }} />
              <ReferenceLine y={1.5} stroke={color.warning[500]} strokeDasharray="3 3"
                label={{ value: "target 1.5×", position: "insideTopRight", fill: color.warning[700], fontSize: 10 }} />
              <Line dataKey="lift" name="Search lift" stroke={color.teal[600]} strokeWidth={2.5}
                dot={{ r: 3.5, fill: color.teal[600], strokeWidth: 0 }}
                activeDot={{ r: 6, stroke: color.neutral[800], strokeWidth: 1 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card pad="md">
          <CardHeader><div>
            <CardTitle>Does clicking a result matter?</CardTitle>
            <CardSubtitle>Same-day conversion of the {nf.format(searchers)} searchers, split by whether they clicked a search result. A clean partition: {nf.format(clickers)} clicked + {nf.format(noclick)} didn't.</CardSubtitle>
          </div></CardHeader>
          <CardBody>
            <div className="flex flex-col gap-5">
              {[
                { label: "Clicked a search result", n: clickers, conv: convClickers, cvr: clickedCvr, fill: color.teal[500] },
                { label: "Searched, never clicked", n: noclick, conv: convNoclick, cvr: noclickCvr, fill: color.navy[300] },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-emphasis-md text-heading">{row.label}</span>
                    <span className="t-display-sm t-num" style={{ color: row.fill === color.teal[500] ? color.teal[700] : color.neutral[800] }}>{pct1(row.cvr)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.cvr || 0) * 1.6)}%`, background: row.fill }} />
                  </div>
                  <div className="mt-1 t-body-xs text-tertiary t-num">{nf.format(row.conv)} converted · {nf.format(row.n)} searchers</div>
                </div>
              ))}
              <p className="t-body-sm text-body leading-relaxed">
                Result-clickers convert at <span className="t-emphasis-md">{ratio != null ? `${Math.round(ratio * 100) / 100}×` : "—"}</span> the rate of searchers who never clicked.
                Some of that is self-selection — but the asset-level <Metric k="searchToInvest">search → invest rate</Metric> ({pct1(assetRate)} of clicks followed same-day by an invest on that exact asset) is direct follow-through that self-selection alone doesn't explain.
              </p>
            </div>
          </CardBody>
        </Card>

        <ChartCard title={<Metric k="searchersCvr">Same-day CVR by feature week</Metric>}
          subtitle="Bars: invest events that week. Lines: of searchers / result-clickers that week, the % who invested same-day."
          loading={false} error={errOf(data, "conv_byWeek")} height={280}
          footer={`Searcher CVR ${pct1(cvrEarly)} → ${pct1(cvrLate)}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={weekSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="week" {...axisProps} />
              <YAxis yAxisId="cvr" {...axisProps} width={44} unit="%" domain={[0, "dataMax + 10"]} />
              <YAxis yAxisId="ev" orientation="right" {...axisProps} width={48} />
              <Tooltip cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "investEvents" ? nf.format(v) : `${v}%`)} />} />
              <Legend {...legendProps} />
              <Bar yAxisId="ev" dataKey="investEvents" name="Invest events" fill={color.navy[200]} radius={[3, 3, 0, 0]} maxBarSize={40}>
                {weekSeries.map((d, i) => <Cell key={i} fill={i === weekSeries.length - 1 ? color.navy[100] : color.navy[200]} />)}
              </Bar>
              <Line yAxisId="cvr" dataKey="searcherCvr" name="Searcher CVR" stroke={color.teal[600]} strokeWidth={2.5}
                dot={{ r: 3, fill: color.teal[600], strokeWidth: 0 }} activeDot={{ r: 5 }} />
              <Line yAxisId="cvr" dataKey="clickerCvr" name="Result-clicker CVR" stroke={color.navy[500]} strokeWidth={2.5} strokeDasharray="4 3"
                dot={{ r: 3, fill: color.navy[500], strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card pad="md">
          <CardHeader><div>
            <CardTitle>Top converting search queries</CardTitle>
            <CardSubtitle>Distinct users who clicked a result for the query → users who invested the same day. ≥ 5 clickers; ranked by converters. The loan-family and alias-gap terms (loan, akara, mufin, indel, keer…) both convert well — V2 aliases would lift them further.</CardSubtitle>
          </div></CardHeader>
          <CardBody>
            {errOf(data, "conv_queries") ? <p className="t-body-sm text-tertiary">Could not load.</p> : (
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[28rem] border-collapse">
                <thead><tr className="t-overline text-tertiary text-left">
                  <th className="pb-2 font-semibold">Query</th>
                  <th className="pb-2 font-semibold text-right">Clickers</th>
                  <th className="pb-2 font-semibold text-right">Converted same-day</th>
                  <th className="pb-2 font-semibold text-right">Rate</th>
                </tr></thead>
                <tbody className="t-body-sm">
                  {queries.map((r) => {
                    const rate = Number(r.rate_pct);
                    return (
                      <tr key={r.query} className="border-t border-border-default">
                        <td className="py-2 pr-3"><span className="font-mono t-emphasis-md text-heading">{r.query}</span></td>
                        <td className="py-2 text-right t-num text-secondary">{nf.format(r.clickers)}</td>
                        <td className="py-2 text-right">
                          <span className="inline-flex items-center gap-2 justify-end">
                            <span className="inline-block h-1.5 rounded-full bg-muted align-middle" style={{ width: 56 }}>
                              <span className="block h-full rounded-full bg-teal-500" style={{ width: `${Math.round((100 * Number(r.converters)) / maxConv)}%` }} />
                            </span>
                            <span className="t-emphasis-md t-num text-body w-8 text-right">{nf.format(r.converters)}</span>
                          </span>
                        </td>
                        <td className="py-2 text-right t-num">
                          <span className="inline-block rounded-xs px-1.5 py-0.5 t-emphasis-sm" style={{ background: color.teal[50], color: color.teal[700] }}>{rate}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card pad="md">
          <CardHeader><div>
            <CardTitle>Invest events by product category</CardTitle>
            <CardSubtitle>All <code className="font-mono">invest_now</code> + <code className="font-mono">quick_checkout</code> events, W1–W6. (The two events use slightly different category labels — "Corporate Bonds" vs "Bonds" — shown as recorded.)</CardSubtitle>
          </div></CardHeader>
          <CardBody>
            {errOf(data, "conv_byCat") ? <p className="t-body-sm text-tertiary">Could not load.</p> : (
              <ul className="flex flex-col divide-y divide-border-default">
                {byCat.map((r) => (
                  <li key={r.category} className="flex items-center gap-3 py-2">
                    <span className="t-emphasis-md text-heading w-44 shrink-0 truncate">{r.category}</span>
                    <span className="relative h-2 flex-1 rounded-full bg-muted">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-navy-400" style={{ width: `${Math.max(3, Math.round((100 * Number(r.events)) / maxCat))}%` }} />
                    </span>
                    <span className="t-body-sm t-num text-secondary w-16 text-right shrink-0">{nf.format(r.events)}</span>
                    <span className="t-body-xs t-num text-tertiary w-20 text-right shrink-0">{nf.format(r.users)} users</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 t-body-xs text-tertiary">
              Search-attributed conversions are a thin slice of total invest volume — most investors don't go through search ({nf.format(searchers)} searchers vs {nf.format(investUsers)} distinct invest-event users in the window). The lever is lifting the searchers who do.
            </p>
          </CardBody>
        </Card>
      </div>

      <p className="t-body-xs text-tertiary">
        Computed live from the DuckDB views via <code className="font-mono">POST /api/projects/asset_search/query</code>; builders in <code className="font-mono">lib/queries/conversion.js</code>.
        user_id is parsed <code className="font-mono">DOUBLE→BIGINT</code> (W1–W3 search exports store it as a float) and timestamps are shifted +5:30 so "same calendar day" is the IST day.
      </p>
    </div>
  );
}
