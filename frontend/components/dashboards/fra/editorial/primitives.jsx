"use client";
/**
 * Shared editorial rendering primitives for the FRA YouTube dashboard tabs.
 *
 * The ED_* palette, Recharts chart props, the editorial chart frame (`Figure`),
 * the ledger table, the stat exhibit, delta ticks, the animation hooks and the
 * AI-insights blocks. Every editorial FRA tab imports from here. Theme-agnostic
 * formatters live separately in `fra/helpers.js`.
 *
 * Lifted verbatim from the pre-restructure FraYoutubeDashboardEditorial.jsx.
 */

import * as React from "react";
import { fetchFraInsights } from "@/lib/api";
import { fmt } from "../helpers";

/* ── editorial palette (ink marks on paper, sparing accents) ─────────────────
   References the --ed-* CSS variables, so the charts follow whichever
   editorial theme is active (sepia / light). Recharts passes these straight
   through to SVG fill/stroke, where var() resolves normally — this dashboard
   always renders inside [data-design="editorial"], so the vars are in scope. */
export const ED_PAPER = "var(--ed-paper)";
export const ED_INK = "var(--ed-ink)";
export const ED_INK_SOFT = "var(--ed-ink-soft)";
export const ED_INK_MUTED = "var(--ed-ink-muted)";
export const ED_INK_FAINT = "var(--ed-ink-faint)";
export const ED_RUST = "var(--ed-rust)";
export const ED_FOREST = "var(--ed-forest)";
export const ED_GOLD = "var(--ed-gold)";
export const ED_RULE_FAINT = "var(--ed-rule-faint)";

/* Restrained Recharts entrance: a short ease so figures settle rather than
   sweep. Disabled wholesale when the reader prefers reduced motion. */
export const CHART_ANIM_MS = 520;

export const edAxisProps = {
  stroke: ED_INK_MUTED,
  tick: { fontSize: 10, fontFamily: "var(--ed-mono)", fill: ED_INK_MUTED, letterSpacing: 0.5 },
  tickLine: false,
  axisLine: { stroke: ED_INK, strokeWidth: 1 },
};
export const edGridProps = {
  stroke: ED_RULE_FAINT,
  strokeDasharray: "0",
  vertical: false,
};

/* Per-field formatters for editorial delta magnitudes. */
export const edDeltaFmt = {
  int: (v) => fmt(v),
  dec1: (v) => Number(v).toFixed(1),
  dec2: (v) => Number(v).toFixed(2),
  secs: (v) => `${Math.round(Number(v))}s`,
};

/* ── reduced-motion ─────────────────────────────────────────────────────────
   The CSS already disables ed-set / ed-skeleton under prefers-reduced-motion;
   the new JS animations (scroll-reveal, count-up) must check it too. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

/* A <section> that fades in via the CSS ed-set animation. Content is always
   visible — the animation is a progressive enhancement only. */
export function RevealSection({ reduced, children, id, className = "", style, stagger }) {
  const delayClass = stagger ? ` ed-set-delay-${Math.min(stagger, 5)}` : "";
  return (
    <section
      id={id}
      className={`${reduced ? "" : `ed-set${delayClass}`} ${className}`.trim()}
      style={style}
    >
      {children}
    </section>
  );
}

/* ── count-up ───────────────────────────────────────────────────────────────
   A brief, restrained count-up for the §3 north-star pull-number. Runs once,
   on first reveal; under reduced motion the final value is rendered directly.
   ease-out-quint so the digits decelerate into their final reading. */
export function useCountUp(target, active, reduced, durationMs = 900) {
  const [value, setValue] = React.useState(reduced ? target : 0);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!active || target == null || Number.isNaN(Number(target))) return;
    if (reduced) { setValue(Number(target)); return; }
    if (started.current) return;
    started.current = true;

    let raf = 0;
    const t0 = performance.now();
    const end = Number(target);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 5); // ease-out-quint
      setValue(end * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(end);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, reduced, durationMs]);

  return value;
}

