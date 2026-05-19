"use client";
// FraYoutubeDashboardEditorial — tab shell
// ─────────────────────────────────────────────────────────────────────────
// The editorial-theme rendering of the FRA YouTube project dashboard. A thin
// shell: a persistent masthead, a "Weekly"-idiom tab strip, and the active
// tab. Six fixed-order tabs — Overview, Reach & Growth, Content & Format,
// Audience, Cadence & SEO, AI Insights — each a focused component under
// fra/editorial/. The data layer (SQL specs + useFraYoutube) lives in
// lib/queries/fraYoutube.js; the shared rendering primitives in
// fra/editorial/primitives.jsx; theme-agnostic formatters in fra/helpers.js.

import * as React from "react";
import Link from "next/link";
import { useFraYoutube, rowsOf, errOf, computeTrend } from "@/lib/queries/fraYoutube";
import { fmtDate } from "./fra/helpers";
import {
  ED_INK_MUTED, ED_INK_FAINT, ED_RUST, CHART_ANIM_MS,
  usePrefersReducedMotion, useFraInsights, RevealSection, EmptyPlate,
} from "./fra/editorial/primitives";
import OverviewTab from "./fra/editorial/OverviewTab";
import ReachGrowthTab from "./fra/editorial/ReachGrowthTab";
import ContentFormatTab from "./fra/editorial/ContentFormatTab";
import AudienceTab from "./fra/editorial/AudienceTab";
import CadenceSeoTab from "./fra/editorial/CadenceSeoTab";
import InsightsTab from "./fra/editorial/InsightsTab";

/* The six tabs, in fixed order (spec §4.1). `key` is the stable identifier the
   tabs' onNavigate() calls and the active-tab state both use. */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reach-growth", label: "Reach & Growth" },
  { key: "content-format", label: "Content & Format" },
  { key: "audience", label: "Audience" },
  { key: "cadence-seo", label: "Cadence & SEO" },
  { key: "ai-insights", label: "AI Insights" },
];

/* The "Weekly"-idiom tab strip — mono labels on a ruled rail, in the spirit of
   the old TableOfContents. Horizontally scrollable on narrow viewports so all
   six tabs are reachable at 375px without wrapping. */
