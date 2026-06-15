// AssetSearchGCSectionEditorial
//
// Editorial twin of AssetSearchGCSection. Reads the EXACT same dashboard data
// keys (gc_overview / gc_mix / gc_funnel / gc_partner / gc_terms), so the
// numbers are identical to the classic rendering — only the visual treatment
// differs. Re-expressed in the "Grip Weekly" editorial language: hairline-ruled
// figures and tables, Fraunces / Newsreader / IBM Plex Mono type, the --ed-*
// paper-and-ink palette. No cards, no @/components/ui, no @/lib/tokens —
// mirroring how AssetSearchDailySection / -OutreachSection are editorial-native.
//
// Why this file exists: the classic AssetSearchGCSection was reused verbatim
// inside the editorial dashboard, so the Grip Connect block rendered as classic
// rounded cards + a fixed navy/teal chart palette amid the newspaper layout
// (the --gi-* token remap in editorial.css recolours text/bg but can't touch
// the hard-coded chart hex or the card chrome/fonts). This is the missing
// editorial visual twin: the editorial dashboard imports GC from here, the
// classic dashboard keeps importing ./AssetSearchGCSection unchanged.

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

/* ── editorial palette + chart styling ───────────────────────────────────────
   Self-contained, mirroring the constants AssetSearchDashboardEditorial and its
   sibling sections declare locally. Colours reference --ed-* CSS variables, so
   they follow whichever editorial theme (sepia / light) is active. */
const ED_INK = "var(--ed-ink)";
const ED_INK_MUTED = "var(--ed-ink-muted)";
const ED_RUST = "var(--ed-rust)";
const ED_GOLD = "var(--ed-gold)";
const ED_FOREST = "var(--ed-forest)";
const ED_RULE_FAINT = "var(--ed-rule-faint)";

// Segment colours. Grip Connect = rust — it is both this section's subject and
// the elevated-ZRR series the "persistent gap" finding is about; own platform
// = ink-muted, the neutral baseline (the same grammar the Overview uses:
// baseline series in ink, the series-under-watch in rust). To prefer a
// non-semantic two-accent pairing, swap OWN to ED_FOREST / GC to ED_GOLD here.
const GC = "Grip Connect";
const OWN = "Own Platform";
const SEG_COLOR = { [GC]: ED_RUST, [OWN]: ED_INK_MUTED };