/* ── editorial tooltip — paper-on-ink, monospaced ───────────────────────────*/
export function EdTooltip({ active, payload, label, labelFmt, valueFmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: ED_PAPER,
        border: `1px solid ${ED_INK}`,
        padding: "8px 12px",
        fontFamily: "var(--ed-mono)",
        fontSize: 11,
        color: ED_INK,
        boxShadow: "2px 2px 0 rgba(27,24,24,0.12)",
      }}
    >
      {label != null && (
        <div style={{ textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4, fontWeight: 500 }}>
          {labelFmt ? labelFmt(label) : label}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, background: p.color || p.fill || p.stroke }} />
          <span style={{ color: ED_INK_MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>{p.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 500 }}>
            {valueFmt ? valueFmt(p.value, p) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── primitives ─────────────────────────────────────────────────────────────*/

export function SectionHead({ number, italic, deck, anchor }) {
  return (
    <header id={anchor} className="mt-16 mb-7" style={{ scrollMarginTop: 24 }}>
      <hr className="ed-rule-thick mb-6" />
      <p className="ed-section-no mb-1">SECTION {number}</p>
      <h2 className="ed-headline" style={{ fontSize: "clamp(30px, 4.8vw, 52px)" }}>
        <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
          {italic}
        </em>
      </h2>
      {deck && (
        <p className="ed-prose-italic mt-3" style={{ maxWidth: "62ch", fontSize: 15 }}>{deck}</p>
      )}
    </header>
  );
}

/* A ruled chart frame — ed-figure top/bottom rules, a FIG. caption, an italic
   reading caption, then the chart, with an optional honest after-note. */
export function Figure({ figNum, title, caption, footnote, children, height = 280, error, loading }) {
  return (
    <figure className="ed-figure mt-9">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span className="ed-caption">FIG. {figNum}</span>
        <span className="ed-section-no" style={{ fontStyle: "italic" }}>—</span>
        <h3
          className="ed-prose"
          style={{ fontVariationSettings: "'opsz' 24", fontSize: 16, fontWeight: 500, color: ED_INK }}
        >
          {title}
        </h3>
      </figcaption>
      {caption && <p className="ed-prose-italic mb-4" style={{ maxWidth: "62ch" }}>{caption}</p>}
      <div style={{ height, width: "100%" }}>
        {loading ? (
          <div className="h-full w-full flex items-center justify-center">
            <span className="ed-skeleton" style={{ width: "8em", height: "0.7em" }} aria-label="loading" />
          </div>
        ) : error ? (
          <div className="h-full w-full flex items-center justify-center">
            <span className="ed-prose-italic" style={{ color: ED_RUST }}>
              Could not render this figure: {error}
            </span>
          </div>
        ) : (
          children
        )}
      </div>
      {footnote && !loading && !error && (
        <p className="ed-caption mt-3" style={{ lineHeight: 1.7, opacity: 0.85 }}>{footnote}</p>
      )}
    </figure>
  );
}

/* A small delta tick — rust ▼ for negative, forest ▲ for positive. An optional
   `note` names the comparison window so a ±0 reads as "flat over that window"
   rather than a bare, puzzling zero. */
export function DeltaTick({ value, goodIsUp = true, suffix = "" }) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return null;
  const d = Number(value);
  if (d === 0) {
    return <span className="ed-caption" style={{ color: ED_INK_MUTED }}>±0{suffix}</span>;
  }
  const good = goodIsUp ? d > 0 : d < 0;
  return (
    <span className="ed-caption" style={{ color: good ? ED_FOREST : ED_RUST, fontWeight: 600 }}>
      {d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}{suffix}
    </span>
  );
}

/* One delta line — forest ▲ / rust ▼ / muted ±, then the window caption. A
   null delta (window not deep enough yet) shows an em-dash so the caption
   still names the window that is coming. */
export function DeltaTickLine({ delta, label, format = fmt, goodIsUp = true }) {
  if (delta == null) {
    return <span className="ed-caption" style={{ color: ED_INK_FAINT }}>— {label}</span>;
  }
  const d = Number(delta);
  const sign = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  const color =
    d === 0 || goodIsUp == null
      ? ED_INK_MUTED
      : (goodIsUp ? d > 0 : d < 0)
        ? ED_FOREST
        : ED_RUST;
  return (
    <span className="ed-caption" style={{ color, fontWeight: d === 0 ? 400 : 600 }}>
      {sign} {d === 0 ? "0" : format(Math.abs(d))}
      <span style={{ color: ED_INK_FAINT, fontWeight: 400, marginLeft: 5 }}>{label}</span>
    </span>
  );
}

/* The At-a-glance delta block — day- and week-over-week stacked, the week line
   populating once the snapshot history is a week deep. */
export function DualDeltaTick({ trend, field, format, goodIsUp = true }) {
  if (!trend) return null;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <DeltaTickLine
        delta={trend.day?.deltas?.[field]}
        label={trend.day?.label || "vs yesterday"}
        format={format}
        goodIsUp={goodIsUp}
      />
      <DeltaTickLine
        delta={trend.week?.deltas?.[field]}
        label={trend.week?.label || "vs last week"}
        format={format}
        goodIsUp={goodIsUp}
      />
    </span>
  );
}

