"use client";
/**
 * AudienceTab — Tab 4 of the FRA editorial dashboard.
 *
 * Engagement in full (extracted from the original mega-file as
 * EngagementSection — exported so OverviewTab can import it), plus two net-new
 * sections: like-rate vs comment-rate split and engagement by video duration.
 *
 * EngagementSection is an export function so OverviewTab (Task 8) can import
 * it by name without duplicating code.
 */

import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, ReferenceLine,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { pct1 } from "../helpers";
import {
  ED_INK, ED_INK_FAINT, ED_GOLD, ED_FOREST, ED_RUST, ED_RULE_FAINT,
  edAxisProps, edGridProps,
  RevealSection, EdTooltip, SectionHead,
  Figure, Exhibit, EmptyPlate, ErrorNote,
} from "./primitives";

/* ── Section VI — Engagement (extracted from FraYoutubeDashboardEditorial.jsx
   lines 989–1036; verbatim except: `number` prop replaces the hard-coded "VI",
   `reduced` prop is removed in favour of the RevealSection default). */
export function EngagementSection({ number, loading, data, engagementSeries, engMean, animProps }) {
  return (
    <RevealSection reduced={false} id="sec-engagement">
      <SectionHead
        number={number}
        italic="Engagement"
        deck="Engagement rate — likes plus comments over views — read against the channel mean. Bars to the right beat the average; bars to the left drag it down."
      />
      <Figure
        figNum={`${number}.1`}
        title="Engagement rate vs channel mean, by category"
        caption={`The dividing line is the channel mean, ${engMean ? engMean.toFixed(2) : "—"}%. Each bar is a category's distance from it.`}
        loading={loading}
        error={errOf(data, "engagement")}
        height={Math.max(220, engagementSeries.length * 44 + 40)}
      >
        {engagementSeries.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No engagement data for this snapshot.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={engagementSeries}
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" horizontal={false} />
              <XAxis type="number" {...edAxisProps} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
              <YAxis type="category" dataKey="bucket" {...edAxisProps} width={104} />
              <Tooltip
                cursor={{ fill: "rgba(27,24,24,0.05)" }}
                content={
                  <EdTooltip
                    valueFmt={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(2)} pt`}
                  />
                }
              />
              <ReferenceLine x={0} stroke={ED_INK} strokeWidth={1.5} />
              <Bar dataKey="diff" name="vs mean" maxBarSize={26} {...animProps}>
                {engagementSeries.map((d, i) => (
                  <Cell key={i} fill={d.diff >= 0 ? ED_FOREST : ED_RUST} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Figure>
    </RevealSection>
  );
}

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
