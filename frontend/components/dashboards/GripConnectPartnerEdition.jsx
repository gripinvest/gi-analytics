"use client";
// GripConnectPartnerEdition
// ─────────────────────────────────────────────────────────────────────────
// The per-partner "dossier" — a single partner's dedicated edition of the
// Grip Connect report. Where the combined report compares the four partners
// side by side, this digs into one: the MTD headline, the AUM story month by
// month and week by week (split into first-time vs repeat money), the weekly
// counts, and that partner's registration→KYC funnel.
//
// Data: the headline + funnel are passed down from the combined report
// (already-loaded layer-2 tables). The weekly history is queried here from
// card_3841; the monthly AUM series is rolled up from the daily card_3843
// (SUM of daily AUM per calendar month — the same flow the MTD figure sums,
// just over whole months, so it is fully verifiable, not an estimate).

import * as React from "react";
import { runQuery } from "@/lib/api";
import {
  fmtAum, fmtCount, fmtPct, Delta, SkeletonBlock, LedgerTable, NorthStarFigure,
  resolveTable, DISPLAY_TO_RAW,
} from "./GripConnectDashboardEditorial";

const nf = new Intl.NumberFormat("en-IN");

// Module-level cache keyed by `${projectId}::${partner}`. Avoids re-fetching
// both queries on every partner tab switch. Cleared by the combined report's
// refresh handler (see clearPartnerCache) so a refresh shows fresh numbers.
const _partnerCache = new Map();

// Drop all cached partner data. Called after a manual refresh so the dossier
// re-queries instead of serving pre-refresh numbers.
export function clearPartnerCache() {
  _partnerCache.clear();
}

