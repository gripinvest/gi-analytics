"use client";
// AssetSearchDailySection
// ─────────────────────────────────────────────────────────────────────────
// Daily-grain "pulse" panel — last 14 days of the four signals where day-level
// granularity actually adds information (V2 ramp, ZRR spike detection, failed-
// user volume, V2 instrumentation health). Sits in a separate tab so it
// doesn't compete with the weekly editorial narrative; you go here when you
// want to know "what's different about today / yesterday."
//
// Reads from the same DuckDB tables every other section uses — just grouped
// by IST calendar day. SQL builders live in lib/queries/daily.js.

import * as React from "react";
import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

import {
  fillDailyGaps,
  pivotByEngine,
  todayIST,
} from "@/lib/queries/daily";

const ED_INK = "var(--ed-ink)";
const ED_RUST = "var(--ed-rust)";
const ED_FOREST = "var(--ed-forest)";
const ED_GOLD = "var(--ed-gold)";
const ED_INK_MUTED = "var(--ed-ink-muted)";
const ED_RULE_FAINT = "var(--ed-rule-faint)";

const axisProps = {
  stroke: ED_INK_MUTED,
  tick: { fontSize: 10, fontFamily: "var(--ed-mono)", fill: ED_INK_MUTED, letterSpacing: 0.5 },
  tickLine: false,
  axisLine: { stroke: ED_INK, strokeWidth: 1 },
};
const gridProps = {
  stroke: ED_RULE_FAINT,
  strokeDasharray: "0",
  vertical: false,
};
const legendProps = {
  verticalAlign: "top",
  align: "left",
  height: 26,
  wrapperStyle: {
    fontFamily: "var(--ed-mono)",
    fontSize: 10,
    color: ED_INK_MUTED,
    letterSpacing: 0.5,
  },
};