/* A masthead/At-a-glance statistic — big Fraunces figure with caption + delta.
   Loading swaps the bare dash for a pulsing ledger skeleton. */
export function Exhibit({ label, value, sub, delta, loading }) {
  const isMissing = value == null || value === "—";
  return (
    <div className="flex flex-col gap-1">
      <div className="ed-caption">{label}</div>
      <div className="ed-stat-num">
        {loading && isMissing
          ? <span className="ed-skeleton ed-skeleton-num" aria-label="loading" />
          : value}
      </div>
      {delta && <div className="-mt-0.5">{delta}</div>}
      {sub && <div className="ed-prose-italic" style={{ fontSize: 12.5, opacity: 0.85 }}>{sub}</div>}
    </div>
  );
}

/* A ruled, monospaced comparison table — the editorial data grid.
   `cols` = [{ key, label, align?, mono?, render? }]. */
export function LedgerTable({ cols, rows, loading, empty = "No data for the current snapshot." }) {
  if (loading) {
    return <div className="ed-skeleton" style={{ width: "100%", height: 160, borderRadius: 2 }} aria-label="loading" />;
  }
  if (!rows || rows.length === 0) {
    return <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>{empty}</p>;
  }
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table className="w-full ed-prose" style={{ fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
            {cols.map((c) => (
              <th
                key={c.key}
                className="ed-caption py-2"
                style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={c.mono ? "ed-num py-2" : "py-2"}
                  style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}
                >
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* An honest "awaiting data" plate — used where a query came back empty but the
   section still belongs in the narrative. */
export function EmptyPlate({ children }) {
  return (
    <div
      className="px-5 py-5 mt-2"
      style={{ border: `1px solid ${ED_RULE_FAINT}`, background: "var(--ed-paper-deep)" }}
    >
      <p className="ed-caption mb-1" style={{ color: ED_GOLD }}>◷ Awaiting data</p>
      <p className="ed-prose-italic">{children}</p>
    </div>
  );
}

export function ErrorNote({ children }) {
  return (
    <p className="ed-prose-italic mt-2" style={{ color: ED_RUST }}>{children}</p>
  );
}

/* ── AI insights hook ───────────────────────────────────────────────────────
   The insights endpoint may return an `error` field alongside its fallback
   payload (spec §7) — surface it rather than swallowing it. */
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

export function InsightColumn({ heading, mark, markColor, items }) {
  return (
    <div>
      <hr className="ed-rule mb-3" />
      <p className="ed-overline mb-3">{heading}</p>
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((it, i) => (
            <li key={i} className="ed-prose flex gap-2.5" style={{ fontSize: 14 }}>
              <span
                className="ed-num shrink-0"
                style={{ color: markColor, fontWeight: 700, lineHeight: 1.5 }}
                aria-hidden
              >
                {mark}
              </span>
              <span>{insightItemText(it)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ed-prose-italic" style={{ color: ED_INK_FAINT, fontSize: 13 }}>
          Nothing noted for this snapshot.
        </p>
      )}
    </div>
  );
}

/* ── AI insights block — editorial lists ────────────────────────────────────*/
export function AiInsights({ state }) {
  const { loading, error, insights } = state;

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {["70%", "92%", "60%"].map((w, i) => (
          <span key={i} className="ed-skeleton" style={{ width: w, height: "0.8em" }} aria-label="loading" />
        ))}
      </div>
    );
  }

  // The endpoint may return its fallback payload alongside an `error` string
  // (spec §7) — surface the error, but still render whatever verdict came back.
  return (
    <div className="flex flex-col gap-7">
      {error && (
        <p className="ed-caption" style={{ color: ED_RUST, lineHeight: 1.7 }}>
          ⚠ The AI brief fell back to a cached read — {error}
        </p>
      )}

      {insights?.verdict && (
        <p className="ed-lede ed-dropcap" style={{ maxWidth: "62ch" }}>{insights.verdict}</p>
      )}

      {!insights && !error && (
        <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No insights available yet.</p>
      )}

      <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
        <InsightColumn
          heading="Strengths"
          mark="✓"
          markColor={ED_FOREST}
          items={insights?.strengths}
        />
        <InsightColumn
          heading="Weaknesses"
          mark="✗"
          markColor={ED_RUST}
          items={insights?.weaknesses}
        />
        <InsightColumn
          heading="Recommendations"
          mark="→"
          markColor={ED_GOLD}
          items={insights?.recommendations}
        />
      </div>
    </div>
  );
}
