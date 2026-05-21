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
    <section className="route-drilldown">
      <hr className="ed-rule-thick" />
      <div className="mt-2 mb-3 flex items-baseline justify-between gap-4">
        <p className="ed-section-no">
          Routes — top {expanded ? EXPANDED_TOP : DEFAULT_TOP} by week-over-week LCP regression
        </p>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="ed-caption shrink-0 underline"
          style={{ background: "none", border: "none", cursor: "pointer" }}
        >
          {expanded ? "[show 5]" : `[show ${EXPANDED_TOP}]`}
        </button>
      </div>

      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th className="ed-caption p-1.5">Route</th>
            <th className="ed-caption p-1.5 text-right">Views (7d)</th>
            <th className="ed-caption p-1.5 text-right">LCP p95</th>
            <th className="ed-caption p-1.5 text-right">INP p95</th>
            <th className="ed-caption p-1.5 text-right">WoW Δ LCP</th>
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
            <tr className="ed-rule-faint" style={{ borderTopWidth: 1, borderTopStyle: "solid" }}>
              <td className="ed-caption p-1.5">Other pages ({otherRows.length})</td>
              <td className="ed-num p-1.5 text-right">{otherViews.toLocaleString()}</td>
              <td className="ed-caption p-1.5" colSpan={3}>—</td>
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
      <tr onClick={onToggle} className="ed-rule-faint"
          style={{ cursor: "pointer", borderTopWidth: 1, borderTopStyle: "solid" }}>
        <td className="ed-num p-1.5">{row.page_url}</td>
        <td className="ed-num p-1.5 text-right">{row.page_views?.toLocaleString()}</td>
        <td className="ed-num p-1.5 text-right">{row.lcp_p95_ms ? `${(row.lcp_p95_ms / 1000).toFixed(2)}s` : "—"}</td>
        <td className="ed-num p-1.5 text-right">{row.inp_p95_ms != null ? `${Math.round(row.inp_p95_ms)}ms` : "—"}</td>
        <td className="ed-num p-1.5 text-right" style={{ color: wowColor }}>
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
      <td colSpan={5} className="p-1.5" style={{ background: "var(--ed-paper-deep)" }}>
        <p className="ed-caption mb-1">30-day LCP p95 trend</p>
        {rows.length > 0 ? (
          <Sparkline rows={rows} />
        ) : (
          <p className="ed-caption">No data yet for this route.</p>
        )}
      </td>
    </tr>
  );
}

function Sparkline({ rows }) {
  // Inline SVG sparkline — light enough to avoid full Recharts overhead per row.
  const w = 480, h = 40, pad = 4;
  const max = Math.max(...rows.map(r => r.lcp_p95_ms || 0), 4000);
  const points = rows.map((r, i) => {
    const x = pad + (i / Math.max(rows.length - 1, 1)) * (w - 2 * pad);
    const y = h - pad - ((r.lcp_p95_ms || 0) / max) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke="var(--ed-ink)" strokeWidth={1.25} />
    </svg>
  );
}
