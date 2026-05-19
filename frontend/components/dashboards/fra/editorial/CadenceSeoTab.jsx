"use client";
/**
 * CadenceSeoTab — Tab 5 of the FRA editorial dashboard.
 *
 * Cadence + Titles & SEO in full (extracted from the original mega-file as
 * CadenceSection and TitlesSeoSection — exported so OverviewTab can import
 * them), plus two net-new sections: upload cadence & gap stats and
 * tag-frequency / SEO analysis.
 *
 * CadenceSection and TitlesSeoSection are export functions so OverviewTab
 * (Task 8) can import them by name without duplicating code.
 */

import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, LabelList,
} from "recharts";
import { errOf } from "@/lib/queries/fraYoutube";
import { fmt, compact } from "../helpers";
import {
  ED_INK, ED_INK_SOFT, ED_INK_MUTED, ED_INK_FAINT,
  ED_RUST, ED_FOREST, ED_GOLD, ED_RULE_FAINT,
  edAxisProps, edGridProps,
  RevealSection, EdTooltip, SectionHead,
  Figure, Exhibit, LedgerTable, EmptyPlate, ErrorNote,
} from "./primitives";

/* ── Section VII — Cadence (extracted from FraYoutubeDashboardEditorial.jsx
   lines 1038–1094; verbatim except: `number` prop replaces the hard-coded
   "VII", `reduced` is set to false, and figNum uses the number prop). */
export function CadenceSection({ number, loading, data, cadenceDaySeries, cadenceHourSeries, animProps }) {
  return (
    <RevealSection reduced={false} id="sec-cadence">
      <SectionHead
        number={number}
        italic="Cadence"
        deck="When the channel posts, in India Standard Time, and how those choices have performed on average."
      />
      <Figure
        figNum={`${number}.1`}
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
        figNum={`${number}.2`}
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
  );
}

/* ── Section VIII — Titles & SEO (extracted from FraYoutubeDashboardEditorial.jsx
   lines 1096–1138; verbatim except: `number` prop replaces the hard-coded
   "VIII", `reduced` is set to false, and figNum uses the number prop). */
export function TitlesSeoSection({ number, loading, data, titleSeries, animProps }) {
  return (
    <RevealSection reduced={false} id="sec-titles">
      <SectionHead
        number={number}
        italic="Titles & SEO"
        deck="Recurring structural patterns in the channel's video titles, ranked by the average views the videos carrying them earned."
      />
      <Figure
        figNum={`${number}.1`}
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
              <YAxis type="category" dataKey="pattern" {...edAxisProps} width={130} tickFormatter={(v) => v && v.length > 16 ? `${v.slice(0, 16)}…` : v} />
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
  );
}

/* ── Upload cadence — the channel's pacing: how often it ships, and the gaps
   between uploads. Net-new in the restructure; reads fra_youtube__upload_cadence
   (a single channel-level row). */
function UploadCadenceSection({ number, loading, error, cadenceRow }) {
  return (
    <RevealSection reduced={false} id="sec-pacing">
      <SectionHead
        number={number}
        italic="The pace of it"
        deck="How steadily the channel publishes — its monthly rhythm, and the gaps that open up between one upload and the next."
      />
      {error ? (
        <ErrorNote>Could not load upload cadence: {error}</ErrorNote>
      ) : !loading && !cadenceRow ? (
        <EmptyPlate>No upload-cadence row for the current snapshot.</EmptyPlate>
      ) : (
        <div className="grid gap-x-8 gap-y-8 grid-cols-2 lg:grid-cols-4">
          <Exhibit
            label="Uploads / month"
            loading={loading}
            value={cadenceRow?.avg_uploads_per_month != null ? Number(cadenceRow.avg_uploads_per_month).toFixed(2) : "—"}
            sub="averaged over active months"
          />
          <Exhibit
            label="Avg gap"
            loading={loading}
            value={cadenceRow?.avg_gap_days != null ? `${Number(cadenceRow.avg_gap_days).toFixed(1)} d` : "—"}
            sub="mean days between uploads"
          />
          <Exhibit
            label="Median gap"
            loading={loading}
            value={cadenceRow?.median_gap_days != null ? `${Number(cadenceRow.median_gap_days).toFixed(1)} d` : "—"}
            sub="the typical wait"
          />
          <Exhibit
            label="Longest gap"
            loading={loading}
            value={cadenceRow?.longest_gap_days != null ? `${fmt(cadenceRow.longest_gap_days)} d` : "—"}
            sub="the channel's quietest stretch"
          />
        </div>
      )}
    </RevealSection>
  );
}

