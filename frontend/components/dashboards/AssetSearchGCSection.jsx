// AssetSearchGCSection
//
// Grip Connect vs own-platform views for the Asset Search dashboards, shared by
// both the Classic and Editorial renderings so the two stay at data parity.
//
// Every search event carries gc_id / gc_name (the global trackEvent stamp from
// gi-client-web): a row is "Grip Connect" when gc_id is set (a partner journey)
// and "Own Platform" when empty. The split is exact per row. gc_id / gc_name
// only exist from feature-week W4 (Apr 23) onward, so these views cover W4+;
// the parent gates rendering on Q.hasGcWeeks before mounting this section.
//
// Builders consumed (lib/queries/assetSearch.js): gcOverview, gcMixByWeek,
// gcFunnelBySegment, byPartner, topPartnerTerms — keyed gc_overview / gc_mix /
// gc_funnel / gc_partner / gc_terms in the dashboard data map.

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { color, zrrColor, zrrBg } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge, Stat, StatStrip, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";

const nf = new Intl.NumberFormat("en-IN");
const pct = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${v}%`);
const rowsOf = (data, key) => (data && data[key] && data[key].rows) || [];
const errOf = (data, key) => (data && data[key] && data[key].error) || null;

// Stable segment colours used across every GC chart: own platform = navy,
// Grip Connect = teal. Kept here so both dashboards read identically.
const SEG_COLOR = { "Own Platform": color.navy[400], "Grip Connect": color.teal[500] };
const OWN = "Own Platform";
const GC = "Grip Connect";

const legendProps = {
  verticalAlign: "top", align: "left", height: 28, iconType: "circle", iconSize: 8,
  wrapperStyle: { paddingBottom: 6, fontSize: 12, color: "var(--gi-text-tertiary)" },
};

function segRow(rows, segment) {
  return rows.find((r) => r.segment === segment) || null;
}

/* ── compact GC-vs-own card, embedded on Overview / Conversion ─────────────── */
// Makes the GC split visible on the main screens (the "any number is readable
// as GC vs own" ask) without modifying the existing all-traffic cards.
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
    <Card pad="md">
      <CardHeader>
        <div>
          <CardTitle>Grip Connect vs own platform</CardTitle>
          <CardSubtitle>
            Search traffic split by <code className="font-mono">gc_id</code> — partner journeys vs own-platform users.
            {note ? ` ${note}` : ""} W4 (Apr 23) onward.
          </CardSubtitle>
        </div>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-16" /></div>
            ))}
          </div>
        ) : err || !gc ? (
          <p className="t-body-sm text-tertiary">Could not load the GC split.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {[{ s: GC, o: gc, f: gcF }, { s: OWN, o: own, f: ownF }].map(({ s, o, f }) => (
                <div key={s} className="rounded-lg border border-border-default p-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SEG_COLOR[s] }} />
                    <span className="t-emphasis-md text-body">{s}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Stat label="Queries" value={o ? nf.format(o.queries) : "—"} hint={o ? `${o.query_share_pct}% share` : ""} />
                    <Stat label="Zero-result" value={o ? pct(o.zrr_pct) : "—"}
                      valueColor={o && o.zrr_pct != null ? zrrColor(Number(o.zrr_pct)) : undefined} />
                    <Stat label="Click-rate" value={f ? pct(f.click_rate_pct) : "—"} />
                  </div>
                </div>
              ))}
            </div>
            {gc && own && (
              <p className="mt-3 t-body-xs text-tertiary">
                Grip Connect is {pct(gcShare)} of search volume, with a {pct(gc.zrr_pct)} zero-result rate
                vs {pct(own.zrr_pct)} on own platform
                {gcF && ownF ? ` and a ${pct(gcF.click_rate_pct)} click-rate vs ${pct(ownF.click_rate_pct)}` : ""}.
                See the Grip Connect tab for the per-partner breakdown.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ── dedicated Grip Connect tab content ────────────────────────────────────── */
export default function AssetSearchGCSection({ data, loading }) {
  const overview = rowsOf(data, "gc_overview");
  const mix = rowsOf(data, "gc_mix");
  const funnel = rowsOf(data, "gc_funnel");
  const partners = rowsOf(data, "gc_partner");
  const terms = rowsOf(data, "gc_terms");

  const gc = segRow(overview, GC);
  const own = segRow(overview, OWN);
  const gcF = segRow(funnel, GC);
  const ownF = segRow(funnel, OWN);

  // pivot the per-week long rows into one row per week for the charts
  const mixSeries = React.useMemo(() => {
    const byWeek = {};
    for (const r of mix) {
      const w = (byWeek[r.week] ||= { week: r.week });
      w[r.segment] = Number(r.queries);
      w[`${r.segment} zrr`] = Number(r.zrr_pct);
    }
    return Object.values(byWeek).sort((a, b) => Number(a.week.slice(1)) - Number(b.week.slice(1)));
  }, [mix]);

  const maxPartnerQ = Math.max(1, ...partners.map((p) => Number(p.queries) || 0));

  return (
    <div className="flex flex-col gap-6">
      {/* headline split */}
      <Card pad="lg">
        {loading ? (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-16" /></div>
            ))}
          </div>
        ) : (
          <>
            <StatStrip>
              <Stat label="GC query share" value={gc ? pct(gc.query_share_pct) : "—"}
                hint={gc ? `${nf.format(gc.queries)} of ${nf.format((Number(gc?.queries) || 0) + (Number(own?.queries) || 0))} queries` : ""} />
              <Stat label="GC zero-result rate" value={gc ? pct(gc.zrr_pct) : "—"}
                valueColor={gc && gc.zrr_pct != null ? zrrColor(Number(gc.zrr_pct)) : undefined}
                hint={own ? `own platform ${pct(own.zrr_pct)}` : ""} />
              <Stat label="GC click-rate" value={gcF ? pct(gcF.click_rate_pct) : "—"}
                hint={ownF ? `own platform ${pct(ownF.click_rate_pct)}` : ""} />
              <Stat label="GC partners" value={partners.length ? nf.format(partners.length) : "—"}
                hint="distinct gc_name with search activity" />
            </StatStrip>
            <p className="mt-4 t-body-xs text-tertiary">
              Grip Connect = search events stamped with a partner <code className="font-mono">gc_id</code>; own platform = no gc_id.
              Available from feature-week W4 (Apr 23 2026) — W1–W3 predate the wide event export, so they are not split here.
            </p>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Query volume by segment & week"
          subtitle="Grouped bars: queries from Grip Connect vs own-platform sessions each feature week."
          loading={loading} error={errOf(data, "gc_mix")} height={280}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mixSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }} barGap={2}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="week" {...axisProps} />
              <YAxis {...axisProps} width={48} />
              <Tooltip cursor={{ fill: color.neutral[100] }} content={<TooltipBox valueFmt={(v) => nf.format(v)} />} />
              <Legend {...legendProps} />
              <Bar dataKey={GC} name="Grip Connect" fill={SEG_COLOR[GC]} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey={OWN} name="Own Platform" fill={SEG_COLOR[OWN]} radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Zero-result rate by segment & week"
          subtitle="Lines: % of queries returning no results, Grip Connect vs own platform. The persistent gap is the core finding."
          loading={loading} error={errOf(data, "gc_mix")} height={280}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mixSeries} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="week" {...axisProps} />
              <YAxis {...axisProps} width={44} unit="%" domain={[0, "dataMax + 8"]} />
              <Tooltip cursor={{ stroke: color.neutral[300] }} content={<TooltipBox valueFmt={(v) => `${v}%`} />} />
              <Legend {...legendProps} />
              <Line dataKey={`${GC} zrr`} name="Grip Connect" stroke={SEG_COLOR[GC]} strokeWidth={2.5}
                dot={{ r: 3, fill: SEG_COLOR[GC], strokeWidth: 0 }} activeDot={{ r: 5 }} />
              <Line dataKey={`${OWN} zrr`} name="Own Platform" stroke={SEG_COLOR[OWN]} strokeWidth={2.5}
                dot={{ r: 3, fill: SEG_COLOR[OWN], strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* per-partner breakdown — the dedicated GC drill-down */}
      <Card pad="md">
        <CardHeader>
          <div>
            <CardTitle>Per-partner search health</CardTitle>
            <CardSubtitle>
              Each Grip Connect partner (<code className="font-mono">gc_name</code>): query volume, distinct sessions,
              zero-result rate and the share of sessions that clicked a result.
            </CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : errOf(data, "gc_partner") ? (
            <p className="t-body-sm text-tertiary">Could not load.</p>
          ) : partners.length === 0 ? (
            <p className="t-body-sm text-tertiary">No partner-attributed search activity in the loaded weeks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="t-body-xs text-tertiary text-left border-b border-border-default">
                    <th className="py-2 pr-3 font-medium">Partner</th>
                    <th className="py-2 px-2 font-medium text-right">Queries</th>
                    <th className="py-2 px-2 font-medium text-right">Sessions</th>
                    <th className="py-2 px-2 font-medium text-right">ZRR</th>
                    <th className="py-2 pl-2 font-medium text-right">Click-rate</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => {
                    const w = Math.max(4, Math.round((100 * Number(p.queries)) / maxPartnerQ));
                    return (
                      <tr key={p.partner} className="border-b border-border-subtle last:border-0">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="t-emphasis-sm text-body truncate max-w-[12rem]">{p.partner}</span>
                          </div>
                          <span className="relative mt-1 block h-1.5 w-full max-w-[10rem] rounded-full bg-muted">
                            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: SEG_COLOR[GC] }} />
                          </span>
                        </td>
                        <td className="py-2 px-2 t-body-sm t-num text-secondary text-right">{nf.format(p.queries)}</td>
                        <td className="py-2 px-2 t-body-sm t-num text-secondary text-right">{nf.format(p.sessions)}</td>
                        <td className="py-2 px-2 text-right">
                          <Badge tone="neutral" variant="soft" className="justify-center"
                            style={{ background: zrrBg(Number(p.zrr_pct)), color: zrrColor(Number(p.zrr_pct)) }}>
                            {p.zrr_pct}%
                          </Badge>
                        </td>
                        <td className="py-2 pl-2 t-body-sm t-num text-secondary text-right">{pct(p.click_rate_pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* what GC users search for */}
      <Card pad="md">
        <CardHeader>
          <div>
            <CardTitle>Top Grip Connect search terms</CardTitle>
            <CardSubtitle>Most-run query text within partner traffic, with its zero-result rate.</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
          ) : errOf(data, "gc_terms") ? (
            <p className="t-body-sm text-tertiary">Could not load.</p>
          ) : terms.length === 0 ? (
            <p className="t-body-sm text-tertiary">No partner search terms in the loaded weeks.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {terms.map((t) => (
                <li key={t.term} className="flex items-center gap-3 py-2">
                  <span className="t-emphasis-sm text-body flex-1 truncate font-mono">{t.term}</span>
                  <span className="t-body-sm t-num text-secondary w-14 text-right shrink-0">{nf.format(t.searches)}</span>
                  <Badge tone="neutral" variant="soft" className="w-12 justify-center shrink-0"
                    style={{ background: zrrBg(Number(t.zrr_pct)), color: zrrColor(Number(t.zrr_pct)) }}>
                    {t.zrr_pct}%
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