const nf = new Intl.NumberFormat("en-IN");
const pct = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${v}%`);
const rowsOf = (data, key) => (data && data[key] && data[key].rows) || [];
const errOf = (data, key) => (data && data[key] && data[key].error) || null;
const segRow = (rows, segment) => rows.find((r) => r.segment === segment) || null;
// Zero-result value colour — same thresholds the editorial Terms table uses, so
// a ZRR number reads identically everywhere in the issue.
const zrrInk = (z) =>
  z == null || Number.isNaN(z) ? ED_INK : z > 50 ? ED_RUST : z > 30 ? ED_GOLD : ED_FOREST;

const edAxisProps = {
  stroke: ED_INK_MUTED,
  tick: { fontSize: 10, fontFamily: "var(--ed-mono)", fill: ED_INK_MUTED, letterSpacing: 0.5 },
  tickLine: false,
  axisLine: { stroke: ED_INK, strokeWidth: 1 },
};
const edGridProps = { stroke: ED_RULE_FAINT, strokeDasharray: "0", vertical: false };
const edLegendProps = {
  verticalAlign: "top", align: "left", height: 26, iconType: "rect", iconSize: 10,
  wrapperStyle: {
    paddingBottom: 4, fontFamily: "var(--ed-mono)", fontSize: 10,
    letterSpacing: "0.10em", textTransform: "uppercase", color: ED_INK_MUTED,
  },
};

function EdTooltip({ active, payload, label, valueFmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: "var(--ed-paper)", border: `1px solid ${ED_INK}`, padding: "8px 12px",
      fontFamily: "var(--ed-mono)", fontSize: 11, color: ED_INK, boxShadow: "2px 2px 0 rgba(27,24,24,0.10)",
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

/* Editorial chart wrapper — hairline rules top + bottom, mono caption. Mirrors
   the dashboard's Figure primitive (kept local; see the self-contain note). */
function EdFigure({ label, title, caption, children, height = 280, loading, error }) {
  return (
    <figure className="ed-figure">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span className="ed-caption">{label}</span>
        <span className="ed-section-no" style={{ fontStyle: "italic" }}>—</span>
        <h3 className="ed-prose" style={{ fontVariationSettings: "'opsz' 24", fontSize: 16, fontWeight: 500, color: ED_INK }}>
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
            <span className="ed-prose-italic" style={{ color: ED_RUST }}>Could not render this figure: {error}</span>
          </div>
        ) : children}
      </div>
    </figure>
  );
}

/* Section header — duplicated from the editorial dashboard (its SectionHead is
   module-local and unexported). */
function SectionHead({ number, italic, deck }) {
  return (
    <header className="mt-16 mb-8">
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

/* A headline figure — caption label over a large Fraunces number, italic hint
   below. */
function GcStat({ label, value, valueColor, hint, loading }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="ed-caption">{label}</span>
      {loading ? (
        <span className="ed-skeleton ed-skeleton-num" aria-label="loading" />
      ) : (
        <span className="ed-stat-num" style={{ fontSize: 34, color: valueColor || ED_INK }}>{value}</span>
      )}
      {hint && !loading ? <span className="ed-prose-italic" style={{ fontSize: 12 }}>{hint}</span> : null}
    </div>
  );
}

/* A compact label/value pair for the overview comparison block. */
function StatPair({ label, value, valueColor, hint }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="ed-caption">{label}</span>
      <span className="ed-num" style={{ fontSize: 18, fontWeight: 500, color: valueColor || ED_INK }}>{value}</span>
      {hint ? <span className="ed-prose-italic" style={{ fontSize: 11 }}>{hint}</span> : null}
    </div>
  );
}

const SegSwatch = ({ segment }) => (
  <span style={{ display: "inline-block", width: 10, height: 10, background: SEG_COLOR[segment] }} />
);

/* pivot the per-week long rows (one per segment per week) into one row per week
   for the charts — identical reshape to the classic section. */
function useMixSeries(mix) {
  return React.useMemo(() => {
    const byWeek = {};
    for (const r of mix) {
      const w = (byWeek[r.week] ||= { week: r.week });
      w[r.segment] = Number(r.queries);
      w[`${r.segment} zrr`] = Number(r.zrr_pct);
    }
    return Object.values(byWeek).sort((a, b) => Number(a.week.slice(1)) - Number(b.week.slice(1)));
  }, [mix]);
}

/* ── compact GC-vs-own block, embedded on the Overview ───────────────────────
   Editorial twin of the classic GCComparisonCard: a ruled standfirst block
   (no card) showing the split, so the GC share is visible on the lead screen. */
export function GCComparisonCard({ data, loading, note }) {
  const overview = rowsOf(data, "gc_overview");
  const funnel = rowsOf(data, "gc_funnel");
  const err = errOf(data, "gc_overview");

  const own = segRow(overview, OWN);
  const gc = segRow(overview, GC);
  const ownF = segRow(funnel, OWN);
  const gcF = segRow(funnel, GC);
  const gcShare = gc ? Number(gc.query_share_pct) : null;

  return (
    <section className="ed-set border-t border-b border-[var(--ed-ink)] py-6 mt-10">
      <p className="ed-caption mb-1">GRIP CONNECT vs OWN PLATFORM</p>
      <p className="ed-prose-italic mb-5" style={{ maxWidth: "64ch", fontSize: 13 }}>
        Search traffic split by <span style={{ fontFamily: "var(--ed-mono)" }}>gc_id</span> — partner journeys vs
        own-platform users.{note ? ` ${note}` : ""} W4 (Apr 23) onward.
      </p>
      {loading ? (
        <div className="flex flex-wrap gap-x-12 gap-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="ed-skeleton ed-skeleton-num" aria-label="loading" />
          ))}
        </div>
      ) : err || !gc ? (
        <p className="ed-prose-italic" style={{ color: ED_RUST }}>Could not load the GC split.</p>
      ) : (
        <>
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {[{ s: GC, o: gc, f: gcF }, { s: OWN, o: own, f: ownF }].map(({ s, o, f }) => (
              <div key={s} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <SegSwatch segment={s} />
                  <span className="ed-overline" style={{ color: ED_INK }}>{s}</span>
                </div>
                <div className="grid grid-cols-3 gap-x-6">
                  <StatPair label="Queries" value={o ? nf.format(o.queries) : "—"} hint={o ? `${o.query_share_pct}% share` : ""} />
                  <StatPair label="Zero-result" value={o ? pct(o.zrr_pct) : "—"}
                    valueColor={o && o.zrr_pct != null ? zrrInk(Number(o.zrr_pct)) : undefined} />
                  <StatPair label="Click-rate" value={f ? pct(f.click_rate_pct) : "—"} />
                </div>
              </div>
            ))}
          </div>
          {gc && own && (
            <p className="ed-prose-italic mt-5" style={{ maxWidth: "72ch", fontSize: 13 }}>
              Grip Connect is {pct(gcShare)} of search volume, with a {pct(gc.zrr_pct)} zero-result rate
              vs {pct(own.zrr_pct)} on own platform
              {gcF && ownF ? ` and a ${pct(gcF.click_rate_pct)} click-rate vs ${pct(ownF.click_rate_pct)}` : ""}.
              See the Grip Connect section for the per-partner breakdown.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ── dedicated Grip Connect section ─────────────────────────────────────────── */
export default function AssetSearchGCSection({ data, loading, sectionNumber = "" }) {
  const overview = rowsOf(data, "gc_overview");
  const mix = rowsOf(data, "gc_mix");
  const funnel = rowsOf(data, "gc_funnel");
  const partners = rowsOf(data, "gc_partner");
  const terms = rowsOf(data, "gc_terms");

  const gc = segRow(overview, GC);
  const own = segRow(overview, OWN);
  const gcF = segRow(funnel, GC);
  const ownF = segRow(funnel, OWN);

  const mixSeries = useMixSeries(mix);
  const totalQueries = (Number(gc?.queries) || 0) + (Number(own?.queries) || 0);

  return (
    <section className="ed-set">
      <SectionHead
        number={sectionNumber}
        italic="Grip Connect"
        deck="Partner-distribution traffic inside search — its share of volume, the zero-result gap against own-platform users, and the per-partner picture. Split by gc_id, W4 (Apr 23) onward."
      />

      {/* headline numbers */}
      <div className="grid gap-x-8 gap-y-7 grid-cols-2 sm:grid-cols-4">
        <GcStat loading={loading} label="GC QUERY SHARE"
          value={gc ? pct(gc.query_share_pct) : "—"}
          hint={gc ? `${nf.format(gc.queries)} of ${nf.format(totalQueries)} queries` : ""} />
        <GcStat loading={loading} label="GC ZERO-RESULT RATE"
          value={gc ? pct(gc.zrr_pct) : "—"}
          valueColor={gc && gc.zrr_pct != null ? zrrInk(Number(gc.zrr_pct)) : undefined}
          hint={own ? `own platform ${pct(own.zrr_pct)}` : ""} />
        <GcStat loading={loading} label="GC CLICK-RATE"
          value={gcF ? pct(gcF.click_rate_pct) : "—"}
          hint={ownF ? `own platform ${pct(ownF.click_rate_pct)}` : ""} />
        <GcStat loading={loading} label="GC PARTNERS"
          value={partners.length ? nf.format(partners.length) : "—"}
          hint="distinct gc_name with search activity" />
      </div>
      <p className="ed-prose-italic mt-5" style={{ maxWidth: "72ch", fontSize: 13 }}>
        Grip Connect = search events stamped with a partner <span style={{ fontFamily: "var(--ed-mono)" }}>gc_id</span>;
        own platform = no gc_id. Available from feature-week W4 (Apr 23 2026) — W1–W3 predate the wide event
        export, so they are not split here.
      </p>

      {/* the two figures */}
      <div className="grid gap-10 lg:grid-cols-2 mt-10">
        <EdFigure label="FIG. 1" title="Query volume by segment & week"
          caption="Grip Connect vs own-platform queries each feature week."
          loading={loading} error={errOf(data, "gc_mix")} height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mixSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }} barGap={2}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="week" {...edAxisProps} />
              <YAxis {...edAxisProps} width={48} />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.04)" }} content={<EdTooltip valueFmt={(v) => nf.format(v)} />} />
              <Legend {...edLegendProps} />
              <Bar dataKey={GC} name="Grip Connect" fill={SEG_COLOR[GC]} maxBarSize={22} />
              <Bar dataKey={OWN} name="Own Platform" fill={SEG_COLOR[OWN]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </EdFigure>

        <EdFigure label="FIG. 2" title="Zero-result rate by segment & week"
          caption="Share of queries returning no results — Grip Connect vs own platform. The persistent gap is the core finding."
          loading={loading} error={errOf(data, "gc_mix")} height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mixSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...edGridProps} />
              <XAxis dataKey="week" {...edAxisProps} />
              <YAxis {...edAxisProps} width={44} unit="%" domain={[0, "dataMax + 8"]} />
              <Tooltip cursor={{ stroke: ED_INK_MUTED }} content={<EdTooltip valueFmt={(v) => `${v}%`} />} />
              <Legend {...edLegendProps} />
              <Line dataKey={`${GC} zrr`} name="Grip Connect" stroke={SEG_COLOR[GC]} strokeWidth={2.5}
                dot={{ r: 3, fill: SEG_COLOR[GC], strokeWidth: 0 }} activeDot={{ r: 5, stroke: ED_INK, strokeWidth: 1 }} />
              <Line dataKey={`${OWN} zrr`} name="Own Platform" stroke={SEG_COLOR[OWN]} strokeWidth={2.5}
                dot={{ r: 3, fill: SEG_COLOR[OWN], strokeWidth: 0 }} activeDot={{ r: 5, stroke: ED_INK, strokeWidth: 1 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </EdFigure>
      </div>

      {/* per-partner breakdown — a ruled ledger table, not cards */}
      <div className="mt-14">
        <p className="ed-caption mb-2">FIG. 3 — PER-PARTNER SEARCH HEALTH</p>
        <p className="ed-prose-italic mb-3" style={{ maxWidth: "66ch" }}>
          Each Grip Connect partner (<span style={{ fontFamily: "var(--ed-mono)" }}>gc_name</span>): query volume,
          distinct sessions, zero-result rate, and the share of sessions that clicked a result.
        </p>
        <hr className="ed-rule" />
        {loading ? (
          <p className="ed-prose-italic py-6">Setting type…</p>
        ) : errOf(data, "gc_partner") ? (
          <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>Could not load.</p>
        ) : partners.length === 0 ? (
          <p className="ed-prose-italic py-6">No partner-attributed search activity in the loaded weeks.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full ed-prose" style={{ fontSize: 14, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${ED_INK}` }}>
                  <th className="ed-caption text-left py-2">PARTNER</th>
                  <th className="ed-caption text-right py-2">QUERIES</th>
                  <th className="ed-caption text-right py-2">SESSIONS</th>
                  <th className="ed-caption text-right py-2">ZRR</th>
                  <th className="ed-caption text-right py-2">CLICK-RATE</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => {
                  const zr = Number(p.zrr_pct);
                  return (
                    <tr key={p.partner} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                      <td className="py-2.5" style={{ fontWeight: 500, color: ED_INK }}>{p.partner}</td>
                      <td className="py-2.5 text-right ed-num">{nf.format(p.queries)}</td>
                      <td className="py-2.5 text-right ed-num" style={{ color: ED_INK_MUTED }}>{nf.format(p.sessions)}</td>
                      <td className="py-2.5 text-right ed-num" style={{ color: zrrInk(zr), fontWeight: 600 }}>{p.zrr_pct}%</td>
                      <td className="py-2.5 text-right ed-num">{pct(p.click_rate_pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* what GC users search for */}
      <div className="mt-14">
        <p className="ed-caption mb-2">FIG. 4 — TOP GRIP CONNECT SEARCH TERMS</p>
        <p className="ed-prose-italic mb-3" style={{ maxWidth: "66ch" }}>
          Most-run query text within partner traffic, with its zero-result rate.
        </p>
        <hr className="ed-rule" />
        {loading ? (
          <p className="ed-prose-italic py-6">Setting type…</p>
        ) : errOf(data, "gc_terms") ? (
          <p className="ed-prose-italic py-6" style={{ color: ED_RUST }}>Could not load.</p>
        ) : terms.length === 0 ? (
          <p className="ed-prose-italic py-6">No partner search terms in the loaded weeks.</p>
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
              {terms.map((t) => {
                const zr = Number(t.zrr_pct);
                return (
                  <tr key={t.term} style={{ borderBottom: `1px solid ${ED_RULE_FAINT}` }}>
                    <td className="py-2" style={{ fontFamily: "var(--ed-mono)", color: ED_INK }}>{t.term}</td>
                    <td className="py-2 text-right ed-num">{nf.format(t.searches)}</td>
                    <td className="py-2 text-right ed-num" style={{ color: zrrInk(zr), fontWeight: 600 }}>{t.zrr_pct}%</td>
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
