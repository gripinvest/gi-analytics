"use client";

import * as React from "react";
import {
  ResponsiveContainer, BarChart, LineChart,
  Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { runQuery, fetchFraInsights } from "@/lib/api";
import { color, chartPalette } from "@/lib/tokens";
import {
  Card, CardHeader, CardTitle, CardSubtitle, CardBody,
  Badge, Stat, StatStrip, Tabs, TabList, Tab, TabPanel, Skeleton,
} from "@/components/ui";
import { ChartCard, TooltipBox, axisProps, gridProps } from "@/components/charts";

/* ── number helpers ───────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("en-IN");
const pct = (v) => (v == null || v === "" ? "—" : `${Number(v).toFixed(1)}%`);
const fmt = (v) => (v == null || v === "" ? "—" : nf.format(Number(v)));

/* ── SQL queries ──────────────────────────────────────────────────────────── */

const SQL = {
  overview: `
    SELECT * FROM fra_youtube__overview
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__overview)
  `,
  distribution: `
    SELECT * FROM fra_youtube__distribution
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__distribution)
  `,
  channelSnapshots: `
    SELECT snapshot_date, total_views
    FROM fra_youtube__channel_snapshots
    ORDER BY snapshot_date
  `,
  monthlyViews: `
    SELECT * FROM fra_youtube__monthly_views
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__monthly_views)
    ORDER BY month
  `,
  categoryMix: `
    SELECT * FROM fra_youtube__category_mix
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__category_mix)
    ORDER BY perf_vs_mean_pct DESC
  `,
  engagement: `
    SELECT * FROM fra_youtube__engagement_breakdown
    WHERE dimension = 'category'
      AND snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__engagement_breakdown)
  `,
  cadence: `
    SELECT * FROM fra_youtube__posting_patterns
    WHERE dimension = 'day'
      AND snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__posting_patterns)
  `,
  titlePatterns: `
    SELECT * FROM fra_youtube__title_patterns
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__title_patterns)
    ORDER BY avg_views DESC
  `,
  catalogHealth: `
    SELECT * FROM fra_youtube__catalog_health
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__catalog_health)
  `,
};

/* ── data hook ────────────────────────────────────────────────────────────── */

function useFraYoutube(projectId) {
  const [state, setState] = React.useState({ loading: true, error: null, data: {} });

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: {} });

    const run = async (key, sql) => {
      try {
        const res = await runQuery(projectId, sql, 1000);
        return [key, res && res.error ? { error: res.error } : { rows: (res && res.rows) || [] }];
      } catch (e) {
        return [key, { error: String((e && e.message) || e) }];
      }
    };

    (async () => {
      const jobs = Object.entries(SQL).map(([key, sql]) => run(key, sql));
      const entries = await Promise.all(jobs);
      if (!cancelled) setState({ loading: false, error: null, data: Object.fromEntries(entries) });
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  return state;
}

/* ── insights hook ────────────────────────────────────────────────────────── */

function useFraInsights() {
  const [state, setState] = React.useState({ loading: true, error: null, insights: null });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchFraInsights();
        if (!cancelled) setState({ loading: false, error: null, insights: data });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: String((e && e.message) || e), insights: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

/* ── small helpers ────────────────────────────────────────────────────────── */

const get = (data, key) => (data && data[key]) || {};
const rowsOf = (data, key) => get(data, key).rows || [];
const errOf = (data, key) => get(data, key).error || null;

/* ── discovery verdict ────────────────────────────────────────────────────── */

function discoveryVerdictBadge(row) {
  if (!row) return <Badge tone="neutral">no data</Badge>;
  const recentCount = Number(row.recent_video_count ?? 0);
  const rate = Number(row.breakout_1k_rate ?? 0);
  if (recentCount === 0) return <Badge tone="neutral">no recent uploads</Badge>;
  if (rate < 0.25) return <Badge tone="error">discovery crisis</Badge>;
  if (rate < 0.6) return <Badge tone="warning">needs improvement</Badge>;
  return <Badge tone="success">healthy discovery</Badge>;
}

/* ── DeltaChip ────────────────────────────────────────────────────────────── */

function DeltaChip({ delta, goodIsUp = true, suffix = "" }) {
  if (delta == null || delta === "" || Number.isNaN(Number(delta))) return null;
  const d = Number(delta);
  if (d === 0) return <span className="t-emphasis-sm text-tertiary">±0{suffix}</span>;
  const good = goodIsUp ? d > 0 : d < 0;
  return (
    <Badge tone={good ? "success" : "error"} variant="soft" className="gap-0.5">
      {d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}{suffix}
    </Badge>
  );
}

/* ── main component ───────────────────────────────────────────────────────── */

export default function FraYoutubeDashboard({ project }) {
  const { loading, data } = useFraYoutube(project.id);
  const insightsState = useFraInsights();

  const overviewRows = rowsOf(data, "overview");
  const overview = overviewRows[0] || null;

  // Empty state — no snapshot yet
  if (!loading && overviewRows.length === 0) {
    return (
      <Card pad="lg">
        <p className="t-body-sm text-secondary">
          No snapshots yet — the first daily refresh has not run.
        </p>
      </Card>
    );
  }

  const snapshotDate = overview?.snapshot_date ?? "—";

  const distributionRows = rowsOf(data, "distribution");
  const distRow = distributionRows[0] || null;

  const channelSnapshotRows = rowsOf(data, "channelSnapshots");
  const monthlyViewsRows = rowsOf(data, "monthlyViews");

  const categoryMixRows = rowsOf(data, "categoryMix");
  const engagementRows = rowsOf(data, "engagement");
  const cadenceRows = rowsOf(data, "cadence");
  const titlePatternsRows = rowsOf(data, "titlePatterns");
  const catalogRows = rowsOf(data, "catalogHealth");
  const catalogRow = catalogRows[0] || null;

  // Chart series
  const growthSeries = channelSnapshotRows.map((r) => ({
    date: String(r.snapshot_date).slice(0, 10),
    total_views: Number(r.total_views),
  }));

  const monthlySeries = monthlyViewsRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    total_views: Number(r.total_views),
  }));

  const engagementSeries = engagementRows.map((r) => ({
    bucket: r.bucket,
    engagement_rate_pct: Number(r.engagement_rate_pct),
  }));

  const cadenceSeries = cadenceRows.map((r) => ({
    bucket: r.bucket,
    avg_views: Number(r.avg_views),
  }));

  return (
    <div className="flex flex-col gap-6">

      {/* ── stat strip ──────────────────────────────────────────────────── */}
      <Card pad="lg">
        {loading ? (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <StatStrip>
            <Stat
              label="Subscribers"
              value={overview ? fmt(overview.subscribers) : "—"}
              delta={
                overview?.subscribers_delta != null ? (
                  <DeltaChip delta={overview.subscribers_delta} goodIsUp />
                ) : undefined
              }
              hint={`as of ${snapshotDate}`}
            />
            <Stat
              label="Total views"
              value={overview ? fmt(overview.total_views) : "—"}
              delta={
                overview?.total_views_delta != null ? (
                  <DeltaChip delta={overview.total_views_delta} goodIsUp />
                ) : undefined
              }
            />
            <Stat
              label="Videos"
              value={overview ? fmt(overview.video_count) : "—"}
            />
            <Stat
              label="Avg views / video"
              value={overview ? fmt(overview.avg_views) : "—"}
            />
          </StatStrip>
        )}
      </Card>

      {/* ── tabs ────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="overview">
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="discovery">Discovery</Tab>
          <Tab value="growth">Growth</Tab>
          <Tab value="content-fit">Content fit</Tab>
          <Tab value="engagement">Engagement</Tab>
          <Tab value="cadence">Cadence</Tab>
          <Tab value="titles-seo">Titles &amp; SEO</Tab>
          <Tab value="catalog">Catalog</Tab>
        </TabList>

        {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
        <TabPanel value="overview" className="mt-5 flex flex-col gap-6">
          <Card pad="md">
            <CardHeader>
              <CardTitle>Channel snapshot</CardTitle>
              {overview && (
                <CardSubtitle>as of {snapshotDate}</CardSubtitle>
              )}
            </CardHeader>
            <CardBody>
              {loading ? (
                <Skeleton className="h-20 w-full" />
              ) : errOf(data, "overview") ? (
                <p className="t-body-sm text-error">Could not load this section.</p>
              ) : overview ? (
                <StatStrip>
                  <Stat label="Subscribers" value={fmt(overview.subscribers)} />
                  <Stat label="Total views" value={fmt(overview.total_views)} />
                  <Stat label="Videos" value={fmt(overview.video_count)} />
                  <Stat label="Avg views / video" value={fmt(overview.avg_views)} />
                </StatStrip>
              ) : (
                <p className="t-body-sm text-tertiary">No overview data.</p>
              )}
            </CardBody>
          </Card>

          {/* AI insights */}
          <AiInsightsCard state={insightsState} />
        </TabPanel>

        {/* ── DISCOVERY ─────────────────────────────────────────────────── */}
        <TabPanel value="discovery" className="mt-5 flex flex-col gap-6">
          <Card pad="md">
            <CardHeader>
              <div>
                <CardTitle>Discovery health</CardTitle>
                <CardSubtitle>Share of recent videos crossing key view thresholds</CardSubtitle>
              </div>
              {!loading && discoveryVerdictBadge(distRow)}
            </CardHeader>
            <CardBody>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : errOf(data, "distribution") ? (
                <p className="t-body-sm text-error">Could not load this section.</p>
              ) : distRow ? (
                <div className="flex flex-col gap-4">
                  <div className="text-4xl t-num font-semibold text-heading">
                    {distRow.breakout_1k_rate != null
                      ? `${(Number(distRow.breakout_1k_rate) * 100).toFixed(1)}%`
                      : "—"}
                    <span className="ml-2 t-body-sm text-tertiary font-normal">breakout ≥1k rate</span>
                  </div>
                  <StatStrip>
                    <Stat label="Videos ≥ 1k views" value={fmt(distRow.videos_ge_1k)} />
                    <Stat label="Videos ≥ 10k views" value={fmt(distRow.videos_ge_10k)} />
                    <Stat label="Videos ≥ 100k views" value={fmt(distRow.videos_ge_100k)} />
                    <Stat label="Gini coefficient" value={distRow.gini != null ? Number(distRow.gini).toFixed(3) : "—"} />
                    <Stat label="Recent video count" value={fmt(distRow.recent_video_count)} />
                  </StatStrip>
                </div>
              ) : (
                <p className="t-body-sm text-tertiary">No distribution data for current snapshot.</p>
              )}
            </CardBody>
          </Card>
        </TabPanel>

        {/* ── GROWTH ────────────────────────────────────────────────────── */}
        <TabPanel value="growth" className="mt-5 flex flex-col gap-6">
          <ChartCard
            title="Total views over time"
            subtitle="Daily channel snapshots — the real cumulative-view trend."
            loading={loading}
            error={errOf(data, "channelSnapshots")}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthSeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} width={56} tickFormatter={(v) => nf.format(v)} />
                <Tooltip
                  cursor={{ stroke: color.neutral[300] }}
                  content={<TooltipBox valueFmt={(v) => nf.format(v)} />}
                />
                <Line
                  dataKey="total_views"
                  name="Total views"
                  stroke={chartPalette[0]}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Monthly views"
            subtitle="Total views per calendar month (from video publish date)."
            loading={loading}
            error={errOf(data, "monthlyViews")}
            height={240}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} width={56} tickFormatter={(v) => nf.format(v)} />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v) => nf.format(v)} />}
                />
                <Bar
                  dataKey="total_views"
                  name="Views"
                  fill={chartPalette[0]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabPanel>

        {/* ── CONTENT FIT ───────────────────────────────────────────────── */}
        <TabPanel value="content-fit" className="mt-5 flex flex-col gap-6">
          <Card pad="md">
            <CardHeader>
              <div>
                <CardTitle>Category performance vs mean</CardTitle>
                <CardSubtitle>Categories sorted by performance vs channel average</CardSubtitle>
              </div>
            </CardHeader>
            <CardBody>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : errOf(data, "categoryMix") ? (
                <p className="t-body-sm text-error">Could not load this section.</p>
              ) : categoryMixRows.length === 0 ? (
                <p className="t-body-sm text-tertiary">No category mix data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="py-2 pr-4 text-left t-overline text-tertiary">Category</th>
                        <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                        <th className="py-2 pr-4 text-right t-overline text-tertiary">Avg views</th>
                        <th className="py-2 text-right t-overline text-tertiary">vs mean</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryMixRows.map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-border-default last:border-0"
                        >
                          <td className="py-2 pr-4 text-body">{r.category}</td>
                          <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.video_count)}</td>
                          <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.avg_views)}</td>
                          <td className="py-2 text-right">
                            {i === 0 ? (
                              <Badge tone="success">{pct(r.perf_vs_mean_pct)}</Badge>
                            ) : i === categoryMixRows.length - 1 ? (
                              <Badge tone="error">{pct(r.perf_vs_mean_pct)}</Badge>
                            ) : (
                              <span className="t-num text-secondary">{pct(r.perf_vs_mean_pct)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </TabPanel>

        {/* ── ENGAGEMENT ────────────────────────────────────────────────── */}
        <TabPanel value="engagement" className="mt-5 flex flex-col gap-6">
          <ChartCard
            title="Engagement rate by category"
            subtitle="(likes + comments) ÷ views, grouped by content category."
            loading={loading}
            error={errOf(data, "engagement")}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={engagementSeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bucket" {...axisProps} />
                <YAxis {...axisProps} width={48} unit="%" />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v) => `${Number(v).toFixed(2)}%`} />}
                />
                <Bar
                  dataKey="engagement_rate_pct"
                  name="Engagement rate"
                  fill={chartPalette[1]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={56}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabPanel>

        {/* ── CADENCE ───────────────────────────────────────────────────── */}
        <TabPanel value="cadence" className="mt-5 flex flex-col gap-6">
          <ChartCard
            title="Avg views by publish day"
            subtitle="Average views for videos published on each day of the week."
            loading={loading}
            error={errOf(data, "cadence")}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cadenceSeries} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bucket" {...axisProps} />
                <YAxis {...axisProps} width={56} tickFormatter={(v) => nf.format(v)} />
                <Tooltip
                  cursor={{ fill: color.neutral[100] }}
                  content={<TooltipBox valueFmt={(v) => nf.format(v)} />}
                />
                <Bar
                  dataKey="avg_views"
                  name="Avg views"
                  fill={chartPalette[2]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={64}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabPanel>

        {/* ── TITLES & SEO ──────────────────────────────────────────────── */}
        <TabPanel value="titles-seo" className="mt-5 flex flex-col gap-6">
          <Card pad="md">
            <CardHeader>
              <div>
                <CardTitle>Title patterns</CardTitle>
                <CardSubtitle>Recurring structural patterns in video titles, sorted by avg views</CardSubtitle>
              </div>
            </CardHeader>
            <CardBody>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : errOf(data, "titlePatterns") ? (
                <p className="t-body-sm text-error">Could not load this section.</p>
              ) : titlePatternsRows.length === 0 ? (
                <p className="t-body-sm text-tertiary">No title pattern data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="py-2 pr-4 text-left t-overline text-tertiary">Pattern</th>
                        <th className="py-2 pr-4 text-right t-overline text-tertiary">Videos</th>
                        <th className="py-2 text-right t-overline text-tertiary">Avg views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {titlePatternsRows.map((r, i) => (
                        <tr key={i} className="border-b border-border-default last:border-0">
                          <td className="py-2 pr-4 text-body">{r.pattern}</td>
                          <td className="py-2 pr-4 text-right t-num text-secondary">{fmt(r.video_count)}</td>
                          <td className="py-2 text-right t-num text-secondary">{fmt(r.avg_views)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </TabPanel>

        {/* ── CATALOG ───────────────────────────────────────────────────── */}
        <TabPanel value="catalog" className="mt-5 flex flex-col gap-6">
          <Card pad="md">
            <CardHeader>
              <div>
                <CardTitle>Catalog health</CardTitle>
                <CardSubtitle>Recent vs all-time performance and subscriber efficiency</CardSubtitle>
              </div>
            </CardHeader>
            <CardBody>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : errOf(data, "catalogHealth") ? (
                <p className="t-body-sm text-error">Could not load this section.</p>
              ) : catalogRow ? (
                <StatStrip>
                  <Stat
                    label="Recent avg views"
                    value={fmt(catalogRow.recent_avg_views)}
                    hint="last 30 days"
                  />
                  <Stat
                    label="All-time avg views"
                    value={fmt(catalogRow.alltime_avg_views)}
                  />
                  <Stat
                    label="Freshness delta"
                    value={catalogRow.freshness_delta_pct != null
                      ? pct(catalogRow.freshness_delta_pct)
                      : "—"}
                    hint="recent vs all-time"
                  />
                  <Stat
                    label="Subscriber efficiency"
                    value={catalogRow.subscriber_efficiency != null
                      ? Number(catalogRow.subscriber_efficiency).toFixed(3)
                      : "—"}
                    hint="total views ÷ subscribers"
                  />
                </StatStrip>
              ) : (
                <p className="t-body-sm text-tertiary">No catalog health data.</p>
              )}
            </CardBody>
          </Card>
        </TabPanel>
      </Tabs>

      {/* ── retention locked panel ─────────────────────────────────────── */}
      <Card pad="md" className="opacity-60">
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

/* ── AI Insights card ─────────────────────────────────────────────────────── */

function AiInsightsCard({ state }) {
  const { loading, error, insights } = state;

  return (
    <Card pad="md">
      <CardHeader>
        <CardTitle>AI insights</CardTitle>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : error ? (
          <p className="t-body-sm text-tertiary">Could not load insights: {error}</p>
        ) : insights ? (
          <div className="flex flex-col gap-4">
            {insights.verdict && (
              <p className="t-body-sm text-body font-medium">{insights.verdict}</p>
            )}
            {insights.strengths && insights.strengths.length > 0 && (
              <div>
                <div className="t-overline text-tertiary mb-1">Strengths</div>
                <ul className="flex flex-col gap-1">
                  {insights.strengths.map((s, i) => (
                    <li key={i} className="t-body-sm text-body flex gap-2">
                      <span className="text-success-600 shrink-0">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insights.weaknesses && insights.weaknesses.length > 0 && (
              <div>
                <div className="t-overline text-tertiary mb-1">Weaknesses</div>
                <ul className="flex flex-col gap-1">
                  {insights.weaknesses.map((w, i) => (
                    <li key={i} className="t-body-sm text-body flex gap-2">
                      <span className="text-error-600 shrink-0">✗</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insights.recommendations && insights.recommendations.length > 0 && (
              <div>
                <div className="t-overline text-tertiary mb-1">Recommendations</div>
                <ul className="flex flex-col gap-1">
                  {insights.recommendations.map((r, i) => (
                    <li key={i} className="t-body-sm text-body flex gap-2">
                      <span className="text-navy-600 shrink-0">→</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="t-body-sm text-tertiary">No insights available yet.</p>
        )}
      </CardBody>
    </Card>
  );
}
