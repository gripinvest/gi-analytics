"use client";
// AssetSearchDashboardEditorial
// ─────────────────────────────────────────────────────────────────────────
// A parallel rendering of the same data the classic Asset Search dashboard
// shows, but laid out as a printed financial weekly. Masthead, lede, drop-
// caps, exhibits, pull-quote, numbered sections, captioned figures, footnotes.
//
// The data hook (useDashboard) is a copy of the classic dashboard's — same
// queries, same shape, same gate (convOk / pageViewsOk). The visual treatment
// is entirely separate. Charts use Recharts but re-skinned to print
// conventions (hairline axes, no grid verticals, IBM Plex Mono tick labels,
// rust/forest accents).

import * as React from "react";
import Link from "next/link";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, AreaChart,
  Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend,
  ReferenceLine,
} from "recharts";

import { runQuery } from "@/lib/api";
import { useProjectRefresh, RefreshControl } from "@/components/RefreshControl";
import * as Q from "@/lib/queries/assetSearch";
import { METRIC_DEFS, ISSUER_MAP, ISSUER_CATEGORY } from "@/lib/queries/assetSearch";
import * as C from "@/lib/queries/conversion";
import { CONV_METRIC_DEFS } from "@/lib/queries/conversion";

/* ── data loading (mirrors the classic dashboard's hook) ──────────────────── */

const QUERY_SPECS = {
  health:           (ctx) => Q.queryHealthByWeek(ctx),
  funnel:           (ctx) => Q.funnelByWeek(ctx),
  suggestions:      (ctx) => Q.suggestionsByWeek(ctx),
  clears:           (ctx) => Q.clearsByWeek(ctx),
  sessionOutcome:   (ctx) => Q.sessionOutcomeByWeek(ctx),
  tabs:             (ctx) => Q.byTab(ctx),
  sessions:         (ctx) => Q.totalQuerySessions(ctx),
  terms:            (ctx) => Q.topSearchTerms(ctx),
  assets:           (ctx) => Q.topClickedAssets(ctx),
  positions:        (ctx) => Q.clicksByPosition(ctx),
  zeroQueries:      (ctx) => Q.topZeroResultQueries(ctx),
  issuers:          (ctx) => Q.issuerHealthByWeek(ctx),
  issuerKeywords:   (ctx) => Q.keywordsByIssuer(ctx),
  issuerOutcome:    (ctx) => Q.sessionOutcomeByIssuerWeek(ctx),
};
const CONV_SPECS = {
  conv_headline:  (conv) => C.conversionHeadline(conv),
  conv_assetRate: (conv) => C.searchToInvestRate(conv),
  conv_queries:   (conv) => C.topConvertingQueries(conv),
  conv_byWeek:    (conv) => C.conversionByWeek(conv),
  conv_byCat:     (conv) => C.investByCategory(conv),
};
const COHORT_SPECS = {
  conv_cohort: (conv) => C.cohortCvr(conv),
  conv_daily:  (conv) => C.cohortDaily(conv),
};
const COHORT_W_SPECS = {
  conv_cohortW:        (conv) => C.weeklyCohortCvr(conv),
  conv_adoption:       (conv) => C.weeklyAdoption(conv),
  conv_cohortW_byWeek: (conv) => C.weeklyCohortCvrByWeek(conv),
};

