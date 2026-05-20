"use client";
import * as React from "react";

/* Display direction: lower-is-better metrics get ↓ = forest, ↑ = rust.
   Higher-is-better (page_views) flip the sign. */
function delta(thisVal, lastVal, lowerIsBetter = true) {
  if (thisVal == null || lastVal == null) return null;
  const diff = thisVal - lastVal;
  const pct = lastVal !== 0 ? (diff / lastVal) * 100 : 0;
  const good = lowerIsBetter ? diff <= 0 : diff >= 0;
  return { diff, pct, good };
}

function fmtDelta(d, unit, signLabel) {
  if (!d) return "—";
  const sign = d.diff > 0 ? "↑" : d.diff < 0 ? "↓" : "→";
  const color = d.good ? "var(--ed-forest)" : "var(--ed-rust)";
  return <span style={{ color, fontFamily: "var(--ed-mono)" }}>{sign} {Math.abs(d.diff).toFixed(2)}{unit} ({d.pct >= 0 ? "+" : ""}{d.pct.toFixed(1)}%)</span>;
}

export default function HeroBand({ heroRows /* from hero query: this_week, last_week */ }) {
  const tw = heroRows?.find(r => r.bucket === "this_week") || {};
  const lw = heroRows?.find(r => r.bucket === "last_week") || {};

  const lcpDelta = delta(tw.lcp_p75_ms, lw.lcp_p75_ms, true);
  const inpDelta = delta(tw.inp_p75_ms, lw.inp_p75_ms, true);
  const errDelta = delta(tw.js_errors / Math.max(tw.page_views, 1) * 1000,
                          lw.js_errors / Math.max(lw.page_views, 1) * 1000, true);

  return (
    <div className="hero-band" style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 16,
      padding: 16,
      background: "var(--ed-paper-deep)",
      marginBottom: 16,
    }}>
      <HeroCell label="p75 LCP this week"
                value={tw.lcp_p75_ms != null ? `${(tw.lcp_p75_ms / 1000).toFixed(2)}s` : "—"}
                delta={fmtDelta(lcpDelta, "ms", "")} />
      <HeroCell label="p75 INP this week"
                value={tw.inp_p75_ms != null ? `${Math.round(tw.inp_p75_ms)}ms` : "—"}
                delta={fmtDelta(inpDelta, "ms", "")} />
      <HeroCell label="JS errors / 1K page views"
                value={tw.page_views ? (tw.js_errors / tw.page_views * 1000).toFixed(1) : "—"}
                delta={fmtDelta(errDelta, "", "")} />
      <HeroCell label="Page views (7d)"
                value={tw.page_views?.toLocaleString() || "—"}
                delta={null} />
    </div>
  );
}

function HeroCell({ label, value, delta }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 24,
        fontVariantNumeric: "tabular-nums",
        color: "var(--ed-ink)",
      }}>{value}</div>
      <div style={{ fontSize: 12, marginTop: 2 }}>{delta}</div>
    </div>
  );
}
