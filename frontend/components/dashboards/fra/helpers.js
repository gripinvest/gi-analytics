/**
 * Theme-agnostic formatting utilities for the FRA YouTube dashboards.
 *
 * Number/date formatters only — no React, no JSX, no editorial styling. Both
 * the editorial and (later) classic renderings import these. Editorial
 * rendering primitives live in `fra/editorial/primitives.jsx`.
 */

export const nf = new Intl.NumberFormat("en-IN");

export const fmt = (v) => (v == null || v === "" ? "—" : nf.format(Number(v)));

export const pct1 = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`;

export const compact = (v) => {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return nf.format(n);
};

export const fmtDate = (s) => {
  const d = new Date(String(s ?? "").slice(0, 10));
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

export const fmtMonth = (s) => {
  // "2025-07" → "Jul '25"
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return String(s ?? "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : `${d.toLocaleDateString("en-IN", { month: "short" })} '${m[1].slice(2)}`;
};

/**
 * Parse a pipe-delimited recommendation string into structured label/value pairs.
 *
 * Input: "Lever: <lever> | Metric: <metric> | Action: <action>"
 * Output: [{ label: "Lever", value: "<lever>" }, { label: "Metric", value: "<metric>" }, ...]
 *
 * If the input has no `|` and no `:` (a plain sentence — strengths/weaknesses),
 * returns [{ label: null, value: text }] so callers can render it plainly.
 *
 * Pure function — no React, no JSX.
 *
 * @param {string} text
 * @returns {{ label: string|null, value: string }[]}
 */
export function parseRecommendation(text) {
  const str = String(text ?? "").trim();
  if (!str) return [{ label: null, value: str }];

  const hasPipe = str.includes("|");
  const hasColon = str.includes(":");

  if (!hasPipe && !hasColon) {
    return [{ label: null, value: str }];
  }

  const segments = hasPipe ? str.split("|") : [str];
  const parts = segments.map((seg) => {
    const trimmed = seg.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) return { label: null, value: trimmed };
    const label = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    return { label: label || null, value };
  });

  // If every segment produced a null label, treat as plain text
  const hasAnyLabel = parts.some((p) => p.label !== null);
  if (!hasAnyLabel) return [{ label: null, value: str }];

  return parts;
}
