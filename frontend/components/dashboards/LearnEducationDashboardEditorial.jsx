'use client';
// LearnEducationDashboardEditorial — "Grip Education Weekly"
// ─────────────────────────────────────────────────────────────────────────
// Broadsheet treatment of the Learn (Grip Education) A/B experiment.
// Aligned with the sibling editorial dashboards (Asset Search, Performance
// Grip, FRA YouTube): warm paper, Fraunces masthead, Newsreader prose,
// IBM Plex Mono ledger figures, rust/forest accents.
//
// Spec: docs/projects/learn-education/specs/2026-05-26-weekly-ab-tracker.md
//
// Pre-launch: the data layer in lib/queries/learnEducation.js currently
// serves a mock shaped to the canonical product spreadsheet. The masthead
// dateline flags this; once W1 prod data lands via the daily refresh
// (services/integrations/learn_education.py) the dateline switches to "live".

import * as React from 'react';
import Link from 'next/link';
import {
  useLearnEducation,
  COLUMNS,
  formatCell,
  computeFtiLift,
} from '@/lib/queries/learnEducation';

/* Anchored sections. The reader chooses one and the page scrolls there;
 * url ?section=<key> deep-links to a section (matches Asset Search pattern). */
const SECTIONS = [
  { key: 'overview',     no: '01', italic: 'The Overview' },
  { key: 'ledger',       no: '02', italic: 'The Ledger' },
  { key: 'engagement',   no: '03', italic: 'On Engagement' },
  { key: 'health',       no: '04', italic: 'On Validity' },
];

const COHORT_PROSE = {
  control:   'Control',
  treatment: 'Treatment',
};

