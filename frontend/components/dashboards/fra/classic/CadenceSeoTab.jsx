"use client";
/**
 * CadenceSeoTab — Tab 5 of the FRA classic dashboard.
 *
 * Cadence + Titles & SEO in full (extracted from the original mega-file as
 * CadenceSection / TitlesSeoSection — exported so OverviewTab can import them),
 * plus two net-new sections: upload cadence & gap stats and the tag-frequency
 * / SEO analysis.
 */

import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";
import { fmt, compact } from "../helpers";
import { Section, StatStripSkeleton, MiniBar } from "./primitives";

/* ── §06 Cadence — extracted verbatim from FraYoutubeDashboard.jsx lines 802–875 ─ */

export function CadenceSection({ index, loading, data, cadenceDaySeries, cadenceHourSeries }) {
  return (
    <Section
      index={index}
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
  );
}

/* ── §07 Titles & SEO — extracted verbatim from FraYoutubeDashboard.jsx lines 877–919 ─ */

export function TitlesSeoSection({ index, loading, data, titleRows, titleMax }) {
  return (
    <Section
      index={index}
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
  );
}

/* ── Upload cadence — net-new ──────────────────────────────────────────────── */

/* Upload cadence — the channel's pacing: how often it ships, and the gaps
   between uploads. Net-new in the restructure; reads fra_youtube__upload_cadence
   (a single channel-level row). */
function UploadCadenceSection({ index, loading, error, cadenceRow }) {
  return (
    <Section
      index={index}
      title="The pace of it"
      deck="How steadily the channel publishes — its monthly rhythm, and the gaps that open up between one upload and the next."
    >
      <Card pad="md">
        {loading ? (
          <StatStripSkeleton count={4} />
        ) : error ? (
          <p className="t-body-sm text-error-600">Could not load upload cadence.</p>
        ) : !cadenceRow ? (
          <p className="t-body-sm text-tertiary">No upload-cadence row for the current snapshot.</p>
        ) : (
          <StatStrip>
            <Stat
              label="Uploads / month"
              value={cadenceRow.avg_uploads_per_month != null ? Number(cadenceRow.avg_uploads_per_month).toFixed(2) : "—"}
              hint="averaged over active months"
            />
            <Stat
              label="Avg gap"
              value={cadenceRow.avg_gap_days != null ? `${Number(cadenceRow.avg_gap_days).toFixed(1)} d` : "—"}
              hint="mean days between uploads"
            />
            <Stat
              label="Median gap"
              value={cadenceRow.median_gap_days != null ? `${Number(cadenceRow.median_gap_days).toFixed(1)} d` : "—"}
              hint="the typical wait"
            />
            <Stat
              label="Longest gap"
              value={cadenceRow.longest_gap_days != null ? `${fmt(cadenceRow.longest_gap_days)} d` : "—"}
              hint="the channel's quietest stretch"
            />
          </StatStrip>
        )}
      </Card>
    </Section>
  );
}

/* ── Tag analysis — net-new ────────────────────────────────────────────────── */

/* Tag-type accent colours — keeps the SEO read scannable at a glance. */
const TAG_TYPE_COLOR = {
  product: color.success[500],
  aspirational: chartPalette[1],
  platform: color.teal[600],
  brand: color.error[400],
  educational: chartPalette[0],
  other: color.neutral[400],
};

/* Tag-frequency / SEO analysis — the channel's most-used SEO tags, ranked, each
   keyword-classified into a coarse type. Net-new in the restructure; reads
   fra_youtube__tag_analysis (top 30 tags). */
function TagAnalysisSection({ index, loading, error, tagRows }) {
  const top = (tagRows || []).slice(0, 12);
  const series = top.map((r) => ({
    tag: r.tag,
    frequency: Number(r.frequency) || 0,
    type: r.tag_type || "other",
  }));
  return (
    <Section
      index={index}
      title="The keywords"
      deck="The SEO tags the channel reaches for most, ranked by how many videos carry them — and what kind of word each one is."
    >
      <ChartCard
        title="Most-used SEO tags"
        subtitle="Each bar is a tag; its length is the number of videos that carry it. Bars are tinted by tag type."
        loading={loading}
        error={error}
        height={Math.max(220, series.length * 34 + 48)}
      >
        {series.length === 0 ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            No tag data for this snapshot.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={series} margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="tag" {...axisProps} width={130} />
              <Tooltip
                cursor={{ fill: color.neutral[100] }}
                content={<TooltipBox valueFmt={(v) => `${fmt(v)} videos`} />}
              />
              <Bar dataKey="frequency" name="Videos" maxBarSize={20} radius={[2, 2, 2, 2]}>
                {series.map((d, i) => (
                  <Cell key={i} fill={TAG_TYPE_COLOR[d.type] || chartPalette[0]} />
                ))}
                <LabelList
                  dataKey="frequency"
                  position="right"
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, fill: color.neutral[500] }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <Card pad="md">
        <CardHeader>
          <CardTitle>Tags by type</CardTitle>
          <CardSubtitle>Every tag the analysis surfaced, with its keyword classification</CardSubtitle>
        </CardHeader>
        <CardBody>
          {error ? (
            <p className="t-body-sm text-error-600">Could not load this section.</p>
          ) : loading ? (
            <Skeleton className="h-32 w-full" />
          ) : !tagRows || tagRows.length === 0 ? (
            <p className="t-body-sm text-tertiary">No tag data for the current snapshot.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="py-2 pr-4 text-left t-overline text-tertiary">Tag</th>
                    <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                    <th className="py-2 text-left t-overline text-tertiary">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {tagRows.map((r, i) => (
                    <tr key={i} className="border-b border-border-default last:border-0">
                      <td className="py-2 pr-4 text-body">{r.tag}</td>
                      <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.frequency)}</td>
                      <td className="py-2">
                        <span
                          className="t-emphasis-sm capitalize"
                          style={{ color: TAG_TYPE_COLOR[r.tag_type] || color.neutral[600] }}
                        >
                          {r.tag_type || "other"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}

/* ── Tab assembly ──────────────────────────────────────────────────────────── */

export default function CadenceSeoTab({
  loading, data,
  cadenceDaySeries, cadenceHourSeries, titleRows, titleMax, uploadCadenceRow, tagAnalysisRows,
}) {
  return (
    <div className="flex flex-col gap-10">
      <CadenceSection index={1} loading={loading} data={data}
        cadenceDaySeries={cadenceDaySeries} cadenceHourSeries={cadenceHourSeries} />
      <UploadCadenceSection index={2} loading={loading}
        error={errOf(data, "uploadCadence")} cadenceRow={uploadCadenceRow} />
      <TitlesSeoSection index={3} loading={loading} data={data}
        titleRows={titleRows} titleMax={titleMax} />
      <TagAnalysisSection index={4} loading={loading}
        error={errOf(data, "tagAnalysis")} tagRows={tagAnalysisRows} />
    </div>
  );
}
