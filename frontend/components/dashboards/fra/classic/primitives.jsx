"use client";
/**
 * Shared classic rendering primitives for the FRA YouTube dashboard tabs.
 *
 * The numbered section frame (`SectionHeading`, `Section`), the StatStrip
 * skeleton, the magnitude `MiniBar`, the delta chips/lines, the discovery
 * verdict badge, the AI-insights blocks, and the classic-only formatters.
 * Every classic FRA tab imports from here. Theme-agnostic formatters live
 * separately in `fra/helpers.js`.
 *
 * Lifted verbatim from the pre-restructure FraYoutubeDashboard.jsx; the only
 * change is that `fmt`/`compact` now resolve to the `helpers.js` exports.
 */

import * as React from "react";
import { fetchFraInsights } from "@/lib/api";
import {
  Card, CardBody, Badge, Skeleton,
} from "@/components/ui";
import { fmt } from "../helpers";

/* ── classic-only null-coercion helpers ──────────────────────────────────── */

/** Coerce to a finite number, or null — keeps a missing value out of charts
    rather than letting it land as a misleading real zero. */
export const toNum = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
export const pct = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`;

/** Average duration in seconds → "Xm Ys". */
export const fmtDuration = (sec) => {
  if (sec == null || sec === "" || Number.isNaN(Number(sec))) return "—";
  const total = Number(sec);
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
};

/* ── section heading ────────────────────────────────────────────────────────
   The single-scroll replacement for the old tab bar: a hairline rule, a
   numbered overline, a display title and a one-line deck. */
export function SectionHeading({ index, title, deck }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border-default pt-6">
      <span className="t-overline text-tertiary">
        Section {String(index).padStart(2, "0")}
      </span>
      <h2 className="t-display-md text-heading">{title}</h2>
      {deck && <p className="t-body-sm text-tertiary max-w-2xl">{deck}</p>}
    </div>
  );
}

/* A section = heading + its card(s), with consistent vertical rhythm. */
export function Section({ index, title, deck, children }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading index={index} title={title} deck={deck} />
      {children}
    </section>
  );
}

/* ── small parts ────────────────────────────────────────────────────────── */

/* Skeleton stand-in for a StatStrip while the queries resolve. */
export function StatStripSkeleton({ count = 4 }) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/* A thin inline magnitude bar — used in the title-patterns ledger. */
export function MiniBar({ value, max }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-200">
      <div
        className="h-full rounded-full bg-navy-300"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/* A delta chip — success ▲ / error ▼ against the snapshot. Used for the
   Catalog-health freshness delta. */
export function DeltaChip({ delta, goodIsUp = true, suffix = "" }) {
  if (delta == null || delta === "" || Number.isNaN(Number(delta))) return null;
  const d = Number(delta);
  if (d === 0) return <span className="t-emphasis-sm text-tertiary">±0{suffix}</span>;
  const good = goodIsUp ? d > 0 : d < 0;
  return (
    <Badge tone={good ? "success" : "error"} variant="soft" className="gap-0.5">
      <span aria-hidden>{d > 0 ? "▲" : "▼"}</span> {fmt(Math.abs(d))}{suffix}
    </Badge>
  );
}

/* Per-field formatters for delta magnitudes. */
export const deltaFmt = {
  int: (v) => fmt(v),
  dec1: (v) => Number(v).toFixed(1),
  dec2: (v) => Number(v).toFixed(2),
  secs: (v) => `${Math.round(Number(v))}s`,
};

/* One line of a delta block: an arrow + magnitude in success/error/neutral,
   then the muted window caption. A null delta (window not deep enough yet)
   shows an em-dash so the caption still names the window that is coming. */
export function DeltaLine({ delta, label, format = fmt, goodIsUp = true }) {
  if (delta == null) {
    return <span className="t-body-xs text-tertiary whitespace-nowrap">— {label}</span>;
  }
  const d = Number(delta);
  const sign = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  const tone =
    d === 0 || goodIsUp == null
      ? "text-tertiary"
      : (goodIsUp ? d > 0 : d < 0)
        ? "text-success-700"
        : "text-error-600";
  return (
    <span className={`t-body-xs whitespace-nowrap ${tone}`}>
      <span aria-hidden>{sign}</span> {d === 0 ? "0" : format(Math.abs(d))}{" "}
      <span className="text-tertiary">{label}</span>
    </span>
  );
}

/* The "At a glance" delta block — day-over-day and week-over-week stacked, the
   week line populating once the snapshot history is a week deep. */
export function DualDelta({ trend, field, format, goodIsUp = true }) {
  if (!trend) return null;
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      <DeltaLine
        delta={trend.day?.deltas?.[field]}
        label={trend.day?.label || "vs yesterday"}
        format={format}
        goodIsUp={goodIsUp}
      />
      <DeltaLine
        delta={trend.week?.deltas?.[field]}
        label={trend.week?.label || "vs last week"}
        format={format}
        goodIsUp={goodIsUp}
      />
    </div>
  );
}

/* The discovery verdict — a one-glance read of the breakout rate. */
export function discoveryVerdictBadge(row) {
  if (!row) return <Badge tone="neutral">no data</Badge>;
  const recentCount = Number(row.recent_video_count ?? 0);
  const rate = Number(row.breakout_1k_rate ?? 0);
  if (recentCount === 0) return <Badge tone="neutral">no recent uploads</Badge>;
  if (rate < 0.25) return <Badge tone="error">discovery crisis</Badge>;
  if (rate < 0.6) return <Badge tone="warning">needs improvement</Badge>;
  return <Badge tone="success">healthy discovery</Badge>;
}

/* ── AI insights hook ───────────────────────────────────────────────────────
   The endpoint can return its fallback payload alongside an `error` string —
   surface it rather than swallowing it (matches the editorial rendering). */
export function useFraInsights() {
  const [state, setState] = React.useState({ loading: true, error: null, insights: null });
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchFraInsights();
        if (!cancelled) {
          setState({
            loading: false,
            error: data && data.error ? String(data.error) : null,
            insights: data || null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState({ loading: false, error: String((e && e.message) || e), insights: null });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

/* ── view-distribution buckets (§ Discovery histogram) ──────────────────────
   Bucketed client-side from raw per-video view counts — /query is SELECT-only
   so the bucketing cannot be a backend job. */
export const VIEW_BUCKETS = [
  { label: "0–99",    min: 0,     max: 100 },
  { label: "100–499", min: 100,   max: 500 },
  { label: "500–999", min: 500,   max: 1000 },
  { label: "1K–4.9K", min: 1000,  max: 5000 },
  { label: "5K–9.9K", min: 5000,  max: 10000 },
  { label: "10K–49K", min: 10000, max: 50000 },
  { label: "50K+",    min: 50000, max: Infinity },
];

export function bucketViews(videoViewsRows) {
  if (!videoViewsRows || videoViewsRows.length === 0) return [];
  const counts = VIEW_BUCKETS.map((b) => ({ bucket: b.label, count: 0 }));
  for (const row of videoViewsRows) {
    const v = Number(row.views) || 0;
    for (let i = 0; i < VIEW_BUCKETS.length; i++) {
      if (v >= VIEW_BUCKETS[i].min && v < VIEW_BUCKETS[i].max) {
        counts[i].count++;
        break;
      }
    }
  }
  return counts;
}

/* ── AI Insights card ───────────────────────────────────────────────────────
   Surfaces the endpoint's `error` field softly while still rendering whatever
   verdict came back. */
export function AiInsightsCard({ state }) {
  const { loading, error, insights } = state;

  return (
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

            {insights?.verdict && (
              <p className="t-body-md text-body font-medium">{insights.verdict}</p>
            )}

            {!insights && !error && (
              <p className="t-body-sm text-tertiary">No insights available yet.</p>
            )}

            <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
              <InsightColumn
                heading="Strengths"
                mark="✓"
                markClass="text-success-700"
                items={insights?.strengths}
              />
              <InsightColumn
                heading="Weaknesses"
                mark="✗"
                markClass="text-error-600"
                items={insights?.weaknesses}
              />
              <InsightColumn
                heading="Recommendations"
                mark="→"
                markClass="text-navy-700"
                items={insights?.recommendations}
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// AI insight items are normally plain strings, but the LLM occasionally returns
// a structured recommendation object ({lever, metric, action}). Coerce to text
// so a stray object can never crash the render — React cannot render an object.
export function insightItemText(it) {
  if (it == null) return "";
  if (typeof it === "string") return it;
  if (typeof it === "object") {
    const parts = [
      ["Lever", it.lever],
      ["Metric", it.metric],
      ["Action", it.action],
    ].filter(([, v]) => v != null && v !== "");
    return parts.length
      ? parts.map(([k, v]) => `${k}: ${v}`).join(" | ")
      : JSON.stringify(it);
  }
  return String(it);
}

export function InsightColumn({ heading, mark, markClass, items }) {
  return (
    <div>
      <div className="t-overline text-tertiary mb-2 border-t border-border-default pt-2">
        {heading}
      </div>
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={i} className="t-body-sm text-body flex gap-2">
              <span className={`shrink-0 ${markClass}`} aria-hidden>{mark}</span>
              <span>{insightItemText(it)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-body-sm text-tertiary">Nothing noted for this snapshot.</p>
      )}
    </div>
  );
}