function useDashboard(project, nonce) {
  const grouped = React.useMemo(() => Q.groupTables(project.tables || []), [project.tables]);
  const conv = React.useMemo(() => C.conversionTables(project.tables || []), [project.tables]);
  const [state, setState] = React.useState({ loading: true, fatal: null, data: {} });

  React.useEffect(() => {
    if (!grouped.ok) {
      setState({ loading: false, fatal: "This project's tables don't match the Asset Search layout.", data: {} });
      return;
    }
    let cancelled = false;
    setState({ loading: true, fatal: null, data: {} });
    const ctx = { tables: grouped.tables, weeks: grouped.weeks };
    const run = async (key, sql) => {
      try {
        const res = await runQuery(project.id, sql, 1000);
        return [key, res && res.error ? { error: res.error } : { rows: (res && res.rows) || [] }];
      } catch (e) {
        return [key, { error: String((e && e.message) || e) }];
      }
    };
    (async () => {
      const jobs = [
        ...Object.entries(QUERY_SPECS).map(([key, build]) => run(key, build(ctx))),
        ...(conv.ok ? Object.entries(CONV_SPECS).map(([key, build]) => run(key, build(conv))) : []),
        ...(conv.cohortOk ? Object.entries(COHORT_SPECS).map(([key, build]) => run(key, build(conv))) : []),
        ...(conv.pageViewsOk ? Object.entries(COHORT_W_SPECS).map(([key, build]) => run(key, build(conv))) : []),
      ];
      const entries = await Promise.all(jobs);
      if (!cancelled) setState({ loading: false, fatal: null, data: Object.fromEntries(entries) });
    })();
    return () => { cancelled = true; };
    // Deps narrowed to [project.id, nonce] on purpose: `grouped`/`conv` are
    // `useMemo` results over `project.tables`, and a parent re-render that
    // hands us a new `project` *object* reference (same content) used to
    // re-fire the entire query batch unnecessarily. `nonce` covers every
    // refresh-driven content change; `project.id` covers project switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, nonce]);

  return { ...state, weeks: grouped.weeks, lastWeek: grouped.lastWeek, convOk: conv.ok };
}

/* ── small helpers ─────────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("en-IN");
const pct = (v) => (v == null ? "—" : `${v}%`);
const rowsOf = (data, k) => (data && data[k] && data[k].rows) || [];
const errOf  = (data, k) => (data && data[k] && data[k].error) || null;
const sum = (rows, col) => rows.reduce((a, r) => a + (Number(r[col]) || 0), 0);
const weightedPct = (rows, num, den) => {
  const d = sum(rows, den); if (!d) return null;
  return Math.round((1000 * sum(rows, num)) / d) / 10;
};

/* Feature-week date math, presentation layer only. The data pipeline derives
   bounds from the CSV table names (spec §6); this helper exists so the
   masthead / lede / footnotes can read off real week numbers instead of
   carrying hardcoded strings that drift the moment a new week lands. */
const LAUNCH = new Date(Date.UTC(2026, 3, 2));   // Apr 2 2026 — spec D2
const ONE_DAY_MS = 86400 * 1000;
const _MONTH_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const _MONTH_UPPER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const _NUM_WORD = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
                   "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const weekNumberOf = (label) => {                // "W7" / "W7_…" → 7
  const m = String(label || "").match(/^W(\d+)/);
  return m ? Number(m[1]) : null;
};
const featureWeekRange = (n) => {
  if (!n || n < 1) return null;
  const start = new Date(LAUNCH.getTime() + (n - 1) * 7 * ONE_DAY_MS);
  const end   = new Date(start.getTime() + 6 * ONE_DAY_MS);  // inclusive last day
  return { start, end };
};
const fmtMonthDayTitle = (d) => `${_MONTH_TITLE[d.getUTCMonth()]} ${d.getUTCDate()}`;
const fmtMonthDayUpper = (d) => `${_MONTH_UPPER[d.getUTCMonth()]} ${d.getUTCDate()}`;
// Compact week-range string: "Apr 2–8" within a month; "Apr 30–May 6" across.
const fmtWeekDates = (n) => {
  const r = featureWeekRange(n); if (!r) return "";
  return r.start.getUTCMonth() === r.end.getUTCMonth()
    ? `${fmtMonthDayTitle(r.start)}–${r.end.getUTCDate()}`
    : `${fmtMonthDayTitle(r.start)}–${fmtMonthDayTitle(r.end)}`;
};
const wordOrNum = (n) => (n >= 0 && n < _NUM_WORD.length ? _NUM_WORD[n] : String(n));

/* ── editorial chart styling ───────────────────────────────────────────────────
   Colours reference the --ed-* CSS variables rather than literal hex, so the
   charts follow whichever editorial theme is active (sepia / light). Recharts
   passes these straight through to SVG fill/stroke, where var() resolves
   normally — the editorial dashboard always renders inside [data-design=
   "editorial"], so the variables are always in scope. */

const ED_INK = "var(--ed-ink)";
const ED_RUST = "var(--ed-rust)";
const ED_FOREST = "var(--ed-forest)";
const ED_GOLD = "var(--ed-gold)";
const ED_INK_MUTED = "var(--ed-ink-muted)";
const ED_RULE_FAINT = "var(--ed-rule-faint)";

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
const edLegendProps = {
  verticalAlign: "top",
  align: "left",
  height: 26,
  iconType: "rect",
  iconSize: 10,
  wrapperStyle: {
    paddingBottom: 4,
    fontFamily: "var(--ed-mono)",
    fontSize: 10,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color: ED_INK_MUTED,
  },
};

function EdTooltip({ active, payload, label, valueFmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: "var(--ed-paper)",
      border: `1px solid ${ED_INK}`,
      padding: "8px 12px",
      fontFamily: "var(--ed-mono)",
      fontSize: 11,
      color: ED_INK,
      boxShadow: "2px 2px 0 rgba(27,24,24,0.10)",
    }}>
      <div style={{ textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4, fontWeight: 500 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, background: p.color || p.fill }} />
          <span style={{ color: ED_INK_MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>{p.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 500 }}>{valueFmt ? valueFmt(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── primitives ────────────────────────────────────────────────────────────── */

function Figure({ figNum, title, caption, children, height = 260, error, loading, ledeAfter }) {
  return (
    <figure className="ed-figure mt-10">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span className="ed-caption">FIG. {figNum}</span>
        <span className="ed-section-no" style={{ fontStyle: "italic" }}>—</span>
        <h3 className="ed-prose" style={{ fontVariationSettings: "'opsz' 24", fontSize: 16, fontWeight: 500, color: "var(--ed-ink)" }}>
          {title}
        </h3>
      </figcaption>
      {caption && <p className="ed-prose-italic mb-4" style={{ maxWidth: "60ch" }}>{caption}</p>}
      <div style={{ height, width: "100%" }}>
        {loading ? (
          <div className="h-full w-full flex items-center justify-center">
            <span className="ed-caption animate-pulse">SETTING TYPE…</span>
          </div>
        ) : error ? (
          <div className="h-full w-full flex items-center justify-center">
            <span className="ed-prose-italic" style={{ color: "var(--ed-rust)" }}>Could not render this figure: {error}</span>
          </div>
        ) : (
          children
        )}
      </div>
      {ledeAfter && <p className="ed-prose-italic mt-3" style={{ maxWidth: "62ch" }}>{ledeAfter}</p>}
    </figure>
  );
}

function Exhibit({ letter, label, value, sub, delta, deltaGoodIsDown = true, loading = false }) {
  // Delta sits on its own line below the value (not next to the label) so a
  // wider chip — e.g. "▼ 6.5pt" — never wraps in the label row and pushes the
  // value out of baseline alignment with sibling exhibits at narrow widths.
  // The chip still reads as a comment on the number it sits directly below.
  //
  // `loading` swaps the bare placeholder ("—") for a soft pulsing skeleton —
  // a static dash on a still page reads as "broken/empty" even when the
  // dashboard is genuinely computing. Once the data lands the skeleton
  // crossfades out via React's normal re-render.
  const isMissing = value == null || value === "—";
  return (
    <div className="flex flex-col gap-1 ed-set">
      <div className="ed-caption">EXHIBIT {letter}</div>
      <div className="ed-stat-num">
        {loading && isMissing
          ? <span className="ed-skeleton ed-skeleton-num" aria-label="loading" />
          : value}
      </div>
      {delta && (
        <div className="-mt-0.5">
          <DeltaInline {...delta} goodIsDown={deltaGoodIsDown} />
        </div>
      )}
      <div className="ed-prose-italic" style={{ fontSize: 13 }}>{label}</div>
      {sub && <div className="ed-caption" style={{ opacity: 0.75 }}>{sub}</div>}
    </div>
  );
}

function DeltaInline({ from, to, suffix = "", goodIsDown = true }) {
  if (from == null || to == null) return null;
  const diff = Math.round((to - from) * 10) / 10;
  if (diff === 0) {
    return <span className="ed-caption" style={{ color: ED_INK_MUTED }}>±0{suffix}</span>;
  }
  const good = goodIsDown ? diff < 0 : diff > 0;
  return (
    <span className="ed-caption" style={{ color: good ? ED_FOREST : ED_RUST, fontWeight: 600 }}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)}{suffix}
    </span>
  );
}

function SectionHead({ number, italic, deck, anchor }) {
  return (
    <header id={anchor} className="mt-16 mb-8">
      <hr className="ed-rule-thick mb-6" />
      <div className="flex items-baseline gap-4 mb-1">
        <span className="ed-section-no">SECTION {number}</span>
      </div>
      <h2 className="ed-headline" style={{ fontSize: "clamp(34px, 5vw, 56px)" }}>
        <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
          {italic}
        </em>
      </h2>
      {deck && <p className="ed-prose-italic mt-3" style={{ maxWidth: "60ch", fontSize: 15 }}>{deck}</p>}
    </header>
  );
}

function Footnote({ n, children, term }) {
  return (
    <li id={`fn-${n}`} className="ed-prose" style={{ fontSize: 13, color: ED_INK_MUTED, marginBottom: 8 }}>
      <span className="ed-caption" style={{ marginRight: 8, color: ED_INK }}>{String(n).padStart(2, "0")}</span>
      {term && (
        <span className="ed-prose" style={{ fontWeight: 500, color: ED_INK, marginRight: 6 }}>
          {term}.
        </span>
      )}
      {children}
    </li>
  );
}

function Term({ n, children }) {
  // Inline reference to a footnote — small superscript number after a term.
  return (
    <>{children}<a href={`#fn-${n}`} className="ed-footnote-ref">{String(n).padStart(2, "0")}</a></>
  );
}

/* ── main ──────────────────────────────────────────────────────────────────── */

export default function AssetSearchDashboardEditorial({ project }) {
  const refreshState = useProjectRefresh(project);
  const { loading, fatal, data, weeks, lastWeek, convOk } = useDashboard(project, refreshState.nonce);

  // ── masthead derivations — keep the editorial copy honest against live data
  // The masthead used to carry hardcoded dates ("APR 2 – MAY 13, 2026"),
  // hardcoded counts ("Six weeks in"), and a hardcoded glossary line that
  // listed W1–W6 by name. Each of those drifted the moment a new week landed
  // and the dashboard reported one set of facts in the prose alongside a
  // different set in the charts. Derive them from the live week list.
  const firstWeekN = weekNumberOf(weeks[0]) || 1;
  const lastWeekN  = weekNumberOf(lastWeek) || firstWeekN;
  const firstRange = featureWeekRange(firstWeekN);
  const lastRange  = featureWeekRange(lastWeekN);
  const nWeeks     = weeks.length;
  const issueNo    = String(Math.max(nWeeks, 1)).padStart(2, "0");
  const reportingPeriod = firstRange && lastRange
    ? `${fmtMonthDayUpper(firstRange.start)} – ${fmtMonthDayUpper(lastRange.end)}, ${lastRange.end.getUTCFullYear()}`
    : "";
  const weekGlossary = weeks
    .map((w) => `${w} ${fmtWeekDates(weekNumberOf(w))}`)
    .join(" · ");
  const nWeeksWord = wordOrNum(nWeeks);                       // "Six" / "Seven" / …

  // ── headline numbers ─────────────────────────────────────────────────────
  const health = rowsOf(data, "health");
  const funnel = rowsOf(data, "funnel");
  const sessionOutcome = rowsOf(data, "sessionOutcome");
  const suggestions = rowsOf(data, "suggestions");
  const clears = rowsOf(data, "clears");
  const tabs = rowsOf(data, "tabs");
  const terms = rowsOf(data, "terms");
  const assets = rowsOf(data, "assets");
  const positions = rowsOf(data, "positions");
  const zeroQueries = rowsOf(data, "zeroQueries");
  const sessions = rowsOf(data, "sessions")[0]?.sessions;
  const issuers = rowsOf(data, "issuers");

  const overallZrr = weightedPct(health, "zero_result", "queries");
  const overallRefine = weightedPct(health, "refinements", "queries");
  const totalQueries = sum(health, "queries");
  const totalClears = sum(clears, "clears");
  const totalClicks = sum(funnel, "clicked") || sum(assets, "clicks");
  const ctrLast = suggestions.length ? suggestions[suggestions.length - 1].ctr_pct : null;
  const zrrFirst = health.length ? health[0].zrr_pct : null;
  const zrrLast = health.length ? health[health.length - 1].zrr_pct : null;

  // Conversion / adoption
  const cohortW = rowsOf(data, "conv_cohortW")[0] || null;
  const cohort8 = rowsOf(data, "conv_cohort")[0] || null;
  const cohort = cohortW || cohort8;

  const adoption = rowsOf(data, "conv_adoption");
  const adoptionOverallPct = (() => {
    const v = sum(adoption, "visitors"); const s = sum(adoption, "searchers");
    return v ? Math.round((1000 * s) / v) / 10 : null;
  })();
  const adoptionFirst = adoption.length ? Number(adoption[0].adoption_pct) : null;
  const adoptionLast = adoption.length ? Number(adoption[adoption.length - 1].adoption_pct) : null;

  // Search lift (cohort)
  const lift = (() => {
    if (!cohort) return null;
    const ns = Number(cohort.n_searchers);
    const cs = Number(cohort.conv_searchers);
    const nn = Number(cohort.n_nonsearchers);
    const cn = Number(cohort.conv_nonsearchers);
    if (!ns || !nn || !cn) return null;
    const sCvr = cs / ns;
    const nCvr = cn / nn;
    return nCvr ? Math.round((sCvr / nCvr) * 10) / 10 : null;
  })();

  // ── chart-ready series ───────────────────────────────────────────────────
  const healthSeries = health.map((r) => ({
    week: r.week, queries: Number(r.queries), zrr: Number(r.zrr_pct), refinement: Number(r.refinement_pct),
  }));
  const funnelSeries = funnel.map((r) => ({
    week: r.week, Focused: Number(r.initiated), Queried: Number(r.queried), Clicked: Number(r.clicked),
  }));
  // Session-outcome funnel — the headline search-health series. Each searched
  // session classified once: Success / Relevance gap / Dead end.
  const outcomeSeries = sessionOutcome.map((r) => ({
    week: r.week,
    Success: Number(r.success),
    "Relevance gap": Number(r.relevance_gap),
    "Dead end": Number(r.dead_end),
    searched: Number(r.searched),
    successPct: Number(r.success_pct),
  }));
  const outcomeSuccessPct = weightedPct(sessionOutcome, "success", "searched");
  const adoptionSeries = adoption.map((r) => ({
    week: r.week, visitors: Number(r.visitors), searchers: Number(r.searchers), adoption: Number(r.adoption_pct),
  }));
  const suggSeries = suggestions.map((r) => ({ week: r.week, clicks: Number(r.suggestion_clicks), ctr: Number(r.ctr_pct) }));
  const posSeries = positions.map((r) => ({ rank: `#${r.rank}`, clicks: Number(r.clicks) }));
  const refineSeries = healthSeries;

  // ── section state ────────────────────────────────────────────────────────
  const sections = [
    { key: "overview",     no: "I",   italic: "The Overview" },
    ...(convOk ? [{ key: "conversion", no: "II",  italic: "The Conversion" }] : []),
    { key: "issuers",      no: convOk ? "III" : "II",  italic: "The Issuers" },
    { key: "terms",        no: convOk ? "IV"  : "III", italic: "The Terms" },
    { key: "instrumentation", no: convOk ? "V" : "IV", italic: "The Instrumentation" },
  ];
  const [section, setSection] = React.useState("overview");

  if (fatal) {
    return (
      <section className="mt-12">
        <h2 className="ed-headline mb-3">{fatal}</h2>
        <p className="ed-prose-italic">The editor cannot set this issue. Check the project tables.</p>
      </section>
    );
  }

  return (
    <article className="ed-article">
      {/* ── MASTHEAD ────────────────────────────────────────────────────── */}
      <header className="ed-set">
        <Link href="/" className="ed-caption hover:underline" style={{ color: ED_INK_MUTED }}>
          ← BACK TO INDEX
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ed-caption mb-2">A FINANCIAL WEEKLY · INTERNAL EDITION</p>
            <h1 className="ed-masthead" style={{ fontSize: "clamp(64px, 12vw, 140px)" }}>
              Grip<br/>Weekly.
            </h1>
          </div>
          <p className="ed-section-no" style={{ fontSize: "clamp(18px, 3vw, 28px)" }}>
            on <em style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 80" }}>Asset Search</em>
          </p>
        </div>
        <hr className="ed-rule-double mt-5" />
        <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>VOL. I</span><span>·</span>
          <span>NO. {issueNo}</span><span>·</span>
          <span>REPORTING PERIOD · {reportingPeriod}</span><span>·</span>
          <span>{weeks[0]}–{lastWeek}</span><span>·</span>
          <span>{nf.format(totalQueries)} QUERIES INDEXED</span>
          {/* Global page-loading hint. Sits in the masthead so the user always
              has a single place to glance at — instead of inferring "still
              loading" from individual missing figures further down the page.
              Hides as soon as the dashboard fetches complete. */}
          {loading && (
            <>
              <span>·</span>
              <span className="ed-prose-italic inline-flex items-center gap-1.5" style={{ color: "var(--ed-ink-faint)" }}>
                <span className="ed-skeleton" style={{ width: "0.4em", height: "0.4em", borderRadius: "50%" }} aria-hidden />
                ON THE PRESSES
              </span>
            </>
          )}
        </p>
        {/* live-data refresh — present only when project.refreshable is true */}
        <RefreshControl project={project} state={refreshState} variant="editorial" />

        {/* Week glossary — feature weeks are counted from the Apr 2 2026 launch,
            NOT ISO calendar weeks. The list below is derived from the live
            week set so it stays honest as new weeks land. */}
        <p className="ed-caption mt-4" style={{ lineHeight: 1.8 }}>
          FEATURE WEEKS — COUNTED FROM THE APR 2, 2026 LAUNCH
        </p>
        <p className="ed-prose-italic mt-1" style={{ fontSize: "12px", color: "var(--ed-ink-faint)", lineHeight: 1.7 }}>
          {weekGlossary}
        </p>
      </header>

      {/* ── LEDE / EDITOR'S NOTE ──────────────────────────────────────────── */}
      <section className="mt-12 grid gap-10 md:grid-cols-[1.5fr_1fr] ed-set ed-set-delay-1">
        <div>
          <p className="ed-overline mb-4">FROM THE EDITOR</p>
          <h2 className="ed-headline mb-5" style={{ fontSize: "clamp(32px, 5vw, 52px)" }}>
            {nWeeksWord} weeks in, search converts.<br/>
            <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
              The trouble is who isn't searching.
            </em>
          </h2>
          <p className="ed-lede ed-dropcap" style={{ maxWidth: "56ch" }}>
            {nWeeksWord} weeks after launch, search behaves as we hoped — visitors who use it convert at
            roughly <Term n={1}>twice</Term> the rate of those who don't. The unhappy footnote
            is that the share of visitors who reach for it has slipped, week on week, from
            {" "}{pct(adoptionFirst)} in launch week to {pct(adoptionLast)} this week. The lift is real;
            the audience for the lift is shrinking.
          </p>
          <p className="ed-byline mt-5">— The Editor</p>
        </div>

        {/* Pull-quote on the right: the headline lift number, set huge. */}
        {lift && (
          <aside className="border-t border-b border-[var(--ed-ink)] py-6 self-center">
            <p className="ed-caption mb-3">THE PULL QUOTE</p>
            <div className="ed-pullnum" style={{ fontSize: "clamp(72px, 10vw, 120px)" }}>
              {lift}×
            </div>
            <p className="ed-prose-italic mt-3" style={{ fontSize: 14 }}>
              searcher CVR ÷ non-searcher CVR, over <Term n={2}>{weeks[0]}–{lastWeek}</Term>.
              Above 1.5× target.
            </p>
          </aside>
        )}
      </section>

      <hr className="ed-rule-thick mt-14" />

      {/* ── EXHIBITS ROW ──────────────────────────────────────────────────── */}
      {/* pb-2 + mt-20 below give the figures bottom breathing room — the
          earlier ed-rule-thick at mt-12 pressed right under the last row. */}
      <section className="mt-8 pb-2 ed-set ed-set-delay-2">
        <p className="ed-overline mb-6">BY THE NUMBERS</p>
        <div className="grid gap-x-8 gap-y-7 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {/* Exhibit A is a raw count, not a rate, so the `sub` carries the
              definition rather than a denominator. A "search session" is the
              distinct (context_session_id) — Rudderstack's browser-session
              identifier — in which the user issued ≥1 query. Spelling that out
              inline saves readers from guessing whether the figure counts
              users, page-views, or queries. */}
          <Exhibit letter="A" label="search sessions" loading={loading}
            value={sessions != null ? nf.format(sessions) : "—"}
            sub={`distinct browser sessions with ≥1 query · ${weeks.length} weeks`} />
          {adoptionOverallPct != null && (
            <Exhibit letter="B" label={<Term n={3}>adoption rate</Term>} value={pct(adoptionOverallPct)}
              sub={`${nf.format(sum(adoption, "searchers"))} of ${nf.format(sum(adoption, "visitors"))}`}
              delta={{ from: adoptionFirst, to: adoptionLast, suffix: "pt" }}
              deltaGoodIsDown={false} loading={loading} />
          )}
          <Exhibit letter={adoptionOverallPct != null ? "C" : "B"} label={<Term n={4}>zero-result rate</Term>}
            value={pct(overallZrr)} sub={`${nf.format(totalQueries)} queries`} loading={loading}
            delta={{ from: zrrFirst, to: zrrLast, suffix: "pt" }} />
          <Exhibit letter={adoptionOverallPct != null ? "D" : "C"} label="refinement rate"
            value={pct(overallRefine)} sub="iterating mid-search" loading={loading} />
          <Exhibit letter={adoptionOverallPct != null ? "E" : "D"} label="result clicks"
            value={totalClicks ? nf.format(totalClicks) : "—"} sub="from search results" loading={loading} />
          <Exhibit letter={adoptionOverallPct != null ? "F" : "E"} label="suggestion CTR"
            value={pct(ctrLast)} sub={`${lastWeek} focus-time picks`} loading={loading} />
        </div>
      </section>

      {/* No rule here. The previous design framed the nav between two
          horizontal lines (rule above + rule below from SectionHead), which
          read as visual clutter. Whitespace alone (pb-2 on the exhibits
          section above + mt-16 on the nav below) does the section break
          while the SectionHead rule one row down remains the editorial
          delimiter for each section. */}

      {/* ── SECTIONS NAV ──────────────────────────────────────────────────── */}
      <nav
        role="tablist"
        aria-label="Sections of this issue"
        className="mt-16 flex flex-wrap items-baseline gap-x-7 gap-y-3 ed-set ed-set-delay-3"
      >
        {sections.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={section === s.key}
            onClick={() => setSection(s.key)}
            className="ed-section-link inline-flex items-baseline gap-2"
          >
            <span className="ed-caption" style={{ color: "inherit" }}>{s.no}.</span>
            <span>{s.italic}</span>
          </button>
        ))}
      </nav>

      {/* ── SECTION CONTENT ───────────────────────────────────────────────── */}
      {section === "overview" && (
        <OverviewSection
          loading={loading}
          data={data}
          adoptionSeries={adoptionSeries}
          healthSeries={healthSeries}
          funnelSeries={funnelSeries}
          outcomeSeries={outcomeSeries}
          outcomeSuccessPct={outcomeSuccessPct}
          refineSeries={refineSeries}
          suggSeries={suggSeries}
          tabs={tabs}
          weeks={weeks} lastWeek={lastWeek}
          zrrFirst={zrrFirst} zrrLast={zrrLast}
          adoptionFirst={adoptionFirst} adoptionLast={adoptionLast}
        />
      )}
      {section === "conversion" && convOk && (
        <ConversionSection data={data} loading={loading} weeks={weeks} lastWeek={lastWeek} lift={lift} cohort={cohort} />
      )}
      {section === "issuers" && (
        <IssuersSection
          rows={issuers}
          outcomeRows={rowsOf(data, "issuerOutcome")}
          keywordRows={rowsOf(data, "issuerKeywords")}
          weeks={weeks}
          lastWeek={lastWeek}
          loading={loading}
          error={errOf(data, "issuers")}
        />
      )}
      {section === "terms" && (
        <TermsSection terms={terms} assets={assets} positions={posSeries} zeroQueries={zeroQueries} loading={loading} data={data} />
      )}
      {section === "instrumentation" && (
        <InstrumentationSection clears={clears} totalClears={totalClears} weeks={weeks} lastWeek={lastWeek} loading={loading} data={data} />
      )}

      {/* ── FOOTNOTES ─────────────────────────────────────────────────────── */}
      <FootnotesBlock />

      {/* ── COLOPHON ──────────────────────────────────────────────────────── */}
      <footer className="mt-16">
        <hr className="ed-rule" />
        <p className="ed-byline mt-4 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 12 }}>
          <span>Set in <strong style={{ fontStyle: "normal", fontWeight: 500 }}>Fraunces</strong>,
            <strong style={{ fontStyle: "normal", fontWeight: 500 }}> Newsreader</strong>,
            and <strong style={{ fontStyle: "normal", fontWeight: 500 }}> IBM Plex Mono</strong>.</span>
          <span>·</span>
          <span>Data sourced from DuckDB over weekly product event exports.</span>
          <span>·</span>
          <span>© Grip Invest 2026 · Internal use only.</span>
        </p>
      </footer>
    </article>
  );
}

