"use client";
// FraYoutubeDashboardEditorial
// ─────────────────────────────────────────────────────────────────────────
// The editorial-theme rendering of the FRA YouTube project dashboard — a
// single-scroll "FRA Weekly" report. No tabs: ten numbered editorial sections
// run top to bottom as a printed channel review. Matches the platform's
// editorial idiom (masthead, ruled exhibits, ed-figure chart frames) shared
// with GripConnect and Asset Search.
//
// Charts are Recharts re-skinned to print: ink marks on warm paper, with
// rust / forest / gold accents only — never the classic navy/teal palette.
//
// Micro-animations (all gated by prefers-reduced-motion):
//  - Sections "set" as they enter the viewport, via one IntersectionObserver.
//  - The §3 north-star pull-number counts up on first reveal.
//  - Recharts series use a short, restrained entrance ease.
// SQL specs + the data hook live in lib/queries/fraYoutube.js so a deferred
// classic rewrite can reuse them.

import * as React from "react";
import Link from "next/link";
import {
  ResponsiveContainer, ComposedChart, AreaChart, BarChart, ScatterChart,
  Area, Bar, Line, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  Cell, ReferenceLine, LabelList,
} from "recharts";
import { fetchFraInsights } from "@/lib/api";
import { useFraYoutube, rowsOf, errOf, computeTrend } from "@/lib/queries/fraYoutube";

/* ── editorial palette (ink marks on paper, sparing accents) ─────────────────
   References the --ed-* CSS variables, so the charts follow whichever
   editorial theme is active (sepia / light). Recharts passes these straight
   through to SVG fill/stroke, where var() resolves normally — this dashboard
   always renders inside [data-design="editorial"], so the vars are in scope. */
const ED_PAPER = "var(--ed-paper)";
const ED_INK = "var(--ed-ink)";
const ED_INK_SOFT = "var(--ed-ink-soft)";
const ED_INK_MUTED = "var(--ed-ink-muted)";
const ED_INK_FAINT = "var(--ed-ink-faint)";
const ED_RUST = "var(--ed-rust)";
const ED_FOREST = "var(--ed-forest)";
const ED_GOLD = "var(--ed-gold)";
const ED_RULE_FAINT = "var(--ed-rule-faint)";

/* Restrained Recharts entrance: a short ease so figures settle rather than
   sweep. Disabled wholesale when the reader prefers reduced motion. */
const CHART_ANIM_MS = 520;

const edAxisProps = {
  stroke: ED_INK_MUTED,
  tick: { fontSize: 10, fontFamily: "var(--ed-mono)", fill: ED_INK_MUTED, letterSpacing: 0.5 },
  tickLine: false,
  axisLine: { stroke: ED_INK, strokeWidth: 1 },
};
const edGridProps = {
  stroke: ED_RULE_FAINT,
  strokeDasharray: "0",
  vertical: false,
};

