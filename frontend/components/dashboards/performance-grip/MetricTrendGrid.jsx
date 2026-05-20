"use client";
import * as React from "react";
import MetricTrendCard from "./MetricTrendCard";
import { THRESHOLDS } from "@/lib/queries/performanceGrip";

const METRICS = {
  lcp:  { label: "Largest Contentful Paint",  blurb: "Time until the largest visible element loads" },
  inp:  { label: "Interaction to Next Paint", blurb: "Latency of the user's next interaction" },
  cls:  { label: "Cumulative Layout Shift",   blurb: "How much the page visibly jumps after load" },
  fcp:  { label: "First Contentful Paint",    blurb: "When something first appears on screen" },
  ttfb: { label: "Time to First Byte",        blurb: "Server response speed" },
};

const CORE = ["lcp", "inp", "cls"];
const SECONDARY = ["fcp", "ttfb"];

export default function MetricTrendGrid({ rows }) {
  return (
    <div className="metric-trend-grid">
      <Section title="Core Web Vitals">
        <Grid columns={3}>
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
        </Grid>
      </Section>
      <Section title="Secondary Web Vitals">
        <Grid columns={2}>
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
        </Grid>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        borderTop: "1px solid var(--ed-ink)",
        paddingTop: 8,
        marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function Grid({ columns, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
      gap: 16,
    }}>{children}</div>
  );
}
