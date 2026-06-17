"use client";
import * as React from "react";
import { issuerForQuery } from "@/lib/queries/assetSearch";

const isTrue = (v) => v === true || v === "True" || v === 1 || v === "1";

function Scorecard({ label, value, sub }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="ed-caption" style={{ opacity: 0.75 }}>{label}</div>
      <div className="ed-headline" style={{ fontSize: 26, lineHeight: 1.05 }}>{value ?? "—"}</div>
      {sub && <div className="ed-caption" style={{ opacity: 0.7 }}>{sub}</div>}
    </div>
  );
}

const mCell = { padding: "8px 10px", borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)", color: "var(--ed-ink-soft, #2c2926)", verticalAlign: "top" };

export default function UserSearchHistoryModal({ userId, rows, loading, error, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = Array.isArray(rows) ? rows : [];
  const summary = React.useMemo(() => {
    if (data.length === 0) return null;
    const keywords = new Set(data.map((r) => (r.query_text || "").trim()).filter(Boolean));
    const days = data.map((r) => r.day).filter(Boolean).sort();
    const gc = data.map((r) => (r.gc_name || "").trim()).find(Boolean);
    const kyc = data.map((r) => (r.kyc || "").trim()).find(Boolean);
    return {
      searches: data.length,
      distinct: keywords.size,
      zero: data.filter((r) => Number(r.results_count) === 0).length,
      withClicks: data.filter((r) => r.clicked_assets).length,
      first: days[0], last: days[days.length - 1],
      invested: data.some((r) => isTrue(r.invested)),
      source: gc ? `GC · ${gc}` : "Platform",
      kyc: kyc || "—",
    };
  }, [data]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Search history for user ${userId}`} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(27,24,24,0.55)", zIndex: 50,
               display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "4vh 12px" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--ed-paper, #f2ebdb)", border: "1px solid var(--ed-rule, #1b1818)",
                 width: "min(880px, 96vw)", padding: "20px 22px", fontFamily: "var(--ed-mono, ui-monospace)" }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <div className="ed-overline">USER HISTORY</div>
            <h3 className="ed-headline" style={{ fontSize: 28 }}>#{userId}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ed-caption"
            style={{ border: "1px solid var(--ed-rule, #1b1818)", background: "transparent", padding: "4px 10px", cursor: "pointer" }}>✕ CLOSE</button>
        </div>

        {loading && <p className="ed-prose-italic" style={{ marginTop: 16 }}>Loading history…</p>}
        {error && <p className="ed-prose-italic" style={{ marginTop: 16, color: "var(--ed-rust, #a6242b)" }}>Could not load history: {String(error)}</p>}

        {!loading && !error && summary && (
          <>
            <div className="grid gap-x-6 gap-y-4 mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              <Scorecard label="SEARCHES" value={summary.searches} sub={`${summary.distinct} distinct`} />
              <Scorecard label="ZERO-RESULT" value={summary.zero} sub="dead ends" />
              <Scorecard label="W/ CLICKS" value={summary.withClicks} sub="searches → click" />
              <Scorecard label="INVESTED" value={summary.invested ? "Yes" : "No"} />
              <Scorecard label="SOURCE" value={summary.source} sub={`KYC ${summary.kyc}`} />
              <Scorecard label="ACTIVE" value={summary.first === summary.last ? summary.first : `${summary.first} → ${summary.last}`} />
            </div>
            <div className="mt-6" style={{ overflowX: "auto", maxHeight: "46vh", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 600 }}>
                <thead><tr>
                  {["DATE", "KEYWORD", "ISSUER", "RESULTS", "CLICKED"].map((h) => (
                    <th key={h} scope="col" className="ed-caption"
                      style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.map((r, i) => {
                    const issuer = issuerForQuery(r.query_text);
                    const zero = Number(r.results_count) === 0;
                    return (
                      <tr key={i} style={{ background: i % 2 ? "var(--ed-paper-deep, #ece2cd)" : "transparent" }}>
                        <td style={mCell}>{r.day}</td>
                        <td style={{ ...mCell, fontStyle: "italic" }}>"{r.query_text}"{isTrue(r.is_refinement) ? " ↻" : ""}</td>
                        <td style={mCell}>{issuer || "—"}</td>
                        <td style={mCell}>{zero ? <span style={{ color: "var(--ed-rust, #a6242b)" }}>0 · dead end</span> : r.results_count}</td>
                        <td style={mCell}>{r.clicked_assets ? `${r.clicked_types ? r.clicked_types + " · " : ""}${r.clicked_assets}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!loading && !error && !summary && (
          <p className="ed-prose-italic" style={{ marginTop: 16 }}>No W4+ search history for this user.</p>
        )}
      </div>
    </div>
  );
}
