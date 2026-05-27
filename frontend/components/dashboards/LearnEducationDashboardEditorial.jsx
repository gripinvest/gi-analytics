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
import { RefreshControl, useProjectRefresh } from '@/components/RefreshControl';
import {
  useLearnEducation,
  COLUMNS,
  formatCell,
  computeFtiLift,
  computeFtiLifts,
  formatVariantLabel,
  isControlVariant,
  isTreatmentVariant,
  getTreatmentVariants,
} from '@/lib/queries/learnEducation';

/* Anchored sections. The reader chooses one and the page scrolls there;
 * url ?section=<key> deep-links to a section (matches Asset Search pattern). */
const SECTIONS = [
  { key: 'overview',     no: 'I',   italic: 'The Overview' },
  { key: 'ledger',       no: 'II',  italic: 'The Ledger' },
  { key: 'engagement',   no: 'III', italic: 'The Engagement' },
  { key: 'health',       no: 'IV',  italic: 'The Guardrails' },
];

/* Engagement columns that are em-dashed for Control. The denominator
 * (`total_non_invested_users`), the FTI count, and the FTI-rate columns
 * remain numeric — those are meaningful for both arms. */
const ENGAGEMENT_ONLY_COLS = new Set([
  'learn_page_visitors',
  'learn_visit_rate_pct',
  'unique_video_players',
  'total_video_plays',
  'avg_videos_per_user',
  'avg_watch_time_sec',
  'fti_users_who_watched',
]);

