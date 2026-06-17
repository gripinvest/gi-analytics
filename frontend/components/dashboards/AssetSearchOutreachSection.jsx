"use client";
// AssetSearchOutreachSection
// ─────────────────────────────────────────────────────────────────────────
// CS-facing surface inside the Asset Search dashboard. Surfaces every
// user × issuer pair where the user hit a failed search the registry can
// map to a known issuer — Notify Me click is one signal flag, not the
// filter. Most demand never taps the CTA; the list is broader than the
// CTA queue alone.
//
// No PII on this surface. The DuckDB layer carries event payloads only;
// the only join key is `user_id`, which CS uses against their CRM for
// contact detail. Keeping email/phone/name out avoids duplicating
// sensitive data into the (auth-light) web tier.
//
// Persona separation rationale: the rest of this dashboard is leadership-
// facing (trend lines, success rates, weekly comparisons). This section
// is CS-facing — a workbench. Heading style stays Editorial to belong
// inside the same dashboard, but the working area drops to data-dense
// table conventions (compact rows, monospaced numbers, hover affordances,
// sticky filter bar) so a CS rep can clear a queue without scrolling
// through marketing typography.

import * as React from "react";
import {
  dataState,
  decorateOutreachRow,
  getAllStatuses,
  setOutreachStatus,
  statusKey,
  OUTREACH_STATUSES,
} from "@/lib/queries/outreach";

// ── status pill (color + icon + text — never colour-only per a11y) ──────────

const STATUS_META = {
  new: { label: "New", tone: "var(--ed-gold, #b8870a)", glyph: "●" },
  contacted: {
    label: "Contacted",
    tone: "var(--ed-ink-muted, #5d5752)",
    glyph: "◐",
  },
  converted: {
    label: "Converted",
    tone: "var(--ed-forest, #3b5e3d)",
    glyph: "✓",
  },
};

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.new;
  return (
    <span
      className="ed-caption inline-flex items-center gap-1"
      style={{ color: meta.tone, fontWeight: 600, letterSpacing: 0.4 }}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label.toUpperCase()}</span>
    </span>
  );
}

// ── priority tag (P1 → P4, colour-banded) ──────────────────────────────────

const PRIORITY_META = {
  1: { tone: "var(--ed-rust, #a6242b)",      letter: "P1" },
  2: { tone: "var(--ed-gold, #b8870a)",      letter: "P2" },
  3: { tone: "var(--ed-ink-muted, #5d5752)", letter: "P3" },
  4: { tone: "var(--ed-forest, #3b5e3d)",    letter: "P4" },
};

function PriorityTag({ rank, label }) {
  const meta = PRIORITY_META[rank] || PRIORITY_META[3];
  return (
    <span
      className="ed-caption inline-flex items-center gap-1"
      style={{ color: meta.tone, fontWeight: 600, letterSpacing: 0.4 }}
      title={label}
    >
      {meta.letter}
    </span>
  );
}

// ── KPI exhibit (matches Editorial Exhibit visual weight, smaller scale) ────

