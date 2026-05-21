"use client";

import * as React from "react";
import {
  LineChart, Line, Area, ReferenceArea, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

/* Editorial palette tokens (resolved at runtime by browser CSS variables) */
const ED_FOREST = "var(--ed-forest)";
const ED_GOLD   = "var(--ed-gold)";
const ED_RUST   = "var(--ed-rust)";
const ED_INK    = "var(--ed-ink)";

// Calibrated against cream paper at projector resolution (spec §6.2 H14 fix).
// 10% is more visible than the 5% the spec mentioned as a starting point.
const BAND_OPACITY     = 0.10;
const SPREAD_OPACITY   = 0.12;

/* Helper: convert a value field to display ms vs s vs raw float.
   LCP/FCP/TTFB in seconds (the archive stores ms; we ÷1000 for display).
   INP in ms. CLS dimensionless. */
function formatValue(metric, raw) {
  if (raw == null) return "—";
  switch (metric) {
    case "lcp":
    case "fcp":
    case "ttfb":
      return `${(raw / 1000).toFixed(2)}s`;
    case "inp":
      return `${Math.round(raw)}ms`;
    case "cls":
      return raw.toFixed(2);
    default:
      return String(raw);
  }
}

/* Map metric → threshold boundaries in the chart's data unit. */
function thresholdsFor(metric, thresholds) {
  if (metric === "cls") return { good: thresholds.cls.good, ni: thresholds.cls.ni };
  const t = thresholds[metric];
  return { good: t.good_ms, ni: t.ni_ms };
}

export default function MetricTrendCard({
  metric,         // 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'
  metricLabel,    // 'Largest Contentful Paint' / 'INP' / etc.
  metricBlurb,    // 'time until the largest visible element loads' (one-liner under the name)
  rows,           // [{ date, lcp_p75_ms, lcp_p95_ms, ... }, ...]  — from query module
  thresholds,     // imported THRESHOLDS object from performanceGrip.js
}) {
  const t = thresholdsFor(metric, thresholds);
  const p75Key = `${metric}${metric === "cls" ? "_p75" : "_p75_ms"}`;
  const p95Key = `${metric}${metric === "cls" ? "_p95" : "_p95_ms"}`;

  // Latest day's headline p75 value
  const latest = rows.length ? rows[rows.length - 1] : {};
  const latestP75 = latest[p75Key];

  // Fixed Y-axis anchored to thresholds. Range = [0, 1.5 × amber boundary].
  // Keeps the Good→NI line in a stable visual position across days.
  const yMax = t.ni * 1.5;

  return (
    <div className="metric-trend-card">
      <div className="metric-trend-card__head">
        <p className="metric-trend-card__name ed-headline" style={{ fontSize: 18 }}>
          {metricLabel}
        </p>
        {metricBlurb && (
          <p className="metric-trend-card__blurb ed-prose-italic mt-1">{metricBlurb}</p>
        )}
        <p className="metric-trend-card__value ed-stat-num mt-2">
          {formatValue(metric, latestP75)}
        </p>
      </div>

      <div className="ed-figure mt-3">
      <div className="metric-trend-card__chart" style={{ width: "100%", height: 140 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            {/* Threshold bands as ReferenceArea — paint first so they're behind data */}
            <ReferenceArea y1={0}    y2={t.good} fill={ED_FOREST} fillOpacity={BAND_OPACITY} />
            <ReferenceArea y1={t.good} y2={t.ni}   fill={ED_GOLD}   fillOpacity={BAND_OPACITY} />
            <ReferenceArea y1={t.ni}   y2={yMax}   fill={ED_RUST}   fillOpacity={BAND_OPACITY} />

            <CartesianGrid horizontal={false} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={10}
                   stroke="var(--ed-ink-soft)" />
            <YAxis domain={[0, yMax]} fontSize={10} stroke="var(--ed-ink-soft)"
                   tickFormatter={(v) => formatValue(metric, v)} />

            {/* Spread band between p75 and p95 (neutral ink, not the threshold hue) */}
            <Area type="monotone" dataKey={p95Key} stroke="none"
                  fill={ED_INK} fillOpacity={SPREAD_OPACITY}
                  baseLine={(d) => d[p75Key]} isAnimationActive={false} />

            {/* p75 line — the headline */}
            <Line type="monotone" dataKey={p75Key} stroke={ED_INK} strokeWidth={1.5}
                  dot={false} isAnimationActive={false} />

            <Tooltip
              contentStyle={{
                fontFamily: "var(--ed-mono)",
                fontSize: 11,
                background: "var(--ed-paper)",
                border: "1px solid var(--ed-rule)",
              }}
              formatter={(v, k) => [formatValue(metric, v), k]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="metric-trend-card__legend ed-caption mt-1.5">
        ── p75   ░░ p75–p95 spread
      </p>
      </div>
    </div>
  );
}
