"use client";
// AssetSearchCutoverStrip
// ─────────────────────────────────────────────────────────────────────────
// Side-by-side V1 vs V2 comparison strip at the top of Overview. Reads
// `engine_version` from asset_search_* event payloads (NULL = V1,
// 'v2' = V2). Renders a projected/sample state with a pending pill
// while engineDataState() is 'pending'.

import * as React from "react";
import {
  engineDataState,
  pairByEngine,
  ppDelta,
} from "@/lib/queries/engineComparison";

const ED_RUST = "var(--ed-rust, #a6242b)";
const ED_FOREST = "var(--ed-forest, #3b5e3d)";
const ED_INK = "var(--ed-ink, #1b1818)";
const ED_INK_MUTED = "var(--ed-ink-muted, #5d5752)";
const ED_GOLD = "var(--ed-gold, #b8870a)";
const ED_RULE_FAINT = "var(--ed-rule-faint, #c8bfa9)";

function DeltaTag({ delta, suffix = "pt" }) {
  if (!delta) return <span className="ed-caption" style={{ color: ED_INK_MUTED }}>—</span>;
  if (delta.value === 0) {
    return <span className="ed-caption" style={{ color: ED_INK_MUTED }}>±0{suffix}</span>;
  }
  const color = delta.good ? ED_FOREST : ED_RUST;
  return (
    <span className="ed-caption" style={{ color, fontWeight: 600 }}>
      {delta.sign}
      {delta.value}
      {suffix}
    </span>
  );
}

function pct(n) {
  if (n == null) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function num(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN").format(n);
}

/** Single metric row — "Metric | V1 | V2 | delta". */
function MetricRow({ label, v1, v2, formatter = pct, goodIsDown = true, deltaSuffix = "pt", note }) {
  const delta = ppDelta(v1, v2, { goodIsDown });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, 1.4fr) 1fr 1fr 80px",
        gap: 12,
        alignItems: "baseline",
        padding: "8px 0",
        borderBottom: `1px solid ${ED_RULE_FAINT}`,
      }}
    >
      <div>
        <div
          className="ed-prose"
          style={{ fontSize: 14, fontWeight: 500, color: ED_INK }}
        >
          {label}
        </div>
        {note && (
          <div className="ed-caption" style={{ color: ED_INK_MUTED, marginTop: 2 }}>
            {note}
          </div>
        )}
      </div>
      <div
        className="ed-headline"
        style={{
          fontSize: 22,
          lineHeight: 1.1,
          fontVariationSettings: "'opsz' 24, 'wght' 500",
          color: ED_INK,
        }}
      >
        {formatter(v1)}
      </div>
      <div
        className="ed-headline"
        style={{
          fontSize: 22,
          lineHeight: 1.1,
          fontVariationSettings: "'opsz' 24, 'wght' 500",
          color: ED_INK,
        }}
      >
        {formatter(v2)}
      </div>
      <div style={{ textAlign: "right" }}>
        <DeltaTag delta={delta} suffix={deltaSuffix} />
      </div>
    </div>
  );
}