function MiniExhibit({ label, value, sub }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="ed-caption" style={{ opacity: 0.75 }}>{label}</div>
      <div
        className="ed-headline"
        style={{
          fontSize: 32,
          lineHeight: 1.05,
          fontVariationSettings: "'opsz' 36, 'wght' 500",
        }}
      >
        {value ?? "—"}
      </div>
      {sub && (
        <div className="ed-caption" style={{ opacity: 0.7 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── sortable header cell ────────────────────────────────────────────────────

function HeaderCell({ field, label, sort, setSort, align = "left" }) {
  const active = sort.field === field;
  const dir = active ? sort.dir : "none";
  const toggle = () =>
    setSort((s) =>
      s.field === field
        ? { field, dir: s.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" }
    );
  return (
    <th
      scope="col"
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      className="ed-caption"
      style={{
        textAlign: align,
        padding: 0,
        borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)",
        whiteSpace: "nowrap",
        userSelect: "none",
        color: active ? "var(--ed-ink, #1b1818)" : "var(--ed-ink-muted, #5d5752)",
        background: "transparent",
      }}
    >
      {/* Keyboard-accessible sort trigger — using a real <button> instead
          of an onClick on the <th> so Tab + Enter/Space both work for
          screen-reader and keyboard users. */}
      <button
        type="button"
        onClick={toggle}
        className="ed-caption"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          width: "100%",
          padding: "10px 12px",
          textAlign: align,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          background: "transparent",
          border: "none",
          color: "inherit",
          font: "inherit",
          letterSpacing: "inherit",
          cursor: "pointer",
        }}
      >
        {label}
        <span aria-hidden="true" style={{ opacity: active ? 0.9 : 0.35 }}>
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
        </span>
      </button>
    </th>
  );
}

// ── row action button (minimal, keyboard-accessible) ────────────────────────

function ActionButton({ children, onClick, ariaLabel, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title || ariaLabel}
      className="ed-caption"
      style={{
        padding: "4px 8px",
        background: "transparent",
        border: "1px solid var(--ed-rule-faint, #c8bfa9)",
        color: "var(--ed-ink-soft, #2c2926)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

// ── main section ────────────────────────────────────────────────────────────

const ALL_ISSUER = "__all__";

// Lifecycle ordinal so sorting on "status" produces new → contacted →
// converted instead of alphabetical (contacted < converted < new).
const STATUS_RANK = OUTREACH_STATUSES.reduce((m, s, i) => {
  m[s] = i;
  return m;
}, {});

export default function AssetSearchOutreachSection({
  liveRows,
  sectionNumber = "VI",
  loading = false,
}) {
  const live = Array.isArray(liveRows) ? liveRows : [];
  const state = dataState(live);
  const sourceRows = live; // real data only — no mock fallback

  // ── filter state ────────────────────────────────────────────────────────
  const [issuerFilter, setIssuerFilter] = React.useState(ALL_ISSUER);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [notifiedFilter, setNotifiedFilter] = React.useState("all"); // all | yes | no
  const [search, setSearch] = React.useState("");
  // Default sort: notified-first (warmest leads), then priority rank, then
  // hit count — matches the offline CS_call_list ordering convention.
  const [sort, setSort] = React.useState({ field: "priority_rank", dir: "asc" });

  // Status map is hydrated once from localStorage on mount; updates flow
  // through component state so toggling a status doesn't require a
  // round-trip re-parse and the memo cascade stays minimal.
  const [statusMap, setStatusMap] = React.useState(() => getAllStatuses());

  // ── derive filtered + sorted rows ───────────────────────────────────────
  const issuers = React.useMemo(
    () => Array.from(new Set(sourceRows.map((r) => r.mapped_issuer))).sort(),
    [sourceRows]
  );

  const enrichedRows = React.useMemo(
    () =>
      sourceRows.map((r) => {
        const decorated = decorateOutreachRow(r);
        return {
          ...decorated,
          status: statusMap[statusKey(decorated)]?.status ?? "new",
        };
      }),
    [sourceRows, statusMap]
  );

  const filteredRows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return enrichedRows.filter((r) => {
      if (issuerFilter !== ALL_ISSUER && r.mapped_issuer !== issuerFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (notifiedFilter === "yes" && !r.notified) return false;
      if (notifiedFilter === "no" && r.notified) return false;
      if (needle) {
        // No PII in the search needle — match against user_id, issuer, and
        // the rolled-up `top_searches` query list.
        const hay =
          `${r.user_id || ""} ${r.top_searches || ""} ${r.mapped_issuer || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [enrichedRows, issuerFilter, statusFilter, notifiedFilter, search]);

  const sortedRows = React.useMemo(() => {
    const copy = filteredRows.slice();
    const { field, dir } = sort;
    copy.sort((a, b) => {
      // Status sort uses lifecycle ordinal (new → contacted → converted),
      // not alphabetical. Date sorts use ISO string compare (correct ordering).
      const av = field === "status" ? STATUS_RANK[a.status] ?? 99 : a[field];
      const bv = field === "status" ? STATUS_RANK[b.status] ?? 99 : b[field];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av > bv ? 1 : -1;
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sort]);

  // KPIs depend on the filter set only — sort order doesn't change totals.
  const kpis = React.useMemo(() => {
    const totalHits = filteredRows.reduce((s, r) => s + (r.hit_count || 0), 0);
    const uniqueUsers = new Set(filteredRows.map((r) => r.user_id)).size;
    const notifiedCount = filteredRows.filter((r) => r.notified).length;
    const byIssuer = filteredRows.reduce((m, r) => {
      m[r.mapped_issuer] = (m[r.mapped_issuer] || 0) + (r.hit_count || 0);
      return m;
    }, {});
    const topIssuer =
      Object.entries(byIssuer).sort(([, a], [, b]) => b - a)[0] || null;
    const newCount = filteredRows.filter((r) => r.status === "new").length;
    return {
      totalHits,
      uniqueUsers,
      notifiedCount,
      topIssuer: topIssuer ? { name: topIssuer[0], hits: topIssuer[1] } : null,
      newCount,
    };
  }, [filteredRows]);

  // ── handlers ────────────────────────────────────────────────────────────
  // Tactile feedback comes from the button's :active state; no toast yet.
  const handleCopy = async (text) => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked — accept silently */
    }
  };

  const handleStatusToggle = (row) => {
    const idx = OUTREACH_STATUSES.indexOf(row.status);
    const next = OUTREACH_STATUSES[(idx + 1) % OUTREACH_STATUSES.length];
    setOutreachStatus(row, next);
    setStatusMap((prev) => ({
      ...prev,
      [statusKey(row)]: { status: next, updated_at: new Date().toISOString() },
    }));
  };

  const handleExportCsv = () => {
    if (typeof window === "undefined") return;
    // No PII in this export — `user_id` is the join key against the CRM.
    const headers = [
      "User ID",
      "Priority",
      "Issuer",
      "Source",
      "Category",
      "Hits",
      "Top searches",
      "Tab",
      "First seen",
      "Last seen",
      "Notified",
      "V2",
      "Status",
    ];
    const escape = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = sortedRows.map((r) =>
      [
        r.user_id,
        r.priority_label,
        r.mapped_issuer,
        r.source_label,
        r.issuer_category,
        r.hit_count,
        r.top_searches,
        r.active_tab,
        r.first_active,
        r.last_active,
        r.notified ? "yes" : "no",
        r.seen_v2 ? "yes" : "no",
        r.status,
      ].map(escape).join(",")
    );
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `outreach-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── render ──────────────────────────────────────────────────────────────
  return (
    <section className="ed-set">
      <hr className="ed-rule-thick mb-6" />
      <p className="ed-overline mb-2">{sectionNumber}. The Outreach</p>
      <h2 className="ed-headline" style={{ fontSize: "clamp(34px, 5vw, 56px)" }}>
        <em>The Queue</em>
      </h2>
      <p
        className="ed-prose-italic"
        style={{ maxWidth: "62ch", marginTop: 10 }}
      >
        Every user × issuer pair where the user hit a failed search that the
        registry maps to a known issuer. <strong style={{ fontStyle: "normal", fontWeight: 600 }}>“Notify me”</strong> is one
        column — most demand never taps the CTA. The User ID is the join key
        against your CRM; no PII lives here.
      </p>

      {loading ? (
        <div className="mt-8 flex flex-col gap-2" aria-label="loading">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="ed-skeleton" style={{ height: 28, width: "100%" }} />)}
        </div>
      ) : (
        <>
          {/* Pending-data callout — only shows when no live rows */}
          {state === "pending" && (
            <div
              className="ed-prose-italic"
              style={{
                marginTop: 18,
                padding: "10px 14px",
                background: "var(--ed-gold-tint, rgba(184, 135, 10, 0.10))",
                borderLeft: "3px solid var(--ed-gold, #b8870a)",
                color: "var(--ed-ink-soft, #2c2926)",
                fontSize: 13,
              }}
              role="status"
            >
              <strong style={{ fontStyle: "normal", fontWeight: 600 }}>
                Waiting for live data — no failed-search rows in the current window yet.
              </strong>
            </div>
          )}

      {/* ── KPI exhibits ─────────────────────────────────────────────────── */}
      <div
        className="grid gap-x-8 gap-y-6 mt-8"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        <MiniExhibit
          label="FAILED HITS"
          value={kpis.totalHits}
          sub="in current view"
        />
        <MiniExhibit
          label="UNIQUE USERS"
          value={kpis.uniqueUsers}
          sub="distinct leads"
        />
        <MiniExhibit
          label="NOTIFIED"
          value={kpis.notifiedCount}
          sub="tapped notify-me CTA"
        />
        <MiniExhibit
          label="TOP ISSUER"
          value={kpis.topIssuer ? kpis.topIssuer.name : "—"}
          sub={kpis.topIssuer ? `${kpis.topIssuer.hits} hits` : "no rows"}
        />
        <MiniExhibit
          label="OUTSTANDING"
          value={kpis.newCount}
          sub="awaiting contact"
        />
      </div>

      {/* ── filter bar — sticky inside the section ───────────────────────── */}
      <div
        className="mt-10 flex flex-wrap items-end gap-3"
        style={{
          padding: "12px 14px",
          background: "var(--ed-paper-deep, #ece2cd)",
          border: "1px solid var(--ed-rule-faint, #c8bfa9)",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        <label
          className="flex flex-col gap-1"
          style={{ minWidth: 180 }}
        >
          <span className="ed-caption" style={{ opacity: 0.75 }}>ISSUER</span>
          <select
            value={issuerFilter}
            onChange={(e) => setIssuerFilter(e.target.value)}
            className="ed-prose"
            style={{
              padding: "6px 8px",
              background: "var(--ed-paper, #f2ebdb)",
              border: "1px solid var(--ed-rule, #1b1818)",
              color: "var(--ed-ink, #1b1818)",
              fontSize: 14,
            }}
          >
            <option value={ALL_ISSUER}>All issuers ({issuers.length})</option>
            {issuers.map((iss) => (
              <option key={iss} value={iss}>{iss}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1" style={{ minWidth: 140 }}>
          <span className="ed-caption" style={{ opacity: 0.75 }}>STATUS</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="ed-prose"
            style={{
              padding: "6px 8px",
              background: "var(--ed-paper, #f2ebdb)",
              border: "1px solid var(--ed-rule, #1b1818)",
              color: "var(--ed-ink, #1b1818)",
              fontSize: 14,
            }}
          >
            <option value="all">All</option>
            {OUTREACH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1" style={{ minWidth: 140 }}>
          <span className="ed-caption" style={{ opacity: 0.75 }}>NOTIFIED</span>
          <select
            value={notifiedFilter}
            onChange={(e) => setNotifiedFilter(e.target.value)}
            className="ed-prose"
            style={{
              padding: "6px 8px",
              background: "var(--ed-paper, #f2ebdb)",
              border: "1px solid var(--ed-rule, #1b1818)",
              color: "var(--ed-ink, #1b1818)",
              fontSize: 14,
            }}
          >
            <option value="all">All</option>
            <option value="yes">Tapped CTA</option>
            <option value="no">Did not tap</option>
          </select>
        </label>

        <label className="flex flex-col gap-1" style={{ flex: 1, minWidth: 200 }}>
          <span className="ed-caption" style={{ opacity: 0.75 }}>
            SEARCH (USER ID / ISSUER / QUERY)
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. 20110, muthoot, vedika"
            className="ed-prose"
            style={{
              padding: "6px 8px",
              background: "var(--ed-paper, #f2ebdb)",
              border: "1px solid var(--ed-rule, #1b1818)",
              color: "var(--ed-ink, #1b1818)",
              fontSize: 14,
            }}
          />
        </label>

        <div className="flex items-center gap-2">
          <span className="ed-caption" style={{ opacity: 0.75 }}>
            {sortedRows.length} row{sortedRows.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={sortedRows.length === 0}
            className="ed-caption"
            style={{
              padding: "6px 12px",
              background: "var(--ed-ink, #1b1818)",
              color: "var(--ed-paper, #f2ebdb)",
              border: "none",
              cursor: sortedRows.length === 0 ? "not-allowed" : "pointer",
              opacity: sortedRows.length === 0 ? 0.4 : 1,
              fontWeight: 600,
              letterSpacing: 0.6,
            }}
          >
            EXPORT CSV
          </button>
        </div>
      </div>

      {/* ── outreach table ───────────────────────────────────────────────── */}
      <div className="mt-4" style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--ed-mono, ui-monospace)",
            fontSize: 12.5,
            minWidth: 980,
          }}
        >
          <thead>
            <tr>
              <HeaderCell field="user_id"        label="USER ID"      sort={sort} setSort={setSort} />
              <HeaderCell field="priority_rank"  label="PRIORITY"     sort={sort} setSort={setSort} />
              <HeaderCell field="mapped_issuer"  label="ISSUER"       sort={sort} setSort={setSort} />
              <HeaderCell field="source_label"   label="SOURCE"       sort={sort} setSort={setSort} />
              <HeaderCell field="top_searches"   label="TOP SEARCHES" sort={sort} setSort={setSort} />
              <HeaderCell field="hit_count"      label="HITS"         sort={sort} setSort={setSort} align="right" />
              <HeaderCell field="last_active"    label="LAST SEEN"    sort={sort} setSort={setSort} />
              <HeaderCell field="notified"       label="NOTIFIED"     sort={sort} setSort={setSort} />
              <HeaderCell field="status"         label="STATUS"       sort={sort} setSort={setSort} />
              <th
                scope="col"
                className="ed-caption"
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)",
                  textAlign: "right",
                  color: "var(--ed-ink-muted, #5d5752)",
                }}
              >
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="ed-prose-italic"
                  style={{ padding: 24, textAlign: "center", opacity: 0.7 }}
                >
                  No leads match the current filter.
                </td>
              </tr>
            ) : (
              sortedRows.map((row, idx) => (
                <tr
                  key={`${row.user_id}-${row.mapped_issuer}`}
                  style={{
                    background:
                      idx % 2 === 0
                        ? "transparent"
                        : "var(--ed-paper-deep, #ece2cd)",
                  }}
                >
                  <td style={cellStyle}>
                    <span
                      style={{ color: "var(--ed-ink, #1b1818)", fontWeight: 500 }}
                    >
                      {row.user_id}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <PriorityTag rank={row.priority_rank} label={row.priority_label} />
                  </td>
                  <td style={cellStyle}>
                    <div>{row.mapped_issuer}</div>
                    <div
                      className="ed-caption"
                      style={{
                        opacity: 0.65,
                        fontSize: 10.5,
                        letterSpacing: 0.5,
                      }}
                    >
                      {row.issuer_category === "catalog_gap"   ? "NOT ON PLATFORM" :
                       row.issuer_category === "availability"  ? "CYCLING / SOLD OUT" :
                       row.issuer_category === "alias"         ? "ALIAS GAP" :
                                                                  "HEALTHY"}
                    </div>
                  </td>
                  <td style={cellStyle}>
                    <span className="ed-caption" style={{ letterSpacing: 0.4, opacity: row.is_gc ? 1 : 0.7 }}>
                      {row.source_label || "Platform"}
                    </span>
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      fontStyle: "italic",
                      maxWidth: 280,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.top_searches}
                  >
                    “{row.top_searches}”
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {row.hit_count}
                  </td>
                  <td style={cellStyle}>{formatWhen(row.last_active)}</td>
                  <td style={cellStyle}>
                    {row.notified ? (
                      <span
                        className="ed-caption"
                        style={{
                          color: "var(--ed-forest, #3b5e3d)",
                          fontWeight: 600,
                          letterSpacing: 0.4,
                        }}
                      >
                        ● TAPPED
                      </span>
                    ) : (
                      <span
                        className="ed-caption"
                        style={{ opacity: 0.5, letterSpacing: 0.4 }}
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td style={cellStyle}>
                    <StatusPill status={row.status} />
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      <ActionButton
                        ariaLabel={`Copy user ID ${row.user_id}`}
                        onClick={() => handleCopy(String(row.user_id))}
                      >
                        Copy ID
                      </ActionButton>
                      <ActionButton
                        ariaLabel={`Cycle status for user ${row.user_id}`}
                        title="Cycle: new → contacted → converted → new"
                        onClick={() => handleStatusToggle(row)}
                      >
                        Next status →
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* CS-actionable Metabase question footnote — explains what to do next */}
      <p
        className="ed-caption"
        style={{ marginTop: 18, opacity: 0.75, maxWidth: "70ch" }}
      >
        Once V2 is live, a saved Metabase question (parametrised by issuer +
        date range) will pull the same rows directly for export to your
        outreach tool. Status changes here are stored locally to your
        browser — they don’t persist across devices yet.
      </p>
        </>
      )}
    </section>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

const cellStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--ed-rule-faint, #c8bfa9)",
  color: "var(--ed-ink-soft, #2c2926)",
  verticalAlign: "top",
};

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / 36e5;
    if (diffHrs < 1) return "< 1h ago";
    if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`;
    const diffDays = diffHrs / 24;
    if (diffDays < 7) return `${Math.round(diffDays)}d ago`;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}