// Compact `MMM DD` axis label so 14 days fit without rotation.
const shortDay = (d) => {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00+05:30`);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
};

/** Mini-exhibit "yesterday vs. day-before" callout — surfaces movement at a
 *  glance so the user doesn't have to read the bar heights. */
function YesterdayCallout({ label, series, valueKey, suffix = "", goodIsDown = false }) {
  const today = todayIST();
  // Filter out today's bucket (in-progress) and take the last 2 complete days.
  const complete = series.filter((r) => String(r.day) < today);
  const last = complete[complete.length - 1];
  const prev = complete[complete.length - 2];
  if (!last) {
    return (
      <div className="flex flex-col gap-1">
        <div className="ed-caption" style={{ opacity: 0.75 }}>{label}</div>
        <div
          className="ed-headline"
          style={{ fontSize: 28, lineHeight: 1.05, fontVariationSettings: "'opsz' 36, 'wght' 500" }}
        >
          —
        </div>
        <div className="ed-caption" style={{ opacity: 0.7 }}>no data</div>
      </div>
    );
  }
  const v = Number(last[valueKey] ?? 0);
  const p = prev != null ? Number(prev[valueKey] ?? 0) : null;
  const delta = p != null ? v - p : null;
  const deltaPct = p ? Math.round((1000 * (v - p)) / p) / 10 : null;
  const good = delta == null ? null : (goodIsDown ? delta < 0 : delta > 0);
  const tone = good == null ? ED_INK_MUTED : good ? ED_FOREST : ED_RUST;
  return (
    <div className="flex flex-col gap-1">
      <div className="ed-caption" style={{ opacity: 0.75 }}>{label}</div>
      <div
        className="ed-headline"
        style={{ fontSize: 28, lineHeight: 1.05, fontVariationSettings: "'opsz' 36, 'wght' 500" }}
      >
        {Number.isFinite(v) ? `${v}${suffix}` : "—"}
      </div>
      <div className="ed-caption" style={{ color: tone, fontWeight: 600 }}>
        {delta == null
          ? `yesterday (${shortDay(last.day)})`
          : `${delta >= 0 ? "+" : ""}${delta}${suffix} vs prior${deltaPct != null ? ` (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)` : ""}`}
      </div>
    </div>
  );
}

function ChartBox({ title, caption, children }) {
  return (
    <div
      style={{
        marginTop: 28,
        padding: "16px 18px 8px",
        border: `1px solid ${ED_RULE_FAINT}`,
        background: "var(--ed-paper, #f2ebdb)",
      }}
    >
      <p className="ed-overline" style={{ marginBottom: 6, letterSpacing: 0.8 }}>
        {title}
      </p>
      {caption && (
        <p className="ed-caption" style={{ marginBottom: 12, opacity: 0.75, maxWidth: "70ch" }}>
          {caption}
        </p>
      )}
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AssetSearchDailySection({
  sectionNumber = "II",
  queriesByEngineRows,
  zrrRows,
  failedUsersRows,
  notifyChipRows,
}) {
  const today = todayIST();

  // Pivot the engine-split queries into stacked-bar shape, then fill gaps.
  const queriesSeries = React.useMemo(() => {
    const pivoted = pivotByEngine(queriesByEngineRows || []);
    return fillDailyGaps(pivoted, ["v1", "v2"]);
  }, [queriesByEngineRows]);

  const zrrSeries = React.useMemo(
    () => fillDailyGaps(zrrRows || [], ["queries", "zero_results", "zrr_pct"]),
    [zrrRows]
  );

  const failedSeries = React.useMemo(
    () => fillDailyGaps(failedUsersRows || [], ["failed_users", "failure_events"]),
    [failedUsersRows]
  );

  const notifyChipSeries = React.useMemo(
    () => fillDailyGaps(notifyChipRows || [], ["notify_clicks", "chip_clicks", "unique_users"]),
    [notifyChipRows]
  );

  return (
    <section className="ed-set">
      <hr className="ed-rule-thick mb-6" />
      <p className="ed-overline mb-2">{sectionNumber}. The Daily Pulse</p>
      <h2 className="ed-headline" style={{ fontSize: "clamp(34px, 5vw, 56px)" }}>
        <em>Daily Signals</em>
      </h2>
      <p className="ed-prose-italic" style={{ maxWidth: "62ch", marginTop: 10 }}>
        Same source events as the weekly views, grouped by IST calendar day.
        Today is rendered with a softer tone — it's still in progress and the
        "yesterday vs prior" callouts skip it.
      </p>

      {/* ── KPI callouts: yesterday vs day-before ─────────────────────────── */}
      <div
        className="grid gap-x-8 gap-y-6 mt-8"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        <YesterdayCallout
          label="YESTERDAY'S QUERIES"
          series={queriesSeries.map((r) => ({ day: r.day, q: Number(r.v1 || 0) + Number(r.v2 || 0) }))}
          valueKey="q"
        />
        <YesterdayCallout
          label="ZRR (YESTERDAY)"
          series={zrrSeries}
          valueKey="zrr_pct"
          suffix="%"
          goodIsDown
        />
        <YesterdayCallout
          label="FAILED USERS"
          series={failedSeries}
          valueKey="failed_users"
          goodIsDown
        />
        <YesterdayCallout
          label="NOTIFY-ME + CHIP TAPS"
          series={notifyChipSeries.map((r) => ({
            day: r.day,
            taps: Number(r.notify_clicks || 0) + Number(r.chip_clicks || 0),
          }))}
          valueKey="taps"
        />
      </div>

      {/* ── Chart 1: Queries by engine, daily ─────────────────────────────── */}
      <ChartBox
        title="QUERIES PER DAY · ENGINE SPLIT"
        caption="Stacked V1 (rust) vs V2 (forest). The dashed line marks the V2 cutover (2026-05-27). The V2 share should grow daily until it dominates."
      >
        <BarChart data={queriesSeries} margin={{ top: 16, right: 12, bottom: 8, left: -10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip
            labelFormatter={shortDay}
            contentStyle={{
              background: "var(--ed-paper)",
              border: `1px solid ${ED_RULE_FAINT}`,
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
            }}
          />
          <Legend {...legendProps} />
          <ReferenceLine
            x="2026-05-27"
            stroke={ED_GOLD}
            strokeDasharray="3 3"
            label={{ value: "V2", fill: ED_GOLD, fontSize: 10, position: "insideTop" }}
          />
          <Bar dataKey="v1" stackId="q" name="V1" fill={ED_RUST} fillOpacity={0.75} />
          <Bar dataKey="v2" stackId="q" name="V2" fill={ED_FOREST} fillOpacity={0.85} />
        </BarChart>
      </ChartBox>

      {/* ── Chart 2: Zero-result rate, daily ──────────────────────────────── */}
      <ChartBox
        title="ZERO-RESULT RATE · PER DAY"
        caption="Query-level. A sudden daily spike — alias broken, asset cycled out — shows up here within hours instead of waiting for the weekly roll-up."
      >
        <LineChart data={zrrSeries} margin={{ top: 16, right: 12, bottom: 8, left: -10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
          <YAxis {...axisProps} width={48} unit="%" domain={[0, "dataMax + 5"]} />
          <Tooltip
            labelFormatter={shortDay}
            formatter={(v, k) => (k === "zrr_pct" ? [`${v}%`, "ZRR"] : [v, k])}
            contentStyle={{
              background: "var(--ed-paper)",
              border: `1px solid ${ED_RULE_FAINT}`,
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
            }}
          />
          <ReferenceLine
            x="2026-05-27"
            stroke={ED_GOLD}
            strokeDasharray="3 3"
          />
          <Line
            type="monotone"
            dataKey="zrr_pct"
            stroke={ED_RUST}
            strokeWidth={1.5}
            dot={{ r: 2.5, fill: ED_RUST }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ChartBox>

      {/* ── Chart 3: Distinct failed users per day ───────────────────────── */}
      <ChartBox
        title="FAILED-SEARCH USERS · PER DAY"
        caption="Distinct users who hit at least one zero-result query or empty-state event. The CS daily queue size."
      >
        <BarChart data={failedSeries} margin={{ top: 16, right: 12, bottom: 8, left: -10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip
            labelFormatter={shortDay}
            contentStyle={{
              background: "var(--ed-paper)",
              border: `1px solid ${ED_RULE_FAINT}`,
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
            }}
          />
          <Bar dataKey="failed_users" name="Failed users" fill={ED_INK_MUTED} fillOpacity={0.7} />
        </BarChart>
      </ChartBox>

      {/* ── Chart 4: Notify-me + chip taps per day ───────────────────────── */}
      <ChartBox
        title="V2 EMPTY-STATE ENGAGEMENT · PER DAY"
        caption="Notify-me taps and chip clicks. Small numbers right now; the trend is the instrumentation health signal — daily zeros after launch would mean the V2 hooks aren't firing."
      >
        <BarChart data={notifyChipSeries} margin={{ top: 16, right: 12, bottom: 8, left: -10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip
            labelFormatter={shortDay}
            contentStyle={{
              background: "var(--ed-paper)",
              border: `1px solid ${ED_RULE_FAINT}`,
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
            }}
          />
          <Legend {...legendProps} />
          <Bar dataKey="notify_clicks" stackId="t" name="Notify Me" fill={ED_FOREST} fillOpacity={0.85} />
          <Bar dataKey="chip_clicks"   stackId="t" name="Chip"      fill={ED_GOLD}   fillOpacity={0.75} />
        </BarChart>
      </ChartBox>

      <p className="ed-caption" style={{ marginTop: 18, opacity: 0.75, maxWidth: "70ch" }}>
        Today ({today}) is included but ignored by the "yesterday vs prior"
        callouts above — partial-day data would jitter the comparison.
        Cutover marker is 2026-05-27 IST (gi-client-web v22.0.26 release).
      </p>
    </section>
  );
}
