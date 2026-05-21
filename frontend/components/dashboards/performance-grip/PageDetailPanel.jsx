"use client";
import * as React from "react";
import MetricTrendCard from "./MetricTrendCard";
import { METRICS, CORE, SECONDARY } from "./MetricTrendGrid";
import { THRESHOLDS, usePageDetail } from "@/lib/queries/performanceGrip";

/* Page Detail — pick one route from a dropdown and read its full archive
   detail: a per-page summary strip + all 5 Web Vitals trendlines, each
   full-width (one metric per row, not the 3+2 grid). Reuses MetricTrendCard
   and the trendline row shape via usePageDetail. */

/* Sum a numeric column across the detail rows. */
function sumCol(rows, key) {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

/* One labelled figure in the summary strip — mirrors HeroBand's cells. */
function SummaryCell({ label, value }) {
  return (
    <div>
      <p className="ed-overline mb-1">{label}</p>
      <p className="ed-stat-num">{value}</p>
    </div>
  );
}

export default function PageDetailPanel({ app, device, windowDays, routeRows }) {
  // Routes sorted by page views descending — drives both the dropdown order
  // and the default selection (highest-traffic route).
  const sortedRoutes = React.useMemo(
    () => [...(routeRows || [])].sort((a, b) => (b.page_views ?? 0) - (a.page_views ?? 0)),
    [routeRows],
  );

  const [pageUrl, setPageUrl] = React.useState(sortedRoutes[0]?.page_url ?? "");

  // Re-default if routeRows changes and the current selection is no longer present.
  React.useEffect(() => {
    if (!sortedRoutes.length) { setPageUrl(""); return; }
    setPageUrl(prev =>
      prev && sortedRoutes.some(r => r.page_url === prev)
        ? prev
        : sortedRoutes[0].page_url
    );
  }, [sortedRoutes]);

  const { rows } = usePageDetail({ app, device, pageUrl, windowDays });

  // Per-page window totals for the summary strip.
  const totalViews   = sumCol(rows, "page_views_total");
  const totalErrors  = sumCol(rows, "js_errors_total");
  const totalSamples = sumCol(rows, "sample_count_total");
  const totalOutliers =
    sumCol(rows, "lcp_outliers") + sumCol(rows, "inp_outliers") +
    sumCol(rows, "cls_outliers") + sumCol(rows, "fcp_outliers") +
    sumCol(rows, "ttfb_outliers");

  return (
    <section className="page-detail-panel">
      <hr className="ed-rule-thick" />
      <p className="ed-section-no mt-2 mb-4">Page Detail</p>

      {sortedRoutes.length === 0 ? (
        <p className="ed-caption">No routes yet</p>
      ) : (
        <>
          {/* Route dropdown — bottom-ruled, mono, on paper. */}
          <div className="mb-6 max-w-xl">
            <label htmlFor="page-detail-route" className="ed-caption block mb-1">
              Route
            </label>
            <select
              id="page-detail-route"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              className="w-full cursor-pointer bg-transparent py-2"
              style={{
                fontFamily: "var(--ed-mono)",
                fontSize: 14,
                color: "var(--ed-ink)",
                background: "var(--ed-paper)",
                border: 0,
                borderBottom: "1px solid var(--ed-rule)",
                borderRadius: 0,
                outline: "none",
              }}
            >
              {sortedRoutes.map(r => (
                <option key={r.page_url} value={r.page_url}>
                  {r.page_url}  ({(r.page_views ?? 0).toLocaleString()} views)
                </option>
              ))}
            </select>
          </div>

          {/* Per-page summary strip. */}
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryCell label="Page views (window)" value={totalViews.toLocaleString()} />
            <SummaryCell label="JS errors (window)"  value={totalErrors.toLocaleString()} />
            <SummaryCell label="Samples (window)"    value={totalSamples.toLocaleString()} />
            <SummaryCell label="Extreme readings set aside" value={totalOutliers.toLocaleString()} />
          </div>

          {rows.length === 0 ? (
            <p className="ed-caption">No data for this page in the selected window.</p>
          ) : (
            <>
              {/* Core Web Vitals — full-width, one metric per row. */}
              <p className="ed-overline mb-3">Core Web Vitals</p>
              <div className="mb-8 flex flex-col gap-6">
                {CORE.map(m => (
                  <MetricTrendCard
                    key={m}
                    metric={m}
                    metricLabel={METRICS[m].label}
                    metricBlurb={METRICS[m].blurb}
                    rows={rows}
                    thresholds={THRESHOLDS}
                  />
                ))}
              </div>

              {/* Secondary Web Vitals — full-width, one metric per row. */}
              <p className="ed-overline mb-3">Secondary Web Vitals</p>
              <div className="flex flex-col gap-6">
                {SECONDARY.map(m => (
                  <MetricTrendCard
                    key={m}
                    metric={m}
                    metricLabel={METRICS[m].label}
                    metricBlurb={METRICS[m].blurb}
                    rows={rows}
                    thresholds={THRESHOLDS}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
