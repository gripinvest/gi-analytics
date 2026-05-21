"use client";
import * as React from "react";
import MetricTrendCard from "./MetricTrendCard";
import { THRESHOLDS } from "@/lib/queries/performanceGrip";

/* Metric label/blurb map + Core/Secondary grouping. Exported so PageDetailPanel
   (and any other per-metric surface) reuses the same copy without duplicating it. */
export const METRICS = {
  lcp:  { label: "Largest Contentful Paint",  blurb: "Time until the largest visible element loads" },
  inp:  { label: "Interaction to Next Paint", blurb: "Latency of the user's next interaction" },
  cls:  { label: "Cumulative Layout Shift",   blurb: "How much the page visibly jumps after load" },
  fcp:  { label: "First Contentful Paint",    blurb: "When something first appears on screen" },
  ttfb: { label: "Time to First Byte",        blurb: "Server response speed" },
};

export const CORE = ["lcp", "inp", "cls"];
export const SECONDARY = ["fcp", "ttfb"];

export default function MetricTrendGrid({ rows }) {
  return (
    <div className="metric-trend-grid">
      <section className="mb-8">
        <hr className="ed-rule-thick" />
        <p className="ed-section-no mt-2 mb-4">Core Web Vitals</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CORE.map(m => (
            <MetricTrendCard
              key={m}
              metric={m}
              metricLabel={METRICS[m].label}
              metricBlurb={METRICS[m].blurb}
              rows={rows}
              thresholds={THRESHOLDS}
            />
          ))}
        </div>
      </section>
      <section className="mb-8">
        <hr className="ed-rule-thick" />
        <p className="ed-section-no mt-2 mb-4">Secondary Web Vitals</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {SECONDARY.map(m => (
            <MetricTrendCard
              key={m}
              metric={m}
              metricLabel={METRICS[m].label}
              metricBlurb={METRICS[m].blurb}
              rows={rows}
              thresholds={THRESHOLDS}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