/* ── SECTION I — OVERVIEW ─────────────────────────────────────────────────── */

function OverviewSection({ loading, data, adoptionSeries, healthSeries, funnelSeries, outcomeSeries, outcomeSuccessPct, refineSeries, suggSeries, tabs, weeks, lastWeek, zrrFirst, zrrLast, adoptionFirst, adoptionLast }) {
  const showAdoption = adoptionSeries.length > 0;
  return (
    <section className="ed-set">
      <SectionHead
        number="I"
        italic="The Overview"
        deck={`Six feature weeks of asset-search data, ${weeks[0]}–${lastWeek}. The adoption trend is the lead story; everything below it qualifies or extends it.`}
      />

      {showAdoption && (
        <Figure
          figNum="1"
          title="Search adoption, by week"
          caption="Bars = visitors to the assets page. Line = the share who focused the search box at least once."
          loading={loading} error={errOf(data, "conv_adoption")}
          height={290}
          ledeAfter={`Adoption: ${pct(adoptionFirst)} (${weeks[0]}) → ${pct(adoptionLast)} (${lastWeek}). A 1pt move ≈ 160 more searchers per week.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={adoptionSeries} margin={{ top: 30, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="week" {...edAxisProps} />
              <YAxis yAxisId="v" {...edAxisProps} width={48} />
              <YAxis yAxisId="a" orientation="right" {...edAxisProps} width={40} unit="%" domain={[0, "dataMax + 2"]} />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v, p) => (p.dataKey === "adoption" ? `${v}%` : nf.format(v))} />} />
              <Legend {...edLegendProps} />
              <Bar yAxisId="v" dataKey="visitors" name="Visitors" fill={ED_INK} opacity={0.42} maxBarSize={46} />
              <Line yAxisId="a" dataKey="adoption" name="Adoption rate" stroke={ED_RUST} strokeWidth={2.5}
                dot={{ r: 3.5, fill: ED_RUST, strokeWidth: 0 }} activeDot={{ r: 6, stroke: ED_INK, strokeWidth: 1 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Figure>
      )}

      <Figure
        figNum="2"
        title="Zero-result rate against query volume"
        caption="Bars = queries run that week. Line = the share returning zero asset matches."
        loading={loading} error={errOf(data, "health")}
        height={300}
        ledeAfter={`From ${pct(zrrFirst)} at launch to ${pct(zrrLast)} this week — a meaningful improvement, though weekly volume has plateaued.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={healthSeries} margin={{ top: 30, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid {...edGridProps} />
            <XAxis dataKey="week" {...edAxisProps} />
            <YAxis yAxisId="v" {...edAxisProps} width={48} />
            <YAxis yAxisId="z" orientation="right" {...edAxisProps} width={40} unit="%" domain={[0, "dataMax + 10"]} />
            <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v, p) => (p.dataKey === "zrr" ? `${v}%` : nf.format(v))} />} />
            <Legend {...edLegendProps} />
            <Bar yAxisId="v" dataKey="queries" name="Queries" fill={ED_INK} opacity={0.42} maxBarSize={46} />
            <Line yAxisId="z" dataKey="zrr" name="Zero-result rate" stroke={ED_RUST} strokeWidth={2.5}
              dot={{ r: 3.5, fill: ED_RUST, strokeWidth: 0 }} activeDot={{ r: 6, stroke: ED_INK, strokeWidth: 1 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Figure>

      <Figure
        figNum="3"
        title="Search outcome — every searched session, one of three ends"
        caption="Success = the session clicked a result. Relevance gap = results were shown but nothing was clicked. Dead end = every query returned zero results."
        loading={loading} error={errOf(data, "sessionOutcome")}
        height={300}
        ledeAfter={`${pct(outcomeSuccessPct)} of searches end in a result click. The rest split between a relevance gap — results shown, none compelling enough — and a dead end, where nothing matched at all. Each searched session is counted once.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={outcomeSeries} margin={{ top: 30, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid {...edGridProps} />
            <XAxis dataKey="week" {...edAxisProps} />
            <YAxis {...edAxisProps} width={48} />
            <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v) => nf.format(v)} />} />
            <Legend {...edLegendProps} />
            <Bar dataKey="Success" stackId="o" fill={ED_FOREST} maxBarSize={46} />
            <Bar dataKey="Relevance gap" stackId="o" fill={ED_GOLD} maxBarSize={46} />
            <Bar dataKey="Dead end" stackId="o" fill={ED_RUST} maxBarSize={46} />
          </BarChart>
        </ResponsiveContainer>
      </Figure>

      <div className="grid gap-10 md:grid-cols-2 mt-10">
        <Figure
          figNum="4"
          title="The funnel, distinct sessions"
          caption="Focused = opened the search box. Queried = typed and ran. Clicked = clicked a result."
          loading={loading} error={errOf(data, "funnel")}
          height={250}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelSeries} margin={{ top: 30, right: 8, bottom: 0, left: -10 }} barGap={2}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="week" {...edAxisProps} />
              <YAxis {...edAxisProps} width={48} />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v) => nf.format(v)} />} />
              <Legend {...edLegendProps} />
              <Bar dataKey="Focused" fill={ED_INK} opacity={0.42} maxBarSize={16} />
              <Bar dataKey="Queried" fill={ED_INK} opacity={0.45} maxBarSize={16} />
              <Bar dataKey="Clicked" fill={ED_GOLD} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </Figure>

        <Figure
          figNum="5"
          title="Refinement rate, by week"
          caption="Share of queries flagged as refinements — the user iterating mid-search."
          loading={loading} error={errOf(data, "health")}
          height={250}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={refineSeries} margin={{ top: 20, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="week" {...edAxisProps} />
              <YAxis {...edAxisProps} width={44} unit="%" />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v) => `${v}%`} />} />
              <Bar dataKey="refinement" name="Refinement rate" fill={ED_GOLD} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </Figure>
      </div>

      {/* Tab usage — as a print-style table, not as bars in a card. */}
      <div className="mt-12">
        <p className="ed-caption mb-2">FIG. 6</p>
        <h3 className="ed-prose mb-3" style={{ fontSize: 16, fontWeight: 500, color: ED_INK }}>
          Where searches originated. <em style={{ color: ED_INK_MUTED }}>Search is global — these are the surfaces the searcher was on.</em>
        </h3>
        <hr className="ed-rule" />
        {loading ? (
          <p className="ed-prose-italic py-6">Setting type…</p>
        ) : errOf(data, "tabs") ? (
          <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>Could not load.</p>
        ) : (
          <table className="w-full ed-prose" style={{ fontSize: 14, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
                <th className="ed-caption text-left py-2" style={{ width: "40%" }}>TAB</th>
                <th className="ed-caption text-right py-2">QUERIES</th>
                <th className="ed-caption text-right py-2">SHARE</th>
                <th className="ed-caption text-right py-2">ZRR</th>
              </tr>
            </thead>
            <tbody>
              {tabs.map((r) => {
                const total = sum(tabs, "queries");
                const share = total ? Math.round((1000 * Number(r.queries)) / total) / 10 : 0;
                return (
                  <tr key={r.tab} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                    <td className="py-2.5" style={{ fontWeight: 500, color: ED_INK }}>{r.tab}</td>
                    <td className="py-2.5 text-right ed-num">{nf.format(r.queries)}</td>
                    <td className="py-2.5 text-right ed-num" style={{ color: ED_INK_MUTED }}>{share}%</td>
                    <td className="py-2.5 text-right ed-num">{r.zrr_pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ── SECTION II — CONVERSION ──────────────────────────────────────────────── */

function ConversionSection({ data, loading, weeks, lastWeek, lift, cohort }) {
  const cohortByWeek = rowsOf(data, "conv_byWeek");
  const cvrSeries = cohortByWeek.map((r) => ({
    week: r.week,
    Searchers: Number(r.searchers),
    "Same-day CVR": r.searchers ? Math.round((1000 * Number(r.conv_searchers)) / Number(r.searchers)) / 10 : 0,
  }));
  const topQueries = rowsOf(data, "conv_queries").slice(0, 10);

  // Weekly cohort lift series — same searcher vs non-searcher math as the
  // cumulative lift block above, but emitted per feature week so the trend
  // behind the headline figure is visible (rather than only the average).
  const liftSeries = rowsOf(data, "conv_cohortW_byWeek").map((r) => ({
    week: r.week,
    lift: r.lift == null ? null : Number(r.lift),
    "Searcher CVR": r.srch_cvr_pct == null ? null : Number(r.srch_cvr_pct),
    "Non-searcher CVR": r.non_cvr_pct == null ? null : Number(r.non_cvr_pct),
  }));

  return (
    <section className="ed-set">
      <SectionHead
        number="II"
        italic="The Conversion"
        deck="Where the lift lives. Conversion is defined here as an invest_now or quick_checkout event by the same user on the same calendar day (IST) as the search."
      />

      {/* Two big numbers side by side: searcher CVR vs non-searcher CVR. */}
      {cohort && (
        <div className="grid gap-10 md:grid-cols-2 mt-10">
          <CohortCallout
            label="Searchers"
            n={Number(cohort.n_searchers)}
            c={Number(cohort.conv_searchers)}
            accent={ED_FOREST}
            note="users who focused the search box at least once"
          />
          <CohortCallout
            label="Non-searchers"
            n={Number(cohort.n_nonsearchers)}
            c={Number(cohort.conv_nonsearchers)}
            accent={ED_INK_MUTED}
            note="visited an assets page but never searched"
          />
        </div>
      )}

      {/* When `lift` is null (loading) the entire block used to disappear,
          leaving a confusing hole in the page that read as "broken". We now
          render the frame with a skeleton numeral so the page composition
          stays intact and the user sees that the figure is computing, not
          missing. Hidden entirely only once loading is done AND lift is
          still null (genuinely no cohort data — e.g. a new project without
          conversion events). */}
      {(lift || loading) && (
        <div className="mt-10 border-t border-b border-[var(--ed-ink)] py-6 grid gap-6 md:grid-cols-[auto_1fr] items-center">
          <div className="ed-pullnum" style={{ fontSize: "clamp(80px, 12vw, 144px)" }}>
            {lift
              ? `${lift}×`
              : <span className="ed-skeleton" style={{ width: "1.6em", height: "0.6em" }} aria-label="loading" />}
          </div>
          <p className="ed-lede" style={{ maxWidth: "44ch" }}>
            {lift ? (
              <>
                Searchers convert at <span style={{ color: ED_FOREST, fontWeight: 600 }}>{lift}×</span> the rate
                of those who don't. The asset-level follow-through (a click on a search result followed by an
                invest on that same asset) puts the search-attributable lift closer to <Term n={5}>two times</Term>.
              </>
            ) : (
              <span className="ed-prose-italic" style={{ opacity: 0.7 }}>
                Computing the searcher vs. non-searcher conversion lift across the W1–{lastWeek} cohort…
              </span>
            )}
          </p>
        </div>
      )}

      {/* Lift trend — the cumulative figure above (~2.3×) is the W1–{lastWeek}
          average; this exhibit shows the per-week ratio so the analyst can see
          whether the lift is steady, climbing, or eroding. Reference lines at
          1.0× (no lift) and 1.5× (target, per CONV_METRIC_DEFS.searchLift). */}
      {liftSeries.length > 0 && (
        <Figure
          figNum="6"
          title="Search lift, by week"
          caption={<>Conversion rate of each week's searcher cohort <em>÷</em> the window-wide non-searcher baseline — same definition as the cumulative lift above, just sliced per feature week. A user who searched in multiple weeks counts in each week's cohort. Reference lines at 1× (no lift) and 1.5× (target).</>}
          loading={loading}
          error={errOf(data, "conv_cohortW_byWeek")}
          height={260}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={liftSeries} margin={{ top: 30, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="week" {...edAxisProps} />
              <YAxis {...edAxisProps} width={42} domain={[0, (m) => Math.max(2.5, Math.ceil((m + 0.3) * 2) / 2)]}
                tickFormatter={(v) => `${v}×`} />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }}
                content={<EdTooltip valueFmt={(v, p) => (p.dataKey === "lift" ? `${v}×` : `${v}%`)} />} />
              <Legend {...edLegendProps} />
              <ReferenceLine y={1.0} stroke={ED_INK_MUTED} strokeDasharray="3 3"
                label={{ value: "no lift", position: "insideTopRight", fill: ED_INK_MUTED, fontSize: 10 }} />
              <ReferenceLine y={1.5} stroke={ED_GOLD} strokeDasharray="3 3"
                label={{ value: "target 1.5×", position: "insideTopRight", fill: ED_GOLD, fontSize: 10 }} />
              <Line dataKey="lift" name="Search lift" stroke={ED_FOREST} strokeWidth={2.5}
                dot={{ r: 3.5, fill: ED_FOREST, strokeWidth: 0 }}
                activeDot={{ r: 6, stroke: ED_INK, strokeWidth: 1 }} />
            </LineChart>
          </ResponsiveContainer>
        </Figure>
      )}

      <Figure
        figNum="7"
        title="Same-day conversion rate, by week"
        caption="Of users who searched in a given week, the share that hit Invest Now / Quick Checkout that same day."
        loading={loading}
        height={290}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={cvrSeries} margin={{ top: 30, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid {...edGridProps} />
            <XAxis dataKey="week" {...edAxisProps} />
            <YAxis yAxisId="v" {...edAxisProps} width={48} />
            <YAxis yAxisId="c" orientation="right" {...edAxisProps} width={42} unit="%" domain={[0, "dataMax + 2"]} />
            <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v, p) => (p.dataKey === "Same-day CVR" ? `${v}%` : nf.format(v))} />} />
            <Legend {...edLegendProps} />
            <Bar yAxisId="v" dataKey="Searchers" fill={ED_INK} opacity={0.42} maxBarSize={42} />
            <Line yAxisId="c" dataKey="Same-day CVR" stroke={ED_FOREST} strokeWidth={2.5}
              dot={{ r: 3.5, fill: ED_FOREST, strokeWidth: 0 }} activeDot={{ r: 6, stroke: ED_INK, strokeWidth: 1 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Figure>

      {/* Top converting queries — a table set print-style. */}
      <div className="mt-12">
        <p className="ed-caption mb-2">FIG. 8</p>
        <h3 className="ed-prose mb-3" style={{ fontSize: 16, fontWeight: 500, color: ED_INK }}>
          Top converting queries. <em style={{ color: ED_INK_MUTED }}>By searcher-level CVR; minimum 5 clickers per query.</em>
        </h3>
        <hr className="ed-rule" />
        {loading ? (
          <p className="ed-prose-italic py-6">Setting type…</p>
        ) : !topQueries.length ? (
          <p className="ed-prose-italic py-6">No queries cleared the minimum-clickers threshold yet.</p>
        ) : (
          <table className="w-full ed-prose" style={{ fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
                <th className="ed-caption text-left py-2">QUERY</th>
                <th className="ed-caption text-right py-2">CLICKERS</th>
                <th className="ed-caption text-right py-2">CONVERTERS</th>
                <th className="ed-caption text-right py-2">CVR</th>
              </tr>
            </thead>
            <tbody>
              {topQueries.map((r) => (
                <tr key={r.query} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                  <td className="py-2 ed-num" style={{ fontFamily: "var(--ed-mono)", color: ED_INK }}>{r.query}</td>
                  <td className="py-2 text-right ed-num" style={{ color: ED_INK_MUTED }}>{nf.format(r.clickers)}</td>
                  <td className="py-2 text-right ed-num">{nf.format(r.converters)}</td>
                  <td className="py-2 text-right ed-num" style={{ color: ED_FOREST, fontWeight: 600 }}>{r.rate_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function CohortCallout({ label, n, c, accent, note }) {
  if (!n) return null;
  const cvr = Math.round((1000 * c) / n) / 10;
  return (
    <div className="border-t border-[var(--ed-ink)] pt-5">
      <p className="ed-caption mb-2">{label.toUpperCase()}</p>
      <div className="ed-stat-num" style={{ color: accent, fontSize: 56 }}>{cvr}%</div>
      <p className="ed-prose mt-2" style={{ fontSize: 14 }}>
        <span style={{ fontFamily: "var(--ed-mono)" }}>{nf.format(c)}</span> of <span style={{ fontFamily: "var(--ed-mono)" }}>{nf.format(n)}</span> converted
      </p>
      <p className="ed-prose-italic mt-1" style={{ fontSize: 13 }}>{note}</p>
    </div>
  );
}

/* ── SECTION III — ISSUERS ────────────────────────────────────────────────── */

// Joins the per-week issuer DB rows (issuerHealthByWeek) with the per-week
// session-outcome rows (sessionOutcomeByIssuerWeek) and ISSUER_MAP's curated
// metadata (category, keywords, the human-written "note"). Success / relevance
// gap / dead end are live from DuckDB — no asset_search_cleared reconstruction.
function edBuildIssuers(rows, outcomeRows, weeks) {
  const byIssuer = new Map();
  for (const r of rows) {
    if (!byIssuer.has(r.issuer)) byIssuer.set(r.issuer, {});
    byIssuer.get(r.issuer)[r.week] = r;
  }
  const byOutcome = new Map();
  for (const r of outcomeRows || []) {
    if (!byOutcome.has(r.issuer)) byOutcome.set(r.issuer, {});
    byOutcome.get(r.issuer)[r.week] = r;
  }
  const avgOf = (xs) => (xs.length ? Math.round((10 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 10 : null);
  return ISSUER_MAP.map((meta) => {
    const wkMap = byIssuer.get(meta.name) || {};
    const oMap = byOutcome.get(meta.name) || {};
    const series = weeks.map((w) => {
      const r = wkMap[w] || {};
      const o = oMap[w] || {};
      return {
        week: w,
        sessions: Number(r.sessions) || 0,
        queries: Number(r.queries) || 0,
        zrr: r.zrr_pct == null ? 0 : Number(r.zrr_pct),
        refinement: r.refinement_pct == null ? 0 : Number(r.refinement_pct),
        success: Number(o.success) || 0,
        relgap: Number(o.relevance_gap) || 0,
        deadEnd: Number(o.dead_end) || 0,
        outcomeSearched: Number(o.searched) || 0,
      };
    });
    const sumKey = (k) => series.reduce((a, s) => a + (s[k] || 0), 0);
    const totSessions = sumKey("sessions"), totQueries = sumKey("queries");
    const totSuccess = sumKey("success"), totRelgap = sumKey("relgap"),
          totDeadEnd = sumKey("deadEnd"), totOutcomeSearched = sumKey("outcomeSearched");
    const avgZrr = totQueries
      ? Math.round((10 * series.reduce((a, s) => a + s.zrr * s.queries, 0)) / totQueries) / 10
      : null;
    const avgRefine = totQueries
      ? Math.round((10 * series.reduce((a, s) => a + s.refinement * s.queries, 0)) / totQueries) / 10
      : null;
    const half = Math.ceil(weeks.length / 2);
    const early = avgOf(series.slice(0, half).map((s) => s.zrr));
    const late = avgOf(series.slice(half).map((s) => s.zrr));
    const zrrDelta = early == null || late == null ? null : Math.round((late - early) * 10) / 10;
    const peak = series.reduce((m, s) => (s.zrr > (m?.zrr ?? -1) ? s : m), null);
    return { ...meta, series, totSessions, totQueries, totSuccess, totRelgap, totDeadEnd, totOutcomeSearched, avgZrr, avgRefine, zrrDelta, peak, early, late };
  })
    .filter((i) => i.totSessions > 0);
  // Note: list order is chosen interactively in IssuersSection (ISSUER_SORTS).
}

// Editorial category palette — maps classic's tone names to ink/rust/gold/forest
// so the same colour signal lands in the editorial palette.
const ED_CAT_COLOR = {
  healthy:      { ink: ED_FOREST, label: "Healthy" },
  alias:        { ink: ED_GOLD,   label: "Alias gap" },
  availability: { ink: ED_GOLD,   label: "Availability" },
  catalog_gap:  { ink: ED_RUST,   label: "Catalog gap" },
};
const ED_CAT_ORDER = ["healthy", "alias", "availability", "catalog_gap"];

// Issuer-list sort options. `volume` (most-searched first) is the default;
// the others let the reader re-rank the list by search health.
const issuerSuccessRate = (i) => (i.totOutcomeSearched ? i.totSuccess / i.totOutcomeSearched : 1);
const ISSUER_SORTS = {
  volume:   { label: "Searches",         cmp: (a, b) => b.totQueries - a.totQueries },
  success:  { label: "Worst success",    cmp: (a, b) => issuerSuccessRate(a) - issuerSuccessRate(b) },
  failures: { label: "Failed searches",  cmp: (a, b) => (b.totRelgap + b.totDeadEnd) - (a.totRelgap + a.totDeadEnd) },
  zrr:      { label: "Zero-result rate", cmp: (a, b) => (b.avgZrr ?? 0) - (a.avgZrr ?? 0) },
};
const ISSUER_SORT_ORDER = ["volume", "success", "failures", "zrr"];

function IssuersSection({ rows, outcomeRows, keywordRows, weeks, lastWeek, loading, error }) {
  const issuers = React.useMemo(() => edBuildIssuers(rows, outcomeRows, weeks), [rows, outcomeRows, weeks]);
  const [filter, setFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("volume");
  const [selected, setSelected] = React.useState(null);
  // The all-keywords table can be long for some issuers; ship collapsed by
  // default and let the user expand it. Resets when a different issuer is
  // picked so the "collapsed by default" promise holds for every issuer.
  const [keywordsExpanded, setKeywordsExpanded] = React.useState(false);
  React.useEffect(() => setKeywordsExpanded(false), [selected]);

  // Group the per-(issuer, keyword) rows by issuer once, then look up by name.
  // Sort by searches desc so the "top 3" pick is a simple slice.
  const keywordsByIssuer = React.useMemo(() => {
    const m = new Map();
    for (const r of keywordRows || []) {
      if (!r.issuer) continue;
      if (!m.has(r.issuer)) m.set(r.issuer, []);
      m.get(r.issuer).push({
        term: r.term,
        searches: Number(r.searches) || 0,
        sessions: Number(r.sessions) || 0,
        zrr_pct: r.zrr_pct == null ? null : Number(r.zrr_pct),
      });
    }
    for (const list of m.values()) list.sort((a, b) => b.searches - a.searches);
    return m;
  }, [keywordRows]);

  // Selecting an issuer scrolls the row that was tapped into view (so the
  // user sees that their click registered) — detail panel sits at the top
  // and updates in place, so there's no separate scroll target for it.
  const userInteractedRef = React.useRef(false);
  const topRef = React.useRef(null);
  const pickIssuer = React.useCallback((name) => {
    userInteractedRef.current = true;
    setSelected(name);
    requestAnimationFrame(() => {
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const shown = (filter === "all" ? issuers : issuers.filter((i) => i.category === filter))
    .slice()
    .sort(ISSUER_SORTS[sortBy].cmp);
  // Detail panel stays hidden until the user explicitly picks an issuer
  // — no auto-fallback to shown[0]/issuers[0]. The cards above are the index;
  // the detail is the deep-dive, opened on demand.
  const current = selected ? issuers.find((i) => i.name === selected) || null : null;
  const counts = ED_CAT_ORDER.reduce((m, c) => ({ ...m, [c]: issuers.filter((i) => i.category === c).length }), {});
  const totalSessions = issuers.reduce((a, i) => a + i.totSessions, 0);
  const issuerOutcomeSeries = current
    ? current.series.map((s) => ({ week: s.week, Success: s.success, "Relevance gap": s.relgap, "Dead end": s.deadEnd }))
    : [];

  // Per-issuer keyword data + computed outcome rates. Each rate reads against
  // this issuer's searched-session total, so success + relgap + dead end = 100%.
  const currentKeywords = current ? (keywordsByIssuer.get(current.name) || []) : [];
  const topKeywords = currentKeywords.slice(0, 3);
  const allKeywords = currentKeywords;
  const totSearches = currentKeywords.reduce((a, k) => a + k.searches, 0);
  const outcomePct = (n) => (current && current.totOutcomeSearched
    ? Math.round((1000 * (n || 0)) / current.totOutcomeSearched) / 10
    : null);
  const successPct = outcomePct(current && current.totSuccess);
  const relgapPct = outcomePct(current && current.totRelgap);
  const deadEndPct = outcomePct(current && current.totDeadEnd);

  if (loading) {
    return (
      <section className="ed-set">
        <SectionHead number="III" italic="The Issuers" deck="Loading…" />
        <p className="ed-prose-italic py-6">Setting type…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="ed-set">
        <SectionHead number="III" italic="The Issuers" />
        <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>Could not load the issuer roll-up. {error}</p>
      </section>
    );
  }
  if (!issuers.length) {
    return (
      <section className="ed-set">
        <SectionHead number="III" italic="The Issuers" />
        <p className="ed-prose-italic py-6">No issuer-mappable searches found in this export.</p>
      </section>
    );
  }

  return (
    <section className="ed-set" ref={topRef}>
      <SectionHead
        number="III"
        italic="The Issuers"
        deck={
          <>
            <code style={{ fontFamily: "var(--ed-mono)" }}>query_text</code> mapped to an issuer by leading-prefix / alias rules. Sessions, ZRR, the search-outcome split and the per-keyword roll-ups are all live from DuckDB. Category and the editorial note are human-written.
          </>
        }
      />

      {/* ── DETAIL FIRST. Selected issuer's full read sits at the top so it
            doesn't get lost below the list. The list further down lets the
            reader switch the focus issuer. */}
      {current && (
        <div className="mt-8">
          <hr className="ed-rule-thick" />
          <header className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h3 className="ed-headline" style={{ fontSize: "clamp(32px, 5vw, 52px)", margin: 0 }}>
              <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80" }}>
                {current.name}
              </em>
            </h3>
            <span className="ed-caption" style={{ color: ED_CAT_COLOR[current.category].ink, fontWeight: 600 }}>
              {ED_CAT_COLOR[current.category].label}
            </span>
            {current.peak && current.peak.zrr > 0 && (
              <span className="ed-prose-italic" style={{ fontSize: 13 }}>
                peak ZRR <span className="ed-num">{current.peak.zrr}%</span> in {current.peak.week}
              </span>
            )}
          </header>

          {/* Inline stat strip — sessions, queries, avg ZRR, refinement, and
              the session-outcome split (success / relevance gap / dead end,
              each count + % of this issuer's searched sessions), then the
              early→late ZRR delta. */}
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3 pt-3" style={{ borderTop: `1px solid ${ED_RULE_FAINT}` }}>
            <StatLine label="TOTAL SEARCHES" value={nf.format(current.totQueries)} />
            <StatLine label="SESSIONS" value={nf.format(current.totSessions)} />
            <StatLine
              label="AVG ZRR"
              value={current.avgZrr == null ? "—" : `${current.avgZrr}%`}
              valueColor={current.avgZrr == null ? ED_INK_MUTED : current.avgZrr > 50 ? ED_RUST : current.avgZrr > 30 ? ED_GOLD : ED_FOREST}
            />
            <StatLine label="REFINEMENT" value={current.avgRefine == null ? "—" : `${current.avgRefine}%`} />
            <StatLine
              label="SUCCESS"
              value={
                <>
                  <span className="ed-num">{nf.format(current.totSuccess)}</span>
                  <span className="ed-caption" style={{ color: ED_INK_MUTED, marginLeft: 6, fontWeight: 500 }}>
                    {successPct == null ? "" : `${successPct}% of searches`}
                  </span>
                </>
              }
              valueColor={ED_FOREST}
            />
            <StatLine
              label="RELEVANCE GAP"
              value={
                <>
                  <span className="ed-num">{nf.format(current.totRelgap)}</span>
                  <span className="ed-caption" style={{ color: ED_INK_MUTED, marginLeft: 6, fontWeight: 500 }}>
                    {relgapPct == null ? "" : `${relgapPct}% of searches`}
                  </span>
                </>
              }
              valueColor={ED_GOLD}
            />
            <StatLine
              label="DEAD END"
              value={
                <>
                  <span className="ed-num">{nf.format(current.totDeadEnd)}</span>
                  <span className="ed-caption" style={{ color: ED_INK_MUTED, marginLeft: 6, fontWeight: 500 }}>
                    {deadEndPct == null ? "" : `${deadEndPct}% of searches`}
                  </span>
                </>
              }
              valueColor={ED_RUST}
            />
            <StatLine
              label="EARLY → LATE ZRR"
              value={<DeltaInline from={current.early} to={current.late} suffix="pt" />}
            />
          </div>

          {/* Top 3 keywords — pull-quoted as the headline behaviour for this
              issuer. Three big cards, each a (term, searches, ZRR). Mobile
              stacks them; desktop puts them on one row. */}
          {topKeywords.length > 0 && (
            <div className="mt-8">
              <p className="ed-overline mb-3">TOP 3 SEARCH TERMS</p>
              <div className="grid gap-4 sm:grid-cols-3" style={{ borderTop: `1px solid ${ED_INK}`, borderBottom: `1px solid ${ED_INK}`, padding: "16px 0" }}>
                {topKeywords.map((k, i) => {
                  const zrr = k.zrr_pct;
                  const zrrColour = zrr == null ? ED_INK_MUTED : zrr > 50 ? ED_RUST : zrr > 30 ? ED_GOLD : ED_FOREST;
                  const sharePct = totSearches ? Math.round((1000 * k.searches) / totSearches) / 10 : null;
                  return (
                    <div key={k.term} className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="ed-caption" style={{ color: ED_INK_MUTED }}>{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ fontFamily: "var(--ed-mono)", fontSize: 18, color: ED_INK }}>{k.term}</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="ed-num" style={{ fontFamily: "var(--ed-mono)", fontSize: 22, fontWeight: 500, color: ED_INK }}>
                          {nf.format(k.searches)}
                        </span>
                        <span className="ed-caption" style={{ color: ED_INK_MUTED }}>SEARCHES</span>
                      </div>
                      <div className="ed-caption" style={{ color: ED_INK_MUTED }}>
                        {sharePct == null ? "" : `${sharePct}% of this issuer's searches`}
                      </div>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="ed-num" style={{ color: zrrColour, fontWeight: 600 }}>
                          {zrr == null ? "—" : `${zrr}%`}
                        </span>
                        <span className="ed-caption" style={{ color: ED_INK_MUTED }}>ZRR</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Full keyword table — every matched term, its volume share, and
              its own ZRR. Sorted by volume desc. Tabular layout (mono
              numerals, hairline rules) so the user can run their eye down
              the ZRR column quickly. */}
          {allKeywords.length > 0 && (
            <div className="mt-8">
              {/* Collapsed by default — a long-tail issuer's full term table can run
                  past a screen and pushes the figures further down. The user
                  opens it on demand; resets on issuer change (see effect above). */}
              <button
                type="button"
                onClick={() => setKeywordsExpanded((s) => !s)}
                aria-expanded={keywordsExpanded}
                className="ed-overline w-full flex items-baseline justify-between gap-3 hover:opacity-80 transition-opacity"
                style={{ minHeight: 44, textAlign: "left", padding: 0, background: "transparent", border: 0 }}
              >
                <span>KEYWORD BREAKDOWN — {allKeywords.length} MATCHED TERMS</span>
                <span className="ed-caption" style={{ color: ED_INK_MUTED, fontSize: 11 }}>
                  {keywordsExpanded ? "HIDE ▾" : "SHOW ▸"}
                </span>
              </button>
              {keywordsExpanded && (
                <>
                  <div className="mt-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                    <table className="w-full" style={{ fontFamily: "var(--ed-mono)", fontSize: 13, borderCollapse: "collapse", minWidth: 380 }}>
                      <thead>
                        <tr style={{ borderTop: `1px solid ${ED_INK}`, borderBottom: `1px solid ${ED_INK}` }}>
                          <th className="ed-caption text-left py-2">TERM</th>
                          <th className="ed-caption text-right py-2">SEARCHES</th>
                          <th className="ed-caption text-right py-2">SHARE</th>
                          <th className="ed-caption text-right py-2">SESSIONS</th>
                          <th className="ed-caption text-right py-2">ZRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allKeywords.map((k) => {
                          const zrr = k.zrr_pct;
                          const zrrColour = zrr == null ? ED_INK_MUTED : zrr > 50 ? ED_RUST : zrr > 30 ? ED_GOLD : ED_FOREST;
                          const sharePct = totSearches ? Math.round((1000 * k.searches) / totSearches) / 10 : null;
                          return (
                            <tr key={k.term} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                              <td className="py-2" style={{ color: ED_INK }}>{k.term}</td>
                              <td className="py-2 text-right ed-num" style={{ color: ED_INK }}>{nf.format(k.searches)}</td>
                              <td className="py-2 text-right ed-num" style={{ color: ED_INK_MUTED }}>{sharePct == null ? "—" : `${sharePct}%`}</td>
                              <td className="py-2 text-right ed-num" style={{ color: ED_INK_MUTED }}>{nf.format(k.sessions)}</td>
                              <td className="py-2 text-right ed-num" style={{ color: zrrColour, fontWeight: 600 }}>
                                {zrr == null ? "—" : `${zrr}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="ed-prose-italic mt-3" style={{ fontSize: 12, color: ED_INK_MUTED }}>
                    Terms case-folded; minimum 3 occurrences. ZRR colour: green &lt; 30%, gold 30–50%, rust &gt; 50%.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Figures III·a + III·b side-by-side on desktop, then THE READ
              and MATCHED ON full-width below — gives the prose room to breathe. */}
          <div className="mt-10 flex flex-col gap-10">
            <div className="grid gap-10 lg:grid-cols-2">
              <Figure
                figNum={`III·a`}
                title="Sessions and zero-result rate, by week"
                caption={<>Area: sessions for <em>{current.name}</em>. Line: query-level zero-result rate.</>}
                height={240}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={current.series} margin={{ top: 30, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid {...edGridProps} />
                    <XAxis dataKey="week" {...edAxisProps} />
                    <YAxis yAxisId="s" {...edAxisProps} width={42} />
                    <YAxis
                      yAxisId="z"
                      orientation="right"
                      {...edAxisProps}
                      width={42}
                      unit="%"
                      domain={[0, (m) => Math.max(20, Math.ceil((m + 10) / 10) * 10)]}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(27,24,24,0.04)" }}
                      content={<EdTooltip valueFmt={(v, p) => (p.dataKey === "zrr" ? `${v}%` : nf.format(v))} />}
                    />
                    <Legend {...edLegendProps} />
                    <Area yAxisId="s" dataKey="sessions" name="Sessions" stroke={ED_INK} strokeWidth={1.5} fill={ED_INK} fillOpacity={0.18} />
                    <Line yAxisId="z" dataKey="zrr" name="Zero-result rate" stroke={ED_RUST} strokeWidth={2.2}
                      dot={{ r: 3, fill: ED_RUST, strokeWidth: 0 }} activeDot={{ r: 5.5, stroke: ED_INK, strokeWidth: 1 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Figure>

              <Figure
                figNum={`III·b`}
                title="Search outcome, by week"
                caption="Each searched session for this issuer, classified once: success (clicked a result), relevance gap (results shown, no click), or dead end (zero results). Live from DuckDB."
                height={200}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={issuerOutcomeSeries} margin={{ top: 30, right: 8, bottom: 0, left: -16 }} barGap={2}>
                    <CartesianGrid {...edGridProps} />
                    <XAxis dataKey="week" {...edAxisProps} />
                    <YAxis {...edAxisProps} width={36} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v) => nf.format(v)} />} />
                    <Legend {...edLegendProps} />
                    <Bar dataKey="Success" stackId="a" fill={ED_FOREST} maxBarSize={28} />
                    <Bar dataKey="Relevance gap" stackId="a" fill={ED_GOLD} maxBarSize={28} />
                    <Bar dataKey="Dead end" stackId="a" fill={ED_RUST} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </Figure>
            </div>

            {/* THE READ and MATCHED ON keywords from the curated ISSUER_MAP
                — full-width below the figures (was a right-rail sidebar). */}
            <div>
              <p className="ed-overline mb-2">THE READ</p>
                <p className="ed-prose" style={{ fontSize: 15, lineHeight: 1.55, color: ED_INK_SOFT_INLINE }}>
                  {current.note}
                </p>
              </div>
              <div>
                <p className="ed-overline mb-2">MATCHED ON</p>
                <div className="flex flex-wrap gap-1.5">
                  {current.keywords.map((k) => (
                    <span
                      key={k}
                      style={{
                        fontFamily: "var(--ed-mono)",
                        fontSize: 11,
                        padding: "2px 8px",
                        border: `1px solid ${ED_RULE_FAINT}`,
                        color: ED_INK,
                      }}
                    >
                      {k}
                    </span>
                  ))}
                </div>
                <p className="ed-byline mt-3" style={{ fontSize: 12 }}>
                  SQL prefix rule: {current.prefixes.map((p) => `LOWER(query_text) LIKE '${p}%'`).join(" OR ")}
                </p>
              </div>
          </div>

          <hr className="ed-rule-thick mt-12" />
        </div>
      )}

      {/* ── ALL ISSUERS LIST. Below the detail because tapping a row updates
            the detail above. Filter chips + count summary at the top. */}
      <header className="mt-10 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <p className="ed-overline">ALL ISSUERS · TAP A ROW TO READ</p>
        <span className="ed-caption ml-auto" style={{ color: ED_INK_MUTED }}>
          {nf.format(totalSessions)} sessions · {weeks.length} weeks
        </span>
      </header>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <FilterCue active={filter === "all"} onClick={() => setFilter("all")} label="All" count={issuers.length} ink={ED_INK} />
        {ED_CAT_ORDER.filter((c) => counts[c]).map((c) => (
          <FilterCue
            key={c}
            active={filter === c}
            onClick={() => setFilter(c)}
            label={ED_CAT_COLOR[c].label}
            count={counts[c]}
            ink={ED_CAT_COLOR[c].ink}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <span className="ed-caption" style={{ color: ED_INK_MUTED, letterSpacing: "0.10em" }}>SORT BY</span>
        {ISSUER_SORT_ORDER.map((k) => (
          <SortCue key={k} active={sortBy === k} onClick={() => setSortBy(k)} label={ISSUER_SORTS[k].label} />
        ))}
      </div>

      <ol className="mt-5" style={{ listStyle: "none", padding: 0, borderTop: `1px solid ${ED_INK}` }}>
        {shown.map((iss, idx) => {
          const active = current && current.name === iss.name;
          return (
            <li
              key={iss.name}
              style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}
            >
              <button
                type="button"
                onClick={() => pickIssuer(iss.name)}
                aria-pressed={active}
                className="w-full text-left py-4 grid gap-4 md:gap-6 md:grid-cols-[44px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,140px)] md:items-baseline transition-opacity duration-150"
                style={{ background: "transparent", opacity: active ? 1 : 0.92, cursor: "pointer", border: 0 }}
              >
                <div
                  className="ed-section-no"
                  style={{ fontSize: 22, color: ED_INK, fontStyle: "normal", fontVariationSettings: "'opsz' 36, 'SOFT' 60" }}
                >
                  {String(idx + 1).padStart(2, "0")}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="ed-headline" style={{ fontSize: 22, lineHeight: 1.1, margin: 0 }}>{iss.name}</span>
                    <span className="ed-caption" style={{ color: ED_CAT_COLOR[iss.category].ink, fontWeight: 600 }}>
                      {ED_CAT_COLOR[iss.category].label}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 ed-caption" style={{ color: ED_INK_MUTED }}>
                    <span>{nf.format(iss.totSessions)} SESSIONS</span>
                    <span>·</span>
                    <span style={{ color: iss.avgZrr == null ? ED_INK_MUTED : iss.avgZrr > 50 ? ED_RUST : iss.avgZrr > 30 ? ED_GOLD : ED_FOREST, fontWeight: 600 }}>
                      AVG ZRR {iss.avgZrr == null ? "—" : `${iss.avgZrr}%`}
                    </span>
                    <span>·</span>
                    <span>
                      SUCCESS {nf.format(iss.totSuccess)}
                      {iss.totOutcomeSearched ? (
                        <span style={{ color: ED_INK_MUTED, fontWeight: 400, marginLeft: 4 }}>
                          ({Math.round((1000 * iss.totSuccess) / iss.totOutcomeSearched) / 10}%)
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
                <div className="hidden md:block h-9" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={iss.series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                      <Area dataKey="sessions" stroke={ED_INK} strokeWidth={1} fill={ED_INK} fillOpacity={0.12} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-right">
                  <DeltaInline from={iss.early} to={iss.late} suffix="pt" />
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Soft-ink colour for prose paragraphs — the --ed-ink-soft CSS variable, so it
// follows the active editorial theme (sepia / light).
const ED_INK_SOFT_INLINE = "var(--ed-ink-soft)";

function SortCue({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-baseline px-1 py-1 transition-colors duration-150"
      style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 11,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        color: active ? ED_INK : ED_INK_MUTED,
        borderBottom: active ? `2px solid ${ED_INK}` : "2px solid transparent",
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}

function FilterCue({ active, onClick, label, count, ink }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-baseline gap-1.5 px-1 py-1 transition-colors duration-150"
      style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 11,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        color: active ? ED_INK : ED_INK_MUTED,
        borderBottom: active ? `2px solid ${ink}` : "2px solid transparent",
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
      <span style={{ color: ED_INK_MUTED, fontWeight: 400 }}>·</span>
      <span style={{ color: ED_INK_MUTED }}>{count}</span>
    </button>
  );
}

function StatLine({ label, value, valueColor }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="ed-caption">{label}</span>
      <span
        className="ed-num"
        style={{ fontFamily: "var(--ed-mono)", fontSize: 15, fontWeight: 500, color: valueColor || ED_INK }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── SECTION IV — TERMS & ASSETS ──────────────────────────────────────────── */

function TermsSection({ terms, assets, positions, zeroQueries, loading, data }) {
  return (
    <section className="ed-set">
      <SectionHead
        number="IV"
        italic="The Terms"
        deck="What people actually type. The first list is by volume; the second is queries that returned nothing."
      />
      <div className="grid gap-12 lg:grid-cols-2 mt-8">
        <div>
          <p className="ed-caption mb-2">FIG. 8 — TOP SEARCH TERMS</p>
          <hr className="ed-rule" />
          {loading ? <p className="ed-prose-italic py-6">Setting type…</p> : errOf(data, "terms") ? (
            <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>Could not load.</p>
          ) : (
            <table className="w-full ed-prose" style={{ fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
                  <th className="ed-caption text-left py-2">TERM</th>
                  <th className="ed-caption text-right py-2">SEARCHES</th>
                  <th className="ed-caption text-right py-2">ZRR</th>
                </tr>
              </thead>
              <tbody>
                {terms.slice(0, 14).map((r) => {
                  const zr = Number(r.zrr_pct);
                  return (
                    <tr key={r.term} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                      <td className="py-2" style={{ fontFamily: "var(--ed-mono)", color: ED_INK }}>{r.term}</td>
                      <td className="py-2 text-right ed-num">{nf.format(r.searches)}</td>
                      <td className="py-2 text-right ed-num" style={{ color: zr > 50 ? ED_RUST : zr > 30 ? ED_GOLD : ED_FOREST, fontWeight: 600 }}>{zr}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <p className="ed-caption mb-2">FIG. 9 — TOP ZERO-RESULT QUERIES</p>
          <hr className="ed-rule" />
          {loading ? <p className="ed-prose-italic py-6">Setting type…</p> : errOf(data, "zeroQueries") ? (
            <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>Could not load.</p>
          ) : (
            <table className="w-full ed-prose" style={{ fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
                  <th className="ed-caption text-left py-2">QUERY</th>
                  <th className="ed-caption text-right py-2">OCCURRENCES</th>
                </tr>
              </thead>
              <tbody>
                {zeroQueries.slice(0, 14).map((r) => (
                  // SQL columns are `term` (LOWER(TRIM(query_text))) and `hits` (COUNT(*)).
                  // The previous accessors here read `r.query_text` / `r.count` which return
                  // undefined → empty cell and `nf.format(undefined)` → the literal "NaN".
                  <tr key={r.term} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                    <td className="py-2" style={{ fontFamily: "var(--ed-mono)", color: ED_INK }}>{r.term}</td>
                    <td className="py-2 text-right ed-num" style={{ color: ED_RUST }}>{nf.format(r.hits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Figure
        figNum="10"
        title="Clicks by result position"
        caption="At which rank did the user click? Heavy concentration at rank 1 is healthy ranking; long tails suggest the top result is often wrong."
        height={240}
        loading={loading}
        error={errOf(data, "positions")}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={positions} margin={{ top: 16, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid {...edGridProps} />
            <XAxis dataKey="rank" {...edAxisProps} />
            <YAxis {...edAxisProps} width={44} />
            <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v) => nf.format(v)} />} />
            <Bar dataKey="clicks" name="Clicks" fill={ED_GOLD} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </Figure>
    </section>
  );
}

/* ── SECTION V — INSTRUMENTATION ──────────────────────────────────────────── */

function InstrumentationSection({ clears, totalClears, weeks, lastWeek, loading, data }) {
  return (
    <section className="ed-set">
      <SectionHead
        number={data && rowsOf(data, "conv_headline").length ? "V" : "IV"}
        italic="The Instrumentation"
        deck="How the data was gathered, and where the next correction needs to land."
      />
      <p className="ed-lede mt-6" style={{ maxWidth: "62ch" }}>
        Six event families feed this report: <em>search_initiated</em>, <em>search_query</em>,
        <em> search_result_clicked</em>, <em>search_suggestion_clicked</em>, <em>search_cleared</em>, and
        <em> search_empty_state</em>. Joined to <em>assets_page_views</em> (visitor population) and to
        <em> invest_now_button_clicked</em> + <em>quick_checkout_invest_clicked</em> (conversion signal).
      </p>
      <p className="ed-prose mt-6" style={{ maxWidth: "62ch", fontSize: 15 }}>
        Total <Term n={6}>clear events</Term> over the window: <strong style={{ fontFamily: "var(--ed-mono)" }}>{nf.format(totalClears)}</strong>.
        From W4 onward the <span style={{ fontFamily: "var(--ed-mono)" }}>asset_search_cleared</span> export carries the
        had-results / any-click payload, so a clear splits cleanly into
        <em> "found what I wanted and left clean"</em> versus <em>"nothing matched, gave up"</em>.
        W1–W3 predate that payload and are reconstructed offline — each clear matched to the
        session's last query and to its in-episode result clicks.
      </p>
    </section>
  );
}

/* ── FOOTNOTES ─────────────────────────────────────────────────────────────── */

function FootnotesBlock() {
  return (
    <section className="mt-20">
      <hr className="ed-rule-double" />
      <p className="ed-overline mt-6 mb-4">FOOTNOTES</p>
      <ol className="space-y-2" style={{ maxWidth: "72ch", listStyle: "none", padding: 0 }}>
        <Footnote n={1} term="Twice">
          {CONV_METRIC_DEFS.searchLift.body}
        </Footnote>
        <Footnote n={2} term="Window">
          The {nWeeks}-week reporting window is W1 ({fmtWeekDates(1)}) through W{lastWeekN} ({fmtWeekDates(lastWeekN)}), {lastRange ? lastRange.end.getUTCFullYear() : 2026} — feature weeks counted from the Apr 2 launch.
        </Footnote>
        <Footnote n={3} term="Adoption">
          {CONV_METRIC_DEFS.adoption.body}
        </Footnote>
        <Footnote n={4} term="ZRR">
          {METRIC_DEFS.zrr.body}
        </Footnote>
        <Footnote n={5} term="Asset-level follow-through">
          {CONV_METRIC_DEFS.searchToInvest.body}
        </Footnote>
        <Footnote n={6} term="Clear events">
          {METRIC_DEFS.clears.body}
        </Footnote>
      </ol>
    </section>
  );
}
