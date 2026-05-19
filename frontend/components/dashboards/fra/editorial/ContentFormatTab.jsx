"use client";
/**
 * ContentFormatTab — Tab 3 of the FRA editorial dashboard.
 *
 * Content fit in full (extracted from the original mega-file as
 * ContentFitSection — exported so OverviewTab can import it), plus two net-new
 * sections: duration-bucket performance and the per-video leaderboards.
 *
 * ContentFitSection is an export function so OverviewTab (Task 8) can import
 * it by name without duplicating code.
 */

import * as React from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter,
  BarChart, Bar,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  Cell, LabelList,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { fmt, pct1, compact } from "../helpers";
import {
  ED_INK, ED_INK_FAINT, ED_INK_MUTED, ED_FOREST, ED_RUST, ED_RULE_FAINT, ED_GOLD,
  edAxisProps, edGridProps,
  RevealSection, EdTooltip, SectionHead,
  Figure, LedgerTable, EmptyPlate, ErrorNote,
} from "./primitives";

/* ── Section V — Content fit (extracted from FraYoutubeDashboardEditorial.jsx
   lines 877–987; verbatim except: `reduced` prop threaded through, `number`
   made a prop instead of hard-coded "V") ─────────────────────────────────── */
export function ContentFitSection({ number, loading, data, categoryScatter, categoryRows, animProps }) {
  return (
    <RevealSection reduced={false} id="sec-content">
      <SectionHead
        number={number}
        italic="Content fit"
        deck="Every content category placed by how much the channel produces against how well it performs — the most-produced is rarely the best-performing."
      />
      <Figure
        figNum="5.1"
        title="Production vs performance, by category"
        caption="Each mark is a category: horizontal is how many videos it holds, vertical is its average views. Marks high and to the right earn their volume; high and to the left are under-produced winners; low and to the right are over-produced."
        loading={loading}
        error={errOf(data, "categoryMix")}
        height={320}
      >
        {categoryScatter.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No category mix for this snapshot.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 20, bottom: 18, left: 6 }}>
              <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" />
              <XAxis
                type="number"
                dataKey="videos"
                name="Videos"
                {...edAxisProps}
                label={{
                  value: "VIDEO COUNT →",
                  position: "insideBottom",
                  offset: -10,
                  style: { fontFamily: "var(--ed-mono)", fontSize: 9, letterSpacing: "0.12em", fill: ED_INK_MUTED },
                }}
              />
              <YAxis
                type="number"
                dataKey="avgViews"
                name="Avg views"
                {...edAxisProps}
                width={52}
                tickFormatter={compact}
                /* headroom so the top category's "position=top" label
                   clears the plot frame instead of being clipped */
                domain={[0, (max) => Math.ceil((max * 1.18) / 100) * 100]}
              />
              <ZAxis type="number" dataKey="videos" range={[60, 360]} />
              <Tooltip
                cursor={{ stroke: ED_RULE_FAINT, strokeDasharray: "3 3" }}
                content={
                  <EdTooltip
                    valueFmt={(v, p) => (p.dataKey === "avgViews" ? fmt(v) : fmt(v))}
                  />
                }
              />
              <Scatter data={categoryScatter} name="Category" fill={ED_INK} {...animProps}>
                {categoryScatter.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.vsMean == null
                        ? ED_INK
                        : d.vsMean > 0
                          ? ED_FOREST
                          : ED_RUST
                    }
                    fillOpacity={0.78}
                    stroke={ED_INK}
                    strokeWidth={0.75}
                  />
                ))}
                <LabelList
                  dataKey="category"
                  position="top"
                  style={{
                    fontFamily: "var(--ed-mono)",
                    fontSize: 9,
                    fill: ED_INK_MUTED,
                    letterSpacing: "0.04em",
                  }}
                />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </Figure>

      <div className="mt-7">
        <p className="ed-overline mb-3">THE LEDGER · CATEGORY MIX</p>
        <LedgerTable
          loading={loading}
          empty="No category mix for the current snapshot."
          cols={[
            { key: "category", label: "Category" },
            { key: "video_count", label: "Videos", align: "right", mono: true, render: (r) => fmt(r.video_count) },
            { key: "avg_views", label: "Avg views", align: "right", mono: true, render: (r) => fmt(r.avg_views) },
            {
              key: "perf_vs_mean_pct", label: "vs mean", align: "right", mono: true,
              render: (r) => (
                <span style={{ color: Number(r.perf_vs_mean_pct) >= 0 ? ED_FOREST : ED_RUST, fontWeight: 600 }}>
                  {r.perf_vs_mean_pct != null
                    ? `${Number(r.perf_vs_mean_pct) >= 0 ? "+" : ""}${pct1(r.perf_vs_mean_pct)}`
                    : "—"}
                </span>
              ),
            },
          ]}
          rows={categoryRows}
        />
      </div>
    </RevealSection>
  );
}

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
