"use client";
// GripConnectDashboardEditorial
// ─────────────────────────────────────────────────────────────────────────
// Editorial-styled dashboard for the Grip Connect partner-distribution
// project. Unlike the Asset Search dashboard (which computes everything from
// raw event tables), Grip Connect's CSVs are already aggregated — one row
// per partner/metric. So this component just SELECT *s the six tables and
// lays them out as a printed partner report: masthead, North Star exhibits,
// then ruled comparison tables for the funnel / hand-off / upload metrics.
//
// Metrics 5 (webhook delivery) and 6 (app holders) have no real data yet —
// they render as "awaiting data" plates rather than empty tables.

import * as React from "react";
import Link from "next/link";
import { runQuery, refreshProject, pollRefresh } from "@/lib/api";

/* ── partner colour-coding ────────────────────────────────────────────────
   Each partner gets a stable accent so it's recognisable across sections.
   Drawn from the editorial palette — muted, print-appropriate. */
const PARTNER_ORDER = ["ET Money", "Paisa Bazaar", "Mobikwik", "Tata Digital"];

/* ── number formatting ────────────────────────────────────────────────────*/
const nf = new Intl.NumberFormat("en-IN");
const fmtPct = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(1)}%`);
const fmtCount = (v) => (v == null || v === "" ? "—" : nf.format(Number(v)));
const fmtAum = (v) => (v == null || v === "" ? "—" : `₹${Number(v).toFixed(2)}Cr`);
const fmtAsOf = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/* ── data loading ─────────────────────────────────────────────────────────
   Resolves each table by filename-stem suffix against project.tables (the
   backend prefixes every table with the project id + mangles separators).
   Falls back to the conventional name so the component still works if the
   project metadata hasn't loaded the tables list yet. */
const TABLE_SUFFIXES = {
  northStar:  "01_north_star",
  regKyc:     "02_reg_to_kyc",
  redirect:   "03_redirect_handoff",
  kycUpload:  "04_kyc_upload",
  webhook:    "05_webhook_delivery",
  appHolders: "06_app_holders",
};

function resolveTable(tables, suffix, projectId) {
  const hit = (tables || []).find((t) => t.endsWith(suffix));
  return hit || `${projectId}__${suffix}`;
}

function useGripConnect(project, nonce) {
  const [state, setState] = React.useState({ loading: true, error: null, data: {} });

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: {} });

    const keys = Object.keys(TABLE_SUFFIXES);
    Promise.all(
      keys.map((k) => {
        const table = resolveTable(project.tables, TABLE_SUFFIXES[k], project.id);
        return runQuery(project.id, `SELECT * FROM "${table}"`, 200)
          .then((r) => [k, r])
          .catch((e) => [k, { error: String((e && e.message) || e) }]);
      })
    ).then((pairs) => {
      if (cancelled) return;
      const data = {};
      for (const [k, r] of pairs) data[k] = r;
      // A fatal error only if EVERY table failed — a single bad table
      // shouldn't blank the whole report.
      const allFailed = pairs.every(([, r]) => r && r.error);
      setState({
        loading: false,
        error: allFailed ? pairs[0][1].error : null,
        data,
      });
    });

    return () => { cancelled = true; };
  }, [project.id, project.tables, nonce]);

  return state;
}

/* ── small presentational helpers ─────────────────────────────────────────*/

// Sort raw query rows into the canonical partner order so every section
// reads ET Money → Paisa Bazaar → Mobikwik → Tata Digital top to bottom.
function byPartnerOrder(rows, key = "partner") {
  return [...(rows || [])].sort(
    (a, b) => PARTNER_ORDER.indexOf(a[key]) - PARTNER_ORDER.indexOf(b[key])
  );
}

function Delta({ pct }) {
  if (pct == null || pct === "" || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const up = n > 0;
  const flat = n === 0;
  const color = flat ? "var(--ed-ink-muted)" : up ? "var(--ed-forest)" : "var(--ed-rust)";
  return (
    <span className="ed-caption" style={{ color, fontWeight: 600, letterSpacing: "0.04em" }}>
      {flat ? "±" : up ? "▲" : "▼"} {Math.abs(n).toFixed(1)}%
    </span>
  );
}

function SkeletonBlock({ h = 200 }) {
  return <div className="ed-skeleton" style={{ width: "100%", height: h, borderRadius: 2 }} aria-label="loading" />;
}

function SectionHead({ no, title, deck }) {
  return (
    <header className="mt-16 mb-7">
      <hr className="ed-rule-thick mb-5" />
      <p className="ed-section-no mb-1">SECTION {no}</p>
      <h2 className="ed-headline" style={{ fontSize: "clamp(28px, 4.5vw, 46px)" }}>
        <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
          {title}
        </em>
      </h2>
      {deck && <p className="ed-prose-italic mt-2" style={{ maxWidth: "60ch" }}>{deck}</p>}
    </header>
  );
}

/* A ruled, monospaced comparison table — the editorial equivalent of a data
   grid. `cols` is [{ key, label, render?, align? }]. */
function LedgerTable({ cols, rows, loading }) {
  if (loading) return <SkeletonBlock h={180} />;
  return (
    <table className="w-full ed-prose" style={{ fontSize: 13, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--ed-ink)" }}>
          {cols.map((c) => (
            <th
              key={c.key}
              className="ed-caption py-2"
              style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: "1px solid var(--ed-rule-faint)" }}>
            {cols.map((c) => (
              <td
                key={c.key}
                className={c.mono ? "ed-num py-2" : "py-2"}
                style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}
              >
                {c.render ? c.render(row) : row[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Section I — North Star ───────────────────────────────────────────────*/
function NorthStarSection({ rows, loading }) {
  // Pivot the long table into { partner: { AUM, FTI, Repeat } }.
  const byPartner = {};
  for (const r of rows || []) {
    (byPartner[r.partner] ||= {})[r.metric] = r;
  }
  const partners = PARTNER_ORDER.filter((p) => byPartner[p]);

  return (
    <section className="ed-set">
      <SectionHead
        no="I"
        title="The North Star"
        deck="Assets under management, first-time investors and repeat investors — month-to-date against the same window one month prior."
      />
      {loading ? (
        <SkeletonBlock h={260} />
      ) : (
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2">
          {partners.map((partner) => {
            const m = byPartner[partner];
            return (
              <div key={partner} className="ed-set">
                <p className="ed-overline mb-3" style={{ color: "var(--ed-ink)" }}>{partner}</p>
                <div className="grid grid-cols-3 gap-x-4">
                  <NorthStarFigure label="AUM" row={m.AUM} fmt={fmtAum} />
                  <NorthStarFigure label="First-time" row={m.FTI} fmt={fmtCount} />
                  <NorthStarFigure label="Repeat" row={m.Repeat} fmt={fmtCount} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NorthStarFigure({ label, row, fmt }) {
  if (!row) return <div><div className="ed-caption">{label}</div><div className="ed-stat-num">—</div></div>;
  return (
    <div className="flex flex-col gap-1">
      <div className="ed-caption">{label}</div>
      <div className="ed-stat-num" style={{ fontSize: 26 }}>{fmt(row.mtd)}</div>
      <Delta pct={row.delta_pct} />
      <div className="ed-caption" style={{ opacity: 0.7 }}>
        was {fmt(row.lmtd)}
      </div>
    </div>
  );
}

/* ── Section II — Registration → KYC funnel ───────────────────────────────*/
function RegKycSection({ rows, loading }) {
  const cols = [
    { key: "partner", label: "Partner" },
    { key: "reg", label: "Reg ✓", align: "right", mono: true, render: (r) => fmtPct(r.reg_success_pct) },
    { key: "email", label: "Email ✓", align: "right", mono: true, render: (r) => fmtPct(r.email_verified_pct) },
    { key: "mobile", label: "Mobile ✓", align: "right", mono: true, render: (r) => fmtPct(r.mobile_verified_pct) },
    { key: "pan", label: "Landed PAN", align: "right", mono: true, render: (r) => fmtPct(r.landed_pan_pct) },
    { key: "kyc", label: "KYC init", align: "right", mono: true, render: (r) => fmtPct(r.kyc_init_pct) },
    { key: "ucc", label: "UCC/KYC", align: "right", mono: true, render: (r) => fmtPct(r.ucc_kyc_init_pct) },
  ];
  return (
    <section className="ed-set">
      <SectionHead
        no="II"
        title="Registration to KYC"
        deck="The hand-off funnel for the week of 4 May 2026 — every step is a share of the partners' registered users."
      />
      <LedgerTable cols={cols} rows={byPartnerOrder(rows)} loading={loading} />
    </section>
  );
}

/* ── Section III — Redirection hand-off ───────────────────────────────────*/
function RedirectSection({ rows, loading }) {
  const sorted = [...(rows || [])].sort((a, b) => {
    if (a.page !== b.page) return String(a.page).localeCompare(String(b.page));
    return PARTNER_ORDER.indexOf(a.partner) - PARTNER_ORDER.indexOf(b.partner);
  });
  const totRedirects = sorted.reduce((s, r) => s + Number(r.redirects || 0), 0);
  const totLanded = sorted.reduce((s, r) => s + Number(r.landed || 0), 0);
  const totRate = totRedirects ? (100 * totLanded) / totRedirects : null;

  const cols = [
    { key: "page", label: "Page", render: (r) => <span style={{ fontFamily: "var(--ed-mono)" }}>{r.page}</span> },
    { key: "partner", label: "Partner" },
    { key: "redirects", label: "Redirects", align: "right", mono: true, render: (r) => fmtCount(r.redirects) },
    { key: "landed", label: "Landed", align: "right", mono: true, render: (r) => fmtCount(r.landed) },
    { key: "rate", label: "Rate", align: "right", mono: true, render: (r) => fmtPct(r.rate_pct) },
  ];
  return (
    <section className="ed-set">
      <SectionHead
        no="III"
        title="The hand-off"
        deck="Redirects from partner apps into Grip pages, and the share that successfully landed — week of 4 May 2026."
      />
      <LedgerTable cols={cols} rows={sorted} loading={loading} />
      {!loading && sorted.length > 0 && (
        <div
          className="flex items-baseline justify-between mt-3 pt-3"
          style={{ borderTop: "2px solid var(--ed-ink)" }}
        >
          <span className="ed-caption" style={{ color: "var(--ed-ink)" }}>All hand-offs</span>
          <span className="ed-num" style={{ fontSize: 14 }}>
            {fmtCount(totLanded)} landed of {fmtCount(totRedirects)} ·{" "}
            <strong>{fmtPct(totRate)}</strong>
          </span>
        </div>
      )}
    </section>
  );
}

/* ── Section IV — KYC upload ──────────────────────────────────────────────*/
function KycUploadSection({ rows, loading }) {
  const cols = [
    { key: "doc_type", label: "Doc type" },
    { key: "requests", label: "Requests", align: "right", mono: true, render: (r) => fmtCount(r.requests) },
    { key: "success", label: "Success", align: "right", mono: true, render: (r) => fmtCount(r.success) },
    { key: "errors", label: "Errors", align: "right", mono: true, render: (r) => fmtCount(r.errors) },
    {
      key: "rate", label: "Error rate", align: "right", mono: true,
      render: (r) => (
        <span style={{ color: Number(r.error_rate_pct) > 3 ? "var(--ed-rust)" : "var(--ed-ink)" }}>
          {fmtPct(r.error_rate_pct)}
        </span>
      ),
    },
  ];
  return (
    <section className="ed-set">
      <SectionHead
        no="IV"
        title="KYC document upload"
        deck="Document-upload success for the week of 4 May 2026. Instrumented for ET Money only so far."
      />
      <LedgerTable cols={cols} rows={rows || []} loading={loading} />
    </section>
  );
}

/* ── Sections V & VI — awaiting-data plates ───────────────────────────────*/
function AwaitingPlate({ no, title, deck, partners }) {
  return (
    <section className="ed-set">
      <SectionHead no={no} title={title} deck={deck} />
      <div
        className="px-5 py-6"
        style={{ border: "1px solid var(--ed-rule-faint)", background: "var(--ed-paper-deep)" }}
      >
        <p className="ed-caption mb-3" style={{ color: "var(--ed-gold)" }}>◷ Awaiting instrumentation</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {partners.map((p) => (
            <span key={p} className="ed-prose-italic">{p}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── main ─────────────────────────────────────────────────────────────────*/
export default function GripConnectDashboardEditorial({ project }) {
  const [nonce, setNonce] = React.useState(0);
  const { loading, error, data } = useGripConnect(project, nonce);
  const [refresh, setRefresh] = React.useState({ state: "idle", error: null });
  const [asOf, setAsOf] = React.useState(
    (project.manifest && project.manifest.refreshed_at) || null
  );

  // Trigger a background refresh: POST, poll to completion, then bump `nonce`
  // so useGripConnect re-fetches and the report updates in place.
  const handleRefresh = React.useCallback(async () => {
    setRefresh({ state: "running", error: null });
    try {
      const { job_id } = await refreshProject(project.id);
      if (!job_id) throw new Error("no job id returned");
      let done = null;
      for (let i = 0; i < 150 && !done; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const p = await pollRefresh(project.id, job_id);
        if (p.status === "done") done = p;
        else if (p.status === "error") {
          setRefresh({ state: "error", error: p.error || "refresh failed" });
          return;
        }
      }
      if (!done) { setRefresh({ state: "error", error: "refresh timed out" }); return; }
      setNonce((n) => n + 1);
      setAsOf(done.finished_at || new Date().toISOString());
      setRefresh({ state: "done", error: null });
      setTimeout(() => setRefresh({ state: "idle", error: null }), 3000);
    } catch (e) {
      setRefresh({ state: "error", error: String((e && e.message) || e) });
    }
  }, [project.id]);

  // On open: if the snapshot is older than the project's reuse window, refresh
  // in the background. The report has already rendered cached data, so this
  // only updates it in place. Fires at most once per mount, and never before
  // a first refresh has produced a manifest.
  const autoFired = React.useRef(false);
  React.useEffect(() => {
    if (autoFired.current) return;
    const win = project.freshness && project.freshness.reuse_window_minutes;
    const stamp = project.manifest && project.manifest.refreshed_at;
    if (!project.refreshable || !win || !stamp) return;
    if ((Date.now() - new Date(stamp).getTime()) / 60000 > win) {
      autoFired.current = true;
      handleRefresh();
    }
  }, [project.refreshable, project.freshness, project.manifest, handleRefresh]);

  const rowsOf = (key) => (data[key] && !data[key].error ? data[key].rows || [] : []);

  if (error) {
    return (
      <section>
        <h2 className="ed-headline mb-3">We couldn't load <em>Grip Connect</em>.</h2>
        <p className="ed-prose-italic">{error}</p>
        <Link href="/" className="ed-btn ed-btn-ghost mt-6 inline-block">← Back to the index</Link>
      </section>
    );
  }

  return (
    <article>
      {/* ── MASTHEAD ─────────────────────────────────────────────────────── */}
      <header className="ed-set">
        <Link href="/" className="ed-caption hover:underline" style={{ color: "var(--ed-ink-muted)" }}>
          ← BACK TO INDEX
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ed-caption mb-2">A PARTNER-DISTRIBUTION REPORT · INTERNAL EDITION</p>
            <h1 className="ed-masthead" style={{ fontSize: "clamp(52px, 11vw, 124px)" }}>
              Grip<br/>Connect.
            </h1>
          </div>
          <p className="ed-section-no" style={{ fontSize: "clamp(16px, 2.6vw, 24px)" }}>
            four partners,<br/>
            <em style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 80" }}>one funnel</em>
          </p>
        </div>
        <hr className="ed-rule-double mt-5" />
        <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>VOL. I</span><span>·</span>
          <span>NO. 01</span><span>·</span>
          <span>WEEK OF MAY 4, 2026</span><span>·</span>
          <span>ET MONEY · PAISA BAZAAR · MOBIKWIK · TATA DIGITAL</span>
          {loading && (
            <>
              <span>·</span>
              <span className="ed-prose-italic inline-flex items-center gap-1.5" style={{ color: "var(--ed-ink-faint)" }}>
                <span className="ed-skeleton" style={{ width: "0.4em", height: "0.4em", borderRadius: "50%" }} aria-hidden />
                ON THE PRESSES
              </span>
            </>
          )}
        </p>

        {/* ── Refresh control — live data from Metabase ─────────────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refresh.state === "running"}
            className="ed-btn ed-btn-ghost"
            style={{ minHeight: 44, minWidth: 44, fontSize: 12 }}
          >
            {refresh.state === "running" ? "Refreshing…" : "Refresh data ↻"}
          </button>
          {refresh.state === "done" && (
            <span className="ed-caption" style={{ color: "var(--ed-forest)" }}>Updated ✓</span>
          )}
          {refresh.state === "error" && (
            <span className="ed-caption" style={{ color: "var(--ed-rust)" }} title={refresh.error || ""}>
              Refresh failed ⚠
            </span>
          )}
          {asOf && refresh.state !== "running" && (
            <span className="ed-caption" style={{ color: "var(--ed-ink-faint)" }}>
              as of {fmtAsOf(asOf)}
            </span>
          )}
        </div>
      </header>

      {/* ── LEDE ─────────────────────────────────────────────────────────── */}
      <section className="mt-10 ed-set ed-set-delay-1">
        <p className="ed-overline mb-3">FROM THE EDITOR</p>
        <p className="ed-lede ed-dropcap" style={{ maxWidth: "60ch" }}>
          Grip Connect places Grip's investment products inside four partner apps. This report
          tracks the money they bring in and the friction along the way — from the first redirect,
          through registration and KYC, to a completed investment.
        </p>
      </section>

      <NorthStarSection rows={rowsOf("northStar")} loading={loading} />
      <RegKycSection rows={rowsOf("regKyc")} loading={loading} />
      <RedirectSection rows={rowsOf("redirect")} loading={loading} />
      <KycUploadSection rows={rowsOf("kycUpload")} loading={loading} />
      <AwaitingPlate
        no="V"
        title="Webhook delivery"
        deck="Order- and KYC-confirmation webhook delivery success per partner. Instrumentation pending."
        partners={PARTNER_ORDER}
      />
      <AwaitingPlate
        no="VI"
        title="App adoption"
        deck="Share of invested users who also hold the Grip app — active app holders over lifetime invested users. Instrumentation pending."
        partners={PARTNER_ORDER}
      />

      {/* ── COLOPHON ─────────────────────────────────────────────────────── */}
      <footer className="mt-16">
        <hr className="ed-rule" />
        <p className="ed-byline mt-4 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 12 }}>
          <span>North Star figures are month-to-date; funnel, hand-off and upload are for the week of 4 May 2026.</span>
          <span>·</span>
          <span>© Grip Invest 2026 · Internal use only.</span>
        </p>
      </footer>
    </article>
  );
}
