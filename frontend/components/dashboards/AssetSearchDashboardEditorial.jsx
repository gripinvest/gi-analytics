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
} from "recharts";

import { runQuery } from "@/lib/api";
import * as Q from "@/lib/queries/assetSearch";
import { METRIC_DEFS } from "@/lib/queries/assetSearch";
import * as C from "@/lib/queries/conversion";
import { CONV_METRIC_DEFS } from "@/lib/queries/conversion";

/* ── data loading (mirrors the classic dashboard's hook) ──────────────────── */

const QUERY_SPECS = {
  health:      (ctx) => Q.queryHealthByWeek(ctx),
  funnel:      (ctx) => Q.funnelByWeek(ctx),
  suggestions: (ctx) => Q.suggestionsByWeek(ctx),
  clears:      (ctx) => Q.clearsByWeek(ctx),
  tabs:        (ctx) => Q.byTab(ctx),
  sessions:    (ctx) => Q.totalQuerySessions(ctx),
  terms:       (ctx) => Q.topSearchTerms(ctx),
  assets:      (ctx) => Q.topClickedAssets(ctx),
  positions:   (ctx) => Q.clicksByPosition(ctx),
  zeroQueries: (ctx) => Q.topZeroResultQueries(ctx),
  issuers:     (ctx) => Q.issuerHealthByWeek(ctx),
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
  conv_cohortW:  (conv) => C.weeklyCohortCvr(conv),
  conv_adoption: (conv) => C.weeklyAdoption(conv),
};

function useDashboard(project) {
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
  }, [project.id, grouped, conv]);

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

/* ── editorial chart styling ───────────────────────────────────────────────── */

const ED_INK = "#1B1818";
const ED_RUST = "#A6242B";
const ED_FOREST = "#3B5E3D";
const ED_GOLD = "#B8870A";
const ED_INK_MUTED = "#5D5752";
const ED_RULE_FAINT = "#C8BFA9";

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

