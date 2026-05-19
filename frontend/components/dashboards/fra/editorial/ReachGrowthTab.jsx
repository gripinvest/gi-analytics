"use client";
/**
 * ReachGrowthTab — Tab 2 of the FRA editorial dashboard.
 *
 * Discovery + Growth + Catalog health (full depth, extracted from the original
 * mega-file) plus two net-new sections: the full percentile ladder and a
 * monthly-detail table with month-over-month % computed client-side.
 *
 * DiscoverySection, GrowthSection, and CatalogHealthSection are defined here
 * as export functions so OverviewTab (Task 8) can import and reuse them without
 * duplicating code. PercentileLadderSection and MonthlyDetailSection are
 * file-local — they are only shown in this tab.
 */

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, AreaChart, BarChart,
  Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { fmt, pct1, compact, fmtMonth } from "../helpers";
import {
  ED_INK, ED_INK_FAINT, ED_INK_MUTED, ED_PAPER, ED_GOLD, ED_FOREST, ED_RUST, ED_RULE_FAINT,
  edAxisProps, edGridProps,
  useCountUp, RevealSection, EdTooltip, SectionHead,
  Figure, DeltaTick, Exhibit, LedgerTable, EmptyPlate, ErrorNote,
} from "./primitives";

/* ── Section III — Discovery (own component for the count-up reveal) ─────────*/
export function DiscoverySection({ number, reduced, loading, distRow, error, videoViewsError, breakoutRate, ladder, distBuckets, animProps }) {
  // The section is visible immediately via CSS ed-set animation.
  // Count up the breakout rate once the component has mounted.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  const counted = useCountUp(breakoutRate, mounted && !loading, reduced, 950);

  const verdict = (() => {
    if (!distRow) return null;
    const recentCount = Number(distRow.recent_video_count ?? 0);
    const rate = Number(distRow.breakout_1k_rate ?? 0);
    if (recentCount === 0) return { tone: ED_INK_MUTED, label: "no recent uploads" };
    if (rate < 0.25) return { tone: ED_RUST, label: "discovery crisis" };
    if (rate < 0.6) return { tone: ED_GOLD, label: "needs improvement" };
    return { tone: ED_FOREST, label: "healthy discovery" };
  })();

  return (
    <section
      id="sec-discovery"
      className={reduced ? "" : "ed-set ed-set-delay-2"}
    >
      <SectionHead
        number={number}
        italic="Discovery"
        deck="The north-star question: of the videos the channel ships, what share break through. A breakout is a video that clears one thousand views."
      />

      {error ? (
        <ErrorNote>Could not load discovery figures: {error}</ErrorNote>
      ) : (
        <>
          {/* The north-star pull-number. */}
          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] items-center">
            <div>
              <p className="ed-overline mb-2">THE NORTH STAR · 1K-BREAKOUT RATE</p>
              <div className="ed-pullnum" style={{ fontSize: "clamp(68px, 13vw, 132px)" }}>
                {loading || breakoutRate == null
                  ? <span className="ed-skeleton" style={{ width: "2.4em", height: "0.62em" }} aria-label="loading" />
                  : <>{counted.toFixed(1)}<span style={{ fontSize: "0.42em", letterSpacing: "-0.02em" }}>%</span></>}
              </div>
              {verdict && !loading && (
                <p className="ed-caption mt-3" style={{ color: verdict.tone, fontWeight: 600 }}>
                  ◆ {verdict.label.toUpperCase()}
                </p>
              )}
              <p className="ed-prose-italic mt-3" style={{ maxWidth: "44ch", fontSize: 14 }}>
                Share of recent videos crossing one thousand views — the channel's
                single clearest read on whether new work is being found.
              </p>
            </div>

            {/* The viral-threshold ladder — a stepped exhibit. */}
            <div className="border-t border-b" style={{ borderColor: ED_INK }}>
              <p className="ed-caption pt-3 pb-2">THE THRESHOLD LADDER</p>
              {loading ? (
                <div className="ed-skeleton" style={{ width: "100%", height: 130, borderRadius: 2, marginBottom: 12 }} aria-label="loading" />
              ) : ladder.length === 0 ? (
                <p className="ed-prose-italic pb-4" style={{ color: ED_INK_FAINT }}>No threshold data for this snapshot.</p>
              ) : (
                <div className="pb-3">
                  {ladder.map((rung, i) => {
                    const top = ladder[0].count || 1;
                    const w = Math.max(4, Math.round((rung.count / top) * 100));
                    return (
                      <div key={rung.tier} className="py-2.5" style={{ borderTop: i ? `1px solid ${ED_RULE_FAINT}` : "none" }}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="ed-caption" style={{ color: ED_INK }}>{rung.tier}</span>
                          <span className="ed-num" style={{ fontSize: 15, fontWeight: 600 }}>{fmt(rung.count)}</span>
                        </div>
                        <div style={{ height: 6, background: "rgba(27,24,24,0.07)" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${w}%`,
                              background: i === 0 ? ED_INK : i === 1 ? ED_GOLD : ED_RUST,
                              transition: reduced ? "none" : `width 720ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* The view-distribution histogram — the concentration / Gini story. */}
          <Figure
            figNum="3.1"
            title="How views concentrate across the library"
            caption="Videos bucketed by lifetime views on a log-scaled ladder. A tall left side and a thin right tail is the classic concentration story — a few videos carry the channel."
            loading={loading}
            error={videoViewsError || null}
            height={260}
            footnote={
              distRow?.gini != null
                ? `Gini coefficient ${Number(distRow.gini).toFixed(3)} — 0 is perfectly even, 1 is one video taking everything.`
                : undefined
            }
          >
            {distBuckets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No video view data for this snapshot.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distBuckets} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
                  <CartesianGrid {...edGridProps} />
                  <XAxis dataKey="bucket" {...edAxisProps} />
                  <YAxis {...edAxisProps} width={44} tickFormatter={compact} />
                  <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => `${fmt(v)} videos`} />} />
                  <Bar dataKey="count" name="Videos" fill={ED_INK} maxBarSize={64} {...animProps} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Figure>
        </>
      )}
    </section>
  );
}

/* ── Section IV — Growth ─────────────────────────────────────────────────────*/
export function GrowthSection({ number, loading, data, growthSeries, growthSeriesWithReal, hasRealTrend, animProps }) {
  return (
    <RevealSection reduced={false} id="sec-growth">
      <SectionHead
        number={number}
        italic="Growth"
        deck="How the library has accumulated views over its lifetime, and how each calendar month has contributed."
      />
      <Figure
        figNum="4.1"
        title="Cumulative library views"
        caption="A running sum of monthly views — the shape of the channel's accumulated reach since its first uploads."
        loading={loading}
        error={errOf(data, "cumulativeViews")}
        height={300}
        footnote={
          "Honest caveat — this is the cumulative lifetime views of videos PUBLISHED THROUGH each " +
          "month, a library-accumulation proxy. It is not the channel's true total view count on that " +
          "date: older videos keep accruing views long after their publish month. The real channel-" +
          "snapshots trend (the thin gold line) holds one point today and grows by one with each " +
          "daily refresh from here."
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={growthSeriesWithReal} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="fraGrowthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ED_INK} stopOpacity={0.20} />
                <stop offset="100%" stopColor={ED_INK} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...edGridProps} />
            <XAxis dataKey="month" {...edAxisProps} tickFormatter={fmtMonth} />
            <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
            <Tooltip
              cursor={{ stroke: ED_RULE_FAINT }}
              content={<EdTooltip labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
            />
            <Area
              type="monotone"
              dataKey="cumulative"
              name="Cumulative views"
              stroke={ED_INK}
              strokeWidth={2}
              fill="url(#fraGrowthFill)"
              {...animProps}
            />
            {hasRealTrend && (
              <Line
                type="monotone"
                dataKey="real"
                name="Channel snapshot (real)"
                stroke={ED_GOLD}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={{ r: 3, fill: ED_GOLD, stroke: ED_PAPER, strokeWidth: 1 }}
                connectNulls
                {...animProps}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Figure>

      <Figure
        figNum="4.2"
        title="Views by calendar month"
        caption="Total views attributed to videos published in each month — which months the channel's reach was built in."
        loading={loading}
        error={errOf(data, "monthlyViews")}
        height={260}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={growthSeries} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
            <CartesianGrid {...edGridProps} />
            <XAxis dataKey="month" {...edAxisProps} tickFormatter={fmtMonth} />
            <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: "rgba(27,24,24,0.05)" }}
              content={<EdTooltip labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
            />
            <Bar dataKey="monthly" name="Monthly views" fill={ED_INK} maxBarSize={38} {...animProps} />
          </BarChart>
        </ResponsiveContainer>
      </Figure>
    </RevealSection>
  );
}

/* ── Section IX — Catalog health ─────────────────────────────────────────────*/
export function CatalogHealthSection({ number, loading, data, catalogRow }) {
  return (
    <RevealSection reduced={false} id="sec-catalog">
      <SectionHead
        number={number}
        italic="Catalog health"
        deck="Whether the channel's recent work is keeping pace with its back catalogue — the last thirty days against the lifetime average."
      />
      {errOf(data, "catalogHealth") ? (
        <ErrorNote>Could not load catalog health: {errOf(data, "catalogHealth")}</ErrorNote>
      ) : !loading && !catalogRow ? (
        <EmptyPlate>No catalog-health row for the current snapshot.</EmptyPlate>
      ) : (
        <div className="grid gap-x-8 gap-y-8 grid-cols-2 lg:grid-cols-4">
          <Exhibit
            label="Recent avg views"
            loading={loading}
            value={catalogRow ? fmt(catalogRow.recent_avg_views) : "—"}
            sub="videos from the last 30 days"
          />
          <Exhibit
            label="All-time avg views"
            loading={loading}
            value={catalogRow ? fmt(catalogRow.alltime_avg_views) : "—"}
            sub="the lifetime mean"
          />
          <Exhibit
            label="Freshness delta"
            loading={loading}
            value={catalogRow?.freshness_delta_pct != null ? pct1(catalogRow.freshness_delta_pct) : "—"}
            delta={
              catalogRow?.freshness_delta_pct != null
                ? <DeltaTick value={catalogRow.freshness_delta_pct} goodIsUp suffix="%" />
                : null
            }
            sub="recent vs all-time"
          />
          <Exhibit
            label="Subscriber efficiency"
            loading={loading}
            value={
              catalogRow?.subscriber_efficiency != null
                ? Number(catalogRow.subscriber_efficiency).toFixed(2)
                : "—"
            }
            sub="total views ÷ subscribers"
          />
        </div>
      )}
    </RevealSection>
  );
}

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
