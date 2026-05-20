"use client";

import * as React from "react";
import { usePerformanceGrip } from "@/lib/queries/performanceGrip";
import StatusVerdict from "./performance-grip/StatusVerdict";
import HeroBand from "./performance-grip/HeroBand";
import WindowToggle from "./performance-grip/WindowToggle";
import { THRESHOLDS } from "@/lib/queries/performanceGrip";

/* Editorial Lite — typography + palette only; no broadsheet masthead. See
   spec §6.5.1 and the M27 decision. */

const APP_DEFAULT = "gi-client-web";       // post-login is the higher-value default
const DEVICE_DEFAULT = "mobile";           // M24: Indian fintech traffic is mostly mobile

// Window auto-promote: 7d / 14d / 30d (no auto-promote to 90d — opt-in only)
function defaultWindow(daysCollected) {
  if (!daysCollected || daysCollected < 14) return 7;
  if (daysCollected < 30) return 14;
  return 30;
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

  if (loading) return <SkeletonShell />;

  return (
    <div className="performance-grip-dashboard">
      {/* TODO Phase G: AppSwitcher */}
      {/* TODO Phase G: DeviceToggle */}
      {/* TODO Phase D: WindowToggle */}
      {/* TODO Phase D: StatusVerdict */}
      {/* TODO Phase D: HeroBand */}
      {/* TODO Phase F: RouteDrilldown */}
      {/* TODO Phase E: MetricTrendGrid */}
      <WindowToggle value={windowDays} onChange={setWindowDays} daysCollected={daysCollected} />
      <StatusVerdict rows={data?.trendlines?.rows ?? []} thresholds={THRESHOLDS} />
      <HeroBand heroRows={data?.hero?.rows ?? []} />
    </div>
  );
}

function SkeletonShell() {
  return <div style={{ padding: 24 }}>Loading Performance Grip…</div>;
}
