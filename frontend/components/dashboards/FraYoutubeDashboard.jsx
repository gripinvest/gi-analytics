"use client";
// FraYoutubeDashboard — classic-theme rendering of the FRA YouTube project.
// ─────────────────────────────────────────────────────────────────────────
// A single-scroll analytics report in the platform's classic idiom: white
// Cards on a light page, Inter type, IBM Plex Mono numerals, navy/teal
// Recharts. No tabs — nine numbered sections run top to bottom, content-par
// with the editorial rendering (FraYoutubeDashboardEditorial).
//
// SQL specs + the data hook are shared from lib/queries/fraYoutube.js so the
// two themes query one source of truth.

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart,
  Area, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { fetchFraInsights } from "@/lib/api";
import { useFraYoutube, rowsOf, errOf, computeTrend } from "@/lib/queries/fraYoutube";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";

/* ── number / date helpers ──────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("en-IN");
const fmt = (v) => (v == null || v === "" ? "—" : nf.format(Number(v)));

/** Coerce to a finite number, or null — keeps a missing value out of charts
    rather than letting it land as a misleading real zero. */
const toNum = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
const pct = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`;

/** Compact Indian-system axis labels: 12.3K, 4.5L, 1.2Cr. */
const compact = (v) => {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return nf.format(n);
};

/** "2025-07" → "Jul ’25". */
const fmtMonth = (s) => {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return String(s ?? "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : `${d.toLocaleDateString("en-IN", { month: "short" })} ’${m[1].slice(2)}`;
};

/** Average duration in seconds → "Xm Ys". */
const fmtDuration = (sec) => {
  if (sec == null || sec === "" || Number.isNaN(Number(sec))) return "—";
  const total = Number(sec);
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
};

/* ── section heading ────────────────────────────────────────────────────────
   The single-scroll replacement for the old tab bar: a hairline rule, a
   numbered overline, a display title and a one-line deck. */
function SectionHeading({ index, title, deck }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border-default pt-6">
      <span className="t-overline text-tertiary">
        Section {String(index).padStart(2, "0")}
      </span>
      <h2 className="t-display-md text-heading">{title}</h2>
      {deck && <p className="t-body-sm text-tertiary max-w-2xl">{deck}</p>}
    </div>
  );
}

/* A section = heading + its card(s), with consistent vertical rhythm. */
function Section({ index, title, deck, children }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading index={index} title={title} deck={deck} />
      {children}
    </section>
  );
}

/* ── small parts ────────────────────────────────────────────────────────── */

/* Skeleton stand-in for a StatStrip while the queries resolve. */
function StatStripSkeleton({ count = 4 }) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/* A thin inline magnitude bar — used in the title-patterns ledger. */
function MiniBar({ value, max }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-200">
      <div
        className="h-full rounded-full bg-navy-300"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/* A delta chip — success ▲ / error ▼ against the snapshot. Used for the
   Catalog-health freshness delta. */
function DeltaChip({ delta, goodIsUp = true, suffix = "" }) {
  if (delta == null || delta === "" || Number.isNaN(Number(delta))) return null;
  const d = Number(delta);
  if (d === 0) return <span className="t-emphasis-sm text-tertiary">±0{suffix}</span>;
  const good = goodIsUp ? d > 0 : d < 0;
  return (
    <Badge tone={good ? "success" : "error"} variant="soft" className="gap-0.5">
      <span aria-hidden>{d > 0 ? "▲" : "▼"}</span> {fmt(Math.abs(d))}{suffix}
    </Badge>
  );
}

/* Per-field formatters for delta magnitudes. */
const deltaFmt = {
  int: (v) => fmt(v),
  dec1: (v) => Number(v).toFixed(1),
  dec2: (v) => Number(v).toFixed(2),
  secs: (v) => `${Math.round(Number(v))}s`,
};

/* One line of a delta block: an arrow + magnitude in success/error/neutral,
   then the muted window caption. A null delta (window not deep enough yet)
   shows an em-dash so the caption still names the window that is coming. */
function DeltaLine({ delta, label, format = fmt, goodIsUp = true }) {
  if (delta == null) {
    return <span className="t-body-xs text-tertiary whitespace-nowrap">— {label}</span>;
  }
  const d = Number(delta);
  const sign = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  const tone =
    d === 0 || goodIsUp == null
      ? "text-tertiary"
      : (goodIsUp ? d > 0 : d < 0)
        ? "text-success-700"
        : "text-error-600";
  return (
    <span className={`t-body-xs whitespace-nowrap ${tone}`}>
      <span aria-hidden>{sign}</span> {d === 0 ? "0" : format(Math.abs(d))}{" "}
      <span className="text-tertiary">{label}</span>
    </span>
  );
}

/* The "At a glance" delta block — day-over-day and week-over-week stacked, the
   week line populating once the snapshot history is a week deep. */
function DualDelta({ trend, field, format, goodIsUp = true }) {
  if (!trend) return null;
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      <DeltaLine
        delta={trend.day?.deltas?.[field]}
        label={trend.day?.label || "vs yesterday"}
        format={format}
        goodIsUp={goodIsUp}
      />
      <DeltaLine
        delta={trend.week?.deltas?.[field]}
        label={trend.week?.label || "vs last week"}
        format={format}
        goodIsUp={goodIsUp}
      />
    </div>
  );
}

/* The discovery verdict — a one-glance read of the breakout rate. */
function discoveryVerdictBadge(row) {
  if (!row) return <Badge tone="neutral">no data</Badge>;
  const recentCount = Number(row.recent_video_count ?? 0);
  const rate = Number(row.breakout_1k_rate ?? 0);
  if (recentCount === 0) return <Badge tone="neutral">no recent uploads</Badge>;
  if (rate < 0.25) return <Badge tone="error">discovery crisis</Badge>;
  if (rate < 0.6) return <Badge tone="warning">needs improvement</Badge>;
  return <Badge tone="success">healthy discovery</Badge>;
}

/* ── AI insights hook ───────────────────────────────────────────────────────
   The endpoint can return its fallback payload alongside an `error` string —
   surface it rather than swallowing it (matches the editorial rendering). */
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

/* ── view-distribution buckets (§ Discovery histogram) ──────────────────────
   Bucketed client-side from raw per-video view counts — /query is SELECT-only
   so the bucketing cannot be a backend job. */
const VIEW_BUCKETS = [
  { label: "0–99",    min: 0,     max: 100 },
  { label: "100–499", min: 100,   max: 500 },
  { label: "500–999", min: 500,   max: 1000 },
  { label: "1K–4.9K", min: 1000,  max: 5000 },
  { label: "5K–9.9K", min: 5000,  max: 10000 },
  { label: "10K–49K", min: 10000, max: 50000 },
  { label: "50K+",    min: 50000, max: Infinity },
];

function bucketViews(videoViewsRows) {
  if (!videoViewsRows || videoViewsRows.length === 0) return [];
  const counts = VIEW_BUCKETS.map((b) => ({ bucket: b.label, count: 0 }));
  for (const row of videoViewsRows) {
    const v = Number(row.views) || 0;
    for (let i = 0; i < VIEW_BUCKETS.length; i++) {
      if (v >= VIEW_BUCKETS[i].min && v < VIEW_BUCKETS[i].max) {
        counts[i].count++;
        break;
      }
    }
  }
  return counts;
}

/* ── main component ─────────────────────────────────────────────────────── */

export default function FraYoutubeDashboard({ project }) {
  const { loading, error, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();

  /* row extraction — every key is { rows } | { error } */
  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;

  /* Hard empty state — no snapshot has been crawled yet. */
  if (!loading && overviewRows.length === 0 && !errOf(data, "overview")) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-secondary">
          No snapshots yet — the first daily refresh has not run. The report
          fills in once the FRA channel has been crawled.
        </p>
      </Card>
    );
  }

  /* Fatal — the data hook only sets a top-level error when EVERY query
     failed; one bad table is handled per-section. */
  if (error && !overview && !loading) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-error-600">
          Could not load the dashboard — {error}
        </p>
      </Card>
    );
  }

  const snapshotDate = overview?.snapshot_date ?? "—";
  const distRow = rowsOf(data, "distribution")[0] || null;
  const catalogRow = rowsOf(data, "catalogHealth")[0] || null;
  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyRows = rowsOf(data, "monthlyViews");
  const cumulativeRows = rowsOf(data, "cumulativeViews");
  const categoryRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceDayRows = rowsOf(data, "cadenceDay");
  const cadenceHourRows = rowsOf(data, "cadenceHour");
  const titleRows = rowsOf(data, "titlePatterns");
  const videoViewsRows = rowsOf(data, "videoViews");

  // Day- and week-over-week trend from the overview history — see computeTrend.
  const trend = computeTrend(overviewRows);

  /* ── chart-ready series ─────────────────────────────────────────────────*/

  // Growth — cumulative library views (running sum) + monthly views, plus the
  // real channel-snapshots trend mapped onto the same month axis.
  const growthSeries = cumulativeRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: Number(r.total_views) || 0,
    cumulative: Number(r.cumulative_views) || 0,
  }));
  const channelByMonth = {};
  for (const r of channelSnapshotRows) {
    const m = String(r.snapshot_date ?? "").slice(0, 7);
    if (m) channelByMonth[m] = Number(r.total_views) || 0;
  }
  const growthWithReal = growthSeries.map((d) => ({
    ...d,
    real: channelByMonth[d.month] != null ? channelByMonth[d.month] : null,
  }));
  const hasRealTrend = Object.keys(channelByMonth).length > 0;

  // Monthly bars — driven by the monthlyViews query, so its ChartCard error
  // state and its data come from one source. A missing total stays null
  // (no bar) rather than a misleading zero-height bar.
  const monthlySeries = monthlyRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    monthly: toNum(r.total_views),
  }));

  // Discovery — view-distribution histogram.
  const distBuckets = bucketViews(videoViewsRows);

  // Content fit — diverging bars: each category's performance vs channel mean.
  // A category with no vs-mean figure stays null (no bar), not plotted on 0%.
  const contentSeries = categoryRows.map((r) => ({
    category: r.category,
    perf: toNum(r.perf_vs_mean_pct),
  }));

  // Engagement — each category's engagement rate as a distance from the
  // channel mean (diverging bars). Categories with no rate are dropped so a
  // missing value does not get folded into the mean as a zero.
  const engRaw = engagementRows
    .map((r) => ({ bucket: r.bucket, rate: toNum(r.engagement_rate_pct) }))
    .filter((r) => r.rate != null);
  const engMean =
    engRaw.length > 0 ? engRaw.reduce((a, r) => a + r.rate, 0) / engRaw.length : 0;
  const engagementSeries = engRaw
    .map((r) => ({ ...r, diff: Math.round((r.rate - engMean) * 100) / 100 }))
    .sort((a, b) => b.diff - a.diff);

  // Cadence — avg views by IST posting day / hour. A slot with no data stays
  // null (no bar) rather than reading as a real zero-views slot.
  const cadenceDaySeries = cadenceDayRows.map((r) => ({
    bucket: r.bucket,
    avg_views: toNum(r.avg_views),
  }));
  const cadenceHourSeries = cadenceHourRows.map((r) => ({
    bucket: r.bucket,
    avg_views: toNum(r.avg_views),
  }));

  // Titles — patterns ranked by avg views.
  const titleMax = titleRows.reduce((m, r) => Math.max(m, Number(r.avg_views) || 0), 0);

  return (
    <div className="flex flex-col gap-10">

      {/* ════════ MASTHEAD ══════════════════════════════════════════════════ */}
      <Card pad="lg">
        <CardHeader>
          <div>
            <CardTitle>
              {overview?.channel_name || "FRA YouTube"}
            </CardTitle>
            <CardSubtitle>
              {overview?.channel_handle ? `${overview.channel_handle} · ` : ""}
              channel health · as of {snapshotDate}
            </CardSubtitle>
          </div>
          {!loading && distRow && discoveryVerdictBadge(distRow)}
        </CardHeader>
        <CardBody>
          {loading ? (
            <StatStripSkeleton count={4} />
          ) : (
            <StatStrip>
              <Stat
                label="Subscribers"
                value={overview ? fmt(overview.subscribers) : "—"}
              />
              <Stat
                label="Total views"
                value={overview ? fmt(overview.total_views) : "—"}
              />
              <Stat label="Videos" value={overview ? fmt(overview.video_count) : "—"} />
              <Stat
                label="Avg views / video"
                value={overview ? fmt(overview.avg_views) : "—"}
              />
            </StatStrip>
          )}
        </CardBody>
      </Card>

      {/* ════════ 01 · AT A GLANCE ══════════════════════════════════════════ */}
      <Section
        index={1}
        title="At a glance"
        deck="The channel in seven figures — reach, library size and pacing — with the week-on-week tick where the snapshot delta is known."
      >
        <Card pad="md">
          {loading ? (
            <StatStripSkeleton count={7} />
          ) : errOf(data, "overview") ? (
            <p className="t-body-sm text-error-600">Could not load this section.</p>
          ) : (
            <StatStrip>
              <Stat
                label="Subscribers"
                value={overview ? fmt(overview.subscribers) : "—"}
                delta={<DualDelta trend={trend} field="subscribers" format={deltaFmt.int} />}
              />
              <Stat
                label="Total views"
                value={overview ? fmt(overview.total_views) : "—"}
                delta={<DualDelta trend={trend} field="total_views" format={deltaFmt.int} />}
              />
              <Stat
                label="Videos"
                value={overview ? fmt(overview.video_count) : "—"}
                delta={<DualDelta trend={trend} field="video_count" format={deltaFmt.int} />}
              />
              <Stat
                label="Avg views / video"
                value={overview ? fmt(overview.avg_views) : "—"}
                delta={<DualDelta trend={trend} field="avg_views" format={deltaFmt.dec1} />}
              />
              <Stat
                label="Median views / video"
                value={overview?.median_views != null ? fmt(overview.median_views) : "—"}
                delta={<DualDelta trend={trend} field="median_views" format={deltaFmt.dec1} />}
              />
              <Stat
                label="Avg duration"
                value={fmtDuration(overview?.avg_duration_sec)}
                delta={
                  <DualDelta
                    trend={trend}
                    field="avg_duration_sec"
                    format={deltaFmt.secs}
                    goodIsUp={null}
                  />
                }
              />
              <Stat
                label="Subscriber efficiency"
                value={
                  catalogRow?.subscriber_efficiency != null
                    ? Number(catalogRow.subscriber_efficiency).toFixed(2)
                    : "—"
                }
                delta={<DualDelta trend={trend} field="subscriber_efficiency" format={deltaFmt.dec2} />}
              />
            </StatStrip>
          )}
        </Card>
      </Section>

      {/* ════════ 02 · DISCOVERY ════════════════════════════════════════════ */}
      <Section
        index={2}
        title="Discovery"
        deck="Of the videos the channel ships, what share break through — a breakout clears one thousand views — and how views concentrate across the library."
      >
        <Card pad="md">
          <CardHeader>
            <div>
              <CardTitle>Breakout health</CardTitle>
              <CardSubtitle>Share of recent videos crossing key view thresholds</CardSubtitle>
            </div>
            {!loading && !errOf(data, "distribution") && discoveryVerdictBadge(distRow)}
          </CardHeader>
          <CardBody>
            {loading ? (
              <StatStripSkeleton count={5} />
            ) : errOf(data, "distribution") ? (
              <p className="t-body-sm text-error-600">Could not load this section.</p>
            ) : distRow ? (
              <div className="flex flex-col gap-5">
                <div className="t-display-md t-num text-heading">
                  {distRow.breakout_1k_rate != null
                    ? `${(Number(distRow.breakout_1k_rate) * 100).toFixed(1)}%`
                    : "—"}
                  <span className="ml-2 t-body-sm text-tertiary font-normal">
                    breakout ≥1K rate — the north star
                  </span>
                </div>
                <StatStrip>
                  <Stat label="Videos ≥ 1K views" value={fmt(distRow.videos_ge_1k)} />
                  <Stat label="Videos ≥ 10K views" value={fmt(distRow.videos_ge_10k)} />
                  <Stat label="Videos ≥ 100K views" value={fmt(distRow.videos_ge_100k)} />
                  <Stat
                    label="Gini coefficient"
                    value={distRow.gini != null ? Number(distRow.gini).toFixed(3) : "—"}
                    hint="0 even · 1 concentrated"
                  />
                  <Stat label="Recent video count" value={fmt(distRow.recent_video_count)} />
                </StatStrip>
              </div>
            ) : (
              <p className="t-body-sm text-tertiary">No distribution data for the current snapshot.</p>
            )}
          </CardBody>
        </Card>

        <ChartCard
          title="How views concentrate across the library"
          subtitle="Videos bucketed by lifetime views — a tall left side and thin right tail is the classic concentration story."
          loading={loading}
          error={errOf(data, "videoViews")}
          height={260}
          footer={
            distRow?.gini != null
              ? `Gini coefficient ${Number(distRow.gini).toFixed(3)} — 0 is perfectly even, 1 is one video taking everything.`
              : undefined
          }
        >
          {distBuckets.length === 0 ? (
            <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
              No per-video view data for this snapshot.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distBuckets} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bucket" {...axisProps} />
                <YAxis {...axisProps} width={48} tickFormatter={compact} />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v) => `${fmt(v)} videos`} />}
                />
                <Bar
                  dataKey="count"
                  name="Videos"
                  fill={chartPalette[0]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={64}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Section>

      {/* ════════ 03 · GROWTH ═══════════════════════════════════════════════ */}
      <Section
        index={3}
        title="Growth"
        deck="How the library has accumulated views over its lifetime, and how each calendar month has contributed."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Cumulative library views"
            subtitle="A running sum of monthly views — the shape of accumulated reach."
            loading={loading}
            error={errOf(data, "cumulativeViews")}
            height={280}
            footer={
              "Honest caveat — this is the cumulative views of videos published through each month, " +
              "a library-accumulation proxy, not the channel's true total on that date (older videos keep " +
              "accruing). The real channel-snapshots trend (gold) holds one point today and grows daily."
            }
          >
            {growthSeries.length === 0 ? (
              <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
                No monthly history for this snapshot.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={growthWithReal} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="fraClassicGrowth" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartPalette[0]} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={chartPalette[0]} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
                  <YAxis {...axisProps} width={52} tickFormatter={compact} />
                  <Tooltip
                    cursor={{ stroke: color.neutral[300] }}
                    content={<TooltipBox labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative views"
                    stroke={chartPalette[0]}
                    strokeWidth={2.5}
                    fill="url(#fraClassicGrowth)"
                  />
                  {hasRealTrend && (
                    <Line
                      type="monotone"
                      dataKey="real"
                      name="Channel snapshot (real)"
                      stroke={color.teal[600]}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={{ r: 3, fill: color.teal[600] }}
                      connectNulls
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Views by calendar month"
            subtitle="Total views attributed to videos published in each month."
            loading={loading}
            error={errOf(data, "monthlyViews")}
            height={280}
          >
            {monthlySeries.length === 0 ? (
              <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
                No monthly views for this snapshot.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
                  <YAxis {...axisProps} width={52} tickFormatter={compact} />
                  <Tooltip
                    cursor={{ fill: color.neutral[100] }}
                    content={<TooltipBox labelFmt={fmtMonth} valueFmt={(v) => fmt(v)} />}
                  />
                  <Bar
                    dataKey="monthly"
                    name="Monthly views"
                    fill={chartPalette[0]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </Section>

      {/* ════════ 04 · CONTENT FIT ══════════════════════════════════════════ */}
      <Section
        index={4}
        title="Content fit"
        deck="Every content category measured against the channel average — the most-produced is rarely the best-performing."
      >
        <ChartCard
          title="Category performance vs channel mean"
          subtitle="Each bar is a category's average views as a percentage above or below the channel mean."
          loading={loading}
          error={errOf(data, "categoryMix")}
          height={Math.max(220, contentSeries.length * 38 + 48)}
        >
          {contentSeries.length === 0 ? (
            <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
              No category mix for this snapshot.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={contentSeries}
                margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
              >
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis
                  type="number"
                  {...axisProps}
                  tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                />
                <YAxis type="category" dataKey="category" {...axisProps} width={120} />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`} />}
                />
                <ReferenceLine x={0} stroke={color.neutral[400]} strokeWidth={1.5} />
                <Bar dataKey="perf" name="vs mean" maxBarSize={22} radius={[2, 2, 2, 2]}>
                  {contentSeries.map((d, i) => (
                    <Cell key={i} fill={d.perf >= 0 ? color.success[500] : color.error[400]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Card pad="md">
          <CardHeader>
            <CardTitle>The category ledger</CardTitle>
            <CardSubtitle>Sorted by performance vs channel average</CardSubtitle>
          </CardHeader>
          <CardBody>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : errOf(data, "categoryMix") ? (
              <p className="t-body-sm text-error-600">Could not load this section.</p>
            ) : categoryRows.length === 0 ? (
              <p className="t-body-sm text-tertiary">No category mix data.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="py-2 pr-4 text-left t-overline text-tertiary">Category</th>
                      <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                      <th className="py-2 pr-4 text-right t-overline text-tertiary">Avg views</th>
                      <th className="py-2 text-right t-overline text-tertiary">vs mean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryRows.map((r, i) => {
                      const perf = r.perf_vs_mean_pct != null ? Number(r.perf_vs_mean_pct) : null;
                      return (
                        <tr key={i} className="border-b border-border-default last:border-0">
                          <td className="py-2 pr-4 text-body">{r.category}</td>
                          <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.video_count)}</td>
                          <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.avg_views)}</td>
                          <td className="py-2 text-right">
                            {perf == null ? (
                              <span className="t-num text-tertiary">—</span>
                            ) : (
                              <Badge tone={perf >= 0 ? "success" : "error"} variant="soft">
                                {perf >= 0 ? "+" : ""}{perf.toFixed(1)}%
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </Section>

      {/* ════════ 05 · ENGAGEMENT ═══════════════════════════════════════════ */}
      <Section
        index={5}
        title="Engagement"
        deck="Engagement rate — likes plus comments over views — read against the channel mean. Bars right of the line beat the average; bars left drag it down."
      >
        <ChartCard
          title="Engagement rate vs channel mean, by category"
          subtitle={`The dividing line is the channel mean, ${engMean ? engMean.toFixed(2) : "—"}%. Each bar is a category's distance from it.`}
          loading={loading}
          error={errOf(data, "engagement")}
          height={Math.max(220, engagementSeries.length * 40 + 48)}
        >
          {engagementSeries.length === 0 ? (
            <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
              No engagement data for this snapshot.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={engagementSeries}
                margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
              >
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis
                  type="number"
                  {...axisProps}
                  tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
                />
                <YAxis type="category" dataKey="bucket" {...axisProps} width={120} />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(2)} pt`} />}
                />
                <ReferenceLine x={0} stroke={color.neutral[400]} strokeWidth={1.5} />
                <Bar dataKey="diff" name="vs mean" maxBarSize={24} radius={[2, 2, 2, 2]}>
                  {engagementSeries.map((d, i) => (
                    <Cell key={i} fill={d.diff >= 0 ? color.success[500] : color.error[400]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Section>

      {/* ════════ 06 · CADENCE ══════════════════════════════════════════════ */}
      <Section
        index={6}
        title="Cadence"
        deck="When the channel posts, in India Standard Time, and how those choices have performed on average."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Avg views by posting day"
            subtitle="Mean views for videos published on each weekday (IST)."
            loading={loading}
            error={errOf(data, "cadenceDay")}
            height={260}
          >
            {cadenceDaySeries.length === 0 ? (
              <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
                No posting-day data for this snapshot.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cadenceDaySeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="bucket" {...axisProps} />
                  <YAxis {...axisProps} width={52} tickFormatter={compact} />
                  <Tooltip
                    cursor={{ fill: color.neutral[100] }}
                    content={<TooltipBox valueFmt={(v) => fmt(v)} />}
                  />
                  <Bar
                    dataKey="avg_views"
                    name="Avg views"
                    fill={chartPalette[0]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Avg views by posting hour"
            subtitle="Mean views by hour of day (IST) — the windows the channel has reached for."
            loading={loading}
            error={errOf(data, "cadenceHour")}
            height={260}
          >
            {cadenceHourSeries.length === 0 ? (
              <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
                No posting-hour data for this snapshot.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cadenceHourSeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="bucket" {...axisProps} interval="preserveStartEnd" />
                  <YAxis {...axisProps} width={52} tickFormatter={compact} />
                  <Tooltip
                    cursor={{ fill: color.neutral[100] }}
                    content={<TooltipBox valueFmt={(v) => fmt(v)} />}
                  />
                  <Bar
                    dataKey="avg_views"
                    name="Avg views"
                    fill={chartPalette[1]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </Section>

      {/* ════════ 07 · TITLES & SEO ═════════════════════════════════════════ */}
      <Section
        index={7}
        title="Titles & SEO"
        deck="Recurring structural patterns in the channel's video titles, ranked by the average views the videos carrying them earned."
      >
        <Card pad="md">
          <CardHeader>
            <CardTitle>Title patterns</CardTitle>
            <CardSubtitle>Sorted by average views per video</CardSubtitle>
          </CardHeader>
          <CardBody>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : errOf(data, "titlePatterns") ? (
              <p className="t-body-sm text-error-600">Could not load this section.</p>
            ) : titleRows.length === 0 ? (
              <p className="t-body-sm text-tertiary">No title-pattern data.</p>
            ) : (
              <ul className="divide-y divide-border-default">
                {titleRows.map((r, i) => (
                  <li key={i} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-body truncate">{r.pattern}</span>
                        <span className="t-num text-heading t-emphasis-sm shrink-0">
                          {fmt(r.avg_views)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <MiniBar value={Number(r.avg_views) || 0} max={titleMax} />
                        <span className="t-body-xs text-tertiary shrink-0">
                          {fmt(r.video_count)} videos
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>

      {/* ════════ 08 · CATALOG HEALTH ═══════════════════════════════════════ */}
      <Section
        index={8}
        title="Catalog health"
        deck="Whether the channel's recent work is keeping pace with its back catalogue — the last thirty days against the lifetime average."
      >
        <Card pad="md">
          {loading ? (
            <StatStripSkeleton count={4} />
          ) : errOf(data, "catalogHealth") ? (
            <p className="t-body-sm text-error-600">Could not load this section.</p>
          ) : catalogRow ? (
            <StatStrip>
              <Stat
                label="Recent avg views"
                value={fmt(catalogRow.recent_avg_views)}
                hint="videos from the last 30 days"
              />
              <Stat
                label="All-time avg views"
                value={fmt(catalogRow.alltime_avg_views)}
                hint="the lifetime mean"
              />
              <Stat
                label="Freshness delta"
                value={pct(catalogRow.freshness_delta_pct)}
                delta={
                  catalogRow.freshness_delta_pct != null ? (
                    <DeltaChip delta={catalogRow.freshness_delta_pct} goodIsUp suffix="%" />
                  ) : undefined
                }
                hint="recent vs all-time"
              />
              <Stat
                label="Subscriber efficiency"
                value={
                  catalogRow.subscriber_efficiency != null
                    ? Number(catalogRow.subscriber_efficiency).toFixed(3)
                    : "—"
                }
                hint="total views ÷ subscribers"
              />
            </StatStrip>
          ) : (
            <p className="t-body-sm text-tertiary">No catalog-health data.</p>
          )}
        </Card>
      </Section>

      {/* ════════ 09 · AI INSIGHTS ══════════════════════════════════════════ */}
      <Section
        index={9}
        title="AI insights"
        deck="The automated read on this snapshot — what the channel is doing well, where it is leaking, and what to try next."
      >
        <AiInsightsCard state={insightsState} />
      </Section>

      {/* ════════ RETENTION — locked panel ══════════════════════════════════ */}
      <Card pad="md">
        <CardHeader>
          <CardTitle>Retention &amp; traffic sources</CardTitle>
          <Badge tone="neutral" variant="outline">locked</Badge>
        </CardHeader>
        <CardBody>
          <p className="t-body-sm text-tertiary">
            Retention, impressions CTR, and traffic sources unlock when the YouTube
            Analytics API is integrated.
          </p>
        </CardBody>
      </Card>

    </div>
  );
}

/* ── AI Insights card ───────────────────────────────────────────────────────
   Surfaces the endpoint's `error` field softly while still rendering whatever
   verdict came back. */
function AiInsightsCard({ state }) {
  const { loading, error, insights } = state;

  return (
    <Card pad="md">
      <CardBody>
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {error && (
              <p className="t-body-sm text-warning-700">
                ⚠ The AI brief fell back to a cached read — {error}
              </p>
            )}

            {insights?.verdict && (
              <p className="t-body-md text-body font-medium">{insights.verdict}</p>
            )}

            {!insights && !error && (
              <p className="t-body-sm text-tertiary">No insights available yet.</p>
            )}

            <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
              <InsightColumn
                heading="Strengths"
                mark="✓"
                markClass="text-success-700"
                items={insights?.strengths}
              />
              <InsightColumn
                heading="Weaknesses"
                mark="✗"
                markClass="text-error-600"
                items={insights?.weaknesses}
              />
              <InsightColumn
                heading="Recommendations"
                mark="→"
                markClass="text-navy-700"
                items={insights?.recommendations}
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
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

function InsightColumn({ heading, mark, markClass, items }) {
  return (
    <div>
      <div className="t-overline text-tertiary mb-2 border-t border-border-default pt-2">
        {heading}
      </div>
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={i} className="t-body-sm text-body flex gap-2">
              <span className={`shrink-0 ${markClass}`} aria-hidden>{mark}</span>
              <span>{insightItemText(it)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-body-sm text-tertiary">Nothing noted for this snapshot.</p>
      )}
    </div>
  );
}
