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
import { pct1 } from "../helpers";
import { Section, StatStripSkeleton } from "./primitives";

/* ── §05 Engagement — extracted verbatim from FraYoutubeDashboard.jsx:755-800 ─
   Exported so OverviewTab can import it. `index` is made a prop; `title` and
   `deck` are hard-coded (they are fixed strings). */
export function EngagementSection({ index, loading, data, engagementSeries, engMean }) {
  return (
    <Section
      index={index}
      title="Engagement"
      deck="Engagement rate — likes plus comments over views — read against the channel mean. Bars right of the line beat the average; bars left drag it down."
    >
      <ChartCard
        title="Engagement rate vs channel mean, by category"
        subtitle={`The dividing line is the channel mean, ${engMean ? engMean.toFixed(2) : "—"}%. Each bar is a category's distance from it.`}
        loading={loading}
        error={errOf(data, "engagement")}
        height={Math.max(220, engagementSeries.length * 40 + 48)}
      >
        {engagementSeries.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No engagement data for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={engagementSeries}
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis
                type="number"
                {...axisProps}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
              />
              <YAxis type="category" dataKey="bucket" {...axisProps} width={120} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(2)} pt`} />}
              />
              <ReferenceLine x={0} stroke={color.neutral[400]} strokeWidth={1.5} />
              <Bar dataKey="diff" name="vs mean" maxBarSize={24} radius={[2, 2, 2, 2]}>
                {engagementSeries.map((d, i) => (
                  <Cell key={i} fill={d.diff >= 0 ? color.success[500] : color.error[400]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </Section>
  );
}

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