/* ── number helpers ─────────────────────────────────────────────────────────*/
const nf = new Intl.NumberFormat("en-IN");
const fmt = (v) => (v == null || v === "" ? "—" : nf.format(Number(v)));
const pct1 = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`);
const compact = (v) => {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return nf.format(n);
};
const fmtDate = (s) => {
  const d = new Date(String(s ?? "").slice(0, 10));
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};
const fmtMonth = (s) => {
  // "2025-07" → "Jul ’25"
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return String(s ?? "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : `${d.toLocaleDateString("en-IN", { month: "short" })} ’${m[1].slice(2)}`;
};

/* ── reduced-motion ─────────────────────────────────────────────────────────
   The CSS already disables ed-set / ed-skeleton under prefers-reduced-motion;
   the new JS animations (scroll-reveal, count-up) must check it too. */
function usePrefersReducedMotion() {
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

/* ── section reveal ─────────────────────────────────────────────────────────
   Sections use the editorial CSS `ed-set` animation for their entrance — a
   one-shot fade-up (opacity 0→1, translateY 8px→0) that ends at opacity:1
   (animation-fill-mode: both, final keyframe is fully visible). This means:
   - The section is ALWAYS visible after the animation completes.
   - If JS is slow or disabled, the CSS animation still runs and ends visible.
   - Under `prefers-reduced-motion` the CSS already disables the animation so
     the section is visible immediately — no JS needed.
   - No IntersectionObserver is required: the content is never dependent on
     the observer firing to be seen.
   The stagger classes (ed-set-delay-1 … ed-set-delay-5) add a subtle offset
   between the first few sections so they don't all animate simultaneously. */

/* A <section> that fades in via the CSS ed-set animation. Content is always
   visible — the animation is a progressive enhancement only. */
function RevealSection({ reduced, children, id, className = "", style, stagger }) {
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
function useCountUp(target, active, reduced, durationMs = 900) {
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
function EdTooltip({ active, payload, label, labelFmt, valueFmt }) {
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

function SectionHead({ number, italic, deck, anchor }) {
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
function Figure({ figNum, title, caption, footnote, children, height = 280, error, loading }) {
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
function DeltaTick({ value, goodIsUp = true, suffix = "" }) {
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

/* Per-field formatters for editorial delta magnitudes. */
const edDeltaFmt = {
  int: (v) => fmt(v),
  dec1: (v) => Number(v).toFixed(1),
  dec2: (v) => Number(v).toFixed(2),
  secs: (v) => `${Math.round(Number(v))}s`,
};

/* One delta line — forest ▲ / rust ▼ / muted ±, then the window caption. A
   null delta (window not deep enough yet) shows an em-dash so the caption
   still names the window that is coming. */
function DeltaTickLine({ delta, label, format = fmt, goodIsUp = true }) {
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
function DualDeltaTick({ trend, field, format, goodIsUp = true }) {
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
function Exhibit({ label, value, sub, delta, loading }) {
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
function LedgerTable({ cols, rows, loading, empty = "No data for the current snapshot." }) {
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
                  {c.render ? c.render(row) : row[c.key]}
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
function EmptyPlate({ children }) {
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

function ErrorNote({ children }) {
  return (
    <p className="ed-prose-italic mt-2" style={{ color: ED_RUST }}>{children}</p>
  );
}

/* ── table-of-contents rail (optional polish, §5) ───────────────────────────*/
const TOC = [
  { id: "sec-glance", no: "II", label: "At a glance" },
  { id: "sec-discovery", no: "III", label: "Discovery" },
  { id: "sec-growth", no: "IV", label: "Growth" },
  { id: "sec-content", no: "V", label: "Content fit" },
  { id: "sec-engagement", no: "VI", label: "Engagement" },
  { id: "sec-cadence", no: "VII", label: "Cadence" },
  { id: "sec-titles", no: "VIII", label: "Titles & SEO" },
  { id: "sec-catalog", no: "IX", label: "Catalog health" },
  { id: "sec-insights", no: "X", label: "AI Insights" },
];

function TableOfContents() {
  return (
    <nav
      className="mt-8 overflow-x-auto"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      aria-label="Sections of this report"
    >
      <div
        className="flex gap-x-5"
        style={{ borderTop: `1px solid ${ED_INK}`, borderBottom: `1px solid ${ED_RULE_FAINT}`, padding: "6px 0" }}
      >
        {TOC.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="ed-section-link shrink-0 whitespace-nowrap"
            style={{ minHeight: 36, display: "inline-flex", alignItems: "center" }}
          >
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/* ── AI insights hook ───────────────────────────────────────────────────────
   The insights endpoint may return an `error` field alongside its fallback
   payload (spec §7) — surface it rather than swallowing it. */
function useFraInsights() {
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

/* ── main ───────────────────────────────────────────────────────────────────*/

export default function FraYoutubeDashboardEditorial({ project }) {
  const reduced = usePrefersReducedMotion();
  const { loading, error, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();

  /* ── row extraction ──────────────────────────────────────────────────────*/
  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;
  const distRow = rowsOf(data, "distribution")[0] || null;
  const catalogRow = rowsOf(data, "catalogHealth")[0] || null;
  const videoViewsRows = rowsOf(data, "videoViews");
  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyRows = rowsOf(data, "monthlyViews");
  const cumulativeRows = rowsOf(data, "cumulativeViews");
  const categoryRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceDayRows = rowsOf(data, "cadenceDay");
  const cadenceHourRows = rowsOf(data, "cadenceHour");
  const titleRows = rowsOf(data, "titlePatterns");

  const snapshotDate = overview?.snapshot_date ?? null;

  /* Hard empty state — no snapshot at all yet. */
  const noSnapshotYet = !loading && rowsOf(data, "overview").length === 0 && !errOf(data, "overview");

  /* Fatal — every query failed. */
  if (error && !overview && !loading) {
    return (
      <article className="ed-article">
        <header className="ed-set">
          <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
            ← BACK TO INDEX
          </Link>
          <h1 className="ed-headline mt-6 mb-3" style={{ fontSize: "clamp(34px,6vw,56px)" }}>
            We couldn’t set <em>The FRA Weekly</em>.
          </h1>
          <p className="ed-prose-italic" style={{ color: ED_RUST }}>{error}</p>
        </header>
      </article>
    );
  }

  /* ── chart-ready series ──────────────────────────────────────────────────*/
  // §4 — cumulative library views (area) + monthly views (bars), one series.
  const growthSeries = cumulativeRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: Number(r.total_views) || 0,
    cumulative: Number(r.cumulative_views) || 0,
  }));
  // The real channel-snapshots trend — one point today, grows daily. Layered
  // as a thin secondary mark; mapped onto its nearest month bucket so it sits
  // on the same x-axis as the cumulative series.
  const channelByMonth = {};
  for (const r of channelSnapshotRows) {
    const m = String(r.snapshot_date ?? "").slice(0, 7);
    if (m) channelByMonth[m] = Number(r.total_views) || 0;
  }
  const growthSeriesWithReal = growthSeries.map((d) => ({
    ...d,
    real: channelByMonth[d.month] != null ? channelByMonth[d.month] : null,
  }));
  const hasRealTrend = Object.keys(channelByMonth).length > 0;

  // §2 — day- and week-over-week trend from the overview history (computeTrend).
  const trend = computeTrend(overviewRows);

  // §3 — view-distribution histogram (log-scaled buckets). Bucketed client-side
  // from the raw per-video view counts in videoViews.
  const distBuckets = (() => {
    if (!videoViewsRows || videoViewsRows.length === 0) return [];
    const BUCKETS = [
      { label: "0–99",    min: 0,      max: 100 },
      { label: "100–499", min: 100,    max: 500 },
      { label: "500–999", min: 500,    max: 1000 },
      { label: "1K–4.9K", min: 1000,   max: 5000 },
      { label: "5K–9.9K", min: 5000,   max: 10000 },
      { label: "10K–49K", min: 10000,  max: 50000 },
      { label: "50K+",    min: 50000,  max: Infinity },
    ];
    const counts = BUCKETS.map((b) => ({ bucket: b.label, count: 0 }));
    for (const row of videoViewsRows) {
      const v = Number(row.views) || 0;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (v >= BUCKETS[i].min && v < BUCKETS[i].max) {
          counts[i].count++;
          break;
        }
      }
    }
    return counts;
  })();

  // §3 — viral-threshold ladder, a stepped exhibit.
  const ladder = distRow
    ? [
        { tier: "≥ 1K views", count: Number(distRow.videos_ge_1k) || 0 },
        { tier: "≥ 10K views", count: Number(distRow.videos_ge_10k) || 0 },
        { tier: "≥ 100K views", count: Number(distRow.videos_ge_100k) || 0 },
      ]
    : [];

  // §3 — the north-star: 1K-breakout rate, as a percentage.
  const breakoutRate =
    distRow && distRow.breakout_1k_rate != null
      ? Number(distRow.breakout_1k_rate) * 100
      : null;

  // §5 — category scatter: video count (x) × avg views (y) per category.
  const categoryScatter = categoryRows.map((r) => ({
    category: r.category,
    videos: Number(r.video_count) || 0,
    avgViews: Number(r.avg_views) || 0,
    vsMean: r.perf_vs_mean_pct != null ? Number(r.perf_vs_mean_pct) : null,
  }));

  // §6 — engagement diverging bars vs channel mean.
  const engRaw = engagementRows.map((r) => ({
    bucket: r.bucket,
    rate: Number(r.engagement_rate_pct) || 0,
  }));
  const engMean =
    engRaw.length > 0 ? engRaw.reduce((a, r) => a + r.rate, 0) / engRaw.length : 0;
  const engagementSeries = engRaw
    .map((r) => ({ ...r, diff: Math.round((r.rate - engMean) * 100) / 100 }))
    .sort((a, b) => b.diff - a.diff);

  // §7 — cadence bars by IST day + hour.
  const cadenceDaySeries = cadenceDayRows.map((r) => ({
    bucket: r.bucket,
    avgViews: Number(r.avg_views) || 0,
  }));
  const cadenceHourSeries = cadenceHourRows.map((r) => ({
    bucket: r.bucket,
    avgViews: Number(r.avg_views) || 0,
  }));

  // §8 — title-pattern horizontal bars.
  const titleSeries = titleRows
    .map((r) => ({ pattern: r.pattern, avgViews: Number(r.avg_views) || 0, videos: Number(r.video_count) || 0 }))
    .slice(0, 9);

  const animProps = reduced
    ? { isAnimationActive: false }
    : { isAnimationActive: true, animationDuration: CHART_ANIM_MS, animationEasing: "ease-out" };

  return (
    <article className="ed-article">
      {/* ════════ SECTION I — MASTHEAD ════════════════════════════════════ */}
      <header className="ed-set">
        <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
          ← BACK TO INDEX
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ed-caption mb-2">A CHANNEL REVIEW · INTERNAL EDITION</p>
            <h1 className="ed-masthead" style={{ fontSize: "clamp(56px, 11.5vw, 132px)" }}>
              The FRA<br/>Weekly.
            </h1>
          </div>
          <p className="ed-section-no" style={{ fontSize: "clamp(16px, 2.6vw, 26px)" }}>
            one channel,<br/>
            <em style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 80" }}>read closely</em>
          </p>
        </div>
        <hr className="ed-rule-double mt-5" />
        <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>VOL. I</span><span>·</span>
          <span>NO. 01</span><span>·</span>
          <span>{overview?.channel_name ? String(overview.channel_name).toUpperCase() : "FRA YOUTUBE"}</span>
          {overview?.channel_handle && (<><span>·</span><span>{overview.channel_handle}</span></>)}
          <span>·</span>
          <span>AS OF {snapshotDate ? fmtDate(snapshotDate).toUpperCase() : "—"}</span>
          {loading && (
            <>
              <span>·</span>
              <span
                className="ed-prose-italic inline-flex items-center gap-1.5"
                style={{ color: ED_INK_FAINT }}
              >
                <span className="ed-skeleton" style={{ width: "0.4em", height: "0.4em", borderRadius: "50%" }} aria-hidden />
                ON THE PRESSES
              </span>
            </>
          )}
        </p>

        {/* The AI headline verdict, set as the lede. */}
        <div className="mt-7">
          <p className="ed-overline mb-3">THE VERDICT</p>
          {insightsState.loading ? (
            <p className="ed-lede" style={{ maxWidth: "60ch" }}>
              <span className="ed-skeleton" style={{ width: "85%", height: "0.8em" }} aria-label="loading" />
            </p>
          ) : insightsState.insights?.verdict ? (
            <p className="ed-lede ed-dropcap" style={{ maxWidth: "60ch" }}>
              {insightsState.insights.verdict}
            </p>
          ) : (
            <p className="ed-lede ed-prose-italic" style={{ maxWidth: "60ch", color: ED_INK_FAINT }}>
              The editorial verdict is being written — the AI brief has not returned yet.
            </p>
          )}
          {insightsState.error && (
            <p className="ed-caption mt-2" style={{ color: ED_RUST }}>
              ⚠ Insights brief: {insightsState.error}
            </p>
          )}
        </div>

        <TableOfContents />
      </header>

      {noSnapshotYet ? (
        <RevealSection reduced={reduced} className="mt-12">
          <EmptyPlate>
            No snapshots yet — the first daily refresh has not run. The report sets
            itself once the FRA channel has been crawled.
          </EmptyPlate>
        </RevealSection>
      ) : (
        <>
          {/* ════════ SECTION II — AT A GLANCE ══════════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-glance">
            <SectionHead
              number="II"
              italic="At a glance"
              deck="The channel in seven figures — subscribers, reach, library size and pacing — with the week-on-week tick where the snapshot delta is known."
            />
            {errOf(data, "overview") ? (
              <ErrorNote>Could not load the channel snapshot: {errOf(data, "overview")}</ErrorNote>
            ) : (
              <div className="grid gap-x-8 gap-y-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                <Exhibit
                  label="Subscribers"
                  loading={loading}
                  value={overview ? fmt(overview.subscribers) : "—"}
                  delta={<DualDeltaTick trend={trend} field="subscribers" format={edDeltaFmt.int} />}
                  sub="channel followers"
                />
                <Exhibit
                  label="Total views"
                  loading={loading}
                  value={overview ? compact(overview.total_views) : "—"}
                  delta={<DualDeltaTick trend={trend} field="total_views" format={edDeltaFmt.int} />}
                  sub="lifetime, all videos"
                />
                <Exhibit
                  label="Videos"
                  loading={loading}
                  value={overview ? fmt(overview.video_count) : "—"}
                  delta={<DualDeltaTick trend={trend} field="video_count" format={edDeltaFmt.int} />}
                  sub="in the catalogue"
                />
                <Exhibit
                  label="Avg views / video"
                  loading={loading}
                  value={overview ? fmt(overview.avg_views) : "—"}
                  delta={<DualDeltaTick trend={trend} field="avg_views" format={edDeltaFmt.dec1} />}
                  sub="mean across the library"
                />
                <Exhibit
                  label="Median views / video"
                  loading={loading}
                  value={overview?.median_views != null ? fmt(overview.median_views) : "—"}
                  delta={<DualDeltaTick trend={trend} field="median_views" format={edDeltaFmt.dec1} />}
                  sub="the typical video"
                />
                <Exhibit
                  label="Avg duration"
                  loading={loading}
                  value={(() => {
                    const sec = overview?.avg_duration_sec != null ? Number(overview.avg_duration_sec) : null;
                    if (sec == null || Number.isNaN(sec)) return "—";
                    const m = Math.floor(sec / 60);
                    const s = Math.round(sec % 60);
                    return `${m}m ${s}s`;
                  })()}
                  delta={
                    <DualDeltaTick
                      trend={trend}
                      field="avg_duration_sec"
                      format={edDeltaFmt.secs}
                      goodIsUp={null}
                    />
                  }
                  sub="per video"
                />
                <Exhibit
                  label="Subscriber efficiency"
                  loading={loading}
                  value={
                    catalogRow?.subscriber_efficiency != null
                      ? Number(catalogRow.subscriber_efficiency).toFixed(2)
                      : "—"
                  }
                  delta={<DualDeltaTick trend={trend} field="subscriber_efficiency" format={edDeltaFmt.dec2} />}
                  sub="total views ÷ subscribers"
                />
              </div>
            )}
          </RevealSection>

          {/* ════════ SECTION III — DISCOVERY ═══════════════════════════════ */}
          <DiscoverySection
            reduced={reduced}
            loading={loading}
            distRow={distRow}
            error={errOf(data, "distribution")}
            videoViewsError={errOf(data, "videoViews")}
            breakoutRate={breakoutRate}
            ladder={ladder}
            distBuckets={distBuckets}
            animProps={animProps}
          />

          {/* ════════ SECTION IV — GROWTH ═══════════════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-growth">
            <SectionHead
              number="IV"
              italic="Growth"
              deck="How the library has accumulated views over its lifetime, and how each calendar month has contributed."
            />
            <Figure
              figNum="4.1"
              title="Cumulative library views"
              caption="A running sum of monthly views — the shape of the channel's accumulated reach since its first uploads."
              loading={loading}
              error={errOf(data, "cumulativeViews")}
              height={300}
              footnote={
                "Honest caveat — this is the cumulative lifetime views of videos PUBLISHED THROUGH each " +
                "month, a library-accumulation proxy. It is not the channel's true total view count on that " +
                "date: older videos keep accruing views long after their publish month. The real channel-" +
                "snapshots trend (the thin gold line) holds one point today and grows by one with each " +
                "daily refresh from here."
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={growthSeriesWithReal} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="fraGrowthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ED_INK} stopOpacity={0.20} />
                      <stop offset="100%" stopColor={ED_INK} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...edGridProps} />
                  <XAxis dataKey="month" {...edAxisProps} tickFormatter={fmtMonth} />
                  <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
                  <Tooltip
                    cursor={{ stroke: ED_RULE_FAINT }}
                    content={<EdTooltip labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative views"
                    stroke={ED_INK}
                    strokeWidth={2}
                    fill="url(#fraGrowthFill)"
                    {...animProps}
                  />
                  {hasRealTrend && (
                    <Line
                      type="monotone"
                      dataKey="real"
                      name="Channel snapshot (real)"
                      stroke={ED_GOLD}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={{ r: 3, fill: ED_GOLD, stroke: ED_PAPER, strokeWidth: 1 }}
                      connectNulls
                      {...animProps}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </Figure>

            <Figure
              figNum="4.2"
              title="Views by calendar month"
              caption="Total views attributed to videos published in each month — which months the channel's reach was built in."
              loading={loading}
              error={errOf(data, "monthlyViews")}
              height={260}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={growthSeries} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
                  <CartesianGrid {...edGridProps} />
                  <XAxis dataKey="month" {...edAxisProps} tickFormatter={fmtMonth} />
                  <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
                  <Tooltip
                    cursor={{ fill: "rgba(27,24,24,0.05)" }}
                    content={<EdTooltip labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
                  />
                  <Bar dataKey="monthly" name="Monthly views" fill={ED_INK} maxBarSize={38} {...animProps} />
                </BarChart>
              </ResponsiveContainer>
            </Figure>
          </RevealSection>

          {/* ════════ SECTION V — CONTENT FIT ═══════════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-content">
            <SectionHead
              number="V"
              italic="Content fit"
              deck="Every content category placed by how much the channel produces against how well it performs — the most-produced is rarely the best-performing."
            />
            <Figure
              figNum="5.1"
              title="Production vs performance, by category"
              caption="Each mark is a category: horizontal is how many videos it holds, vertical is its average views. Marks high and to the right earn their volume; high and to the left are under-produced winners; low and to the right are over-produced."
              loading={loading}
              error={errOf(data, "categoryMix")}
              height={320}
            >
              {categoryScatter.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No category mix for this snapshot.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 12, right: 20, bottom: 18, left: 6 }}>
                    <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" />
                    <XAxis
                      type="number"
                      dataKey="videos"
                      name="Videos"
                      {...edAxisProps}
                      label={{
                        value: "VIDEO COUNT →",
                        position: "insideBottom",
                        offset: -10,
                        style: { fontFamily: "var(--ed-mono)", fontSize: 9, letterSpacing: "0.12em", fill: ED_INK_MUTED },
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="avgViews"
                      name="Avg views"
                      {...edAxisProps}
                      width={52}
                      tickFormatter={compact}
                      /* headroom so the top category's "position=top" label
                         clears the plot frame instead of being clipped */
                      domain={[0, (max) => Math.ceil((max * 1.18) / 100) * 100]}
                    />
                    <ZAxis type="number" dataKey="videos" range={[60, 360]} />
                    <Tooltip
                      cursor={{ stroke: ED_RULE_FAINT, strokeDasharray: "3 3" }}
                      content={
                        <EdTooltip
                          valueFmt={(v, p) => (p.dataKey === "avgViews" ? fmt(v) : fmt(v))}
                        />
                      }
                    />
                    <Scatter data={categoryScatter} name="Category" fill={ED_INK} {...animProps}>
                      {categoryScatter.map((d, i) => (
                        <Cell
                          key={i}
                          fill={
                            d.vsMean == null
                              ? ED_INK
                              : d.vsMean > 0
                                ? ED_FOREST
                                : ED_RUST
                          }
                          fillOpacity={0.78}
                          stroke={ED_INK}
                          strokeWidth={0.75}
                        />
                      ))}
                      <LabelList
                        dataKey="category"
                        position="top"
                        style={{
                          fontFamily: "var(--ed-mono)",
                          fontSize: 9,
                          fill: ED_INK_MUTED,
                          letterSpacing: "0.04em",
                        }}
                      />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </Figure>

            <div className="mt-7">
              <p className="ed-overline mb-3">THE LEDGER · CATEGORY MIX</p>
              <LedgerTable
                loading={loading}
                empty="No category mix for the current snapshot."
                cols={[
                  { key: "category", label: "Category" },
                  { key: "video_count", label: "Videos", align: "right", mono: true, render: (r) => fmt(r.video_count) },
                  { key: "avg_views", label: "Avg views", align: "right", mono: true, render: (r) => fmt(r.avg_views) },
                  {
                    key: "perf_vs_mean_pct", label: "vs mean", align: "right", mono: true,
                    render: (r) => (
                      <span style={{ color: Number(r.perf_vs_mean_pct) >= 0 ? ED_FOREST : ED_RUST, fontWeight: 600 }}>
                        {r.perf_vs_mean_pct != null
                          ? `${Number(r.perf_vs_mean_pct) >= 0 ? "+" : ""}${pct1(r.perf_vs_mean_pct)}`
                          : "—"}
                      </span>
                    ),
                  },
                ]}
                rows={categoryRows}
              />
            </div>
          </RevealSection>

          {/* ════════ SECTION VI — ENGAGEMENT ═══════════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-engagement">
            <SectionHead
              number="VI"
              italic="Engagement"
              deck="Engagement rate — likes plus comments over views — read against the channel mean. Bars to the right beat the average; bars to the left drag it down."
            />
            <Figure
              figNum="6.1"
              title="Engagement rate vs channel mean, by category"
              caption={`The dividing line is the channel mean, ${engMean ? engMean.toFixed(2) : "—"}%. Each bar is a category's distance from it.`}
              loading={loading}
              error={errOf(data, "engagement")}
              height={Math.max(220, engagementSeries.length * 44 + 40)}
            >
              {engagementSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No engagement data for this snapshot.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={engagementSeries}
                    margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" horizontal={false} />
                    <XAxis type="number" {...edAxisProps} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
                    <YAxis type="category" dataKey="bucket" {...edAxisProps} width={104} />
                    <Tooltip
                      cursor={{ fill: "rgba(27,24,24,0.05)" }}
                      content={
                        <EdTooltip
                          valueFmt={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(2)} pt`}
                        />
                      }
                    />
                    <ReferenceLine x={0} stroke={ED_INK} strokeWidth={1.5} />
                    <Bar dataKey="diff" name="vs mean" maxBarSize={26} {...animProps}>
                      {engagementSeries.map((d, i) => (
                        <Cell key={i} fill={d.diff >= 0 ? ED_FOREST : ED_RUST} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Figure>
          </RevealSection>

          {/* ════════ SECTION VII — CADENCE ═════════════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-cadence">
            <SectionHead
              number="VII"
              italic="Cadence"
              deck="When the channel posts, in India Standard Time, and how those choices have performed on average."
            />
            <Figure
              figNum="7.1"
              title="Average views by posting day"
              caption="Mean views for videos published on each weekday (IST)."
              loading={loading}
              error={errOf(data, "cadenceDay")}
              height={250}
            >
              {cadenceDaySeries.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No posting-day data for this snapshot.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cadenceDaySeries} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
                    <CartesianGrid {...edGridProps} />
                    <XAxis dataKey="bucket" {...edAxisProps} />
                    <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
                    <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => fmt(v)} />} />
                    <Bar dataKey="avgViews" name="Avg views" fill={ED_INK} maxBarSize={48} {...animProps} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Figure>

            <Figure
              figNum="7.2"
              title="Average views by posting hour"
              caption="Mean views by hour of day (IST) — the windows the channel has reached for, and what they returned."
              loading={loading}
              error={errOf(data, "cadenceHour")}
              height={250}
            >
              {cadenceHourSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No posting-hour data for this snapshot.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cadenceHourSeries} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
                    <CartesianGrid {...edGridProps} />
                    <XAxis dataKey="bucket" {...edAxisProps} interval="preserveStartEnd" />
                    <YAxis {...edAxisProps} width={52} tickFormatter={compact} />
                    <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => fmt(v)} />} />
                    <Bar dataKey="avgViews" name="Avg views" fill={ED_GOLD} maxBarSize={26} {...animProps} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Figure>
          </RevealSection>

          {/* ════════ SECTION VIII — TITLES & SEO ═══════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-titles">
            <SectionHead
              number="VIII"
              italic="Titles & SEO"
              deck="Recurring structural patterns in the channel's video titles, ranked by the average views the videos carrying them earned."
            />
            <Figure
              figNum="8.1"
              title="Average views by title pattern"
              caption="Each bar is a title pattern; its length is the mean views of videos written that way."
              loading={loading}
              error={errOf(data, "titlePatterns")}
              height={Math.max(220, titleSeries.length * 40 + 40)}
            >
              {titleSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No title-pattern data for this snapshot.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={titleSeries}
                    margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" horizontal={false} />
                    <XAxis type="number" {...edAxisProps} tickFormatter={compact} />
                    <YAxis type="category" dataKey="pattern" {...edAxisProps} width={130} />
                    <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => fmt(v)} />} />
                    <Bar dataKey="avgViews" name="Avg views" fill={ED_INK} maxBarSize={22} {...animProps}>
                      <LabelList
                        dataKey="avgViews"
                        position="right"
                        formatter={compact}
                        style={{ fontFamily: "var(--ed-mono)", fontSize: 9, fill: ED_INK_MUTED }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Figure>
          </RevealSection>

          {/* ════════ SECTION IX — CATALOG HEALTH ═══════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-catalog">
            <SectionHead
              number="IX"
              italic="Catalog health"
              deck="Whether the channel's recent work is keeping pace with its back catalogue — the last thirty days against the lifetime average."
            />
            {errOf(data, "catalogHealth") ? (
              <ErrorNote>Could not load catalog health: {errOf(data, "catalogHealth")}</ErrorNote>
            ) : !loading && !catalogRow ? (
              <EmptyPlate>No catalog-health row for the current snapshot.</EmptyPlate>
            ) : (
              <div className="grid gap-x-8 gap-y-8 grid-cols-2 lg:grid-cols-4">
                <Exhibit
                  label="Recent avg views"
                  loading={loading}
                  value={catalogRow ? fmt(catalogRow.recent_avg_views) : "—"}
                  sub="videos from the last 30 days"
                />
                <Exhibit
                  label="All-time avg views"
                  loading={loading}
                  value={catalogRow ? fmt(catalogRow.alltime_avg_views) : "—"}
                  sub="the lifetime mean"
                />
                <Exhibit
                  label="Freshness delta"
                  loading={loading}
                  value={catalogRow?.freshness_delta_pct != null ? pct1(catalogRow.freshness_delta_pct) : "—"}
                  delta={
                    catalogRow?.freshness_delta_pct != null
                      ? <DeltaTick value={catalogRow.freshness_delta_pct} goodIsUp suffix="%" />
                      : null
                  }
                  sub="recent vs all-time"
                />
                <Exhibit
                  label="Subscriber efficiency"
                  loading={loading}
                  value={
                    catalogRow?.subscriber_efficiency != null
                      ? Number(catalogRow.subscriber_efficiency).toFixed(2)
                      : "—"
                  }
                  sub="total views ÷ subscribers"
                />
              </div>
            )}
          </RevealSection>

          {/* ════════ SECTION X — AI INSIGHTS ═══════════════════════════════ */}
          <RevealSection reduced={reduced} id="sec-insights">
            <SectionHead
              number="X"
              italic="AI Insights"
              deck="The automated read on this snapshot — what the channel is doing well, where it is leaking, and what to try next."
            />
            <AiInsights state={insightsState} />
          </RevealSection>
        </>
      )}

      {/* ════════ COLOPHON ═══════════════════════════════════════════════════ */}
      <footer className="mt-16">
        <hr className="ed-rule" />
        <p
          className="ed-byline mt-4 flex flex-wrap items-center gap-x-3 gap-y-1"
          style={{ fontSize: 12 }}
        >
          <span>
            Figures are drawn from the latest committed snapshot
            {snapshotDate ? ` of ${fmtDate(snapshotDate)}` : ""}. The cumulative-views
            series is a library-accumulation proxy — see Fig. 4.1.
          </span>
          <span>·</span>
          <span>© Grip Invest 2026 · Internal use only.</span>
        </p>
      </footer>
    </article>
  );
}

/* ── Section III — Discovery (own component for the count-up reveal) ─────────*/
function DiscoverySection({ reduced, loading, distRow, error, videoViewsError, breakoutRate, ladder, distBuckets, animProps }) {
  // The section is visible immediately via CSS ed-set animation.
  // Count up the breakout rate once the component has mounted.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  const counted = useCountUp(breakoutRate, mounted && !loading, reduced, 950);

  const verdict = (() => {
    if (!distRow) return null;
    const recentCount = Number(distRow.recent_video_count ?? 0);
    const rate = Number(distRow.breakout_1k_rate ?? 0);
    if (recentCount === 0) return { tone: ED_INK_MUTED, label: "no recent uploads" };
    if (rate < 0.25) return { tone: ED_RUST, label: "discovery crisis" };
    if (rate < 0.6) return { tone: ED_GOLD, label: "needs improvement" };
    return { tone: ED_FOREST, label: "healthy discovery" };
  })();

  return (
    <section
      id="sec-discovery"
      className={reduced ? "" : "ed-set ed-set-delay-2"}
    >
      <SectionHead
        number="III"
        italic="Discovery"
        deck="The north-star question: of the videos the channel ships, what share break through. A breakout is a video that clears one thousand views."
      />

      {error ? (
        <ErrorNote>Could not load discovery figures: {error}</ErrorNote>
      ) : (
        <>
          {/* The north-star pull-number. */}
          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] items-center">
            <div>
              <p className="ed-overline mb-2">THE NORTH STAR · 1K-BREAKOUT RATE</p>
              <div className="ed-pullnum" style={{ fontSize: "clamp(68px, 13vw, 132px)" }}>
                {loading || breakoutRate == null
                  ? <span className="ed-skeleton" style={{ width: "2.4em", height: "0.62em" }} aria-label="loading" />
                  : <>{counted.toFixed(1)}<span style={{ fontSize: "0.42em", letterSpacing: "-0.02em" }}>%</span></>}
              </div>
              {verdict && !loading && (
                <p className="ed-caption mt-3" style={{ color: verdict.tone, fontWeight: 600 }}>
                  ◆ {verdict.label.toUpperCase()}
                </p>
              )}
              <p className="ed-prose-italic mt-3" style={{ maxWidth: "44ch", fontSize: 14 }}>
                Share of recent videos crossing one thousand views — the channel's
                single clearest read on whether new work is being found.
              </p>
            </div>

            {/* The viral-threshold ladder — a stepped exhibit. */}
            <div className="border-t border-b" style={{ borderColor: ED_INK }}>
              <p className="ed-caption pt-3 pb-2">THE THRESHOLD LADDER</p>
              {loading ? (
                <div className="ed-skeleton" style={{ width: "100%", height: 130, borderRadius: 2, marginBottom: 12 }} aria-label="loading" />
              ) : ladder.length === 0 ? (
                <p className="ed-prose-italic pb-4" style={{ color: ED_INK_FAINT }}>No threshold data for this snapshot.</p>
              ) : (
                <div className="pb-3">
                  {ladder.map((rung, i) => {
                    const top = ladder[0].count || 1;
                    const w = Math.max(4, Math.round((rung.count / top) * 100));
                    return (
                      <div key={rung.tier} className="py-2.5" style={{ borderTop: i ? `1px solid ${ED_RULE_FAINT}` : "none" }}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="ed-caption" style={{ color: ED_INK }}>{rung.tier}</span>
                          <span className="ed-num" style={{ fontSize: 15, fontWeight: 600 }}>{fmt(rung.count)}</span>
                        </div>
                        <div style={{ height: 6, background: "rgba(27,24,24,0.07)" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${w}%`,
                              background: i === 0 ? ED_INK : i === 1 ? ED_GOLD : ED_RUST,
                              transition: reduced ? "none" : `width 720ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* The view-distribution histogram — the concentration / Gini story. */}
          <Figure
            figNum="3.1"
            title="How views concentrate across the library"
            caption="Videos bucketed by lifetime views on a log-scaled ladder. A tall left side and a thin right tail is the classic concentration story — a few videos carry the channel."
            loading={loading}
            error={videoViewsError || null}
            height={260}
            footnote={
              distRow?.gini != null
                ? `Gini coefficient ${Number(distRow.gini).toFixed(3)} — 0 is perfectly even, 1 is one video taking everything.`
                : undefined
            }
          >
            {distBuckets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No video view data for this snapshot.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distBuckets} margin={{ top: 8, right: 14, bottom: 0, left: 4 }}>
                  <CartesianGrid {...edGridProps} />
                  <XAxis dataKey="bucket" {...edAxisProps} />
                  <YAxis {...edAxisProps} width={44} tickFormatter={compact} />
                  <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => `${fmt(v)} videos`} />} />
                  <Bar dataKey="count" name="Videos" fill={ED_INK} maxBarSize={64} {...animProps} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Figure>
        </>
      )}
    </section>
  );
}

/* ── AI insights block — editorial lists ────────────────────────────────────*/
function AiInsights({ state }) {
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

// AI insight items are normally plain strings, but the LLM occasionally returns
// a structured recommendation object ({lever, metric, action}). Coerce to text
// so a stray object can never crash the render — React cannot render an object.
function insightItemText(it) {
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

function InsightColumn({ heading, mark, markColor, items }) {
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