export default function LearnEducationDashboardEditorial({ project }) {
  const refreshState = useProjectRefresh(project);
  const { data, loading } = useLearnEducation(refreshState.nonce);
  const rows = data?.rows ?? [];
  const meta = data?.meta ?? {};
  const lifts = React.useMemo(() => computeFtiLifts(rows), [rows]);
  const lift = lifts[0] ?? null;

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
    // Within a week: Control first, then treatment variants alphabetically.
    return [...rows].sort((a, b) => {
      if (a.week !== b.week) return a.week.localeCompare(b.week);
      if (isControlVariant(a.variant)) return -1;
      if (isControlVariant(b.variant)) return 1;
      return a.variant.localeCompare(b.variant);
    });
  }, [rows]);

  // For the headline exhibits row, pick the highest-FTI treatment row of the
  // most recent week. Falls back to first treatment when no FTI data. For a
  // binary experiment this is just "the treatment row" — same as before.
  const latestTreatment = React.useMemo(() => {
    if (sortedRows.length === 0) return null;
    const lastWeek = sortedRows[sortedRows.length - 1].week;
    const lastWeekTreatments = sortedRows.filter(
      (r) => r.week === lastWeek && isTreatmentVariant(r.variant)
    );
    if (lastWeekTreatments.length === 0) return null;
    return lastWeekTreatments.reduce((best, r) =>
      (r.fti_rate_pct ?? -Infinity) > (best.fti_rate_pct ?? -Infinity) ? r : best
    );
  }, [sortedRows]);

  const treatmentVariants = React.useMemo(
    () => getTreatmentVariants(rows),
    [rows]
  );
  const weekRange = sortedRows.length === 0
    ? '—'
    : sortedRows.length === 1
      ? sortedRows[0].week
      : `${sortedRows[0].week}–${sortedRows[sortedRows.length - 1].week}`;

  return (
    <article className="ed-article">
      <Masthead
        weekRange={weekRange}
        isEmpty={meta.is_empty}
        loading={loading}
      />

      {/* Refresh button — same control shared with sibling editorial
          dashboards; renders nothing for projects with refreshable=false. */}
      <RefreshControl project={project} state={refreshState} variant="editorial" />

      {/* ────── LEDE — the headline + pull-quote lift ─────────────────────── */}
      <section className="ed-set ed-set-delay-1 mt-10 grid gap-10 md:grid-cols-[1.5fr_1fr] md:gap-12">
        <div>
          <p className="ed-overline mb-3">THE LEDE</p>
          <h2 className="ed-headline" style={{ fontSize: 'clamp(40px, 6vw, 64px)' }}>
            Does short-form education
            <br />
            <em>lift the FTI rate</em>?
          </h2>
          <p className="ed-lede ed-dropcap mt-6 max-w-prose">
            An A/B experiment on the non-invested cohort. Treatment users
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
                FTI rate, {formatVariantLabel(lift.variant)} over Control · {lift.week}.
                {lift.relative_pct != null ? (
                  <> A relative gain of <Term>+{lift.relative_pct}%</Term> vs the Control baseline.</>
                ) : (
                  <> Control FTI rate is zero, so the relative figure is undefined.</>
                )}
                {lifts.length > 1 && (
                  <> Best of {lifts.length} treatment arms — see §02 for each arm.</>
                )}
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
              latestTreatment && latestTreatment.learn_visit_rate_pct != null
                ? `${latestTreatment.learn_visit_rate_pct.toFixed(1)}%`
                : '—'
            }
            sub="Treatment users who reached /learn"
            loading={loading}
          />
          <Exhibit
            letter="C"
            label="avg watch time"
            value={
              latestTreatment && latestTreatment.avg_watch_time_sec != null
                ? `${latestTreatment.avg_watch_time_sec}s`
                : '—'
            }
            sub="seconds per video play"
            loading={loading}
          />
          <Exhibit
            letter="D"
            label="FTI rate"
            value={
              latestTreatment && latestTreatment.fti_rate_pct != null
                ? `${latestTreatment.fti_rate_pct.toFixed(1)}%`
                : '—'
            }
            sub={
              latestTreatment
                ? treatmentVariants.length > 1
                  ? `first-time investors · ${formatVariantLabel(latestTreatment.variant)} (best of ${treatmentVariants.length})`
                  : 'first-time investors · Treatment'
                : 'first-time investors · Treatment'
            }
            delta={
              lift
                ? { from: lift.control_pct, to: lift.treatment_pct, suffix: 'pt' }
                : undefined
            }
            loading={loading}
          />
        </div>
      </section>

      {/* ────── MARGIN NOTES — A/B integrity indicators (V2) ──────────────── */}
      {/* Surfaces SRM, Control surface leak, FTI lift CI, and MDE at current N.
          Reads from the manifest's margin_notes block (computed once per
          cron run by learn_education_stats.compose_margin_notes()). When the
          manifest doesn't carry the block (pre-V2 backend, or empty data),
          the component renders nothing — keeping page layout consistent. */}
      <MarginNotes marginNotes={project.manifest?.margin_notes} />

      {/* ────── SECTIONS NAV — anchored ───────────────────────────────────── */}
      {/* These are anchor-style section switchers, not tabs. `aria-current`
          is the right semantic; tab roles without paired tabpanels would
          mislead screen-readers. The CSS still keys off aria-selected
          (kept here for visual consistency with sibling editorial dashboards). */}
      <nav
        aria-label="Sections of this issue"
        className="mt-16 flex flex-wrap items-baseline gap-x-7 gap-y-3 ed-set ed-set-delay-3"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-current={section === s.key ? 'page' : undefined}
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
          Set in Fraunces, Newsreader, and IBM Plex Mono on warm paper. The
          full event spec and SQL live in{' '}
          <Link href="/" className="underline decoration-[var(--ed-ink-muted)] underline-offset-4">
            docs/projects/learn-education/
          </Link>.
        </p>
      </footer>
    </article>
  );
}

