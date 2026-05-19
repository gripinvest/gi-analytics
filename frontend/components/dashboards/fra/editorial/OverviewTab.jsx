"use client";
/**
 * Overview tab — the FRA Weekly in full. Every section of the original single-
 * scroll report at its current depth: At a glance, Discovery, Growth, Content
 * fit, Engagement, Cadence, Titles & SEO, Catalog health. The AI section is
 * condensed to the verdict + top-3 action items; each section carries a
 * "read the full analysis" link to its deep-dive tab.
 */

import * as React from "react";
import { errOf } from "@/lib/queries/fraYoutube";
import { fmt, compact } from "../helpers";
import {
  ED_INK_FAINT, ED_RUST, ED_GOLD, edDeltaFmt,
  RevealSection, SectionHead, DualDeltaTick, Exhibit, ErrorNote,
  insightItemText,
} from "./primitives";
import { DiscoverySection, GrowthSection, CatalogHealthSection } from "./ReachGrowthTab";
import { ContentFitSection } from "./ContentFormatTab";
import { EngagementSection } from "./AudienceTab";
import { CadenceSection, TitlesSeoSection } from "./CadenceSeoTab";

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
      {/* §I At a glance — extracted verbatim from original lines 697-776 */}
      <RevealSection reduced={reduced} id="sec-glance">
        <SectionHead
          number="I"
          italic="At a glance"
          deck="The channel in seven figures — subscribers, reach, library size and pacing — with the week-on-week tick where the snapshot delta is known."
        />
        {errOf(data, "overview") ? (
          <ErrorNote>Could not load the channel snapshot: {errOf(data, "overview")}</ErrorNote>
        ) : (
          <div className="grid gap-x-8 gap-y-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            <Exhibit
              label="Subscribers"
              loading={loading}
              value={overview ? fmt(overview.subscribers) : "—"}
              delta={<DualDeltaTick trend={trend} field="subscribers" format={edDeltaFmt.int} />}
              sub="channel followers"
            />
            <Exhibit
              label="Total views"
              loading={loading}
              value={overview ? compact(overview.total_views) : "—"}
              delta={<DualDeltaTick trend={trend} field="total_views" format={edDeltaFmt.int} />}
              sub="lifetime, all videos"
            />
            <Exhibit
              label="Videos"
              loading={loading}
              value={overview ? fmt(overview.video_count) : "—"}
              delta={<DualDeltaTick trend={trend} field="video_count" format={edDeltaFmt.int} />}
              sub="in the catalogue"
            />
            <Exhibit
              label="Avg views / video"
              loading={loading}
              value={overview ? fmt(overview.avg_views) : "—"}
              delta={<DualDeltaTick trend={trend} field="avg_views" format={edDeltaFmt.dec1} />}
              sub="mean across the library"
            />
            <Exhibit
              label="Median views / video"
              loading={loading}
              value={overview?.median_views != null ? fmt(overview.median_views) : "—"}
              delta={<DualDeltaTick trend={trend} field="median_views" format={edDeltaFmt.dec1} />}
              sub="the typical video"
            />
            <Exhibit
              label="Avg duration"
              loading={loading}
              value={(() => {
                const sec = overview?.avg_duration_sec != null ? Number(overview.avg_duration_sec) : null;
                if (sec == null || Number.isNaN(sec)) return "—";
                const m = Math.floor(sec / 60);
                const s = Math.round(sec % 60);
                return `${m}m ${s}s`;
              })()}
              delta={
                <DualDeltaTick
                  trend={trend}
                  field="avg_duration_sec"
                  format={edDeltaFmt.secs}
                  goodIsUp={null}
                />
              }
              sub="per video"
            />
            <Exhibit
              label="Subscriber efficiency"
              loading={loading}
              value={
                catalogRow?.subscriber_efficiency != null
                  ? Number(catalogRow.subscriber_efficiency).toFixed(2)
                  : "—"
              }
              delta={<DualDeltaTick trend={trend} field="subscriber_efficiency" format={edDeltaFmt.dec2} />}
              sub="total views ÷ subscribers"
            />
          </div>
        )}
      </RevealSection>
      <TabConnect label="Reach & Growth — the full discovery analysis" onClick={() => onNavigate("reach-growth")} />

      {/* §II Discovery — imported from ReachGrowthTab */}
      <DiscoverySection number="II" reduced={reduced} loading={loading} distRow={distRow}
        error={errOf(data, "distribution")} videoViewsError={errOf(data, "videoViews")}
        breakoutRate={breakoutRate} ladder={ladder} distBuckets={distBuckets} animProps={animProps} />
      <TabConnect label="Reach & Growth — percentile ladder & concentration" onClick={() => onNavigate("reach-growth")} />

      {/* §III Growth — imported from ReachGrowthTab */}
      <GrowthSection number="III" loading={loading} data={data} growthSeries={growthSeries}
        growthSeriesWithReal={growthSeriesWithReal} hasRealTrend={hasRealTrend} animProps={animProps} />
      <TabConnect label="Reach & Growth — monthly detail with MoM %" onClick={() => onNavigate("reach-growth")} />

      {/* §IV Content fit — imported from ContentFormatTab */}
      <ContentFitSection number="IV" loading={loading} data={data}
        categoryScatter={categoryScatter} categoryRows={categoryRows} animProps={animProps} />
      <TabConnect label="Content & Format — duration buckets & leaderboards" onClick={() => onNavigate("content-format")} />

      {/* §V Engagement — imported from AudienceTab */}
      <EngagementSection number="V" loading={loading} data={data}
        engagementSeries={engagementSeries} engMean={engMean} animProps={animProps} />
      <TabConnect label="Audience — like vs comment split & engagement by duration" onClick={() => onNavigate("audience")} />

      {/* §VI Cadence — imported from CadenceSeoTab */}
      <CadenceSection number="VI" loading={loading} data={data}
        cadenceDaySeries={cadenceDaySeries} cadenceHourSeries={cadenceHourSeries} animProps={animProps} />
      <TabConnect label="Cadence & SEO — upload pacing & gap stats" onClick={() => onNavigate("cadence-seo")} />

      {/* §VII Titles & SEO — imported from CadenceSeoTab */}
      <TitlesSeoSection number="VII" loading={loading} data={data} titleSeries={titleSeries} animProps={animProps} />
      <TabConnect label="Cadence & SEO — tag-frequency analysis" onClick={() => onNavigate("cadence-seo")} />

      {/* §VIII Catalog health — imported from ReachGrowthTab */}
      <CatalogHealthSection number="VIII" loading={loading} data={data} catalogRow={catalogRow} />
      <TabConnect label="Reach & Growth — catalog health in context" onClick={() => onNavigate("reach-growth")} />

      {/* §IX Condensed AI section — verdict + top-3 actions */}
      <OverviewInsightsCondensed insightsState={insightsState} reduced={reduced} onNavigate={onNavigate} />
    </>
  );
}