export default function AssetSearchCutoverStrip({ healthRows, outcomeRows, loading = false }) {
  const health = Array.isArray(healthRows) ? healthRows : [];
  const outcome = Array.isArray(outcomeRows) ? outcomeRows : [];
  const combinedState = loading ? "loading" : engineDataState(health) === "live" ? "live" : "pending";
  const sourceHealth = health;
  const sourceOutcome = outcome;

  const { v1: h1, v2: h2 } = pairByEngine(sourceHealth);
  const { v1: o1, v2: o2 } = pairByEngine(sourceOutcome);

  const successPct = (row) =>
    row && row.searched ? (100 * row.success) / row.searched : null;
  const deadEndPct = (row) =>
    row && row.searched ? (100 * row.dead_end) / row.searched : null;

  return (
    <div
      style={{
        marginTop: 20,
        marginBottom: 24,
        padding: "16px 18px",
        background: "var(--ed-paper-deep, #ece2cd)",
        border: `1px solid ${ED_RULE_FAINT}`,
      }}
      aria-label="V1 versus V2 engine comparison"
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div>
          <p
            className="ed-overline"
            style={{ marginBottom: 4, letterSpacing: 0.8 }}
          >
            ENGINE CUTOVER
          </p>
          <h3
            className="ed-headline"
            style={{
              fontSize: 24,
              margin: 0,
              fontVariationSettings: "'opsz' 36, 'wght' 600",
            }}
          >
            <em>V1 vs V2 — did the push move the needle?</em>
          </h3>
        </div>
        {combinedState === "loading" ? (
          <span
            className="ed-caption"
            style={{
              padding: "4px 10px",
              background: "var(--ed-gold-tint, rgba(184, 135, 10, 0.10))",
              borderLeft: `3px solid ${ED_GOLD}`,
              color: ED_INK,
              fontWeight: 600,
              letterSpacing: 0.4,
            }}
          >
            LOADING…
          </span>
        ) : combinedState === "pending" ? (
          <span
            className="ed-caption"
            style={{
              padding: "4px 10px",
              background: "var(--ed-gold-tint, rgba(184, 135, 10, 0.10))",
              borderLeft: `3px solid ${ED_GOLD}`,
              color: ED_INK,
              fontWeight: 600,
              letterSpacing: 0.4,
            }}
          >
            WAITING FOR LIVE V2 DATA
          </span>
        ) : (
          <span
            className="ed-caption"
            style={{ color: ED_INK_MUTED, fontWeight: 500 }}
          >
            LIVE — {h2 ? num(h2.queries) : "—"} V2 QUERIES OBSERVED
          </span>
        )}
      </div>

      {combinedState === "loading" ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }} aria-label="loading">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="ed-skeleton" style={{ height: 22, width: "100%" }} />)}
        </div>
      ) : combinedState === "pending" ? (
        <p className="ed-prose-italic" style={{ marginTop: 12, maxWidth: "70ch" }}>
          V2 is live. This comparison appears once the daily refresh has fetched
          post-cutover events — no sample numbers are shown.
        </p>
      ) : (
        <>
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(140px, 1.4fr) 1fr 1fr 80px",
              gap: 12,
              padding: "6px 0",
              borderBottom: `1px solid ${ED_RULE_FAINT}`,
            }}
          >
            <div className="ed-caption" style={{ color: ED_INK_MUTED, fontWeight: 600 }}>
              METRIC
            </div>
            <div className="ed-caption" style={{ color: ED_INK_MUTED, fontWeight: 600 }}>
              V1 (pre-cutover)
            </div>
            <div className="ed-caption" style={{ color: ED_INK_MUTED, fontWeight: 600 }}>
              V2 (post-cutover)
            </div>
            <div
              className="ed-caption"
              style={{ color: ED_INK_MUTED, fontWeight: 600, textAlign: "right" }}
            >
              DELTA
            </div>
          </div>

          <MetricRow
            label="Search success rate"
            note="share of searched sessions that clicked a result — primary metric"
            v1={successPct(o1)}
            v2={successPct(o2)}
            goodIsDown={false}
          />
          <MetricRow
            label="Dead-end rate"
            note="zero results, no click — what V2 alias map + fallbacks target"
            v1={deadEndPct(o1)}
            v2={deadEndPct(o2)}
            goodIsDown={true}
          />
          <MetricRow
            label="Zero-result rate"
            note="query-level ZRR across all searches"
            v1={h1?.zrr_pct}
            v2={h2?.zrr_pct}
            goodIsDown={true}
          />
          <MetricRow
            label="Refinement rate"
            note="user iterating mid-search — engine ranking proxy"
            v1={h1?.refinement_pct}
            v2={h2?.refinement_pct}
            goodIsDown={true}
          />
          <MetricRow
            label="Total queries"
            note="search-volume baseline (sample sizes)"
            v1={h1?.queries}
            v2={h2?.queries}
            formatter={num}
            goodIsDown={false}
            deltaSuffix=""
          />
        </>
      )}

      {/* Foot note */}
      <p
        className="ed-caption"
        style={{ marginTop: 12, opacity: 0.7, maxWidth: "72ch" }}
      >
        Reads <code style={{ fontFamily: "var(--ed-mono)" }}>engine_version</code> on every{" "}
        <code style={{ fontFamily: "var(--ed-mono)" }}>asset_search_*</code> event payload (V1 rows: NULL · V2 rows: <code style={{ fontFamily: "var(--ed-mono)" }}>'v2'</code>).{" "}
        {combinedState === "live"
          ? "Live data — sampled across a 4-week window straddling the cutover."
          : "Comparison appears once live V2 events are fetched."}
      </p>
    </div>
  );
}