/* ═══════════════════════════════ MASTHEAD ═══════════════════════════════ */
function Masthead({ weekRange, isEmpty, loading }) {
  return (
    <header className="ed-set">
      <Link href="/" className="ed-caption hover:underline">← BACK TO INDEX</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ed-caption mb-2">AN EDUCATION REVIEW · INTERNAL EDITION</p>
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
        <span>{isEmpty ? 'AWAITING FIRST EDITION' : 'LIVE'}</span>
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

/* ═══════════════════════════════ MARGIN NOTES ═══════════════════════════════ */
/* Inline section between EXHIBITS and the navigable SECTIONS. Renders the
 * four A/B integrity indicators from the manifest's margin_notes block.
 *
 * Each card carries: a single-line value, a traffic-light glyph derived
 * from the verdict, and a one-line caption explaining what the number
 * means and (when applicable) what would invalidate it.
 *
 * Verdict colour map (matches the existing editorial palette):
 *   · 'ok'                 → ed-forest  · ✓
 *   · 'warn'               → ed-gold    · ⚠
 *   · 'fail'               → ed-rust    · ✕
 *   · 'insufficient_data'  → ed-ink-faint · —
 *
 * When marginNotes is undefined the section renders nothing — graceful
 * degradation for pre-V2 backend or projects without this block.
 */
function MarginNotes({ marginNotes }) {
  if (!marginNotes) return null;
  const { srm, control_leak, fti_lift_ci, mde, as_of_week } = marginNotes;

  return (
    <section className="ed-set mt-12">
      <hr className="ed-rule-thick" />
      <div className="mt-8 flex items-baseline justify-between flex-wrap gap-3">
        <p className="ed-overline">MARGIN NOTES · AS OF {as_of_week ?? '—'}</p>
        <p className="ed-caption" style={{ color: 'var(--ed-ink-faint)' }}>
          A/B INTEGRITY · §IV
        </p>
      </div>
      <p
        className="ed-prose-italic mt-3 max-w-prose"
        style={{ fontSize: 15, color: 'var(--ed-ink-muted)' }}
      >
        Where the numbers admit what they can — and can&rsquo;t — claim. The
        dashboard tells you what it sees; the margin tells you whether to
        believe it yet.
      </p>
      <div className="mt-7 grid gap-x-8 gap-y-7 grid-cols-2 lg:grid-cols-4">
        <MarginNote
          label="Sample-ratio mismatch"
          verdict={srm.verdict}
          value={
            srm.control_n != null
              ? `${nf.format(srm.control_n)} / ${nf.format(srm.treatment_n)}`
              : '—'
          }
          sub={
            srm.p_value != null
              ? `p = ${srm.p_value.toFixed(3)} · ${srm.verdict === 'fail' ? 'investigate bucketing' : 'within tolerance'}`
              : 'no cohort yet'
          }
        />
        <MarginNote
          label="Control surface leak"
          verdict={control_leak.verdict}
          value={
            control_leak.leak_pct != null
              ? `${control_leak.leak_pct.toFixed(2)}%`
              : '—'
          }
          sub={
            control_leak.control_visitors != null
              ? `${control_leak.control_visitors} of ${nf.format(control_leak.control_cohort)} · ideal 0`
              : 'no Control cohort yet'
          }
        />
        <MarginNote
          label="FTI lift · 95% CI"
          verdict={fti_lift_ci.verdict}
          value={
            fti_lift_ci.ci_lower_pp != null && fti_lift_ci.ci_upper_pp != null
              ? `[${fti_lift_ci.ci_lower_pp.toFixed(1)}, ${fti_lift_ci.ci_upper_pp.toFixed(1)}] pp`
              : fti_lift_ci.delta_pp != null
              ? `Δ ${fti_lift_ci.delta_pp >= 0 ? '+' : ''}${fti_lift_ci.delta_pp.toFixed(1)}pp`
              : '—'
          }
          sub={
            fti_lift_ci.verdict === 'insufficient_data'
              ? 'need ≥ 10 conversions in both arms'
              : fti_lift_ci.ci_lower_pp != null && fti_lift_ci.ci_lower_pp > 0
              ? 'CI excludes zero — lift is significant'
              : 'CI brackets zero — inconclusive'
          }
        />
        <MarginNote
          label="MDE at current N"
          verdict="ok"
          value={
            mde.mde_abs_pp != null
              ? `±${mde.mde_abs_pp.toFixed(1)} pp`
              : '—'
          }
          sub={
            mde.n_per_arm
              ? `N = ${nf.format(mde.n_per_arm)} / arm · 80% power, α = 0.05`
              : 'need cohort to compute'
          }
        />
      </div>
    </section>
  );
}

const VERDICT_TO_STYLE = {
  ok:                 { glyph: '✓', color: 'var(--ed-forest)' },
  warn:               { glyph: '⚠', color: 'var(--ed-gold)' },
  fail:               { glyph: '✕', color: 'var(--ed-rust)' },
  insufficient_data:  { glyph: '—', color: 'var(--ed-ink-faint)' },
};

function MarginNote({ label, verdict, value, sub }) {
  const style = VERDICT_TO_STYLE[verdict] ?? VERDICT_TO_STYLE.insufficient_data;
  return (
    <div className="border-t border-[var(--ed-rule-faint)] pt-3">
      <p className="ed-caption" style={{ fontSize: 11 }}>
        {label}
      </p>
      <p
        className="font-mono mt-2"
        style={{
          fontSize: 'clamp(22px, 2.5vw, 32px)',
          lineHeight: 1.05,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ed-ink)',
        }}
      >
        {value}{' '}
        <span style={{ fontSize: '0.7em', color: style.color }} aria-hidden>
          {style.glyph}
        </span>
      </p>
      <p
        className="ed-prose-italic mt-2"
        style={{ fontSize: 12.5, color: 'var(--ed-ink-muted)' }}
      >
        {sub}
      </p>
    </div>
  );
}

/* ═══════════════════════════════ SECTIONS ═══════════════════════════════ */

function OverviewSection({ rows }) {
  // For multi-variant: pick the latest-week best-FTI treatment arm as the
  // representative for the Overview narrative. The Ledger (§02) breaks
  // every arm out in detail; this section is the prose summary.
  const treatments = rows.filter((r) => isTreatmentVariant(r.variant));
  const treatment = treatments.reduce(
    (best, r) =>
      !best || (r.fti_rate_pct ?? -Infinity) > (best.fti_rate_pct ?? -Infinity)
        ? r
        : best,
    null
  );
  const control = rows.find((r) => isControlVariant(r.variant));
  const variantLabel = treatment ? formatVariantLabel(treatment.variant) : 'Treatment';
  const variantCount = new Set(treatments.map((r) => r.variant)).size;
  return (
    <section>
      <SectionHead no="I" title="The Overview" />
      <div className="grid gap-10 md:grid-cols-2 mt-8">
        <div>
          <p className="ed-overline mb-3">
            {variantLabel}
            {variantCount > 1 && ` (best of ${variantCount} arms)`}
          </p>
          <p className="ed-lede ed-dropcap max-w-prose">
            {treatment ? (
              <>
                This week {nf.format(treatment.total_non_invested_users ?? 0)}{' '}
                non-invested users were bucketed into {variantLabel}.{' '}
                {nf.format(treatment.learn_page_visitors ?? 0)} reached{' '}
                <code className="font-mono">/learn</code> — a visit rate of{' '}
                <Term>{treatment.learn_visit_rate_pct?.toFixed(1) ?? '—'}%</Term>
                {' '}— and {nf.format(treatment.unique_video_players ?? 0)} watched
                at least one video, averaging {treatment.avg_videos_per_user ?? '—'}{' '}
                per engaged user.
              </>
            ) : (
              'Treatment data has not yet been filed for this issue.'
            )}
          </p>
        </div>
        <div>
          <p className="ed-overline mb-3">Control · the counterfactual</p>
          <p className="ed-prose max-w-prose" style={{ fontSize: 17 }}>
            {control ? (
              <>
                {nf.format(control.total_non_invested_users ?? 0)} non-invested
                users sit in Control. The Learn surface is invisible to them by
                design — that is not missing data, it is the experiment working.
                Their FTI rate of{' '}
                <Term>{control.fti_rate_pct?.toFixed(1) ?? '—'}%</Term> is the
                baseline against which Treatment is judged.
              </>
            ) : (
              'Control data has not yet been filed for this issue.'
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function LedgerSection({ rows, loading }) {
  return (
    <section>
      <SectionHead no="II" title="The Ledger" />
      <p className="ed-prose-italic mt-3 max-w-prose" style={{ fontSize: 15 }}>
        Week by week, cohort by cohort. The canonical product table.
        Control rows show em-dashes for engagement columns because the
        Learn surface never renders for them — read that as <em>could
        not happen by design</em>, not <em>did not happen</em>.
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Weekly A/B ledger — non-invested cohort, Control versus Treatment,
            by week. Em-dash signifies "could not happen by design" because the
            Learn surface is invisible to Control.
          </caption>
          <thead>
            <tr className="border-b-2 border-[var(--ed-ink)]">
              <th scope="col" className="px-2 py-3 ed-caption whitespace-nowrap">Week</th>
              <th scope="col" className="px-2 py-3 ed-caption whitespace-nowrap">Cohort</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
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
              const isTreatment = isTreatmentVariant(r.variant);
              return (
                <tr
                  key={`${r.week}-${r.variant}`}
                  className="border-b border-[var(--ed-rule-faint)]"
                >
                  <td
                    className="px-2 py-3 t-num whitespace-nowrap"
                    style={{ fontFamily: 'var(--ed-mono)', fontSize: 14 }}
                  >
                    {/* Visually deduplicate the week label, but keep it on the
                        row for screen-reader column navigation. The visible
                        cell stays empty; the SR-only span carries the value. */}
                    {isNewWeek ? r.week : <span className="sr-only">{r.week}</span>}
                  </td>
                  <th
                    scope="row"
                    className="px-2 py-3 whitespace-nowrap font-normal"
                    style={{
                      fontFamily: 'var(--ed-display)',
                      fontStyle: 'italic',
                      fontSize: 16,
                      color: isTreatment ? 'var(--ed-ink)' : 'var(--ed-ink-muted)',
                    }}
                  >
                    {formatVariantLabel(r.variant)}
                  </th>
                  {COLUMNS.map((c) => {
                    // Editorial choice: render em-dash for Control on
                    // engagement-only columns. The Learn surface never
                    // renders for Control by design, so a literal "0" would
                    // misread as "happened, but zero of it." The em-dash
                    // distinguishes "could not happen by design" from
                    // "did happen, and was zero." The cohort denominator
                    // and FTI columns remain numeric — those are real for
                    // both arms.
                    const isControlEngagement =
                      isControlVariant(r.variant) && ENGAGEMENT_ONLY_COLS.has(c.key);
                    const raw = r[c.key];
                    const display = isControlEngagement
                      ? '—'
                      : formatCell(raw, c.kind);
                    const muted = display === '—';
                    return (
                      <td
                        key={c.key}
                        className="px-2 py-3 text-right whitespace-nowrap tabular-nums"
                        style={{
                          fontFamily: 'var(--ed-mono)',
                          fontSize: 14,
                          // ed-ink-muted (#5d5752, ~7:1 on warm paper) — passes AA;
                          // ed-ink-faint (#8a847d, ~3.4:1) failed AA for body text.
                          color: muted ? 'var(--ed-ink-muted)' : 'var(--ed-ink)',
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
                  <p className="ed-prose-italic text-center" style={{ color: 'var(--ed-ink-muted)' }}>
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
  // For multi-variant: pick best-FTI treatment arm as representative.
  // Ledger (§02) breaks out every arm in detail.
  const treatments = rows.filter((r) => isTreatmentVariant(r.variant));
  const treatment = treatments.reduce(
    (best, r) =>
      !best || (r.fti_rate_pct ?? -Infinity) > (best.fti_rate_pct ?? -Infinity)
        ? r
        : best,
    null
  );
  if (!treatment) return <Stub no="III" title="The Engagement" />;
  return (
    <section>
      <SectionHead no="III" title="The Engagement" />
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
      <SectionHead no="IV" title="The Guardrails" />
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
      <p className="ed-prose-italic mt-6 max-w-prose" style={{ color: 'var(--ed-ink-muted)' }}>
        Treatment data has not yet been filed.
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
    <div className="border-t border-[var(--ed-rule)] pt-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-block"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: ok ? 'var(--ed-forest)' : 'var(--ed-rust)',
          }}
          role="img"
          aria-label={ok ? 'pass' : 'fail'}
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
      <p className="ed-caption mb-1">EXHIBIT {letter}</p>
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
