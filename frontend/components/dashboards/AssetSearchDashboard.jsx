"use client";

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, AreaChart,
  Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from "recharts";
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

/* ── data loading ─────────────────────────────────────────────────────────── */

const QUERY_SPECS = {
  health:      (ctx) => Q.queryHealthByWeek(ctx),
  funnel:      (ctx) => Q.funnelByWeek(ctx),
  suggestions: (ctx) => Q.suggestionsByWeek(ctx),
  clears:      (ctx) => Q.clearsByWeek(ctx),
  tabs:        (ctx) => Q.byTab(ctx),
  sessions:    (ctx) => Q.totalQuerySessions(ctx),
  terms:       (ctx) => Q.topSearchTerms(ctx),
  assets:      (ctx) => Q.topClickedAssets(ctx),
  positions:   (ctx) => Q.clicksByPosition(ctx),
  zeroQueries: (ctx) => Q.topZeroResultQueries(ctx),
  issuers:     (ctx) => Q.issuerHealthByWeek(ctx),
};

// Conversion ("Business") queries — only run when the invest_now / quick_checkout
// tables are loaded for this project (conv.ok). Keyed under conv_* so they don't
// collide with the search queries above.
const CONV_SPECS = {
  conv_headline:  (conv) => C.conversionHeadline(conv),
  conv_assetRate: (conv) => C.searchToInvestRate(conv),
  conv_queries:   (conv) => C.topConvertingQueries(conv),
  conv_byWeek:    (conv) => C.conversionByWeek(conv),
  conv_byCat:     (conv) => C.investByCategory(conv),
};

