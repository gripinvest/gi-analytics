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

/* ══════════════════════════════════════════════════════════════════════════════
   §04 · CONTENT FIT — extracted verbatim from FraYoutubeDashboard.jsx lines 658–753
   ══════════════════════════════════════════════════════════════════════════════ */

export function ContentFitSection({ index, loading, data, contentSeries, categoryRows }) {
  return (
    <Section
      index={index}
      title="Content fit"
      deck="Every content category measured against the channel average — the most-produced is rarely the best-performing."
    >
      <ChartCard
        title="Category performance vs channel mean"
        subtitle="Each bar is a category's average views as a percentage above or below the channel mean."
        loading={loading}
        error={errOf(data, "categoryMix")}
        height={Math.max(220, contentSeries.length * 38 + 48)}
      >
        {contentSeries.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No category mix for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={contentSeries}
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis
                type="number"
                {...axisProps}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <YAxis type="category" dataKey="category" {...axisProps} width={120} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`} />}
              />
              <ReferenceLine x={0} stroke={color.neutral[400]} strokeWidth={1.5} />
              <Bar dataKey="perf" name="vs mean" maxBarSize={22} radius={[2, 2, 2, 2]}>
                {contentSeries.map((d, i) => (
                  <Cell key={i} fill={d.perf >= 0 ? color.success[500] : color.error[400]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <Card pad="md">
        <CardHeader>
          <CardTitle>The category ledger</CardTitle>
          <CardSubtitle>Sorted by performance vs channel average</CardSubtitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : errOf(data, "categoryMix") ? (
            <p className="t-body-sm text-error-600">Could not load this section.</p>
          ) : categoryRows.length === 0 ? (
            <p className="t-body-sm text-tertiary">No category mix data.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="py-2 pr-4 text-left t-overline text-tertiary">Category</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Avg views</th>
                    <th className="py-2 text-right t-overline text-tertiary">vs mean</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((r, i) => {
                    const perf = r.perf_vs_mean_pct != null ? Number(r.perf_vs_mean_pct) : null;
                    return (
                      <tr key={i} className="border-b border-border-default last:border-0">
                        <td className="py-2 pr-4 text-body">{r.category}</td>
                        <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.video_count)}</td>
                        <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.avg_views)}</td>
                        <td className="py-2 text-right">
                          {perf == null ? (
                            <span className="t-num text-tertiary">—</span>
                          ) : (
                            <Badge tone={perf >= 0 ? "success" : "error"} variant="soft">
                              {perf >= 0 ? "+" : ""}{perf.toFixed(1)}%
                            </Badge>
                          )}
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
    </Section>
  );
}

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
