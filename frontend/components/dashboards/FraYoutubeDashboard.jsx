"use client";
// FraYoutubeDashboard — classic-theme tab shell
// ─────────────────────────────────────────────────────────────────────────
// The classic rendering of the FRA YouTube project dashboard. A thin shell: a
// masthead Card, the platform's @/components/ui Tabs strip, and the active
// tab. Six fixed-order tabs — Overview, Reach & Growth, Content & Format,
// Audience, Cadence & SEO, AI Insights — each a focused component under
// fra/classic/. The data layer (SQL specs + useFraYoutube) lives in
// lib/queries/fraYoutube.js; the shared classic rendering primitives in
// fra/classic/primitives.jsx; theme-agnostic formatters in fra/helpers.js.

import * as React from "react";
import { useFraYoutube, rowsOf, errOf, computeTrend } from "@/lib/queries/fraYoutube";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Stat, StatStrip, Tabs, TabList, Tab, TabPanel,
} from "@/components/ui";
import { fmt } from "./fra/helpers";
import {
  StatStripSkeleton, discoveryVerdictBadge, useFraInsights, bucketViews, toNum,
} from "./fra/classic/primitives";
import OverviewTab from "./fra/classic/OverviewTab";
import ReachGrowthTab from "./fra/classic/ReachGrowthTab";
import ContentFormatTab from "./fra/classic/ContentFormatTab";
import AudienceTab from "./fra/classic/AudienceTab";
import CadenceSeoTab from "./fra/classic/CadenceSeoTab";
import InsightsTab from "./fra/classic/InsightsTab";

/* The six tabs, in fixed order (spec §4.1). `key` is the stable identifier the
   tabs' onNavigate() calls and the Tabs `value` both use. */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reach-growth", label: "Reach & Growth" },
  { key: "content-format", label: "Content & Format" },
  { key: "audience", label: "Audience" },
  { key: "cadence-seo", label: "Cadence & SEO" },
  { key: "ai-insights", label: "AI Insights" },
];