function useDashboard(project) {
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
      ];
      const entries = await Promise.all(jobs);
      if (!cancelled) setState({ loading: false, fatal: null, data: Object.fromEntries(entries) });
    })();
    return () => { cancelled = true; };
  }, [project.id, grouped, conv]);

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
  const { loading, fatal, data, weeks, lastWeek, convOk } = useDashboard(project);

  const health = rowsOf(data, "health");
  const funnel = rowsOf(data, "funnel");
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

  // chart-ready series
  const healthSeries = health.map((r) => ({
    week: r.week, queries: Number(r.queries), zrr: Number(r.zrr_pct), refinement: Number(r.refinement_pct),
  }));
  const funnelSeries = funnel.map((r) => ({
    week: r.week, Focused: Number(r.initiated), Queried: Number(r.queried), Clicked: Number(r.clicked),
  }));
  const suggSeries = suggestions.map((r) => ({ week: r.week, clicks: Number(r.suggestion_clicks), ctr: Number(r.ctr_pct) }));
  const posSeries = positions.map((r) => ({ rank: `#${r.rank}`, clicks: Number(r.clicks) }));

  return (
    <div className="flex flex-col gap-6">
      {/* headline stat strip — inline, not a card grid */}
      <Card pad="lg">
        {loading ? (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
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
            <Stat label={<Metric k="zrr">Query-level ZRR</Metric>} value={pct(overallZrr)}
              valueColor={overallZrr != null ? zrrColor(overallZrr) : undefined}
              hint={`${nf.format(totalQueries)} queries`}
              delta={<DeltaChip from={zrrFirst} to={zrrLast} suffix="pt" />} />
            <Stat label={<Metric k="refinement">Refinement rate</Metric>} value={pct(overallRefine)} hint="user iterating mid-search" />
            <Stat label={<Metric k="clicks">Result clicks</Metric>} value={totalClicks ? nf.format(totalClicks) : "—"} hint="from search results" />
            <Stat label={<Metric k="clears">Clear events</Metric>} value={totalClears ? nf.format(totalClears) : "—"} hint="abandonment proxy *" />
            <Stat label={<Metric k="suggestionCtr">Suggestion CTR</Metric>} value={pct(ctrLast)} hint={`focus-time picks · ${lastWeek}`} />
          </StatStrip>
        )}
        {!loading && (
          <p className="mt-4 t-body-xs text-tertiary">
            * The current data export of <code className="font-mono">asset_search_cleared</code> does not carry the
            had-results / any-click payload, so "clear events" stand in for true abandonment vs relevance-gap until that
            payload is re-exported. ZRR is query-level (the correct metric); session-level over-counts prefix-typing noise.
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
          <ChartCard
            title={<Metric k="zrr">Zero-result rate &amp; query volume by feature week</Metric>}
            subtitle="Bars: queries run. Line: % of queries returning zero results."
            loading={loading} error={errOf(data, "health")} height={300}
            footer={`${lastWeek} is a partial week.  Launch baseline ${pct(zrrFirst)} → latest ${pct(zrrLast)}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={healthSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} />
                <YAxis yAxisId="v" {...axisProps} width={48} />
                <YAxis yAxisId="z" orientation="right" {...axisProps} width={40} unit="%" domain={[0, "dataMax + 10"]} />
                <Tooltip cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "zrr" ? `${v}%` : nf.format(v))} />} />
                <Bar yAxisId="v" dataKey="queries" name="Queries" radius={[3, 3, 0, 0]} maxBarSize={46}>
                  {healthSeries.map((d, i) => <Cell key={i} fill={i === healthSeries.length - 1 ? color.navy[200] : color.navy[400]} />)}
                </Bar>
                <Line yAxisId="z" dataKey="zrr" name="Zero-result rate" stroke={color.error[500]} strokeWidth={2.5}
                  dot={{ r: 3, fill: color.error[500], strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title={<Metric k="sessions">Search funnel by week</Metric>} subtitle="Distinct sessions: focused search → ran a query → clicked a result."
              loading={loading} error={errOf(data, "funnel")} height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="week" {...axisProps} />
                  <YAxis {...axisProps} width={48} />
                  <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
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
              <CardHeader><div><CardTitle>Queries by tab</CardTitle><CardSubtitle>Volume and ZRR per active tab.</CardSubtitle></div></CardHeader>
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
          <IssuersView rows={rowsOf(data, "issuers")} weeks={weeks} lastWeek={lastWeek}
            loading={loading} error={errOf(data, "issuers")} />
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
                <table className="w-full border-collapse">
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
                    ["asset_search_cleared payload", "This export only has timestamp/session/user/active_tab. Re-export with had_results & any_result_clicked to split true abandonment from relevance gaps."],
                    ["Issuer roll-up", "There is no issuer column — term→issuer mapping (incl. alias V2: lon→SDI, icl→InCred, muth→Muthoot, …) lives in the offline analyze_search.py, not in SQL yet."],
                    ["Conversion: window + paid orders", "The Conversion tab joins search to invest_now / quick_checkout on same-day user_id. invest_now is an intent event, not a paid order; same-day misses multi-day journeys; and there's no browse-population table, so a true search lift vs non-searchers isn't computable. Add tblorders + a 1–3 day window + a page/asset-view event to close these."],
                    [`${lastWeek} is partial`, `${lastWeek} covers a short window; treat its absolute counts as incomplete and weight by week length for trend reads.`],
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

function buildIssuers(rows, weeks) {
  const byIssuer = new Map();
  for (const r of rows) {
    if (!byIssuer.has(r.issuer)) byIssuer.set(r.issuer, {});
    byIssuer.get(r.issuer)[r.week] = r;
  }
  return ISSUER_MAP.map((meta) => {
    const wkMap = byIssuer.get(meta.name) || {};
    const series = weeks.map((w, i) => {
      const r = wkMap[w] || {};
      return {
        week: w,
        sessions: Number(r.sessions) || 0,
        queries: Number(r.queries) || 0,
        zrr: r.zrr_pct == null ? 0 : Number(r.zrr_pct),
        refinement: r.refinement_pct == null ? 0 : Number(r.refinement_pct),
        abandoned: (meta.abandoned || [])[i] ?? 0,
        relgap: (meta.relgap || [])[i] ?? 0,
      };
    });
    const sum = (k) => series.reduce((a, s) => a + (s[k] || 0), 0);
    const totSessions = sum("sessions"), totQueries = sum("queries");
    const totAbandoned = sum("abandoned"), totRelgap = sum("relgap");
    const avgZrr = totQueries ? Math.round((10 * series.reduce((a, s) => a + s.zrr * s.queries, 0)) / totQueries) / 10 : null;
    const avgRefine = totQueries ? Math.round((10 * series.reduce((a, s) => a + s.refinement * s.queries, 0)) / totQueries) / 10 : null;
    const half = Math.ceil(weeks.length / 2);
    const early = avgOf(series.slice(0, half).map((s) => s.zrr));
    const late = avgOf(series.slice(half).map((s) => s.zrr));
    const zrrDelta = early == null || late == null ? null : Math.round((late - early) * 10) / 10;
    const peak = series.reduce((m, s) => (s.zrr > (m?.zrr ?? -1) ? s : m), null);
    return { ...meta, series, totSessions, totQueries, totAbandoned, totRelgap, avgZrr, avgRefine, zrrDelta, peak, early, late };
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

function IssuersView({ rows, weeks, lastWeek, loading, error }) {
  const issuers = React.useMemo(() => buildIssuers(rows, weeks), [rows, weeks]);
  const [filter, setFilter] = React.useState("all");
  const [selected, setSelected] = React.useState(null);

  const shown = filter === "all" ? issuers : issuers.filter((i) => i.category === filter);
  const current = issuers.find((i) => i.name === selected) || shown[0] || issuers[0] || null;

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
  const half = Math.ceil(weeks.length / 2);
  const abandSeries = current ? current.series.map((s) => ({ week: s.week, "True abandonment": s.abandoned, "Relevance gap": s.relgap })) : [];

  return (
    <div className="flex flex-col gap-6">
      <Card pad="md">
        <CardHeader>
          <div>
            <CardTitle>Search health by issuer</CardTitle>
            <CardSubtitle>
              <code className="font-mono">query_text</code> mapped to an issuer by leading-prefix / alias rules; prefix variants (aka, akar, akara) collapse into one issuer.
              Sessions, query-level ZRR and refinement are computed live from the DuckDB views. Category, the read on each issuer, and the abandonment / relevance-gap
              counts come from the offline analyze_search.py (the richer <code className="font-mono">asset_search_cleared</code> payload isn't in this export). Hover any{" "}
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
            <div key={iss.name} role="button" tabIndex={0} onClick={() => setSelected(iss.name)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(iss.name); } }}
              className={`cursor-pointer rounded-md border bg-surface p-4 text-left transition-shadow duration-200 outline-none ${active ? "border-navy-300 shadow-md ring-1 ring-navy-200" : "border-border-default shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-navy-300"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="t-heading-md text-heading">{iss.name}</span>
                <Badge tone={CAT_BADGE[iss.category].tone} variant={CAT_BADGE[iss.category].variant} className="shrink-0">{ISSUER_CATEGORY[iss.category].label}</Badge>
              </div>
              <div className="mt-2 flex items-end gap-5">
                <CardStat label="Sessions" value={nf.format(iss.totSessions)} valueColor={color.neutral[900]} />
                <CardStat label="Avg ZRR" value={iss.avgZrr == null ? "—" : `${iss.avgZrr}%`} valueColor={iss.avgZrr == null ? color.neutral[400] : zrrColor(iss.avgZrr)} />
                <CardStat label="Abandon" value={nf.format(iss.totAbandoned)} valueColor={color.neutral[700]} />
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
        <Card pad="lg">
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
                    <ComposedChart data={current.series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="week" {...axisProps} />
                      <YAxis yAxisId="s" {...axisProps} width={40} />
                      <YAxis yAxisId="z" orientation="right" {...axisProps} width={42} unit="%" domain={[0, (m) => Math.max(20, Math.ceil((m + 10) / 10) * 10)]} />
                      <Tooltip cursor={{ fill: color.neutral[100] }}
                        content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "zrr" || p.dataKey === "refinement" ? `${v}%` : nf.format(v))} />} />
                      <Area yAxisId="s" dataKey="sessions" name="Sessions" stroke={color.navy[400]} strokeWidth={2} fill={color.navy[100]} fillOpacity={0.6} />
                      <Line yAxisId="z" dataKey="zrr" name="Zero-result rate" stroke={color.neutral[400]} strokeWidth={2} dot={<ZrrDot />} activeDot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="t-label-md text-tertiary mb-1 flex items-center gap-1.5">
                  <Metric k="abandoned">True abandonment</Metric> vs <Metric k="relgap">relevance gap</Metric>, sessions by week
                </div>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={abandSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={2}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="week" {...axisProps} />
                      <YAxis {...axisProps} width={36} allowDecimals={false} />
                      <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
                      <Bar dataKey="True abandonment" stackId="a" fill={color.error[400]} radius={[0, 0, 0, 0]} maxBarSize={26} />
                      <Bar dataKey="Relevance gap" stackId="a" fill={color.warning[400]} radius={[3, 3, 0, 0]} maxBarSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 t-body-xs text-tertiary">From analyze_search.py. Re-export <code className="font-mono">asset_search_cleared</code> with <code className="font-mono">had_results</code> and <code className="font-mono">any_result_clicked</code> to make these live.</p>
              </div>
              <div className="flex flex-wrap gap-x-7 gap-y-2">
                <InlineStat k="sessions" label="Sessions" value={nf.format(current.totSessions)} />
                <InlineStat k="queries" label="Queries" value={nf.format(current.totQueries)} />
                <InlineStat k="zrr" label="Avg ZRR" value={current.avgZrr == null ? "—" : `${current.avgZrr}%`} valueColor={current.avgZrr == null ? color.neutral[400] : zrrColor(current.avgZrr)} />
                <InlineStat k="refinement" label="Refinement" value={current.avgRefine == null ? "—" : `${current.avgRefine}%`} />
                <InlineStat k="abandoned" label="True abandon" value={nf.format(current.totAbandoned)} valueColor={color.error[600]} align="right" />
                <InlineStat k="relgap" label="Rel. gap" value={nf.format(current.totRelgap)} valueColor={color.warning[700]} align="right" />
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

function ConversionView({ data, loading, weeks, lastWeek }) {
  const h = rowsOf(data, "conv_headline")[0] || {};
  const a = rowsOf(data, "conv_assetRate")[0] || {};
  const byWeek = rowsOf(data, "conv_byWeek");
  const queries = rowsOf(data, "conv_queries");
  const byCat = rowsOf(data, "conv_byCat");
  const headlineErr = errOf(data, "conv_headline");

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
        <StatStrip>
          <Stat label={<Metric k="searchersCvr">Searchers CVR</Metric>}
            value={pct1(searchersCvr)} valueColor={color.teal[600]}
            hint={`${nf.format(convSearchers)} of ${nf.format(searchers)} searchers invested same-day · up to ${pct1(everCvr)} within the window`} />
          <Stat label={<Metric k="clickedCvr">Clicked a result → CVR</Metric>}
            value={pct1(clickedCvr)}
            hint={`${nf.format(convClickers)} of ${nf.format(clickers)} result-clickers`}
            delta={ratio != null ? <Badge tone="success" variant="soft">{Math.round(ratio * 100) / 100}× vs no-click</Badge> : null} />
          <Stat label="Searched, no click → CVR" value={pct1(noclickCvr)}
            hint={`${nf.format(convNoclick)} of ${nf.format(noclick)} — the floor`} />
          <Stat label={<Metric k="searchToInvest">Search → invest rate</Metric>}
            value={pct1(assetRate)}
            hint={`${nf.format(assetMatched)} of ${nf.format(assetClicks)} result clicks → same-day invest on that asset`} />
          <Stat label={<Metric k="invest">Invest events (intent)</Metric>}
            value={investEvents ? nf.format(investEvents) : "—"}
            hint={`${nf.format(investUsers)} distinct users · ${weeks[0]}–${lastWeek}`} />
        </StatStrip>
        <p className="mt-4 t-body-xs text-tertiary">
          "Converted" = the user clicked the <span className="t-emphasis-sm">Invest Now</span> CTA (or a Quick Checkout invest) on the same calendar day as the search activity, joined on <code className="font-mono">user_id</code>.
          <code className="font-mono">invest_now_button_clicked</code> is an <span className="t-emphasis-sm">intent</span> event, not a paid order. Same-day attribution undercounts multi-day journeys, so the true number sits between the same-day figure and the in-window upper bound.
          A search <span className="t-emphasis-sm">lift</span> vs non-searchers isn't shown: there's no browse-population (page / asset-view) table loaded, so the only honest "does search help" read is the clicked vs no-click gap on the right.
        </p>
      </Card>

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
          footer={`${lastWeek} is a partial week.  Searcher CVR ${pct1(cvrEarly)} → ${pct1(cvrLate)}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={weekSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="week" {...axisProps} />
              <YAxis yAxisId="cvr" {...axisProps} width={44} unit="%" domain={[0, "dataMax + 10"]} />
              <YAxis yAxisId="ev" orientation="right" {...axisProps} width={48} />
              <Tooltip cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v, p) => (p.dataKey === "investEvents" ? nf.format(v) : `${v}%`)} />} />
              <Bar yAxisId="ev" dataKey="investEvents" name="Invest events" radius={[3, 3, 0, 0]} maxBarSize={40}>
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
              <table className="w-full border-collapse">
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
