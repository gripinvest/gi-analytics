"use client";
import * as React from "react";
import { useRouteSparkline } from "@/lib/queries/performanceGrip";

const DEFAULT_TOP = 5;
const EXPANDED_TOP = 15;

export default function RouteDrilldown({ routeRows, app, device }) {
  const [expanded, setExpanded] = React.useState(false);
  const [openRow, setOpenRow] = React.useState(null);  // page_url of currently-expanded route

  // Sort by WoW LCP delta descending (biggest regressions first); ties → page_views desc
  const sorted = [...(routeRows || [])].sort((a, b) => {
    const da = a.lcp_wow_delta_ms ?? 0;
    const db = b.lcp_wow_delta_ms ?? 0;
    if (db !== da) return db - da;
    return (b.page_views ?? 0) - (a.page_views ?? 0);
  });

  const visible = sorted.slice(0, expanded ? EXPANDED_TOP : DEFAULT_TOP);
  const otherRows = sorted.slice(expanded ? EXPANDED_TOP : DEFAULT_TOP);
  const otherViews = otherRows.reduce((s, r) => s + (r.page_views ?? 0), 0);

  return (
    <section className="route-drilldown" style={{ marginTop: 24 }}>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        borderTop: "1px solid var(--ed-ink)",
        paddingTop: 8,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>Routes — top {expanded ? EXPANDED_TOP : DEFAULT_TOP} by week-over-week LCP regression</span>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            fontFamily: "var(--ed-mono)",
            fontSize: 10,
            background: "none",
            border: "none",
            color: "var(--ed-ink-soft)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {expanded ? "[show 5]" : `[show ${EXPANDED_TOP}]`}
        </button>
      </div>

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--ed-mono)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--ed-ink-soft)" }}>
            <th style={{ padding: 6 }}>Route</th>
            <th style={{ padding: 6, textAlign: "right" }}>Views (7d)</th>
            <th style={{ padding: 6, textAlign: "right" }}>LCP p75</th>
            <th style={{ padding: 6, textAlign: "right" }}>INP p75</th>
            <th style={{ padding: 6, textAlign: "right" }}>WoW Δ LCP</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <RouteRow key={r.page_url} row={r}
                      isOpen={openRow === r.page_url}
                      onToggle={() => setOpenRow(openRow === r.page_url ? null : r.page_url)}
                      app={app} device={device} />
          ))}
          {otherRows.length > 0 && (
            <tr style={{ borderTop: "1px solid var(--ed-rule-faint)", color: "var(--ed-ink-soft)" }}>
              <td style={{ padding: 6 }}>Other pages ({otherRows.length})</td>
              <td style={{ padding: 6, textAlign: "right" }}>{otherViews.toLocaleString()}</td>
              <td colSpan={3}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function RouteRow({ row, isOpen, onToggle, app, device }) {
  const wow = row.lcp_wow_delta_ms;
  const wowColor = wow > 0 ? "var(--ed-rust)" : wow < 0 ? "var(--ed-forest)" : "var(--ed-ink-soft)";
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", borderTop: "1px solid var(--ed-rule-faint)" }}>
        <td style={{ padding: 6 }}>{row.page_url}</td>
        <td style={{ padding: 6, textAlign: "right" }}>{row.page_views?.toLocaleString()}</td>
        <td style={{ padding: 6, textAlign: "right" }}>{row.lcp_p75_ms ? `${(row.lcp_p75_ms / 1000).toFixed(2)}s` : "—"}</td>
        <td style={{ padding: 6, textAlign: "right" }}>{row.inp_p75_ms != null ? `${Math.round(row.inp_p75_ms)}ms` : "—"}</td>
        <td style={{ padding: 6, textAlign: "right", color: wowColor }}>
          {wow == null ? "—" : `${wow >= 0 ? "+" : ""}${(wow / 1000).toFixed(2)}s`}
        </td>
      </tr>
      {isOpen && <RouteSparklineRow pageUrl={row.page_url} app={app} device={device} />}
    </>
  );
}

function RouteSparklineRow({ pageUrl, app, device }) {
  const rows = useRouteSparkline({ app, device, pageUrl });
  return (
    <tr>
      <td colSpan={5} style={{ padding: "8px 6px", background: "var(--ed-paper-deep)" }}>
        <div style={{
          fontFamily: "var(--ed-mono)",
          fontSize: 10,
          color: "var(--ed-ink-soft)",
          marginBottom: 4,
        }}>30-day LCP p75 trend</div>
        {rows.length > 0 ? (
          <Sparkline rows={rows} />
        ) : (
          <div style={{ color: "var(--ed-ink-soft)" }}>No data yet for this route.</div>
        )}
      </td>
    </tr>
  );
}

function Sparkline({ rows }) {
  // Inline SVG sparkline — light enough to avoid full Recharts overhead per row.
  const w = 480, h = 40, pad = 4;
  const max = Math.max(...rows.map(r => r.lcp_p75_ms || 0), 4000);
  const points = rows.map((r, i) => {
    const x = pad + (i / Math.max(rows.length - 1, 1)) * (w - 2 * pad);
    const y = h - pad - ((r.lcp_p75_ms || 0) / max) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke="var(--ed-ink)" strokeWidth={1.25} />
    </svg>
  );
}