export default function FraYoutubeDashboard({ project }) {
  const { loading, error, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();
  const [activeTab, setActiveTab] = React.useState("overview");

  /* On tab change, return the reader to the top of the report.
     Declared before any early return — all hooks must run unconditionally. */
  const onNavigate = React.useCallback((key) => {
    setActiveTab(key);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* row extraction — every key is { rows } | { error } */
  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;

  /* Hard empty state — no snapshot has been crawled yet. */
  if (!loading && overviewRows.length === 0 && !errOf(data, "overview")) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-secondary">
          No snapshots yet — the first daily refresh has not run. The report
          fills in once the FRA channel has been crawled.
        </p>
      </Card>
    );
  }

  /* Fatal — the data hook only sets a top-level error when EVERY query
     failed; one bad table is handled per-section. */
  if (error && !overview && !loading) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-error-600">
          Could not load the dashboard — {error}
        </p>
      </Card>
    );
  }

  const snapshotDate = overview?.snapshot_date ?? "—";
  const distRow = rowsOf(data, "distribution")[0] || null;
  const catalogRow = rowsOf(data, "catalogHealth")[0] || null;
  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyRows = rowsOf(data, "monthlyViews");
  const cumulativeRows = rowsOf(data, "cumulativeViews");
  const categoryRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceDayRows = rowsOf(data, "cadenceDay");
  const cadenceHourRows = rowsOf(data, "cadenceHour");
  const titleRows = rowsOf(data, "titlePatterns");
  const videoViewsRows = rowsOf(data, "videoViews");

  /* row extraction — the six specs the editorial plan added (already merged) */
  const durationBucketRows = rowsOf(data, "durationBuckets");
  const tagAnalysisRows = rowsOf(data, "tagAnalysis");
  const uploadCadenceRow = rowsOf(data, "uploadCadence")[0] || null;
  const topVideosByViewsRows = rowsOf(data, "topVideosByViews");
  const topVideosByEngagementRows = rowsOf(data, "topVideosByEngagement");
  const engagementOverallRow = rowsOf(data, "engagementOverall")[0] || null;

  // Day- and week-over-week trend from the overview history — see computeTrend.
  const trend = computeTrend(overviewRows);

  /* ── chart-ready series (moved verbatim from the old render body) ─────────*/
  const growthSeries = cumulativeRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: Number(r.total_views) || 0,
    cumulative: Number(r.cumulative_views) || 0,
  }));
  const channelByMonth = {};
  for (const r of channelSnapshotRows) {
    const m = String(r.snapshot_date ?? "").slice(0, 7);
    if (m) channelByMonth[m] = Number(r.total_views) || 0;
  }
  const growthWithReal = growthSeries.map((d) => ({
    ...d,
    real: channelByMonth[d.month] != null ? channelByMonth[d.month] : null,
  }));
  const hasRealTrend = Object.keys(channelByMonth).length > 0;

  const monthlySeries = monthlyRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: toNum(r.total_views),
  }));

  const distBuckets = bucketViews(videoViewsRows);

  const contentSeries = categoryRows.map((r) => ({
    category: r.category,
    perf: toNum(r.perf_vs_mean_pct),
  }));

  const engRaw = engagementRows
    .map((r) => ({ bucket: r.bucket, rate: toNum(r.engagement_rate_pct) }))
    .filter((r) => r.rate != null);
  const engMean =
    engRaw.length > 0 ? engRaw.reduce((a, r) => a + r.rate, 0) / engRaw.length : 0;
  const engagementSeries = engRaw
    .map((r) => ({ ...r, diff: Math.round((r.rate - engMean) * 100) / 100 }))
    .sort((a, b) => b.diff - a.diff);

  const cadenceDaySeries = cadenceDayRows.map((r) => ({
    bucket: r.bucket,
    avg_views: toNum(r.avg_views),
  }));
  const cadenceHourSeries = cadenceHourRows.map((r) => ({
    bucket: r.bucket,
    avg_views: toNum(r.avg_views),
  }));

  const titleMax = titleRows.reduce((m, r) => Math.max(m, Number(r.avg_views) || 0), 0);

  /* ── per-tab props ───────────────────────────────────────────────────────*/
  const tabProps = {
    overview: {
      loading, data, overview, trend, distRow, catalogRow, distBuckets,
      growthWithReal, hasRealTrend, monthlySeries,
      contentSeries, categoryRows, engagementSeries, engMean,
      cadenceDaySeries, cadenceHourSeries, titleRows, titleMax,
      insightsState, onNavigate,
    },
    "reach-growth": {
      loading, data, distRow, distBuckets,
      growthWithReal, hasRealTrend, monthlySeries, monthlyRows, catalogRow,
    },
    "content-format": {
      loading, data, contentSeries, categoryRows, durationBucketRows,
      topVideosByViewsRows, topVideosByEngagementRows,
    },
    audience: {
      loading, data, engagementSeries, engMean, engagementOverallRow, durationBucketRows,
    },
    "cadence-seo": {
      loading, data, cadenceDaySeries, cadenceHourSeries, titleRows, titleMax,
      uploadCadenceRow, tagAnalysisRows,
    },
    "ai-insights": { insightsState },
  };

  return (
    <div className="flex flex-col gap-8">

      {/* ════════ MASTHEAD ══════════════════════════════════════════════════ */}
      <Card pad="lg">
        <CardHeader>
          <div>
            <CardTitle>{overview?.channel_name || "FRA YouTube"}</CardTitle>
            <CardSubtitle>
              {overview?.channel_handle ? `${overview.channel_handle} · ` : ""}
              channel health · as of {snapshotDate}
            </CardSubtitle>
          </div>
          {!loading && distRow && discoveryVerdictBadge(distRow)}
        </CardHeader>
        <CardBody>
          {loading ? (
            <StatStripSkeleton count={4} />
          ) : (
            <StatStrip>
              <Stat label="Subscribers" value={overview ? fmt(overview.subscribers) : "—"} />
              <Stat label="Total views" value={overview ? fmt(overview.total_views) : "—"} />
              <Stat label="Videos" value={overview ? fmt(overview.video_count) : "—"} />
              <Stat label="Avg views / video" value={overview ? fmt(overview.avg_views) : "—"} />
            </StatStrip>
          )}
        </CardBody>
      </Card>

      {/* ════════ TAB STRIP + ACTIVE TAB ════════════════════════════════════ */}
      <Tabs value={activeTab} defaultValue="overview" onValueChange={onNavigate}>
        <TabList>
          {TABS.map((t) => (
            <Tab key={t.key} value={t.key}>{t.label}</Tab>
          ))}
        </TabList>
        <div className="mt-6">
          <TabPanel value="overview"><OverviewTab {...tabProps.overview} /></TabPanel>
          <TabPanel value="reach-growth"><ReachGrowthTab {...tabProps["reach-growth"]} /></TabPanel>
          <TabPanel value="content-format"><ContentFormatTab {...tabProps["content-format"]} /></TabPanel>
          <TabPanel value="audience"><AudienceTab {...tabProps.audience} /></TabPanel>
          <TabPanel value="cadence-seo"><CadenceSeoTab {...tabProps["cadence-seo"]} /></TabPanel>
          <TabPanel value="ai-insights"><InsightsTab {...tabProps["ai-insights"]} /></TabPanel>
        </div>
      </Tabs>
    </div>
  );
}
