"use client";

import * as React from "react";
import Link from "next/link";
import { usePerformanceGrip } from "@/lib/queries/performanceGrip";
import StatusVerdict from "./performance-grip/StatusVerdict";
import HeroBand from "./performance-grip/HeroBand";
import WindowToggle from "./performance-grip/WindowToggle";
import MetricTrendGrid from "./performance-grip/MetricTrendGrid";
import RouteDrilldown from "./performance-grip/RouteDrilldown";
import PageDetailPanel from "./performance-grip/PageDetailPanel";
import AppSwitcher from "./performance-grip/AppSwitcher";
import DeviceToggle from "./performance-grip/DeviceToggle";
import { THRESHOLDS } from "@/lib/queries/performanceGrip";

/* Editorial — "Performance Grip", a broadsheet web-vitals review. Aligned with
   the sibling editorial dashboards: a persistent masthead, Tailwind layout +
   .ed-* editorial typography. See spec §6.5.1 and the M27 decision. */

const APP_DEFAULT = "gi-client-web";       // post-login is the higher-value default
const DEVICE_DEFAULT = "mobile";           // M24: Indian fintech traffic is mostly mobile

// Window auto-promote: 7d / 14d / 30d (no auto-promote to 90d — opt-in only)
function defaultWindow(daysCollected) {
  if (!daysCollected || daysCollected < 14) return 7;
  if (daysCollected < 30) return 14;
  return 30;
}

/* The masthead — shared structure with the other editorial dashboards. */
function Masthead({ app, daysCollected, loading }) {
  return (
    <header className="ed-set">
      <Link href="/" className="ed-caption hover:underline">← BACK TO INDEX</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ed-caption mb-2">A PERFORMANCE REVIEW · INTERNAL EDITION</p>
          <h1 className="ed-masthead" style={{ fontSize: "clamp(48px, 10vw, 104px)" }}>
            Performance<br/>Grip.
          </h1>
        </div>
        <p className="ed-section-no" style={{ fontSize: "clamp(14px, 2.4vw, 22px)" }}>
          web vitals,<br/><em>week by week</em>
        </p>
      </div>
      <hr className="ed-rule-double mt-5" />
      <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>VOL. I</span><span>·</span>
        <span>NO. 01</span><span>·</span>
        <span>{app === "gi-client-web" ? "GI CLIENT WEB" : "GI CLIENT STATIC"}</span><span>·</span>
        <span>{daysCollected} DAYS COLLECTED</span>
        {loading && (
          <>
            <span>·</span>
            <span className="ed-prose-italic inline-flex items-center gap-1.5">
              <span className="ed-skeleton" style={{ width: "0.4em", height: "0.4em", borderRadius: "50%" }} aria-hidden />
              ON THE PRESSES
            </span>
          </>
        )}
      </p>
    </header>
  );
}

export default function PerformanceGripDashboardEditorial() {
  const [app,    setApp]    = React.useState(APP_DEFAULT);
  const [device, setDevice] = React.useState(DEVICE_DEFAULT);
  const [windowDays, setWindowDays] = React.useState(7);  // promoted by an effect once data loads

  const { data, loading } = usePerformanceGrip({ app, device, windowDays });

  // Auto-promote default window once we know the archive's age
  const daysCollected = data?.dataAge?.rows?.[0]?.days_collected ?? 0;
  React.useEffect(() => {
    setWindowDays(prev =>
      prev === 7 || prev === 14 || prev === 30
        ? defaultWindow(daysCollected)
        : prev   // user explicitly picked 90d — don't reset
    );
  }, [daysCollected]);

  if (loading) return <SkeletonShell app={app} daysCollected={daysCollected} />;

  return (
    <article className="ed-article">
      <Masthead app={app} daysCollected={daysCollected} loading={loading} />

      <div className="ed-set ed-set-delay-1 mt-8 flex flex-wrap items-end justify-between gap-4">
        <AppSwitcher value={app} onChange={setApp} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <DeviceToggle value={device} onChange={setDevice} />
          <WindowToggle value={windowDays} onChange={setWindowDays} daysCollected={daysCollected} />
        </div>
      </div>

      <div className="ed-set ed-set-delay-2 mt-8">
        <StatusVerdict rows={data?.trendlines?.rows ?? []} thresholds={THRESHOLDS} />
      </div>

      <div className="ed-set ed-set-delay-3 mt-8">
        <HeroBand heroRows={data?.hero?.rows ?? []} />
      </div>

      <div className="ed-set ed-set-delay-4 mt-12">
        <RouteDrilldown routeRows={data?.routes?.rows ?? []} app={app} device={device} />
      </div>

      <div className="ed-set ed-set-delay-5 mt-12">
        <MetricTrendGrid rows={data?.trendlines?.rows ?? []} />
      </div>

      <div className="ed-set ed-set-delay-5 mt-12">
        <PageDetailPanel
          app={app}
          device={device}
          windowDays={windowDays}
          routeRows={data?.routes?.rows ?? []}
        />
      </div>
    </article>
  );
}

/* Loading state — the masthead sets itself first, then ledger-paper pulse
   blocks stand in for the figures still computing. */
function SkeletonShell({ app, daysCollected }) {
  return (
    <article className="ed-article">
      <Masthead app={app} daysCollected={daysCollected} loading />
      <div className="ed-set mt-8 flex flex-col gap-8">
        <span className="ed-skeleton" style={{ width: "100%", height: 64 }} aria-label="loading" />
        <span className="ed-skeleton" style={{ width: "100%", height: 120 }} aria-hidden />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <span className="ed-skeleton" style={{ width: "100%", height: 200 }} aria-hidden />
          <span className="ed-skeleton" style={{ width: "100%", height: 200 }} aria-hidden />
          <span className="ed-skeleton" style={{ width: "100%", height: 200 }} aria-hidden />
        </div>
      </div>
    </article>
  );
}
