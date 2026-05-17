"use client";
// GripConnectPartnerEdition
// ─────────────────────────────────────────────────────────────────────────
// The per-partner "dossier" — a single partner's dedicated edition of the
// Grip Connect report. Where the combined report compares the four partners
// side by side, this digs into one: the headline figures, the week-by-week
// AUM trajectory split into first-time vs repeat money, the weekly counts,
// and that partner's registration→KYC funnel.
//
// Data: the headline + funnel are passed down from the combined report
// (already loaded as layer-2 tables). The weekly history is queried here
// from the layer-1 card_3841 table, filtered to this partner.

import * as React from "react";
import { runQuery } from "@/lib/api";
import {
  fmtAum, fmtCount, fmtPct, SkeletonBlock, LedgerTable, NorthStarFigure,
  resolveTable, DISPLAY_TO_RAW,
} from "./GripConnectDashboardEditorial";

const nf = new Intl.NumberFormat("en-IN");

/* "2026-05-11" -> "11 May" */
function fmtWeek(s) {
  const d = new Date(String(s ?? "").slice(0, 10));
  return Number.isNaN(d.getTime())
    ? String(s ?? "")
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* Fetch this partner's weekly history (card_3841), newest first, ~12 weeks. */
function usePartnerWeekly(project, partner) {
  const [state, setState] = React.useState({ loading: true, error: null, weekly: [] });

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, weekly: [] });

    const raw = DISPLAY_TO_RAW[partner] || partner;
    const table = resolveTable(project.tables, "card_3841_summary_wow", project.id);
    // raw is one of four fixed, code-controlled partner strings — safe to inline.
    const sql = `SELECT * FROM "${table}" WHERE partner = '${raw}' ORDER BY week DESC LIMIT 12`;

    runQuery(project.id, sql, 50)
      .then((r) => {
        if (cancelled) return;
        setState({ loading: false, error: r.error || null, weekly: r.rows || [] });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ loading: false, error: String((e && e.message) || e), weekly: [] });
      });

    return () => { cancelled = true; };
  }, [project.id, project.tables, partner]);

  return state;
}

/* The signature exhibit — a bar per week, height = total AUM, split into
   first-time money (inked) and repeat money (faint). Labels in ₹ crore. */
function AumBars({ weeks }) {
  if (!weeks.length) {
    return <p className="ed-prose-italic">No weekly history for this partner yet.</p>;
  }
  const max = Math.max(...weeks.map((w) => Number(w.aum) || 0), 1);

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 178 }}>
        {weeks.map((w, i) => {
          const total = Number(w.aum) || 0;
          const fti = Number(w.fti_amount) || 0;
          const barH = total > 0 ? Math.max((total / max) * 150, 3) : 0;
          const ftiH = total > 0 ? (Math.min(fti, total) / total) * barH : 0;
          const latest = i === weeks.length - 1;
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
                {(total / 1e7).toFixed(1)}
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
                {fmtWeek(w.week)}
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
  const { loading, error, weekly } = usePartnerWeekly(project, partner);

  // weekly comes newest-first; the bar chart and ledger read chronologically.
  const weeksChrono = React.useMemo(() => [...weekly].reverse(), [weekly]);
  const ns = {};
  for (const r of northStar || []) ns[r.metric] = r;

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
          A DEEPER READ · MONTH-TO-DATE HEADLINE &amp; WEEKLY HISTORY
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

      {/* ── AUM week by week ─────────────────────────────────────────────*/}
      <section className="mt-14">
        <PartnerSectionHead
          title="Assets, week by week"
          deck="Total AUM each week, split into money from first-time investors and money from those coming back."
        />
        {loading ? <SkeletonBlock h={200} /> : <AumBars weeks={weeksChrono} />}
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
          Some weekly data could not be loaded: {error}
        </p>
      )}
    </article>
  );
}
