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
  Card, CardHeader, CardTitle, CardBody,
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

/* §01 At a glance — the channel in seven figures. Extracted verbatim from
   the pre-restructure FraYoutubeDashboard.jsx lines 409-471. */
function AtAGlanceSection({ index, loading, data, overview, trend, catalogRow }) {
  return (
    <Section
      index={index}
      title="At a glance"
      deck="The channel in seven figures — reach, library size and pacing — with the week-on-week tick where the snapshot delta is known."
    >
      <Card pad="md">
        {loading ? (
          <StatStripSkeleton count={7} />
        ) : errOf(data, "overview") ? (
          <p className="t-body-sm text-error-600">Could not load this section.</p>
        ) : (
          <StatStrip>
            <Stat
              label="Subscribers"
              value={overview ? fmt(overview.subscribers) : "—"}
              delta={<DualDelta trend={trend} field="subscribers" format={deltaFmt.int} />}
            />
            <Stat
              label="Total views"
              value={overview ? fmt(overview.total_views) : "—"}
              delta={<DualDelta trend={trend} field="total_views" format={deltaFmt.int} />}
            />
            <Stat
              label="Videos"
              value={overview ? fmt(overview.video_count) : "—"}
              delta={<DualDelta trend={trend} field="video_count" format={deltaFmt.int} />}
            />
            <Stat
              label="Avg views / video"
              value={overview ? fmt(overview.avg_views) : "—"}
              delta={<DualDelta trend={trend} field="avg_views" format={deltaFmt.dec1} />}
            />
            <Stat
              label="Median views / video"
              value={overview?.median_views != null ? fmt(overview.median_views) : "—"}
              delta={<DualDelta trend={trend} field="median_views" format={deltaFmt.dec1} />}
            />
            <Stat
              label="Avg duration"
              value={fmtDuration(overview?.avg_duration_sec)}
              delta={
                <DualDelta
                  trend={trend}
                  field="avg_duration_sec"
                  format={deltaFmt.secs}
                  goodIsUp={null}
                />
              }
            />
            <Stat
              label="Subscriber efficiency"
              value={
                catalogRow?.subscriber_efficiency != null
                  ? Number(catalogRow.subscriber_efficiency).toFixed(2)
                  : "—"
              }
              delta={<DualDelta trend={trend} field="subscriber_efficiency" format={deltaFmt.dec2} />}
            />
          </StatStrip>
        )}
      </Card>
    </Section>
  );
}

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