function Exhibit({ letter, label, value, sub, delta, deltaGoodIsDown = true }) {
  return (
    <div className="flex flex-col gap-1 ed-set">
      <div className="flex items-baseline gap-2">
        <span className="ed-caption">EXHIBIT {letter}</span>
        {delta && <DeltaInline {...delta} goodIsDown={deltaGoodIsDown} />}
      </div>
      <div className="ed-stat-num">{value}</div>
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
  const { loading, fatal, data, weeks, lastWeek, convOk } = useDashboard(project);

  // ── headline numbers ─────────────────────────────────────────────────────
  const health = rowsOf(data, "health");
  const funnel = rowsOf(data, "funnel");
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
          <span>NO. 06</span><span>·</span>
          <span>MAY 11, 2026</span><span>·</span>
          <span>{weeks[0]}–{lastWeek}</span><span>·</span>
          <span>{nf.format(totalQueries)} QUERIES INDEXED</span>
        </p>
      </header>

      {/* ── LEDE / EDITOR'S NOTE ──────────────────────────────────────────── */}
      <section className="mt-12 grid gap-10 md:grid-cols-[1.5fr_1fr] ed-set ed-set-delay-1">
        <div>
          <p className="ed-overline mb-4">FROM THE EDITOR</p>
          <h2 className="ed-headline mb-5" style={{ fontSize: "clamp(32px, 5vw, 52px)" }}>
            Six weeks in, search converts.<br/>
            <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
              The trouble is who isn't searching.
            </em>
          </h2>
          <p className="ed-lede ed-dropcap" style={{ maxWidth: "56ch" }}>
            Six weeks after launch, search behaves as we hoped — visitors who use it convert at
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
      <section className="mt-8 ed-set ed-set-delay-2">
        <p className="ed-overline mb-6">BY THE NUMBERS</p>
        <div className="grid gap-x-8 gap-y-7 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <Exhibit letter="A" label="search sessions" value={sessions != null ? nf.format(sessions) : "—"}
            sub={`${weeks.length} feature weeks`} />
          {adoptionOverallPct != null && (
            <Exhibit letter="B" label={<Term n={3}>adoption rate</Term>} value={pct(adoptionOverallPct)}
              sub={`${nf.format(sum(adoption, "searchers"))} of ${nf.format(sum(adoption, "visitors"))}`}
              delta={{ from: adoptionFirst, to: adoptionLast, suffix: "pt" }}
              deltaGoodIsDown={false} />
          )}
          <Exhibit letter={adoptionOverallPct != null ? "C" : "B"} label={<Term n={4}>zero-result rate</Term>}
            value={pct(overallZrr)} sub={`${nf.format(totalQueries)} queries`}
            delta={{ from: zrrFirst, to: zrrLast, suffix: "pt" }} />
          <Exhibit letter={adoptionOverallPct != null ? "D" : "C"} label="refinement rate"
            value={pct(overallRefine)} sub="iterating mid-search" />
          <Exhibit letter={adoptionOverallPct != null ? "E" : "D"} label="result clicks"
            value={totalClicks ? nf.format(totalClicks) : "—"} sub="from search results" />
          <Exhibit letter={adoptionOverallPct != null ? "F" : "E"} label="suggestion CTR"
            value={pct(ctrLast)} sub={`${lastWeek} focus-time picks`} />
        </div>
      </section>

      <hr className="ed-rule-thick mt-12" />

      {/* ── SECTIONS NAV ──────────────────────────────────────────────────── */}
      <nav
        role="tablist"
        aria-label="Sections of this issue"
        className="mt-8 flex flex-wrap items-baseline gap-x-7 gap-y-3 ed-set ed-set-delay-3"
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
        <IssuersSection rows={issuers} weeks={weeks} lastWeek={lastWeek} loading={loading} error={errOf(data, "issuers")} />
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

function OverviewSection({ loading, data, adoptionSeries, healthSeries, funnelSeries, refineSeries, suggSeries, tabs, weeks, lastWeek, zrrFirst, zrrLast, adoptionFirst, adoptionLast }) {
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

      <div className="grid gap-10 md:grid-cols-2 mt-10">
        <Figure
          figNum="3"
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
          figNum="4"
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
        <p className="ed-caption mb-2">FIG. 5</p>
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

      {lift && (
        <div className="mt-10 border-t border-b border-[var(--ed-ink)] py-6 grid gap-6 md:grid-cols-[auto_1fr] items-center">
          <div className="ed-pullnum" style={{ fontSize: "clamp(80px, 12vw, 144px)" }}>{lift}×</div>
          <p className="ed-lede" style={{ maxWidth: "44ch" }}>
            Searchers convert at <span style={{ color: ED_FOREST, fontWeight: 600 }}>{lift}×</span> the rate
            of those who don't. The asset-level follow-through (a click on a search result followed by an
            invest on that same asset) puts the search-attributable lift closer to <Term n={5}>two times</Term>.
          </p>
        </div>
      )}

      <Figure
        figNum="6"
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
        <p className="ed-caption mb-2">FIG. 7</p>
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
                  <td className="py-2 text-right ed-num" style={{ color: ED_FOREST, fontWeight: 600 }}>{r.cvr_pct}%</td>
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

function IssuersSection({ rows, weeks, lastWeek, loading, error }) {
  const issuers = React.useMemo(() => {
    // Roll up issuer rows by issuer name across weeks
    const byName = new Map();
    for (const r of rows) {
      const name = r.issuer || r.name || "—";
      if (!byName.has(name)) byName.set(name, { name, queries: 0, zero: 0, weekly: {} });
      const e = byName.get(name);
      e.queries += Number(r.queries) || 0;
      e.zero += Number(r.zero_result) || 0;
      e.weekly[r.week] = { q: Number(r.queries) || 0, z: Number(r.zero_result) || 0, zrr: Number(r.zrr_pct) || 0 };
    }
    return Array.from(byName.values())
      .map((e) => ({
        ...e,
        zrr_pct: e.queries ? Math.round((1000 * e.zero) / e.queries) / 10 : 0,
        peak_zrr: Math.max(...Object.values(e.weekly).map((w) => w.zrr || 0), 0),
      }))
      .sort((a, b) => b.queries - a.queries);
  }, [rows]);

  return (
    <section className="ed-set">
      <SectionHead
        number="III"
        italic="The Issuers"
        deck="Issuer-level rollups across the window. The peak weekly ZRR is the cleanest tell for an alias or coverage gap."
      />
      {loading ? (
        <p className="ed-prose-italic py-6">Setting type…</p>
      ) : error ? (
        <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>{error}</p>
      ) : !issuers.length ? (
        <p className="ed-prose-italic py-6">No issuer-level rows in this export.</p>
      ) : (
        <div className="mt-8">
          <hr className="ed-rule" />
          <table className="w-full ed-prose" style={{ fontSize: 14, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
                <th className="ed-caption text-left py-2">ISSUER</th>
                <th className="ed-caption text-right py-2">QUERIES</th>
                <th className="ed-caption text-right py-2">ZRR (POOLED)</th>
                <th className="ed-caption text-right py-2">PEAK WEEK</th>
              </tr>
            </thead>
            <tbody>
              {issuers.slice(0, 20).map((iss) => (
                <tr key={iss.name} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                  <td className="py-2.5" style={{ fontWeight: 500, color: ED_INK }}>{iss.name}</td>
                  <td className="py-2.5 text-right ed-num">{nf.format(iss.queries)}</td>
                  <td className="py-2.5 text-right ed-num"
                    style={{ color: iss.zrr_pct > 50 ? ED_RUST : iss.zrr_pct > 30 ? ED_GOLD : ED_FOREST, fontWeight: 600 }}>
                    {iss.zrr_pct}%
                  </td>
                  <td className="py-2.5 text-right ed-num" style={{ color: ED_INK_MUTED }}>
                    {iss.peak_zrr}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ed-prose-italic mt-4" style={{ fontSize: 13 }}>
            Color coding: <span style={{ color: ED_FOREST, fontWeight: 600 }}>green</span> &lt; 30%,{" "}
            <span style={{ color: ED_GOLD, fontWeight: 600 }}>gold</span> 30–50%,{" "}
            <span style={{ color: ED_RUST, fontWeight: 600 }}>rust</span> &gt; 50%. ZRR &gt; 50% almost always
            indicates an issuer-name alias or coverage gap.
          </p>
        </div>
      )}
    </section>
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
                  <tr key={r.query_text} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                    <td className="py-2" style={{ fontFamily: "var(--ed-mono)", color: ED_INK }}>{r.query_text}</td>
                    <td className="py-2 text-right ed-num" style={{ color: ED_RUST }}>{nf.format(r.count)}</td>
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
        Today these stand in for true abandonment, but the current export of <span style={{ fontFamily: "var(--ed-mono)" }}>asset_search_cleared</span> does
        not carry the had-results / any-click payload — so we can't yet split a clear into
        <em> "found what I wanted and left clean"</em> versus <em>"nothing matched, gave up"</em>.
        Re-exporting that payload is the highest-value single change to make the abandonment metric honest.
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
          The six-week window is W1 (Apr 2–8) through W6 (May 7–11), 2026. W6 is a partial week and
          tends to look softer in raw counts; the rates are still comparable.
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