/* Tag-type accent colours — keeps the SEO read scannable at a glance. */
const TAG_TYPE_COLOR = {
  product: ED_FOREST,
  aspirational: ED_GOLD,
  platform: ED_INK_MUTED,
  brand: ED_RUST,
  educational: ED_INK_SOFT,
  other: ED_INK_FAINT,
};

/* Tag-frequency / SEO analysis — the channel's most-used SEO tags, ranked, each
   keyword-classified into a coarse type. Net-new in the restructure; reads
   fra_youtube__tag_analysis (top 30 tags). */
function TagAnalysisSection({ number, loading, error, tagRows, animProps }) {
  const top = (tagRows || []).slice(0, 12);
  const series = top.map((r) => ({
    tag: r.tag,
    frequency: Number(r.frequency) || 0,
    type: r.tag_type || "other",
  }));
  return (
    <RevealSection reduced={false} id="sec-tags">
      <SectionHead
        number={number}
        italic="The keywords"
        deck="The SEO tags the channel reaches for most, ranked by how many videos carry them — and what kind of word each one is."
      />
      <Figure
        figNum={`${number}.1`}
        title="Most-used SEO tags"
        caption="Each bar is a tag; its length is the number of videos that carry it. Bars are tinted by tag type — product, aspirational, platform, brand, educational."
        loading={loading}
        error={error}
        height={Math.max(220, series.length * 34 + 40)}
      >
        {series.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="ed-prose-italic" style={{ color: ED_INK_FAINT }}>No tag data for this snapshot.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={series} margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={ED_RULE_FAINT} strokeDasharray="0" horizontal={false} />
              <XAxis type="number" {...edAxisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="tag" {...edAxisProps} width={130} tickFormatter={(v) => v && v.length > 16 ? `${v.slice(0, 16)}…` : v} />
              <Tooltip cursor={{ fill: "rgba(27,24,24,0.05)" }} content={<EdTooltip valueFmt={(v) => `${fmt(v)} videos`} />} />
              <Bar dataKey="frequency" name="Videos" maxBarSize={20} {...animProps}>
                {series.map((d, i) => (
                  <Cell key={i} fill={TAG_TYPE_COLOR[d.type] || ED_INK} />
                ))}
                <LabelList
                  dataKey="frequency"
                  position="right"
                  style={{ fontFamily: "var(--ed-mono)", fontSize: 9, fill: ED_INK_MUTED }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Figure>
      <div className="mt-7">
        <p className="ed-overline mb-3">THE LEDGER · TAGS BY TYPE</p>
        <LedgerTable
          loading={loading}
          empty="No tag data for the current snapshot."
          rows={tagRows}
          cols={[
            { key: "tag", label: "Tag" },
            { key: "frequency", label: "Videos", align: "right", mono: true, render: (r) => fmt(r.frequency) },
            {
              key: "tag_type", label: "Type",
              render: (r) => (
                <span style={{ color: TAG_TYPE_COLOR[r.tag_type] || ED_INK, fontWeight: 600, textTransform: "capitalize" }}>
                  {r.tag_type || "other"}
                </span>
              ),
            },
          ]}
        />
      </div>
    </RevealSection>
  );
}

export default function CadenceSeoTab({
  loading, reduced, animProps, data,
  cadenceDaySeries, cadenceHourSeries, titleSeries, uploadCadenceRow, tagAnalysisRows,
}) {
  return (
    <>
      <CadenceSection number="I" loading={loading} data={data}
        cadenceDaySeries={cadenceDaySeries} cadenceHourSeries={cadenceHourSeries} animProps={animProps} />
      <UploadCadenceSection number="II" loading={loading}
        error={errOf(data, "uploadCadence")} cadenceRow={uploadCadenceRow} />
      <TitlesSeoSection number="III" loading={loading} data={data} titleSeries={titleSeries} animProps={animProps} />
      <TagAnalysisSection number="IV" loading={loading}
        error={errOf(data, "tagAnalysis")} tagRows={tagAnalysisRows} animProps={animProps} />
    </>
  );
}