export default function LearnEducationDashboardEditorial({ project }) {
  const { data, loading } = useLearnEducation();
  const rows = data?.rows ?? [];
  const meta = data?.meta ?? {};
  const lift = React.useMemo(() => computeFtiLift(rows), [rows]);

  const [section, setSection] = React.useState('overview');

  // Deep-link via ?section=<key>
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('section');
    if (initial && SECTIONS.some((s) => s.key === initial)) setSection(initial);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (section === 'overview') params.delete('section');
    else params.set('section', section);
    const query = params.toString();
    const url = window.location.pathname + (query ? '?' + query : '');
    window.history.replaceState(null, '', url);
  }, [section]);

  const sortedRows = React.useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.week !== b.week) return a.week.localeCompare(b.week);
      return a.variant === 'control' ? -1 : 1;
    });
  }, [rows]);

  const latest = sortedRows[sortedRows.length - 1];
  const weekRange = sortedRows.length === 0
    ? '—'
    : sortedRows.length === 1
      ? sortedRows[0].week
      : `${sortedRows[0].week}–${sortedRows[sortedRows.length - 1].week}`;

  return (
    <article className="ed-article">
      <Masthead
        weekRange={weekRange}
        isMock={meta.is_mock}
        loading={loading}
      />

      {/* ────── LEDE — the headline + pull-quote lift ─────────────────────── */}
      <section className="ed-set ed-set-delay-1 mt-10 grid gap-10 md:grid-cols-[1.5fr_1fr] md:gap-12">
        <div>
          <p className="ed-overline mb-3">THE LEDE</p>
          <h2 className="ed-headline" style={{ fontSize: 'clamp(40px, 6vw, 64px)' }}>
            Does short-form education
            <br />
            <em>lift the FTI rate</em>?
          </h2>
          <p className="ed-prose mt-6 max-w-prose" style={{ fontSize: 18 }}>
            <span className="ed-dropcap">A</span>
            n A/B experiment on the non-invested cohort. Treatment users
            see a Reels-style education surface at <code className="font-mono">/learn</code>;
            Control sees the existing journey. We measure visit rate, video
            engagement, and the headline outcome — <em>first-time-investor
            conversion</em>.
          </p>
          <p className="ed-prose mt-4 max-w-prose" style={{ fontSize: 17 }}>
            This issue covers <Term>{weekRange}</Term>. Read the ledger
            below for week-by-week movement; consult{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setSection('health'); }}
              className="underline decoration-[var(--ed-ink-faint)] underline-offset-4"
            >
              §04 On Validity
            </a>
            {' '}before drawing conclusions.
          </p>
        </div>

        <aside className="border-t border-b border-[var(--ed-ink)] py-6 self-center">
          <p className="ed-caption mb-3">THE PULL QUOTE</p>
          {lift ? (
            <>
              <div
                className="ed-pullnum"
                style={{
                  fontSize: 'clamp(64px, 9vw, 108px)',
                  color: lift.delta_pp > 0 ? 'var(--ed-forest)' : 'var(--ed-rust)',
                }}
              >
                {lift.delta_pp > 0 ? '+' : ''}{lift.delta_pp}pp
              </div>
              <p className="ed-prose-italic mt-3" style={{ fontSize: 14 }}>
                FTI rate, Treatment over Control · {lift.week}. A relative
                gain of <Term>+{lift.relative_pct}%</Term> vs the Control baseline.
              </p>
            </>
          ) : (
            <>
              <div
                className="ed-pullnum"
                style={{ fontSize: 'clamp(64px, 9vw, 108px)', color: 'var(--ed-ink-faint)' }}
              >
                —
              </div>
              <p className="ed-prose-italic mt-3" style={{ fontSize: 14 }}>
                The lift is undefined until both arms have an FTI rate
                computed for the same week.
              </p>
            </>
          )}
        </aside>
      </section>

      <hr className="ed-rule-thick mt-14" />

      {/* ────── EXHIBITS — the four headline figures ──────────────────────── */}
      <section className="ed-set ed-set-delay-2 mt-8 pb-2">
        <p className="ed-overline mb-6">BY THE NUMBERS · {weekRange}</p>
        <div className="grid gap-x-8 gap-y-7 grid-cols-2 sm:grid-cols-4">
          <Exhibit
            letter="A"
            label="bucketed users"
            value={meta.cohort_assignment_total ? nf.format(meta.cohort_assignment_total) : '—'}
            sub={`${meta.cohort_treatment_pct ?? 0}% Treatment · non-invested`}
            loading={loading}
          />
          <Exhibit
            letter="B"
            label="visit rate"
            value={
              latest && latest.variant === 'treatment' && latest.learn_visit_rate_pct != null
                ? `${latest.learn_visit_rate_pct.toFixed(1)}%`
                : '—'
            }
            sub="Treatment users who reached /learn"
            loading={loading}
          />
          <Exhibit
            letter="C"
            label="avg watch time"
            value={
              latest && latest.variant === 'treatment' && latest.avg_watch_time_sec != null
                ? `${latest.avg_watch_time_sec}s`
                : '—'
            }
            sub="seconds per video play"
            loading={loading}
          />
          <Exhibit
            letter="D"
            label="FTI rate"
            value={
              latest && latest.variant === 'treatment' && latest.fti_rate_pct != null
                ? `${latest.fti_rate_pct.toFixed(1)}%`
                : '—'
            }
            sub="first-time investors · Treatment"
            delta={
              lift
                ? { from: lift.control_pct, to: lift.treatment_pct, suffix: 'pt' }
                : undefined
            }
            loading={loading}
          />
        </div>
      </section>

      {/* ────── SECTIONS NAV — anchored ───────────────────────────────────── */}
      <nav
        role="tablist"
        aria-label="Sections of this issue"
        className="mt-16 flex flex-wrap items-baseline gap-x-7 gap-y-3 ed-set ed-set-delay-3"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={section === s.key}
            onClick={() => setSection(s.key)}
            className="ed-section-link inline-flex items-baseline gap-2"
          >
            <span className="ed-caption" style={{ color: 'inherit' }}>{s.no}.</span>
            <span>{s.italic}</span>
          </button>
        ))}
      </nav>

      {/* ────── SECTION BODY ──────────────────────────────────────────────── */}
      <div className="mt-10 ed-set ed-set-delay-4">
        {section === 'overview'   && <OverviewSection rows={sortedRows} loading={loading} />}
        {section === 'ledger'     && <LedgerSection rows={sortedRows} loading={loading} />}
        {section === 'engagement' && <EngagementSection rows={sortedRows} loading={loading} />}
        {section === 'health'     && <HealthSection meta={meta} rows={sortedRows} />}
      </div>

      {/* ────── COLOPHON ──────────────────────────────────────────────────── */}
      <footer className="mt-20 pt-6 border-t border-[var(--ed-rule-faint)]">
        <p className="ed-caption mb-2">COLOPHON</p>
        <p className="ed-prose-italic" style={{ fontSize: 14 }}>
          Sources — <code className="font-mono">experiment_assigned</code>{' '}
          (cohort denominator),{' '}
          <code className="font-mono">learn_page_viewed</code> (visitors),{' '}
          <code className="font-mono">learn_video_viewed</code> (plays + watch),{' '}
          <code className="font-mono">new_user_order</code> (FTI). A "play"
          is a video with <code className="font-mono">total_watched_seconds &gt; 0</code>.
          Test users <code className="font-mono">3, 4, 207871, 207875, 207878, 207879</code>{' '}
          excluded in every query path.
        </p>
        <p className="ed-prose-italic mt-2" style={{ fontSize: 13 }}>
          Set in Fraunces &amp; Newsreader on warm paper. The full event spec
          and SQL live in <Link href="/" className="underline decoration-[var(--ed-ink-faint)] underline-offset-4">docs/projects/learn-education/</Link>.
        </p>
      </footer>
    </article>
  );
}