/* "2026-05-11" -> "11 May" */
function fmtWeek(s) {
  const d = new Date(String(s ?? "").slice(0, 10));
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* "2026-04" -> "Apr 26" (short, for chart labels) */
function fmtMonth(s) {
  const d = new Date(`${String(s ?? "").slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

/* "2026-04" -> "April 2026" (long, for the headline callout) */
function fmtMonthLong(s) {
  const d = new Date(`${String(s ?? "").slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/* Fetch this partner's weekly history (card_3841) and its monthly AUM series,
   rolled up from the daily card (card_3843) by SUM over each calendar month. */
function usePartnerData(project, partner) {
  const [state, setState] = React.useState({
    loading: true, error: null, weekly: [], monthly: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    const cacheKey = `${project.id}::${partner}`;

    // Serve from cache synchronously when available.
    if (_partnerCache.has(cacheKey)) {
      const cached = _partnerCache.get(cacheKey);
      setState({ loading: false, error: null, weekly: cached.weekly, monthly: cached.monthly });
      return () => { cancelled = true; };
    }

    setState({ loading: true, error: null, weekly: [], monthly: [] });

    const raw = DISPLAY_TO_RAW[partner] || partner;
    const wow = resolveTable(project.tables, "card_3841_summary_wow", project.id);
    const dod = resolveTable(project.tables, "card_3843_summary_dod", project.id);
    // raw is one of four fixed, code-controlled partner strings — safe to inline.
    const weeklySql =
      `SELECT * FROM "${wow}" WHERE partner = '${raw}' ORDER BY week DESC LIMIT 12`;
    const monthlySql =
      `SELECT strftime(TRY_CAST(day AS DATE), '%Y-%m') AS month, ` +
      `SUM(aum) AS aum, SUM(fti_amount) AS fti_amount ` +
      `FROM "${dod}" WHERE partner = '${raw}' AND TRY_CAST(day AS DATE) IS NOT NULL ` +
      `AND TRY_CAST(day AS DATE) >= CURRENT_DATE - INTERVAL 24 MONTH ` +
      `GROUP BY 1 ORDER BY 1`;

    Promise.all([
      runQuery(project.id, weeklySql, 50),
      runQuery(project.id, monthlySql, 500),
    ])
      .then(([w, m]) => {
        if (cancelled) return;
        const weekly = w.rows || [];
        const monthly = m.rows || [];
        _partnerCache.set(cacheKey, { weekly, monthly });
        setState({
          loading: false,
          error: w.error || m.error || null,
          weekly,
          monthly,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: String((e && e.message) || e),
          weekly: [], monthly: [],
        });
      });

    return () => { cancelled = true; };
  }, [project.id, project.tables, partner]);

  return state;
}

/* A bar per period — height = total AUM, split into first-time money (inked)
   and repeat money (faint). Drives both the monthly and weekly trends. */
function AumBarChart({ data, labelOf, emptyText }) {
  if (!data.length) {
    return <p className="ed-prose-italic">{emptyText}</p>;
  }
  const max = Math.max(...data.map((d) => Number(d.aum) || 0), 1);

  return (
    <div>
      <div
        className="flex items-end gap-1"
        style={{ height: 178 }}
        role="img"
        aria-label={`${data.length}-bar AUM chart`}
      >
        {data.map((d, i) => {
          const total = Number(d.aum) || 0;
          const fti = Number(d.fti_amount) || 0;
          const barH = total > 0 ? Math.max((total / max) * 150, 3) : 0;
          const ftiH = total > 0 ? (Math.max(0, Math.min(fti, total)) / total) * barH : 0;
          const latest = i === data.length - 1;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end gap-1.5"
              style={{ minWidth: 0, height: "100%" }}
            >
              <span
                className="ed-num"
                style={{ fontSize: 9, color: latest ? "var(--ed-ink)" : "var(--ed-ink-faint)" }}
              >
                {total === 0 ? "" : (total / 1e7).toFixed(1)}
              </span>
              <div
                style={{
                  width: "100%", maxWidth: 30, height: 150,
                  display: "flex", flexDirection: "column", justifyContent: "flex-end",
                }}
              >
                <div style={{ height: barH - ftiH, background: "var(--ed-rule-faint)" }} />
                <div style={{ height: ftiH, background: "var(--ed-ink)" }} />
              </div>
              <span className="ed-caption" style={{ fontSize: 9, whiteSpace: "nowrap" }}>
                {labelOf(d)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 ed-caption">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 9, height: 9, background: "var(--ed-ink)", display: "inline-block" }} />
          First-time money
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 9, height: 9, background: "var(--ed-rule-faint)", display: "inline-block" }} />
          Repeat money
        </span>
        <span style={{ color: "var(--ed-ink-faint)" }}>Bar labels: AUM in ₹ crore.</span>
      </div>
    </div>
  );
}

/* The latest-week funnel as ruled, labelled bars. */
const FUNNEL_STAGES = [
  ["reg_success_pct", "Registration complete"],
  ["email_verified_pct", "Email verified"],
  ["mobile_verified_pct", "Mobile verified"],
  ["landed_pan_pct", "Landed on PAN"],
  ["kyc_init_pct", "KYC initiated"],
  ["ucc_kyc_init_pct", "UCC / KYC initiated"],
];

function FunnelSteps({ funnel }) {
  if (!funnel) {
    return <p className="ed-prose-italic">No funnel data for this partner yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 520 }}>
      {FUNNEL_STAGES.map(([key, label]) => {
        const v = Number(funnel[key]);
        const pct = Number.isFinite(v) ? v : 0;
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between ed-caption mb-1">
              <span style={{ color: "var(--ed-ink)" }}>{label}</span>
              <span className="ed-num">{fmtPct(funnel[key])}</span>
            </div>
            <div style={{ height: 6, background: "var(--ed-rule-faint)" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(Math.min(pct, 100), 0)}%`,
                  background: "var(--ed-ink)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PartnerSectionHead({ title, deck }) {
  return (
    <header className="mb-6">
      <hr className="ed-rule-thick mb-4" />
      <h2 className="ed-headline" style={{ fontSize: "clamp(24px, 3.6vw, 36px)" }}>
        <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
          {title}
        </em>
      </h2>
      {deck && <p className="ed-prose-italic mt-2" style={{ maxWidth: "58ch" }}>{deck}</p>}
    </header>
  );
}

export default function GripConnectPartnerEdition({ project, partner, northStar, funnel, onBack }) {
  const { loading, error, weekly, monthly } = usePartnerData(project, partner);

  // weekly comes newest-first; the bar chart and ledger read chronologically.
  const weeksChrono = React.useMemo(() => [...weekly].reverse(), [weekly]);
  const ns = {};
  for (const r of northStar || []) ns[r.metric] = r;

  // Monthly AUM — completed calendar months only. The current month is partial
  // and already covered by the MTD headline, so it is excluded here.
  const monthView = React.useMemo(() => {
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const complete = (monthly || []).filter((m) => m.month && m.month < curKey);
    const firstNonZero = complete.findIndex((m) => Number(m.aum) > 0);
    const trimmed = firstNonZero > 0 ? complete.slice(firstNonZero) : complete;
    const idx = complete.findIndex((m) => m.month === prevKey);
    return {
      chart: trimmed.slice(-14),
      lastFull: idx >= 0 ? complete[idx] : null,
      lastFullPrev: idx > 0 ? complete[idx - 1] : null,
      prevKey,
    };
  }, [monthly]);

  const lastFullCr = monthView.lastFull != null ? Number(monthView.lastFull.aum) / 1e7 : null;
  const lastFullPrevCr =
    monthView.lastFullPrev != null ? Number(monthView.lastFullPrev.aum) / 1e7 : null;
  const lastFullDelta =
    lastFullCr != null && lastFullPrevCr != null && lastFullPrevCr !== 0
      ? Number(((100 * (lastFullCr - lastFullPrevCr)) / lastFullPrevCr).toFixed(1))
      : null;

  const metricCols = [
    { key: "week", label: "Week", render: (r) => fmtWeek(r.week) },
    { key: "reg", label: "Registrations", align: "right", mono: true, render: (r) => fmtCount(r.no_of_registrations) },
    { key: "orders", label: "Orders", align: "right", mono: true, render: (r) => fmtCount(r.no_orders) },
    { key: "fti", label: "First-time", align: "right", mono: true, render: (r) => fmtCount(r.fti_count) },
    {
      key: "aov", label: "AOV", align: "right", mono: true,
      render: (r) => (r.aov == null || r.aov === "" ? "—" : `₹${nf.format(Math.round(Number(r.aov)))}`),
    },
  ];

  return (
    <article className="ed-set">
      {/* ── Dossier masthead ──────────────────────────────────────────────*/}
      <button
        type="button"
        onClick={onBack}
        className="ed-caption hover:underline"
        style={{ color: "var(--ed-ink-muted)", minHeight: 44 }}
      >
        ← THE COMBINED REPORT
      </button>
      <header className="mt-3">
        <p className="ed-caption mb-2">PARTNER DOSSIER · INTERNAL EDITION</p>
        <h1 className="ed-masthead" style={{ fontSize: "clamp(40px, 9vw, 88px)", lineHeight: 1.02 }}>
          {partner}
        </h1>
        <hr className="ed-rule-double mt-4" />
        <p className="ed-dateline mt-3">
          A DEEPER READ · MONTH-TO-DATE HEADLINE &amp; MONTHLY HISTORY
        </p>
      </header>

      {/* ── The headline ─────────────────────────────────────────────────*/}
      <section className="mt-10">
        <p className="ed-overline mb-3">THE HEADLINE — MONTH TO DATE</p>
        <div className="grid grid-cols-3 gap-x-4" style={{ maxWidth: 480 }}>
          <NorthStarFigure label="AUM" row={ns.AUM} fmt={fmtAum} />
          <NorthStarFigure label="First-time" row={ns.FTI} fmt={fmtCount} />
          <NorthStarFigure label="Repeat" row={ns.Repeat} fmt={fmtCount} />
        </div>
      </section>

      {/* ── AUM month by month ───────────────────────────────────────────*/}
      <section className="mt-14">
        <PartnerSectionHead
          title="Assets, month by month"
          deck="Every completed calendar month of AUM — the long view behind this month's headline."
        />
        <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--ed-rule-faint)" }}>
          <p className="ed-caption mb-1">LAST COMPLETE MONTH · {fmtMonthLong(monthView.prevKey)}</p>
          <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
            <span className="ed-stat-num" style={{ fontSize: 30 }}>
              {lastFullCr == null ? "—" : fmtAum(lastFullCr)}
            </span>
            {lastFullDelta != null && <Delta pct={lastFullDelta} />}
            {lastFullPrevCr != null && (
              <span className="ed-caption" style={{ color: "var(--ed-ink-faint)" }}>
                vs {fmtAum(lastFullPrevCr)} the month before
              </span>
            )}
          </div>
        </div>
        {loading ? (
          <SkeletonBlock h={200} />
        ) : (
          <AumBarChart
            data={monthView.chart}
            labelOf={(m) => fmtMonth(m.month)}
            emptyText="No monthly history for this partner yet."
          />
        )}
      </section>

      {/* ── AUM week by week ─────────────────────────────────────────────*/}
      <section className="mt-14">
        <PartnerSectionHead
          title="Assets, week by week"
          deck="The recent weeks up close — total AUM each week, split into first-time and repeat money."
        />
        {loading ? (
          <SkeletonBlock h={200} />
        ) : (
          <AumBarChart
            data={weeksChrono}
            labelOf={(w) => fmtWeek(w.week)}
            emptyText="No weekly history for this partner yet."
          />
        )}
      </section>

      {/* ── Weekly counts ────────────────────────────────────────────────*/}
      <section className="mt-14">
        <PartnerSectionHead
          title="The weekly count"
          deck="Registrations, orders, first-time investors and average order value — most recent weeks first."
        />
        <LedgerTable cols={metricCols} rows={weekly} loading={loading} />
      </section>

      {/* ── Funnel ───────────────────────────────────────────────────────*/}
      <section className="mt-14">
        <PartnerSectionHead
          title="Registration to KYC"
          deck="Where this partner's registered users reach in the latest week — each step a share of registrations."
        />
        <FunnelSteps funnel={funnel} />
      </section>

      {error && (
        <p className="ed-caption mt-8" style={{ color: "var(--ed-rust)" }}>
          Some data could not be loaded: {error}
        </p>
      )}
    </article>
  );
}