function TabStrip({ active, onSelect }) {
  return (
    <nav
      className="mt-8 overflow-x-auto"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      aria-label="Report sections"
    >
      <div
        className="flex gap-x-1"
        style={{ borderTop: "1px solid var(--ed-ink)", borderBottom: "1px solid var(--ed-rule-faint)" }}
      >
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onSelect(t.key)}
              className="ed-section-link shrink-0 whitespace-nowrap"
              aria-current={on ? "page" : undefined}
              style={{
                minHeight: 40,
                padding: "0 14px",
                display: "inline-flex",
                alignItems: "center",
                background: on ? "var(--ed-ink)" : "none",
                color: on ? "var(--ed-paper)" : "var(--ed-ink-muted)",
                border: "none",
                cursor: "pointer",
                fontWeight: on ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function FraYoutubeDashboardEditorial({ project }) {
  const reduced = usePrefersReducedMotion();
  const { loading, error, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();
  const [activeTab, setActiveTab] = React.useState("overview");

  /* On tab change, return the reader to the top of the report. */
  const onNavigate = React.useCallback((key) => {
    setActiveTab(key);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);

  /* ── row extraction (existing) ───────────────────────────────────────────*/
  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;
  const distRow = rowsOf(data, "distribution")[0] || null;
  const catalogRow = rowsOf(data, "catalogHealth")[0] || null;
  const videoViewsRows = rowsOf(data, "videoViews");
  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyRows = rowsOf(data, "monthlyViews");
  const cumulativeRows = rowsOf(data, "cumulativeViews");
  const categoryRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceDayRows = rowsOf(data, "cadenceDay");
  const cadenceHourRows = rowsOf(data, "cadenceHour");
  const titleRows = rowsOf(data, "titlePatterns");

  /* ── row extraction (new, Task 1 specs) ──────────────────────────────────*/
  const durationBucketRows = rowsOf(data, "durationBuckets");
  const tagAnalysisRows = rowsOf(data, "tagAnalysis");
  const uploadCadenceRow = rowsOf(data, "uploadCadence")[0] || null;
  const topVideosByViewsRows = rowsOf(data, "topVideosByViews");
  const topVideosByEngagementRows = rowsOf(data, "topVideosByEngagement");
  const engagementOverallRow = rowsOf(data, "engagementOverall")[0] || null;

  const snapshotDate = overview?.snapshot_date ?? null;
  const noSnapshotYet = !loading && overviewRows.length === 0 && !errOf(data, "overview");

  /* Fatal — every query failed. */
  if (error && !overview && !loading) {
    return (
      <article className="ed-article">
        <header className="ed-set">
          <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
            ← BACK TO INDEX
          </Link>
          <h1 className="ed-headline mt-6 mb-3" style={{ fontSize: "clamp(34px,6vw,56px)" }}>
            We couldn't set <em>The FRA Weekly</em>.
          </h1>
          <p className="ed-prose-italic" style={{ color: ED_RUST }}>{error}</p>
        </header>
      </article>
    );
  }

  /* ── derived chart-ready series (moved verbatim from the old render body) ─*/
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
  const growthSeriesWithReal = growthSeries.map((d) => ({
    ...d,
    real: channelByMonth[d.month] != null ? channelByMonth[d.month] : null,
  }));
  const hasRealTrend = Object.keys(channelByMonth).length > 0;

  const trend = computeTrend(overviewRows);

  const distBuckets = (() => {
    if (!videoViewsRows || videoViewsRows.length === 0) return [];
    const BUCKETS = [
      { label: "0–99", min: 0, max: 100 },
      { label: "100–499", min: 100, max: 500 },
      { label: "500–999", min: 500, max: 1000 },
      { label: "1K–4.9K", min: 1000, max: 5000 },
      { label: "5K–9.9K", min: 5000, max: 10000 },
      { label: "10K–49K", min: 10000, max: 50000 },
      { label: "50K+", min: 50000, max: Infinity },
    ];
    const counts = BUCKETS.map((b) => ({ bucket: b.label, count: 0 }));
    for (const row of videoViewsRows) {
      const v = Number(row.views) || 0;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (v >= BUCKETS[i].min && v < BUCKETS[i].max) { counts[i].count++; break; }
      }
    }
    return counts;
  })();

  const ladder = distRow
    ? [
        { tier: "≥ 1K views", count: Number(distRow.videos_ge_1k) || 0 },
        { tier: "≥ 10K views", count: Number(distRow.videos_ge_10k) || 0 },
        { tier: "≥ 100K views", count: Number(distRow.videos_ge_100k) || 0 },
      ]
    : [];

  const breakoutRate =
    distRow && distRow.breakout_1k_rate != null ? Number(distRow.breakout_1k_rate) * 100 : null;

  const categoryScatter = categoryRows.map((r) => ({
    category: r.category,
    videos: Number(r.video_count) || 0,
    avgViews: Number(r.avg_views) || 0,
    vsMean: r.perf_vs_mean_pct != null ? Number(r.perf_vs_mean_pct) : null,
  }));

  const engRaw = engagementRows.map((r) => ({
    bucket: r.bucket,
    rate: Number(r.engagement_rate_pct) || 0,
  }));
  const engMean = engRaw.length > 0 ? engRaw.reduce((a, r) => a + r.rate, 0) / engRaw.length : 0;
  const engagementSeries = engRaw
    .map((r) => ({ ...r, diff: Math.round((r.rate - engMean) * 100) / 100 }))
    .sort((a, b) => b.diff - a.diff);

  const cadenceDaySeries = cadenceDayRows.map((r) => ({ bucket: r.bucket, avgViews: Number(r.avg_views) || 0 }));
  const cadenceHourSeries = cadenceHourRows.map((r) => ({ bucket: r.bucket, avgViews: Number(r.avg_views) || 0 }));
  const titleSeries = titleRows
    .map((r) => ({ pattern: r.pattern, avgViews: Number(r.avg_views) || 0, videos: Number(r.video_count) || 0 }))
    .slice(0, 9);

  const animProps = reduced
    ? { isAnimationActive: false }
    : { isAnimationActive: true, animationDuration: CHART_ANIM_MS, animationEasing: "ease-out" };

  /* ── shared tab props ────────────────────────────────────────────────────*/
  const commonProps = { reduced, loading, animProps, data };
  const tabProps = {
    overview: {
      ...commonProps, overview, trend, catalogRow, distRow, breakoutRate, ladder, distBuckets,
      growthSeries, growthSeriesWithReal, hasRealTrend, categoryScatter, categoryRows,
      engagementSeries, engMean, cadenceDaySeries, cadenceHourSeries, titleSeries,
      insightsState, onNavigate,
    },
    "reach-growth": {
      ...commonProps, distRow, breakoutRate, ladder, distBuckets,
      growthSeries, growthSeriesWithReal, hasRealTrend, catalogRow, monthlyRows,
    },
    "content-format": {
      ...commonProps, categoryScatter, categoryRows, durationBucketRows,
      topVideosByViewsRows, topVideosByEngagementRows,
    },
    audience: {
      ...commonProps, engagementSeries, engMean, engagementOverallRow, durationBucketRows,
    },
    "cadence-seo": {
      ...commonProps, cadenceDaySeries, cadenceHourSeries, titleSeries, uploadCadenceRow, tagAnalysisRows,
    },
    "ai-insights": { insightsState },
  };

  const TabComponent = {
    overview: OverviewTab,
    "reach-growth": ReachGrowthTab,
    "content-format": ContentFormatTab,
    audience: AudienceTab,
    "cadence-seo": CadenceSeoTab,
    "ai-insights": InsightsTab,
  }[activeTab];

  return (
    <article className="ed-article">
      {/* ════════ MASTHEAD (persistent above the tab strip) ═════════════════ */}
      <header className="ed-set">
        <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
          ← BACK TO INDEX
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ed-caption mb-2">A CHANNEL REVIEW · INTERNAL EDITION</p>
            <h1 className="ed-masthead" style={{ fontSize: "clamp(56px, 11.5vw, 132px)" }}>
              The FRA<br/>Weekly.
            </h1>
          </div>
          <p className="ed-section-no" style={{ fontSize: "clamp(16px, 2.6vw, 26px)" }}>
            one channel,<br/>
            <em style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 80" }}>read closely</em>
          </p>
        </div>
        <hr className="ed-rule-double mt-5" />
        <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>VOL. I</span><span>·</span>
          <span>NO. 01</span><span>·</span>
          <span>{overview?.channel_name ? String(overview.channel_name).toUpperCase() : "FRA YOUTUBE"}</span>
          {overview?.channel_handle && (<><span>·</span><span>{overview.channel_handle}</span></>)}
          <span>·</span>
          <span>AS OF {snapshotDate ? fmtDate(snapshotDate).toUpperCase() : "—"}</span>
          {loading && (
            <>
              <span>·</span>
              <span className="ed-prose-italic inline-flex items-center gap-1.5" style={{ color: ED_INK_FAINT }}>
                <span className="ed-skeleton" style={{ width: "0.4em", height: "0.4em", borderRadius: "50%" }} aria-hidden />
                ON THE PRESSES
              </span>
            </>
          )}
        </p>
        <TabStrip active={activeTab} onSelect={onNavigate} />
      </header>

      {/* ════════ ACTIVE TAB ════════════════════════════════════════════════ */}
      {noSnapshotYet ? (
        <RevealSection reduced={reduced} className="mt-12">
          <EmptyPlate>
            No snapshots yet — the first daily refresh has not run. The report sets
            itself once the FRA channel has been crawled.
          </EmptyPlate>
        </RevealSection>
      ) : (
        <div className="mt-2">
          <TabComponent {...tabProps[activeTab]} />
        </div>
      )}

      {/* ════════ COLOPHON ══════════════════════════════════════════════════ */}
      <footer className="mt-16">
        <hr className="ed-rule" />
        <p className="ed-byline mt-4 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 12 }}>
          <span>
            Figures are drawn from the latest committed snapshot
            {snapshotDate ? ` of ${fmtDate(snapshotDate)}` : ""}. The cumulative-views
            series is a library-accumulation proxy — see the Growth section.
          </span>
          <span>·</span>
          <span>© Grip Invest 2026 · Internal use only.</span>
        </p>
      </footer>
    </article>
  );
}