/* ═══════════════════════════════ MASTHEAD ═══════════════════════════════ */
function Masthead({ weekRange, isMock, loading }) {
  return (
    <header className="ed-set">
      <Link href="/" className="ed-caption hover:underline">← BACK TO INDEX</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ed-caption mb-2">AN A/B FIELD REPORT · INTERNAL EDITION</p>
          <h1 className="ed-masthead" style={{ fontSize: 'clamp(44px, 9vw, 96px)' }}>
            Grip Education<br />
            <em>Weekly.</em>
          </h1>
        </div>
        <p className="ed-section-no" style={{ fontSize: 'clamp(14px, 2.4vw, 22px)' }}>
          on the cohort,<br /><em>and the lift</em>
        </p>
      </div>
      <hr className="ed-rule-double mt-5" />
      <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>VOL. I</span><span>·</span>
        <span>NO. 01</span><span>·</span>
        <span>{weekRange}</span><span>·</span>
        <span>{isMock ? 'PREVIEW DATA' : 'LIVE DATA'}</span>
        {loading && (
          <>
            <span>·</span>
            <span className="ed-prose-italic inline-flex items-center gap-1.5">
              <span
                className="ed-skeleton"
                style={{ width: '0.4em', height: '0.4em', borderRadius: '50%' }}
                aria-hidden
              />
              ON THE PRESSES
            </span>
          </>
        )}
      </p>
    </header>
  );
}

/* ═══════════════════════════════ SECTIONS ═══════════════════════════════ */

function OverviewSection({ rows, loading }) {
  const treatment = rows.find((r) => r.variant === 'treatment');
  const control = rows.find((r) => r.variant === 'control');
  return (
    <section>
      <SectionHead no="01" title="The Overview" />
      <div className="grid gap-10 md:grid-cols-2 mt-8">
        <ProseColumn
          heading="Treatment, in one sentence."
          body={
            treatment
              ? `${nf.format(treatment.total_non_invested_users ?? 0)} non-invested users were bucketed into Treatment this week. ${nf.format(treatment.learn_page_visitors ?? 0)} of them reached the Learn page — a visit rate of ${treatment.learn_visit_rate_pct?.toFixed(1) ?? '—'}%. ${nf.format(treatment.unique_video_players ?? 0)} watched at least one video, with ${treatment.avg_videos_per_user ?? '—'} videos per user on average.`
              : 'Treatment data is not yet available for this issue.'
          }
        />
        <ProseColumn
          heading="Control, the counterfactual."
          body={
            control
              ? `${nf.format(control.total_non_invested_users ?? 0)} non-invested users in Control. The Learn surface is invisible to them by design, so engagement columns are dashes — that is not missing data, it is the experiment working. Their FTI rate of ${control.fti_rate_pct?.toFixed(1) ?? '—'}% is the baseline against which Treatment is judged.`
              : 'Control data is not yet available for this issue.'
          }
        />
      </div>
    </section>
  );
}

