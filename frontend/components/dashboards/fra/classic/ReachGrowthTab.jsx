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

/* ══════════════════════════════════════════════════════════════════════════════
   §02 · DISCOVERY — extracted verbatim from FraYoutubeDashboard.jsx lines 473–557
   ══════════════════════════════════════════════════════════════════════════════ */

export function DiscoverySection({ index, loading, data, distRow, distBuckets }) {
  return (
    <Section
      index={index}
      title="Discovery"
      deck="Of the videos the channel ships, what share break through — a breakout clears one thousand views — and how views concentrate across the library."
    >
      <Card pad="md">
        <CardHeader>
          <div>
            <CardTitle>Breakout health</CardTitle>
            <CardSubtitle>Share of recent videos crossing key view thresholds</CardSubtitle>
          </div>
          {!loading && !errOf(data, "distribution") && discoveryVerdictBadge(distRow)}
        </CardHeader>
        <CardBody>
          {loading ? (
            <StatStripSkeleton count={5} />
          ) : errOf(data, "distribution") ? (
            <p className="t-body-sm text-error-600">Could not load this section.</p>
          ) : distRow ? (
            <div className="flex flex-col gap-5">
              <div className="t-display-md t-num text-heading">
                {distRow.breakout_1k_rate != null
                  ? `${(Number(distRow.breakout_1k_rate) * 100).toFixed(1)}%`
                  : "—"}
                <span className="ml-2 t-body-sm text-tertiary font-normal">
                  breakout ≥1K rate — the north star
                </span>
              </div>
              <StatStrip>
                <Stat label="Videos ≥ 1K views" value={fmt(distRow.videos_ge_1k)} />
                <Stat label="Videos ≥ 10K views" value={fmt(distRow.videos_ge_10k)} />
                <Stat label="Videos ≥ 100K views" value={fmt(distRow.videos_ge_100k)} />
                <Stat
                  label="Gini coefficient"
                  value={distRow.gini != null ? Number(distRow.gini).toFixed(3) : "—"}
                  hint="0 even · 1 concentrated"
                />
                <Stat label="Recent video count" value={fmt(distRow.recent_video_count)} />
              </StatStrip>
            </div>
          ) : (
            <p className="t-body-sm text-tertiary">No distribution data for the current snapshot.</p>
          )}
        </CardBody>
      </Card>

      <ChartCard
        title="How views concentrate across the library"
        subtitle="Videos bucketed by lifetime views — a tall left side and thin right tail is the classic concentration story."
        loading={loading}
        error={errOf(data, "videoViews")}
        height={260}
        footer={
          distRow?.gini != null
            ? `Gini coefficient ${Number(distRow.gini).toFixed(3)} — 0 is perfectly even, 1 is one video taking everything.`
            : undefined
        }
      >
        {distBuckets.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No per-video view data for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distBuckets} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="bucket" {...axisProps} />
              <YAxis {...axisProps} width={48} tickFormatter={compact} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => `${fmt(v)} videos`} />}
              />
              <Bar
                dataKey="count"
                name="Videos"
                fill={chartPalette[0]}
                radius={[3, 3, 0, 0]}
                maxBarSize={64}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   §03 · GROWTH — extracted verbatim from FraYoutubeDashboard.jsx lines 559–656
   Note: original uses local `growthSeries.length` for the empty-state check;
   in the extracted function we use `growthWithReal.length` (same data, same test).
   ══════════════════════════════════════════════════════════════════════════════ */

export function GrowthSection({ index, loading, data, growthWithReal, hasRealTrend, monthlySeries }) {
  return (
    <Section
      index={index}
      title="Growth"
      deck="How the library has accumulated views over its lifetime, and how each calendar month has contributed."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Cumulative library views"
          subtitle="A running sum of monthly views — the shape of accumulated reach."
          loading={loading}
          error={errOf(data, "cumulativeViews")}
          height={280}
          footer={
            "Honest caveat — this is the cumulative views of videos published through each month, " +
            "a library-accumulation proxy, not the channel's true total on that date (older videos keep " +
            "accruing). The real channel-snapshots trend (gold) holds one point today and grows daily."
          }
        >
          {growthWithReal.length === 0 ? (
            <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
              No monthly history for this snapshot.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={growthWithReal} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="fraClassicGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartPalette[0]} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={chartPalette[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
                <YAxis {...axisProps} width={52} tickFormatter={compact} />
                <Tooltip
                  cursor={{ stroke: color.neutral[300] }}
                  content={<TooltipBox labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative views"
                  stroke={chartPalette[0]}
                  strokeWidth={2.5}
                  fill="url(#fraClassicGrowth)"
                />
                {hasRealTrend && (
                  <Line
                    type="monotone"
                    dataKey="real"
                    name="Channel snapshot (real)"
                    stroke={color.teal[600]}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={{ r: 3, fill: color.teal[600] }}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Views by calendar month"
          subtitle="Total views attributed to videos published in each month."
          loading={loading}
          error={errOf(data, "monthlyViews")}
          height={280}
        >
          {monthlySeries.length === 0 ? (
            <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
              No monthly views for this snapshot.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
                <YAxis {...axisProps} width={52} tickFormatter={compact} />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
                />
                <Bar
                  dataKey="monthly"
                  name="Monthly views"
                  fill={chartPalette[0]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={44}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   §08 · CATALOG HEALTH — extracted verbatim from FraYoutubeDashboard.jsx lines 921–968
   ══════════════════════════════════════════════════════════════════════════════ */

export function CatalogHealthSection({ index, loading, data, catalogRow }) {
  return (
    <Section
      index={index}
      title="Catalog health"
      deck="Whether the channel's recent work is keeping pace with its back catalogue — the last thirty days against the lifetime average."
    >
      <Card pad="md">
        {loading ? (
          <StatStripSkeleton count={4} />
        ) : errOf(data, "catalogHealth") ? (
          <p className="t-body-sm text-error-600">Could not load this section.</p>
        ) : catalogRow ? (
          <StatStrip>
            <Stat
              label="Recent avg views"
              value={fmt(catalogRow.recent_avg_views)}
              hint="videos from the last 30 days"
            />
            <Stat
              label="All-time avg views"
              value={fmt(catalogRow.alltime_avg_views)}
              hint="the lifetime mean"
            />
            <Stat
              label="Freshness delta"
              value={pct(catalogRow.freshness_delta_pct)}
              delta={
                catalogRow.freshness_delta_pct != null ? (
                  <DeltaChip delta={catalogRow.freshness_delta_pct} goodIsUp suffix="%" />
                ) : undefined
              }
              hint="recent vs all-time"
            />
            <Stat
              label="Subscriber efficiency"
              value={
                catalogRow.subscriber_efficiency != null
                  ? Number(catalogRow.subscriber_efficiency).toFixed(3)
                  : "—"
              }
              hint="total views ÷ subscribers"
            />
          </StatStrip>
        ) : (
          <p className="t-body-sm text-tertiary">No catalog-health data.</p>
        )}
      </Card>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   The full percentile ladder — P10/P25/P50/P75/P90/P95 of per-video views as a
   ruled list of magnitude bars, plus the two concentration read-outs. Net-new
   in the restructure; reads the five extended distribution columns.
   ══════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════
   Monthly detail — video count and average views per calendar month, with the
   month-over-month change computed client-side. Net-new in the restructure;
   the monthly_views table already carries video_count + avg_views.
   ══════════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════════
   ReachGrowthTab — default export
   ══════════════════════════════════════════════════════════════════════════════ */

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