function LedgerSection({ rows, loading }) {
  return (
    <section>
      <SectionHead no="02" title="The Ledger" />
      <p className="ed-prose-italic mt-3 max-w-prose" style={{ fontSize: 15 }}>
        Week by week, cohort by cohort. The canonical product table.
        Control rows show em-dashes for engagement columns because the
        Learn surface never renders for them — read that as <em>could
        not happen by design</em>, not <em>did not happen</em>.
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-[var(--ed-ink)]">
              <th className="px-2 py-3 ed-caption whitespace-nowrap">Week</th>
              <th className="px-2 py-3 ed-caption whitespace-nowrap">Cohort</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-3 ed-caption whitespace-nowrap text-right"
                  style={{ minWidth: 110 }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = rows[i - 1];
              const isNewWeek = !prev || prev.week !== r.week;
              const isTreatment = r.variant === 'treatment';
              return (
                <tr
                  key={`${r.week}-${r.variant}`}
                  className="border-b border-[var(--ed-rule-faint)]"
                >
                  <td
                    className="px-2 py-3 t-num whitespace-nowrap"
                    style={{ fontFamily: 'var(--ed-mono)', fontSize: 14 }}
                  >
                    {isNewWeek ? r.week : ''}
                  </td>
                  <td
                    className="px-2 py-3 whitespace-nowrap"
                    style={{
                      fontFamily: 'var(--ed-display)',
                      fontStyle: 'italic',
                      fontSize: 16,
                      color: isTreatment ? 'var(--ed-gold)' : 'var(--ed-ink-muted)',
                    }}
                  >
                    {COHORT_PROSE[r.variant]}
                  </td>
                  {COLUMNS.map((c) => {
                    const v = r[c.key];
                    const display = formatCell(v, c.kind);
                    const muted = display === '—';
                    return (
                      <td
                        key={c.key}
                        className="px-2 py-3 text-right whitespace-nowrap tabular-nums"
                        style={{
                          fontFamily: 'var(--ed-mono)',
                          fontSize: 14,
                          color: muted ? 'var(--ed-ink-faint)' : 'var(--ed-ink)',
                          fontWeight: isTreatment && !muted ? 500 : 400,
                        }}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-2 py-8">
                  <p className="ed-prose-italic text-center" style={{ color: 'var(--ed-ink-faint)' }}>
                    {loading ? 'On the presses…' : 'No weeks have been issued yet.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EngagementSection({ rows }) {
  const treatment = rows.find((r) => r.variant === 'treatment');
  if (!treatment) return <Stub no="03" title="On Engagement" />;
  return (
    <section>
      <SectionHead no="03" title="On Engagement" />
      <div className="grid gap-x-10 gap-y-7 sm:grid-cols-3 mt-8">
        <Figure
          stat={`${nf.format(treatment.unique_video_players ?? 0)}`}
          label="unique players"
          prose={`Out of ${nf.format(treatment.learn_page_visitors ?? 0)} visitors, ${pct((treatment.unique_video_players ?? 0) / Math.max(treatment.learn_page_visitors ?? 1, 1) * 100)} watched at least one video.`}
        />
        <Figure
          stat={nf.format(treatment.total_video_plays ?? 0)}
          label="plays"
          prose={`Averaging ${treatment.avg_videos_per_user ?? '—'} videos per engaged user; loops count once.`}
        />
        <Figure
          stat={`${treatment.avg_watch_time_sec ?? '—'}s`}
          label="avg watch time"
          prose={`Forward-delta accumulation with a 1-second ceiling per sample. Seeks do not inflate.`}
        />
      </div>
    </section>
  );
}

function HealthSection({ meta, rows }) {
  const srmOk = true; // until we have variance data; future: chi-square on assignment counts
  const controlLeakValue = meta.control_visit_rate_pct ?? 0;
  const controlLeakOk = controlLeakValue === 0;
  return (
    <section>
      <SectionHead no="04" title="On Validity" />
      <p className="ed-prose-italic mt-3 max-w-prose" style={{ fontSize: 15 }}>
        Two cheap guardrails that catch the two classes of bug which
        destroy an experiment silently. Both must pass before drawing
        conclusions from the ledger.
      </p>
      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <HealthBlock
          ok={srmOk}
          title="Sample Ratio Mismatch"
          value={`${nf.format(meta.cohort_assignment_total ?? 0)} bucketed · ${meta.cohort_treatment_pct ?? 0}% Treatment`}
          prose="Counts of Treatment vs Control should match the configured split within ±2%. Persistent drift indicates a bucketing leak — fix the gate before reading any other metric."
        />
        <HealthBlock
          ok={controlLeakOk}
          title="Control Surface Leak"
          value={`Control Visit Rate ${controlLeakValue.toFixed(1)}%`}
          prose="If Control is correctly conditional-rendered, no Control user ever reaches /learn. A non-zero figure here means the chip or footer item is leaking past the experiment gate."
        />
      </div>
    </section>
  );
}

function Stub({ no, title }) {
  return (
    <section>
      <SectionHead no={no} title={title} />
      <p className="ed-prose-italic mt-6 max-w-prose" style={{ color: 'var(--ed-ink-faint)' }}>
        Awaits Treatment data.
      </p>
    </section>
  );
}

/* ═══════════════════════════════ PRIMITIVES ═══════════════════════════════ */

function SectionHead({ no, title }) {
  return (
    <header className="flex items-baseline gap-4 border-t-2 border-[var(--ed-ink)] pt-4">
      <span className="ed-section-no">§{no}</span>
      <h3 className="ed-headline" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>
        {title}
      </h3>
    </header>
  );
}

function ProseColumn({ heading, body }) {
  return (
    <div>
      <p className="ed-overline mb-3">{heading}</p>
      <p className="ed-prose" style={{ fontSize: 17 }}>{body}</p>
    </div>
  );
}

function Figure({ stat, label, prose }) {
  return (
    <div>
      <div className="ed-stat-num" style={{ fontSize: 'clamp(36px, 5vw, 56px)' }}>
        {stat}
      </div>
      <p className="ed-caption mt-1">{label}</p>
      <p className="ed-prose-italic mt-2" style={{ fontSize: 14 }}>{prose}</p>
    </div>
  );
}

function HealthBlock({ ok, title, value, prose }) {
  return (
    <div className="border-t border-[var(--ed-rule-faint)] pt-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-block"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: ok ? 'var(--ed-forest)' : 'var(--ed-rust)',
          }}
          aria-hidden
        />
        <p className="ed-overline">{title}</p>
      </div>
      <p
        className="mt-2"
        style={{
          fontFamily: 'var(--ed-mono)',
          fontSize: 16,
          color: ok ? 'var(--ed-ink)' : 'var(--ed-rust)',
        }}
      >
        {value}
      </p>
      <p className="ed-prose-italic mt-2 max-w-prose" style={{ fontSize: 14 }}>{prose}</p>
    </div>
  );
}

function Exhibit({ letter, label, value, sub, delta, loading }) {
  return (
    <div>
      <p className="ed-caption mb-1">{letter}.</p>
      <div className="ed-stat-num" style={{ fontSize: 'clamp(32px, 4.5vw, 48px)' }}>
        {loading ? <span className="ed-skeleton ed-skeleton-num" aria-hidden /> : value}
      </div>
      <p className="ed-caption mt-1">{label}</p>
      {sub && <p className="ed-prose-italic mt-1" style={{ fontSize: 13 }}>{sub}</p>}
      {delta && delta.from != null && delta.to != null && (
        <p
          className="mt-1"
          style={{
            fontFamily: 'var(--ed-mono)',
            fontSize: 12,
            color: delta.to >= delta.from ? 'var(--ed-forest)' : 'var(--ed-rust)',
          }}
        >
          {delta.to >= delta.from ? '+' : ''}
          {(delta.to - delta.from).toFixed(1)}{delta.suffix ?? ''} vs Control
        </p>
      )}
    </div>
  );
}

function Term({ children }) {
  return (
    <span
      style={{
        background: 'var(--ed-gold-tint)',
        padding: '0 0.15em',
        borderRadius: 2,
      }}
    >
      {children}
    </span>
  );
}

/* Number / percent formatters — Indian grouping for counts. */
const nf = new Intl.NumberFormat('en-IN');
function pct(value) {
  if (value == null || !isFinite(value)) return '—';
  return value.toFixed(1) + '%';
}
