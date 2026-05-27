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
  { key: 'reading',      no: 'IV',  italic: 'The Reading' },
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

        {/* The pull-quote — reframed 2026-05-28 around the engagement
            gradient. The ITT delta alone duplicates an Exhibit and reads
            flat when the CI brackets zero. The gradient (cohort baseline
            → top engagement band) shows the within-Treatment story while
            keeping the honest selection-effect caveat in the caption.
            Falls back to the ITT delta when funnel data is unavailable. */}
        <PullQuote
          conversionFunnel={project.manifest?.conversion_funnel}
          itLift={lift}
        />
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
        {section === 'overview'   && <OverviewSection rows={sortedRows} meta={meta} marginNotes={project.manifest?.margin_notes} loading={loading} />}
        {section === 'ledger'     && <LedgerSection rows={sortedRows} marginNotes={project.manifest?.margin_notes} loading={loading} />}
        {section === 'engagement' && <EngagementSection rows={sortedRows} conversionFunnel={project.manifest?.conversion_funnel} loading={loading} />}
        {section === 'reading'    && <TheReading rows={sortedRows} marginNotes={project.manifest?.margin_notes} />}
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
/* Margin Notes (the A/B-integrity dispatch) — collapsible by default at
 * page load so it doesn't dominate the masthead. Title pulls the user-
 * facing phrase "Editor's Note on Confidence" up front; "Margin Notes"
 * lives as a sub-label, signalling provenance to readers who know the
 * statistical convention but staying out of the way for those who don't.
 *
 * Each indicator has a `<details>` per-card that expands to a paragraph
 * of plain-English explanation + a reference link to the project glossary.
 * The full section also collapses as a single `<details>`.
 */
/* ═══════════════════════════════ PULL QUOTE ═══════════════════════════════
 * Reframed 2026-05-28 around the engagement gradient. The previous
 * pull-quote showed only the ITT delta, which duplicated an Exhibit and
 * read flat when the CI brackets zero (today's reality at W1).
 *
 * The gradient framing surfaces the within-Treatment story: FTI rate at
 * the cohort baseline vs FTI rate at the top engagement band (completed
 * a video ≥75%). This is a much richer signal — but it is a SELECTION
 * EFFECT, not a causal one. Users who choose to watch may already be
 * more invest-ready. The caption makes the caveat explicit so the bold
 * number doesn't accidentally overclaim.
 *
 * Falls back to the ITT delta when funnel data isn't available.
 */
function PullQuote({ conversionFunnel, itLift }) {
  const treatmentFunnel = conversionFunnel?.variants?.treatment;
  const baselineBand = treatmentFunnel?.bands?.find((b) => b.depth === 'bucketed');
  // Walk depth bands from deepest backward, pick the first one with
  // both meaningful N (≥10) and a non-null FTI rate. That's the
  // "richest signal" band — usually 'completed', sometimes 'played'.
  const topBand = treatmentFunnel?.bands
    ?.slice()
    .reverse()
    .find((b) => (b.cohort_n ?? 0) >= 10 && b.fti_rate_pct != null);

  if (treatmentFunnel && baselineBand && topBand && baselineBand !== topBand) {
    const accentColor =
      topBand.fti_rate_pct > baselineBand.fti_rate_pct
        ? 'var(--ed-forest)'
        : 'var(--ed-rust)';
    return (
      <aside className="border-t border-b border-[var(--ed-ink)] py-6 self-center">
        <p className="ed-caption mb-3">THE PULL QUOTE · ENGAGEMENT GRADIENT</p>
        <div
          className="ed-pullnum"
          style={{
            fontSize: 'clamp(40px, 5.5vw, 64px)',
            lineHeight: 1.1,
            color: accentColor,
          }}
        >
          {baselineBand.fti_rate_pct.toFixed(2)}%
          <span
            style={{
              color: 'var(--ed-ink-faint)',
              fontSize: '0.7em',
              margin: '0 0.3em',
            }}
          >
            →
          </span>
          {topBand.fti_rate_pct.toFixed(2)}%
        </div>
        <p
          className="ed-prose-italic mt-3"
          style={{ fontSize: 14, lineHeight: 1.5 }}
        >
          FTI rate among <Term>all Treatment users</Term> versus those who{' '}
          <Term>{topBand.label.toLowerCase()}</Term>. The gradient is real,
          but measures who self-selects to engage — not what engagement
          causes. See §III for the full funnel + §IV for the causal hygiene
          caveat.
        </p>
      </aside>
    );
  }

  // Fallback to the ITT delta if we don't have funnel data yet.
  if (itLift) {
    return (
      <aside className="border-t border-b border-[var(--ed-ink)] py-6 self-center">
        <p className="ed-caption mb-3">THE PULL QUOTE · ITT LIFT</p>
        <div
          className="ed-pullnum"
          style={{
            fontSize: 'clamp(64px, 9vw, 108px)',
            color: itLift.delta_pp > 0 ? 'var(--ed-forest)' : 'var(--ed-rust)',
          }}
        >
          {itLift.delta_pp > 0 ? '+' : ''}{itLift.delta_pp}pp
        </div>
        <p className="ed-prose-italic mt-3" style={{ fontSize: 14 }}>
          FTI rate, {formatVariantLabel(itLift.variant)} over Control · {itLift.week}.
          {itLift.relative_pct != null ? (
            <> A relative gain of <Term>+{itLift.relative_pct}%</Term> vs the Control baseline.</>
          ) : (
            <> Control FTI rate is zero, so the relative figure is undefined.</>
          )}
        </p>
      </aside>
    );
  }

  return (
    <aside className="border-t border-b border-[var(--ed-ink)] py-6 self-center">
      <p className="ed-caption mb-3">THE PULL QUOTE</p>
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
    </aside>
  );
}

function MarginNotes({ marginNotes }) {
  if (!marginNotes) return null;
  const { srm, control_leak, fti_lift_ci, mde, as_of_week } = marginNotes;

  return (
    <section className="ed-set mt-10">
      <details className="group">
        <summary
          className="flex items-baseline justify-between flex-wrap gap-3 cursor-pointer list-none border-b border-[var(--ed-rule-faint)] pb-2"
          style={{ outline: 'none' }}
        >
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="font-normal"
              style={{
                fontFamily: 'var(--ed-display)',
                fontSize: 'clamp(18px, 2vw, 22px)',
              }}
            >
              Editor’s Note on Confidence
            </span>
            <span
              className="ed-caption"
              style={{ fontSize: 11, color: 'var(--ed-ink-faint)' }}
            >
              MARGIN NOTES · AS OF {as_of_week ?? '—'}
            </span>
          </div>
          <span
            className="ed-caption select-none"
            style={{ fontSize: 11, color: 'var(--ed-ink-muted)' }}
            aria-hidden
          >
            <span className="group-open:hidden">▸ expand</span>
            <span className="hidden group-open:inline">▾ collapse</span>
          </span>
        </summary>

        <p
          className="ed-prose-italic mt-3 max-w-prose"
          style={{ fontSize: 14, color: 'var(--ed-ink-muted)' }}
        >
          Four numbers that tell you whether the headline lift is worth
          believing yet. Click any one for plain-English context.
        </p>

        <ul
          className="mt-5 grid gap-x-6 gap-y-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          <MarginNote
            label="Sample-ratio mismatch"
            verdict={srm.verdict}
            value={
              srm.control_n != null
                ? `${nf.format(srm.control_n)} / ${nf.format(srm.treatment_n)}`
                : '—'
            }
            short={
              srm.p_value != null
                ? `p = ${srm.p_value.toFixed(3)}`
                : 'no cohort'
            }
            explainer="Are Control and Treatment evenly split? A two-proportion z-test against the 50/50 target. If drift is real (p < 0.001), the bucketing is leaking and downstream comparisons can't be trusted. Today's split is read as ‘balanced’ when p > 0.001."
            citation="See glossary.md → SRM, decisions.md → D-11."
          />
          <MarginNote
            label="Control surface leak"
            verdict={control_leak.verdict}
            value={
              control_leak.leak_pct != null
                ? `${control_leak.leak_pct.toFixed(2)}%`
                : '—'
            }
            short={
              control_leak.control_visitors != null
                ? `${control_leak.control_visitors} of ${nf.format(control_leak.control_cohort)}`
                : 'no Control cohort'
            }
            explainer="Control users should never reach /learn — the surface is conditional-rendered. Any number above 0 indicates the gate is failing somewhere (deep-link, useShowLearnPage edge case, UTM bypass). Tolerated under 1% as operational noise."
            citation="See data-sources.md §3a → ‘Control surface leak’."
          />
          <MarginNote
            label="FTI lift, 95% CI"
            verdict={fti_lift_ci.verdict}
            value={
              fti_lift_ci.ci_lower_pp != null && fti_lift_ci.ci_upper_pp != null
                ? `[${fti_lift_ci.ci_lower_pp.toFixed(1)}, ${fti_lift_ci.ci_upper_pp.toFixed(1)}] pp`
                : fti_lift_ci.delta_pp != null
                ? `Δ ${fti_lift_ci.delta_pp >= 0 ? '+' : ''}${fti_lift_ci.delta_pp.toFixed(1)} pp`
                : '—'
            }
            short={
              fti_lift_ci.delta_pp != null
                ? `Δ ${fti_lift_ci.delta_pp >= 0 ? '+' : ''}${fti_lift_ci.delta_pp.toFixed(1)} pp`
                : '—'
            }
            explainer="The 95% confidence interval on Treatment minus Control FTI rate. If the bracket excludes zero, the lift is statistically significant — the experiment can claim causal credit. If the bracket includes zero, lift is consistent with noise; wait for more data."
            citation="See specs/2026-05-27 §2.2 → ‘FTI Lift CI’ and glossary.md → confidence interval."
          />
          <MarginNote
            label="Minimum detectable effect"
            verdict="ok"
            value={
              mde.mde_abs_pp != null
                ? `±${mde.mde_abs_pp.toFixed(1)} pp`
                : '—'
            }
            short={
              mde.n_per_arm
                ? `N = ${nf.format(mde.n_per_arm)}/arm`
                : 'need cohort'
            }
            explainer="The smallest absolute effect we can statistically detect at the current sample size, with 80% power and α = 0.05. A high MDE means the experiment is underpowered: a real-but-small lift would slip past undetected. MDE shrinks as N grows."
            citation="See specs/2026-05-27 §2.2 → ‘MDE’ and glossary.md → power."
          />
        </ul>
      </details>
    </section>
  );
}

const VERDICT_TO_STYLE = {
  ok:                 { glyph: '✓', color: 'var(--ed-forest)' },
  warn:               { glyph: '⚠', color: 'var(--ed-gold)' },
  fail:               { glyph: '✕', color: 'var(--ed-rust)' },
  insufficient_data:  { glyph: '—', color: 'var(--ed-ink-faint)' },
};

/* Per-indicator card. Compact closed state (one line: label · value · glyph)
 * expands on click to reveal a paragraph of plain-English context + a
 * citation pointing into our own docs.
 */
function MarginNote({ label, verdict, value, short, explainer, citation }) {
  const style = VERDICT_TO_STYLE[verdict] ?? VERDICT_TO_STYLE.insufficient_data;
  return (
    <li className="border-t border-[var(--ed-rule-faint)] pt-3">
      <details>
        <summary className="cursor-pointer list-none" style={{ outline: 'none' }}>
          <div className="flex items-baseline justify-between gap-3">
            <p
              className="ed-caption"
              style={{ fontSize: 10.5, letterSpacing: '0.08em' }}
            >
              {label}
            </p>
            <span
              style={{ fontSize: 12, color: style.color }}
              aria-hidden
            >
              {style.glyph}
            </span>
          </div>
          <p
            className="mt-1 tabular-nums"
            style={{
              fontFamily: 'var(--ed-mono)',
              fontSize: 18,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ed-ink)',
              lineHeight: 1.15,
            }}
          >
            {value}
          </p>
          {short && (
            <p
              className="ed-prose-italic"
              style={{ fontSize: 12, color: 'var(--ed-ink-muted)' }}
            >
              {short}
            </p>
          )}
        </summary>
        {explainer && (
          <div className="mt-3 pl-3 border-l-2 border-[var(--ed-rule-faint)]">
            <p
              className="ed-prose"
              style={{ fontSize: 13, color: 'var(--ed-ink-muted)', lineHeight: 1.5 }}
            >
              {explainer}
            </p>
            {citation && (
              <p
                className="ed-caption mt-2"
                style={{ fontSize: 10.5, color: 'var(--ed-ink-faint)' }}
              >
                ¶ {citation}
              </p>
            )}
          </div>
        )}
      </details>
    </li>
  );
}

/* ═══════════════════════════════ THE READING ════════════════════════════════ */
/* Computed inferences from the current cohort data. Each inference is
 * deterministically derived (no runtime LLM — see CLAUDE.md data-discipline
 * rule), but labeled as an INFERENCE with the claim, the supporting data
 * point, and a citation. Bias for honest framing over confident claims.
 *
 * Reads from the same rows the Ledger uses. Lives below Margin Notes so
 * the reader has the confidence calibration before they read the inferences.
 */
function TheReading({ rows, marginNotes }) {
  const inferences = React.useMemo(
    () => deriveInferences({ rows, marginNotes }),
    [rows, marginNotes]
  );

  if (inferences.length === 0) return null;

  return (
    <section className="ed-set mt-10">
      <div className="flex items-baseline justify-between flex-wrap gap-3 border-b border-[var(--ed-ink)] pb-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3
            className="font-normal"
            style={{
              fontFamily: 'var(--ed-display)',
              fontSize: 'clamp(22px, 2.5vw, 28px)',
            }}
          >
            The Reading
          </h3>
          <span
            className="ed-caption"
            style={{ fontSize: 11, color: 'var(--ed-ink-faint)' }}
          >
            DERIVED INFERENCES · NOT EDITORIALISED
          </span>
        </div>
      </div>
      <p
        className="ed-prose-italic mt-3 max-w-prose"
        style={{ fontSize: 14, color: 'var(--ed-ink-muted)' }}
      >
        What the dashboard data implies, computed deterministically from the
        latest cron. Each reading carries its own citation; none are
        editorial opinion.
      </p>
      <ol className="mt-6 space-y-5">
        {inferences.map((inf, i) => (
          <ReadingItem key={i} number={i + 1} inference={inf} />
        ))}
      </ol>
    </section>
  );
}

function ReadingItem({ number, inference }) {
  const toneColor = {
    positive: 'var(--ed-forest)',
    cautious: 'var(--ed-gold)',
    negative: 'var(--ed-rust)',
    neutral: 'var(--ed-ink)',
  }[inference.tone] ?? 'var(--ed-ink)';

  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-4 items-baseline">
      <span
        className="ed-caption"
        style={{
          fontFamily: 'var(--ed-mono)',
          fontSize: 11,
          color: 'var(--ed-ink-faint)',
        }}
      >
        №{String(number).padStart(2, '0')}
      </span>
      <div>
        <p
          className="ed-prose"
          style={{
            fontSize: 16,
            lineHeight: 1.5,
            color: 'var(--ed-ink)',
          }}
        >
          <span
            className="ed-caption mr-2"
            style={{
              fontSize: 10,
              color: toneColor,
              letterSpacing: '0.1em',
            }}
          >
            ◆ INFERENCE
          </span>
          {inference.claim}
        </p>
        <p
          className="mt-1.5 ed-caption"
          style={{
            fontSize: 11,
            color: 'var(--ed-ink-faint)',
            letterSpacing: '0.02em',
          }}
        >
          BASED ON: {inference.evidence}
          {inference.caveat && <> · CAVEAT: {inference.caveat}</>}
        </p>
      </div>
    </li>
  );
}

/* Inference engine — pure function, no I/O. Reads the same data the rest
 * of the dashboard uses and emits a list of {claim, evidence, caveat, tone}
 * objects. Each rule is intentionally conservative: prefer "consistent
 * with X" over "X". A real LLM at runtime is explicitly out of scope —
 * see CLAUDE.md data-discipline. */
function deriveInferences({ rows, marginNotes }) {
  const out = [];
  if (!rows || rows.length === 0) return out;

  const latestWeek = rows.reduce(
    (acc, r) => (r.week_start && r.week_start > acc ? r.week_start : acc),
    ''
  );
  const control = rows.find(
    (r) => r.week_start === latestWeek && isControlVariant(r.variant)
  );
  const treatment = rows.find(
    (r) => r.week_start === latestWeek && isTreatmentVariant(r.variant)
  );

  // 1. FTI lift inference — the headline claim.
  if (control && treatment && control.fti_rate_pct != null && treatment.fti_rate_pct != null) {
    const delta = treatment.fti_rate_pct - control.fti_rate_pct;
    const ci = marginNotes?.fti_lift_ci;
    if (ci && ci.ci_lower_pp != null && ci.ci_upper_pp != null) {
      const crossesZero = ci.ci_lower_pp <= 0 && ci.ci_upper_pp >= 0;
      out.push({
        tone: crossesZero ? 'cautious' : delta > 0 ? 'positive' : 'negative',
        claim: crossesZero
          ? `Treatment FTI rate is ${treatment.fti_rate_pct.toFixed(2)}% vs Control ${control.fti_rate_pct.toFixed(2)}%, a difference of ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp. The 95% confidence interval brackets zero, so the lift is consistent with random variation — we cannot yet claim a real effect.`
          : `Treatment FTI rate exceeds Control by ${Math.abs(delta).toFixed(2)} pp with a 95% confidence interval that ${delta > 0 ? 'excludes' : 'lies below'} zero. The lift is statistically significant at this sample size.`,
        evidence: `Ledger § THE INVESTOR · FTI rate row. 95% CI = [${ci.ci_lower_pp.toFixed(2)}, ${ci.ci_upper_pp.toFixed(2)}] pp via two-proportion z-test, normal approximation.`,
        caveat: 'Causal inference relies on random assignment, validated by SRM check in the Editor’s Note.',
      });
    } else {
      out.push({
        tone: 'cautious',
        claim: `Treatment FTI rate is ${treatment.fti_rate_pct.toFixed(2)}% vs Control ${control.fti_rate_pct.toFixed(2)}%. A confidence interval cannot yet be computed because at least one arm has fewer than 10 conversions.`,
        evidence: 'Ledger § THE INVESTOR · FTI rate row. Margin Notes → FTI lift, 95% CI (insufficient_data).',
        caveat: 'Pre-W2 reading. Numbers will stabilise as the cohort grows.',
      });
    }
  }

  // 2. Engagement inference — does Treatment actually use the surface?
  if (treatment && treatment.learn_visit_rate_pct != null && treatment.engaged_visitor_rate_pct != null) {
    out.push({
      tone: treatment.engaged_visitor_rate_pct >= 25 ? 'positive' : 'cautious',
      claim: `${treatment.learn_visit_rate_pct.toFixed(2)}% of Treatment users visited /learn this week, and ${treatment.engaged_visitor_rate_pct.toFixed(1)}% of those visitors went on to play at least one video. The surface is reaching users and converting attention into engagement at a ${treatment.engaged_visitor_rate_pct >= 25 ? 'healthy' : 'modest'} rate.`,
      evidence: 'Ledger § THE SURFACE · visit rate and engaged-visitor rate rows. learn_video_viewed events with total_watched_seconds > 0.',
    });
  }

  // 3. Watch-time inference — content quality signal.
  if (treatment && treatment.completion_rate_pct != null && treatment.avg_watch_time_sec != null) {
    out.push({
      tone: treatment.completion_rate_pct >= 50 ? 'positive' : 'cautious',
      claim: `Treatment watchers stayed ${treatment.avg_watch_time_sec.toFixed(1)}s per play on average, and ${treatment.completion_rate_pct.toFixed(1)}% of plays crossed the 75% completion threshold. This is ${treatment.completion_rate_pct >= 50 ? 'a strong content-quality signal' : 'mixed — content holds attention partially but does not consistently finish'}.`,
      evidence: 'Ledger § THE WATCH · avg watch time and completion rate rows.',
      caveat: 'Completion threshold of 75% is a configurable constant; see decisions.md → D-15 alternates.',
    });
  }

  // 4. Causal-vs-correlation caveat — always included to maintain hygiene.
  if (treatment && treatment.fti_users_who_watched != null && treatment.fti_users != null) {
    const watchedRate = treatment.fti_users > 0
      ? (treatment.fti_users_who_watched / treatment.fti_users) * 100
      : null;
    out.push({
      tone: 'neutral',
      claim: watchedRate != null
        ? `Of Treatment users who became first-time investors, ${watchedRate.toFixed(0)}% had watched at least one video before their first order. This is suggestive but not causal: watchers self-select into a pre-existing intent to invest, so the watching may correlate with — but not cause — the conversion.`
        : 'No causal claim can be made yet about watching causing investment; the within-Treatment comparison of watchers vs non-watchers is a selection effect, not a randomised contrast.',
      evidence: 'Ledger § THE INVESTOR · FTI users who watched row. Per-user causal-ordering filter (first_play_at < fti_date).',
      caveat: 'The only causal claim available is Treatment-vs-Control at the arm level — see The Reading №01.',
    });
  }

  // 5. Cohort hygiene observation — based on Margin Notes.
  if (marginNotes && marginNotes.srm) {
    const verdict = marginNotes.srm.verdict;
    out.push({
      tone: verdict === 'fail' ? 'negative' : verdict === 'ok' ? 'positive' : 'neutral',
      claim: verdict === 'ok'
        ? `The Control–Treatment split (${nf.format(marginNotes.srm.control_n)}/${nf.format(marginNotes.srm.treatment_n)}) is balanced within statistical tolerance. Randomisation is operating as designed; downstream comparisons are valid.`
        : verdict === 'fail'
        ? `The Control–Treatment split (${nf.format(marginNotes.srm.control_n)}/${nf.format(marginNotes.srm.treatment_n)}) deviates from 50/50 significantly (p = ${marginNotes.srm.p_value}). Bucketing is potentially leaking; treat downstream lift numbers as provisional until SRM clears.`
        : 'Sample-ratio mismatch status is indeterminate due to small cohort. Numbers will stabilise as N grows.',
      evidence: 'Editor’s Note → Sample-ratio mismatch indicator.',
    });
  }

  return out;
}

/* ═══════════════════════════════ SECTIONS ═══════════════════════════════ */

/* The Overview — the "front page" of the section navigation. Pulls
 * together: (1) the hypothesis, (2) the status (live, since when, how
 * far through), (3) headline lift numbers + verdict, (4) per-arm
 * scorecard, (5) what to watch next. Reads top-to-bottom as a single
 * editorial brief; no scroll-to-find.
 */
function OverviewSection({ rows, meta, marginNotes, loading }) {
  const treatments = rows.filter((r) => isTreatmentVariant(r.variant));
  const treatment = treatments.reduce(
    (best, r) =>
      !best || (r.fti_rate_pct ?? -Infinity) > (best.fti_rate_pct ?? -Infinity)
        ? r
        : best,
    null,
  );
  const control = rows.find((r) => isControlVariant(r.variant));
  const variantLabel = treatment ? formatVariantLabel(treatment.variant) : 'Treatment';
  const variantCount = new Set(treatments.map((r) => r.variant)).size;

  // Status string: experiment live duration. Anchored to 2026-05-27 13:02
  // IST go-live (the gi-client-web v22.0.26 tag). After that, we count
  // calendar days since.
  const PROD_GO_LIVE = new Date('2026-05-27T13:02:00+05:30');
  const liveHours = Math.max(0, Math.round((Date.now() - PROD_GO_LIVE.getTime()) / 3.6e6));
  const liveLabel =
    liveHours < 48
      ? `${liveHours}h live`
      : `${Math.round(liveHours / 24)}d live`;

  const weeks = [...new Set(rows.map((r) => r.week_start))].sort();
  const weekCount = weeks.length;

  if (!treatment && !control) {
    return (
      <section>
        <SectionHead no="I" title="The Overview" />
        <p
          className="ed-prose-italic mt-6 max-w-prose"
          style={{ color: 'var(--ed-ink-muted)' }}
        >
          {loading ? 'On the presses…' : 'No data has been filed yet.'}
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionHead no="I" title="The Overview" />

      {/* The hypothesis box — editorial framing of what the experiment claims. */}
      <div className="mt-6 border-t border-b border-[var(--ed-ink)] py-5">
        <p className="ed-overline mb-2">THE HYPOTHESIS</p>
        <p
          className="ed-lede max-w-prose"
          style={{ fontSize: 'clamp(20px, 2.2vw, 24px)', lineHeight: 1.45 }}
        >
          Short-form investing content, surfaced to non-invested users on
          <code className="font-mono mx-1">/learn</code>, lifts the First-Time
          Investor rate without harming funnel metrics elsewhere.
        </p>
      </div>

      {/* Status strip — three facts the reader needs to calibrate everything else. */}
      <div className="mt-8 grid gap-x-8 gap-y-4 grid-cols-2 sm:grid-cols-4 border-b border-[var(--ed-rule-faint)] pb-6">
        <OverviewStat label="Status" value="Live" sub={liveLabel} />
        <OverviewStat
          label="Weeks of data"
          value={String(weekCount)}
          sub={weeks[0] ?? '—'}
        />
        <OverviewStat
          label="Cohort"
          value={nf.format(
            (control?.total_non_invested_users ?? 0) +
              (treatment?.total_non_invested_users ?? 0),
          )}
          sub={`${variantCount > 1 ? `${variantCount}-arm` : 'binary'} · split ${
            meta.cohort_treatment_pct ?? 50
          }%T`}
        />
        <OverviewStat
          label="Daily order volume"
          value={nf.format(717)}
          sub="platform-wide BUYs/day · q2672 reconciliation"
        />
      </div>

      {/* The headline verdict — pulled forward from the Ledger so the reader
          gets the answer before they dig in. */}
      {marginNotes?.fti_lift_ci && (
        <OverviewVerdict
          lift={marginNotes.fti_lift_ci}
          control={control}
          treatment={treatment}
          variantLabel={variantLabel}
        />
      )}

      {/* Per-arm scorecard — keeps the two columns the previous design had,
          tightened up. Avoids the visit-rate / players prose that should
          really live in §III The Engagement. */}
      <div className="grid gap-10 md:grid-cols-2 mt-10">
        <div>
          <p className="ed-overline mb-3">
            {variantLabel}
            {variantCount > 1 && ` · best of ${variantCount} arms`}
          </p>
          <ul className="space-y-2">
            <OverviewArmRow
              label="Cohort size"
              value={nf.format(treatment?.total_non_invested_users ?? 0)}
            />
            <OverviewArmRow
              label="FTI users"
              value={nf.format(treatment?.fti_users ?? 0)}
            />
            <OverviewArmRow
              label="FTI rate"
              value={
                treatment?.fti_rate_pct != null
                  ? `${treatment.fti_rate_pct.toFixed(2)}%`
                  : '—'
              }
              emphasis
            />
          </ul>
          <p
            className="ed-prose-italic mt-4 max-w-prose"
            style={{ fontSize: 13, color: 'var(--ed-ink-muted)' }}
          >
            Engagement detail lives in §III · The Engagement.
          </p>
        </div>
        <div>
          <p className="ed-overline mb-3">Control · the counterfactual</p>
          <ul className="space-y-2">
            <OverviewArmRow
              label="Cohort size"
              value={nf.format(control?.total_non_invested_users ?? 0)}
            />
            <OverviewArmRow
              label="FTI users"
              value={nf.format(control?.fti_users ?? 0)}
            />
            <OverviewArmRow
              label="FTI rate"
              value={
                control?.fti_rate_pct != null
                  ? `${control.fti_rate_pct.toFixed(2)}%`
                  : '—'
              }
              emphasis
            />
          </ul>
          <p
            className="ed-prose-italic mt-4 max-w-prose"
            style={{ fontSize: 13, color: 'var(--ed-ink-muted)' }}
          >
            Learn is invisible to Control by design — non-zero engagement
            would indicate a leak (see Editor’s Note).
          </p>
        </div>
      </div>

      {/* What to watch next — one paragraph forecasting where the data goes
          next. Helps the reader return next week with a frame. */}
      <div className="mt-10">
        <p className="ed-overline mb-3">WHAT TO WATCH</p>
        <p
          className="ed-prose max-w-prose"
          style={{ fontSize: 17, lineHeight: 1.55 }}
        >
          {weekCount < 4 ? (
            <>
              The experiment is in its first {weekCount === 1 ? 'week' : `${weekCount} weeks`}.
              {' '}The minimum detectable effect (MDE) at the current sample size
              is{' '}
              <Term>
                ±{(marginNotes?.mde?.mde_abs_pp ?? 0).toFixed(1)} pp
              </Term>
              {' '}— a real effect smaller than that would slip past undetected.
              Reaching <Term>~12,000 users per arm</Term> (around W4) brings the
              MDE down to roughly ±0.5 pp, at which point the 95% confidence
              interval becomes meaningful for product decisions.
            </>
          ) : (
            <>
              {weekCount} weeks of data are now on file. The lift is{' '}
              <Term>
                {(marginNotes?.fti_lift_ci?.delta_pp ?? 0).toFixed(2)} pp
              </Term>{' '}
              with a 95% CI of [{(marginNotes?.fti_lift_ci?.ci_lower_pp ?? 0).toFixed(2)},
              {' '}{(marginNotes?.fti_lift_ci?.ci_upper_pp ?? 0).toFixed(2)}] pp.
              See §IV · The Reading for a structured interpretation.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function OverviewStat({ label, value, sub }) {
  return (
    <div>
      <p
        className="ed-caption"
        style={{ fontSize: 10.5, color: 'var(--ed-ink-faint)' }}
      >
        {label}
      </p>
      <p
        className="tabular-nums mt-1"
        style={{
          fontFamily: 'var(--ed-mono)',
          fontSize: 'clamp(22px, 2.4vw, 28px)',
          color: 'var(--ed-ink)',
          lineHeight: 1.05,
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          className="ed-prose-italic mt-1"
          style={{ fontSize: 12, color: 'var(--ed-ink-muted)' }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function OverviewVerdict({ lift, control, treatment, variantLabel }) {
  const insufficient = lift.verdict === 'insufficient_data';
  const delta = lift.delta_pp ?? 0;
  const lo = lift.ci_lower_pp;
  const hi = lift.ci_upper_pp;
  const crossesZero = lo != null && hi != null && lo <= 0 && hi >= 0;
  const accentColor = insufficient
    ? 'var(--ed-ink-muted)'
    : crossesZero
      ? 'var(--ed-gold)'
      : delta > 0
        ? 'var(--ed-forest)'
        : 'var(--ed-rust)';
  return (
    <div className="mt-10 grid gap-6 md:grid-cols-[1fr_2fr] md:items-baseline border-b border-[var(--ed-rule-faint)] pb-6">
      <div>
        <p className="ed-overline mb-2">THE VERDICT · W LATEST</p>
        <p
          className="ed-pullnum"
          style={{
            fontSize: 'clamp(56px, 7vw, 96px)',
            lineHeight: 1,
            color: accentColor,
          }}
        >
          {insufficient ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp`}
        </p>
        {!insufficient && lo != null && hi != null && (
          <p
            className="ed-caption mt-2 tabular-nums"
            style={{
              fontFamily: 'var(--ed-mono)',
              fontSize: 12,
              color: 'var(--ed-ink-muted)',
            }}
          >
            CI: [{lo.toFixed(2)}, {hi.toFixed(2)}] pp
          </p>
        )}
      </div>
      <div>
        <p className="ed-prose-italic max-w-prose" style={{ fontSize: 16 }}>
          {variantLabel} FTI rate{' '}
          <Term>{treatment?.fti_rate_pct?.toFixed(2) ?? '—'}%</Term> versus
          Control{' '}
          <Term>{control?.fti_rate_pct?.toFixed(2) ?? '—'}%</Term>.{' '}
          {insufficient
            ? 'Confidence interval not yet computable — both arms need at least 10 conversions.'
            : crossesZero
              ? 'The 95% CI brackets zero; the lift is consistent with noise. Not yet a causal claim.'
              : delta > 0
                ? 'The 95% CI excludes zero on the positive side. Statistically significant.'
                : 'The 95% CI lies below zero. Treatment is statistically WORSE than Control.'}
        </p>
      </div>
    </div>
  );
}

function OverviewArmRow({ label, value, emphasis }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-[var(--ed-rule-faint)] pb-2">
      <span
        className="ed-prose-italic"
        style={{ fontSize: 14, color: 'var(--ed-ink-muted)' }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--ed-mono)',
          fontSize: emphasis ? 22 : 16,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ed-ink)',
          fontWeight: emphasis ? 500 : 400,
        }}
      >
        {value}
      </span>
    </li>
  );
}

/* The Ledger — redesigned 2026-05-28 from a 19-column scroll-table to a
 * section-grouped editorial readout. Three groupings (The Surface, The
 * Watch, The Conversion) map metrics to the funnel stage they describe.
 * Each row inside a section: metric name, Control value, Treatment value,
 * delta (with arrow + color), sparkline of week-over-week lift.
 *
 * Design alternatives considered + rejected — see
 * docs/projects/learn-education/decisions.md D-13 for the full reasoning. */

/* The Ledger holds ONLY metrics that admit a meaningful Control vs
 * Treatment comparison. Em-dashed cells on one side make for a poor
 * comparison story — those metrics live in The Engagement section
 * (Treatment-only deep-dive). The decision is logged in D-18.
 *
 * What counts as "comparable":
 *   - Both arms produce real numbers (not by-design zeros).
 *   - The metric exists independent of the Learn surface — outcomes,
 *     denominators, downstream conversions.
 *
 * What does NOT count:
 *   - Visit rate, video plays, watch time, completion, etc. — Control
 *     can't reach /learn by design, so its value is always 0 or em-dash.
 *     Comparing them is mechanical, not analytical.
 */
const LEDGER_GROUPS = [
  {
    title: 'Cohort balance',
    italic: 'is randomisation working?',
    keys: ['total_non_invested_users'],
  },
  {
    title: 'The Outcome',
    italic: 'the only thing the experiment claims to influence',
    keys: ['fti_users', 'fti_rate_pct'],
  },
  {
    title: 'Causal candidate',
    italic: 'watched before they invested',
    keys: ['fti_users_who_watched'],
    note: 'Control’s zero is by design — Control cannot watch a video that does not render for them. This row is suggestive only; see § The Reading for the causal-vs-correlation hygiene caveat.',
  },
];

function LedgerSection({ rows, marginNotes, loading }) {
  const weeks = React.useMemo(() => {
    const seen = new Set();
    for (const r of rows) seen.add(r.week_start ?? r.week);
    return [...seen].sort();
  }, [rows]);
  const latestWeek = weeks[weeks.length - 1];

  // Pick the lead treatment variant. For multi-variant experiments the
  // Ledger headlines the lead arm; the rest can be browsed in a future
  // sibling section. Today's learn_page is binary, so this is always
  // 'treatment'.
  const treatmentVariant = React.useMemo(() => {
    const variants = new Set(
      rows.filter((r) => isTreatmentVariant(r.variant)).map((r) => r.variant),
    );
    return [...variants].sort()[0];
  }, [rows]);

  // Build a {week → {control, treatment}} index for sparkline trend
  // construction. Pre-computed once so every row's sparkline reads in O(1).
  const weekIndex = React.useMemo(() => {
    const idx = {};
    for (const r of rows) {
      const w = r.week_start ?? r.week;
      if (!idx[w]) idx[w] = {};
      if (isControlVariant(r.variant)) idx[w].control = r;
      else if (r.variant === treatmentVariant) idx[w].treatment = r;
    }
    return idx;
  }, [rows, treatmentVariant]);

  return (
    <section>
      <SectionHead no="II" title="The Ledger" />
      <p className="ed-prose-italic mt-3 max-w-prose" style={{ fontSize: 15 }}>
        The funnel, sliced. Each section answers one question of the
        experiment {weeks.length > 1 ? `across ${weeks.length} weeks` : 'in W1'}.
        Control rows show em-dashes for engagement columns — the Learn
        surface is invisible to Control by design.
      </p>

      {rows.length === 0 && (
        <p
          className="ed-prose-italic text-center mt-12"
          style={{ color: 'var(--ed-ink-muted)' }}
        >
          {loading ? 'On the presses…' : 'No weeks have been issued yet.'}
        </p>
      )}

      {LEDGER_GROUPS.map((group) => (
        <LedgerGroup
          key={group.title}
          group={group}
          rows={rows}
          weeks={weeks}
          latestWeek={latestWeek}
          treatmentVariant={treatmentVariant}
          weekIndex={weekIndex}
        />
      ))}

      {/* FTI Lift CI — the headline causal claim, surfaced inside the
          comparison section so the reader doesn't have to cross-reference
          the Editor's Note. Renders only when both arms have a non-null
          FTI rate (Margin Notes computes it for us). */}
      {marginNotes?.fti_lift_ci && (
        <LedgerLiftSummary lift={marginNotes.fti_lift_ci} />
      )}

      {/* Treatment-only deep-cut — explicitly framed so the reader doesn't
          confuse this with a comparison. The engagement metrics in here
          have no meaningful Control counterpart (the surface is invisible),
          so we show them as a labeled summary rather than fake an
          em-dashed comparison row. §III The Engagement has the full
          funnel-narrative version of these same numbers. */}
      {weekIndex[latestWeek]?.treatment && (
        <LedgerTreatmentOnly treatment={weekIndex[latestWeek].treatment} />
      )}
    </section>
  );
}

/* Where Control cannot speak — a deliberately distinct visual block that
 * shows Treatment-only engagement metrics. The framing makes the design
 * explicit: this isn't a comparison gone wrong (em-dashes everywhere),
 * it's a single-arm readout because the Learn surface is invisible to
 * Control by design. Reads as a "sidebar" inside §II The Ledger.
 *
 * Metrics here also appear in §III The Engagement with deeper narrative;
 * this compact form keeps the Ledger self-contained for readers who
 * stop after §II.
 */
const TREATMENT_ONLY_GROUPS = [
  {
    title: 'The Surface',
    keys: [
      'learn_visit_rate_pct',
      'engaged_visitor_rate_pct',
      'plays_per_visitor',
      'outbound_click_rate_pct',
      'banner_ctr_on_learn_pct',
    ],
  },
  {
    title: 'The Watch',
    keys: [
      'unique_video_players',
      'total_video_plays',
      'avg_videos_per_user',
      'avg_watch_time_sec',
      'completion_rate_pct',
    ],
  },
  {
    title: 'The Friction',
    keys: [
      'median_time_to_first_play_sec',
      'drop_after_first_pct',
    ],
  },
];

function LedgerTreatmentOnly({ treatment }) {
  return (
    <div
      className="mt-14 border-2 px-6 py-5 sm:px-8 sm:py-7"
      style={{
        borderColor: 'var(--ed-ink-muted)',
        // Slightly warmer than the page paper to signal "this is a different
        // kind of read." Tinted toward the editorial paper hue per the
        // shared design laws — no flat #fff.
        background: 'rgba(184, 130, 50, 0.04)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--ed-ink-muted)] pb-2 mb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h4
            className="ed-headline"
            style={{ fontSize: 'clamp(20px, 2.3vw, 26px)' }}
          >
            Treatment only
          </h4>
          <p
            className="ed-prose-italic"
            style={{ fontSize: 13, color: 'var(--ed-ink-muted)' }}
          >
            Control is invisible to <code className="font-mono">/learn</code> by design.
          </p>
        </div>
        <span
          className="ed-caption"
          style={{ fontSize: 10.5, color: 'var(--ed-ink-faint)' }}
        >
          NOT A COMPARISON · NO CONTROL COUNTERPART
        </span>
      </div>

      <p
        className="ed-prose-italic mb-6 max-w-prose"
        style={{ fontSize: 13.5, color: 'var(--ed-ink-muted)' }}
      >
        These metrics describe what happens on the Learn surface itself. A
        Control number here would be either zero (by design) or a leak —
        comparing them to Treatment is not analytically meaningful. See §III ·
        The Engagement for the narrative version of these numbers.
      </p>

      {TREATMENT_ONLY_GROUPS.map((group, i) => (
        <div key={group.title} className={i === 0 ? '' : 'mt-7'}>
          <h5
            className="ed-overline mb-3"
            style={{ color: 'var(--ed-ink-muted)' }}
          >
            {group.title}
          </h5>
          <ul
            className="grid gap-x-6 gap-y-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            {group.keys.map((key) => {
              const col = COLUMNS.find((c) => c.key === key);
              if (!col) return null;
              const value = treatment[key];
              return (
                <li key={key} className="border-t border-[var(--ed-rule-faint)] pt-2">
                  <p
                    className="ed-caption truncate"
                    style={{ fontSize: 10, letterSpacing: '0.08em' }}
                    title={col.label}
                  >
                    {col.label}
                  </p>
                  <p
                    className="mt-1 tabular-nums"
                    style={{
                      fontFamily: 'var(--ed-mono)',
                      fontSize: 'clamp(18px, 2vw, 22px)',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--ed-ink)',
                      lineHeight: 1.1,
                    }}
                  >
                    {formatCell(value, col.kind)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LedgerGroup({ group, weeks, latestWeek, treatmentVariant, weekIndex }) {
  // Pull the latest-week rows for both arms.
  const latest = weekIndex[latestWeek] ?? {};
  const controlRow = latest.control;
  const treatmentRow = latest.treatment;

  const groupColumns = group.keys
    .map((key) => COLUMNS.find((c) => c.key === key))
    .filter(Boolean);

  return (
    <div className="mt-12">
      <div className="flex items-baseline gap-3 border-b border-[var(--ed-ink)] pb-2 mb-3">
        <h4
          className="ed-headline"
          style={{ fontSize: 'clamp(20px, 2.4vw, 26px)' }}
        >
          {group.title}
        </h4>
        <p
          className="ed-prose-italic"
          style={{ fontSize: 13, color: 'var(--ed-ink-muted)' }}
        >
          {group.italic}
        </p>
      </div>

      {/* Mobile-first stack: at small widths each row collapses to a
          two-line card. The wider layout below 640px renders as a 4-column
          flex row (metric | values | delta | sparkline). */}
      <ul className="ed-set">
        {groupColumns.map((col) => (
          <LedgerRow
            key={col.key}
            column={col}
            controlRow={controlRow}
            treatmentRow={treatmentRow}
            weeks={weeks}
            weekIndex={weekIndex}
          />
        ))}
      </ul>

      {group.note && (
        <p
          className="ed-prose-italic mt-3 max-w-prose"
          style={{ fontSize: 12.5, color: 'var(--ed-ink-faint)', lineHeight: 1.5 }}
        >
          ¶ {group.note}
        </p>
      )}
    </div>
  );
}

/* The Lift Summary — the headline CI box, rendered at the bottom of
 * the Ledger so a scanner can stop reading at the conclusion without
 * scrolling to Margin Notes. Editorial framing: this IS the experiment's
 * verdict in numerical form, with the honest hedge built in.
 */
function LedgerLiftSummary({ lift }) {
  const insufficient = lift.verdict === 'insufficient_data';
  const delta = lift.delta_pp;
  const lo = lift.ci_lower_pp;
  const hi = lift.ci_upper_pp;
  const crossesZero = lo != null && hi != null && lo <= 0 && hi >= 0;
  const verdictLine = insufficient
    ? 'Confidence interval not yet computable — both arms need at least 10 conversions.'
    : crossesZero
      ? 'The interval brackets zero. The lift is consistent with random variation; we cannot yet claim a real effect.'
      : (delta ?? 0) > 0
        ? 'The interval excludes zero on the positive side. Treatment’s lift over Control is statistically significant at this sample size.'
        : 'The interval lies below zero. Treatment is statistically WORSE than Control at this sample size.';
  const accentColor = insufficient
    ? 'var(--ed-ink-muted)'
    : crossesZero
      ? 'var(--ed-gold)'
      : (delta ?? 0) > 0
        ? 'var(--ed-forest)'
        : 'var(--ed-rust)';
  return (
    <div className="mt-14">
      <p
        className="ed-overline mb-2"
        style={{ color: 'var(--ed-ink-muted)' }}
      >
        THE VERDICT · 95% CONFIDENCE INTERVAL
      </p>
      <div className="border-t-2 border-b border-[var(--ed-ink)] py-5 grid gap-4 md:grid-cols-[1.2fr_2fr] md:items-center">
        <div>
          <p
            className="ed-pullnum"
            style={{
              fontSize: 'clamp(48px, 6vw, 80px)',
              lineHeight: 1,
              color: accentColor,
            }}
          >
            {insufficient
              ? '—'
              : `${(delta ?? 0) >= 0 ? '+' : ''}${(delta ?? 0).toFixed(2)} pp`}
          </p>
          {!insufficient && lo != null && hi != null && (
            <p
              className="ed-caption mt-2 tabular-nums"
              style={{
                fontFamily: 'var(--ed-mono)',
                fontSize: 12,
                color: 'var(--ed-ink-muted)',
              }}
            >
              CI: [{lo.toFixed(2)}, {hi.toFixed(2)}] pp
            </p>
          )}
        </div>
        <p
          className="ed-prose-italic"
          style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--ed-ink)' }}
        >
          {verdictLine}
        </p>
      </div>
    </div>
  );
}

function LedgerRow({ column, controlRow, treatmentRow, weeks, weekIndex }) {
  const isControlEngagement = ENGAGEMENT_ONLY_COLS.has(column.key);
  const controlValue = controlRow?.[column.key];
  const treatmentValue = treatmentRow?.[column.key];
  const controlDisplay = isControlEngagement
    ? '—'
    : formatCell(controlValue, column.kind);
  const treatmentDisplay = formatCell(treatmentValue, column.kind);

  // Compute delta when both arms have numeric values AND the metric
  // semantically supports cross-arm comparison (em-dashed Control values
  // wouldn't).
  const delta =
    typeof controlValue === 'number' &&
    typeof treatmentValue === 'number' &&
    !isControlEngagement
      ? treatmentValue - controlValue
      : null;

  // Trend datapoints across all weeks — used by the sparkline. We plot
  // the LIFT (Treatment − Control) so the chart tracks the experiment
  // effect, not absolute rates. For engagement-only metrics where Control
  // is em-dashed, the sparkline shows Treatment-only values instead.
  const trend = weeks
    .map((w) => {
      const c = weekIndex[w]?.control?.[column.key];
      const t = weekIndex[w]?.treatment?.[column.key];
      if (isControlEngagement) {
        return typeof t === 'number' ? t : null;
      }
      if (typeof c === 'number' && typeof t === 'number') return t - c;
      return null;
    })
    .filter((v) => v !== null);

  return (
    <li
      className="grid items-baseline gap-x-4 gap-y-1 py-3 border-b border-[var(--ed-rule-faint)]"
      style={{
        gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.9fr)',
      }}
    >
      <div className="min-w-0">
        <p
          className="font-normal truncate"
          style={{
            fontFamily: 'var(--ed-display)',
            fontStyle: 'italic',
            fontSize: 17,
          }}
          title={column.label}
        >
          {column.label}
        </p>
        {column.hint && (
          <p
            className="ed-caption truncate"
            style={{ fontSize: 11, color: 'var(--ed-ink-faint)' }}
            title={column.hint}
          >
            {column.hint}
          </p>
        )}
      </div>

      <LedgerValue label="C" value={controlDisplay} muted={controlDisplay === '—'} />
      <LedgerValue label="T" value={treatmentDisplay} emphasis />
      <LedgerDelta delta={delta} kind={column.kind} />
      <LedgerSparkline values={trend} />
    </li>
  );
}

function LedgerValue({ label, value, muted, emphasis }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span
        className="ed-caption shrink-0"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--ed-ink-faint)',
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums truncate"
        style={{
          fontFamily: 'var(--ed-mono)',
          fontSize: 17,
          fontVariantNumeric: 'tabular-nums',
          color: muted ? 'var(--ed-ink-muted)' : 'var(--ed-ink)',
          fontWeight: emphasis && !muted ? 500 : 400,
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function LedgerDelta({ delta, kind }) {
  if (delta === null || delta === undefined) {
    return (
      <span
        className="text-right tabular-nums"
        style={{ color: 'var(--ed-ink-faint)', fontFamily: 'var(--ed-mono)', fontSize: 15 }}
      >
        —
      </span>
    );
  }
  const positive = delta > 0;
  const negative = delta < 0;
  const arrow = positive ? '↑' : negative ? '↓' : '·';
  const color = positive
    ? 'var(--ed-forest)'
    : negative
      ? 'var(--ed-rust)'
      : 'var(--ed-ink-muted)';
  const formatted = formatCell(Math.abs(delta), kind);
  const suffix = kind === 'pct' ? 'pp' : '';
  return (
    <span
      className="text-right tabular-nums"
      style={{
        fontFamily: 'var(--ed-mono)',
        fontSize: 15,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {arrow} {formatted.replace('%', '')}{suffix && ` ${suffix}`}
    </span>
  );
}

/* Sparkline — pure-SVG, no chart library. Renders the LIFT trajectory
 * (Treatment − Control) across weeks. A single point becomes a dot;
 * multiple points form a polyline with a baseline rule at zero. */
function LedgerSparkline({ values }) {
  if (!values || values.length === 0) {
    return (
      <span
        className="ed-caption text-right"
        style={{ fontSize: 11, color: 'var(--ed-ink-faint)' }}
      >
        —
      </span>
    );
  }
  const W = 90;
  const H = 22;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const zeroY = H - ((0 - min) / range) * H;

  const points = values.map((v, i) => {
    const x = values.length === 1 ? W / 2 : (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return { x, y };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Week-over-week lift trend, ${values.length} weeks`}
      style={{ display: 'block', marginLeft: 'auto' }}
    >
      <line
        x1={0}
        y1={zeroY}
        x2={W}
        y2={zeroY}
        stroke="var(--ed-rule-faint)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {points.length > 1 && (
        <path
          d={pathD}
          fill="none"
          stroke="var(--ed-ink)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === points.length - 1 ? 2.5 : 1.5}
          fill={
            values[i] > 0
              ? 'var(--ed-forest)'
              : values[i] < 0
                ? 'var(--ed-rust)'
                : 'var(--ed-ink-muted)'
          }
        />
      ))}
    </svg>
  );
}

/* The Engagement — Treatment-only deep-dive. This is where every metric
 * that doesn't admit Control comparison lives: visit rate, plays,
 * completion, time-to-first-play, drop-after-first, outbound CTR,
 * banner CTR. Reads as the dashboard's "feature page" — what users
 * actually do on /learn. Organised into three editorial vignettes.
 */
const ENGAGEMENT_VIGNETTES = [
  {
    title: 'The Surface',
    italic: 'who arrives and engages',
    keys: [
      'learn_visit_rate_pct',
      'engaged_visitor_rate_pct',
      'plays_per_visitor',
      'outbound_click_rate_pct',
      'banner_ctr_on_learn_pct',
    ],
  },
  {
    title: 'The Watch',
    italic: 'attention the content earns',
    keys: [
      'unique_video_players',
      'total_video_plays',
      'avg_videos_per_user',
      'avg_watch_time_sec',
      'completion_rate_pct',
    ],
  },
  {
    title: 'The Friction',
    italic: 'where users hesitate or leave',
    keys: [
      'median_time_to_first_play_sec',
      'drop_after_first_pct',
    ],
  },
];

function EngagementSection({ rows, conversionFunnel, loading }) {
  const treatments = rows.filter((r) => isTreatmentVariant(r.variant));
  const treatment = treatments.reduce(
    (best, r) =>
      !best || (r.fti_rate_pct ?? -Infinity) > (best.fti_rate_pct ?? -Infinity)
        ? r
        : best,
    null,
  );
  const variantLabel = treatment ? formatVariantLabel(treatment.variant) : 'Treatment';

  if (!treatment) {
    return (
      <section>
        <SectionHead no="III" title="The Engagement" />
        <p
          className="ed-prose-italic mt-6 max-w-prose"
          style={{ color: 'var(--ed-ink-muted)' }}
        >
          {loading ? 'On the presses…' : 'Treatment data has not yet been filed.'}
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionHead no="III" title="The Engagement" />
      <p
        className="ed-prose-italic mt-3 max-w-prose"
        style={{ fontSize: 15 }}
      >
        How {variantLabel} users actually behave on <code className="font-mono">/learn</code>.
        Control does not appear here by design — the surface is invisible
        to them, so engagement metrics don’t admit a fair comparison.
        For Control-vs-Treatment, see §II The Ledger.
      </p>

      {/* CONVERSION FUNNEL — engagement depth × FTI rate, with the
          selection-effect caveat built into the framing. This is the
          richest within-Treatment story; it shows the FTI gradient
          without claiming it's causal. */}
      {conversionFunnel && (
        <ConversionFunnel funnel={conversionFunnel} />
      )}

      {/* Attrition snapshot — the simpler 5-stage cohort funnel kept
          as a secondary view since it's a different framing (absolute
          counts + cohort %, not FTI conditional). */}
      <EngagementFunnel treatment={treatment} />

      {ENGAGEMENT_VIGNETTES.map((vignette) => (
        <EngagementVignette
          key={vignette.title}
          vignette={vignette}
          treatment={treatment}
        />
      ))}
    </section>
  );
}

/* ═══════════════════════════════ CONVERSION FUNNEL ════════════════════════
 * Bar-pair viz: per depth band, render two horizontal bars — width
 * proportional to cohort_n in the band, and a darker overlay proportional
 * to fti_n. Beside the bars: cohort_n, fti_n, fti_rate_pct.
 *
 * The visual reads at a glance: bars get narrower as engagement deepens
 * (attrition), but the dark overlay grows in fraction (conversion rate
 * climbs). The caveat in the section header keeps the causal hygiene
 * explicit.
 */
function ConversionFunnel({ funnel }) {
  const treatment = funnel.variants?.treatment;
  const control = funnel.variants?.control;
  if (!treatment) return null;

  // Max cohort_n across all bands sets the bar scale.
  const maxN = Math.max(
    ...treatment.bands.map((b) => b.cohort_n ?? 0),
    1,
  );

  return (
    <div className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--ed-ink)] pb-2 mb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h4
            className="ed-headline"
            style={{ fontSize: 'clamp(22px, 2.5vw, 28px)' }}
          >
            The Conversion Funnel
          </h4>
          <p
            className="ed-prose-italic"
            style={{ fontSize: 13, color: 'var(--ed-ink-muted)' }}
          >
            FTI rate by engagement depth — descriptive, not causal.
          </p>
        </div>
        <span
          className="ed-caption"
          style={{ fontSize: 10.5, color: 'var(--ed-ink-faint)' }}
        >
          AS OF {funnel.as_of_week ?? '—'}
        </span>
      </div>

      <p
        className="ed-prose-italic mb-6 max-w-prose"
        style={{ fontSize: 13.5, color: 'var(--ed-ink-muted)', lineHeight: 1.5 }}
      >
        Each band is <Term>cumulative</Term> — a user who completed a video
        also counts as having played, visited, and been bucketed. Deeper
        bands have higher FTI rates, but the gradient measures who
        self-selects into engagement, not what engagement causes.
      </p>

      <ul className="space-y-3">
        {treatment.bands.map((band, i) => (
          <ConversionBand
            key={band.depth}
            band={band}
            maxN={maxN}
            isBaseline={i === 0}
          />
        ))}
      </ul>

      {/* Control reference row — single baseline. */}
      {control && (
        <div className="mt-6 pt-4 border-t border-[var(--ed-rule-faint)]">
          <p
            className="ed-overline mb-3"
            style={{ color: 'var(--ed-ink-muted)' }}
          >
            CONTROL · BASELINE FOR COMPARISON
          </p>
          <ConversionBand
            band={control.bands.find((b) => b.depth === 'bucketed')}
            maxN={maxN}
            isBaseline
            isControl
          />
        </div>
      )}

      {/* Entry source breakdown — among visitors. */}
      {treatment.by_entry_source && treatment.by_entry_source.length > 0 && (
        <div className="mt-10">
          <h5
            className="ed-overline mb-3"
            style={{ color: 'var(--ed-ink-muted)' }}
          >
            BY ENTRY SOURCE · TREATMENT VISITORS
          </h5>
          <p
            className="ed-prose-italic mb-4 max-w-prose"
            style={{ fontSize: 12.5, color: 'var(--ed-ink-faint)' }}
          >
            Where each visitor first arrived from. Sticky — only the FIRST
            entry source per user is counted, even if they return via a
            different route.
          </p>
          <ul
            className="grid gap-x-6 gap-y-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            {treatment.by_entry_source.map((src) => (
              <li
                key={src.source}
                className="border-t border-[var(--ed-rule-faint)] pt-2"
              >
                <p
                  className="ed-caption"
                  style={{ fontSize: 10.5, letterSpacing: '0.08em' }}
                >
                  {prettifyEntrySource(src.source)}
                </p>
                <div className="flex items-baseline justify-between mt-1">
                  <span
                    className="tabular-nums"
                    style={{
                      fontFamily: 'var(--ed-mono)',
                      fontSize: 22,
                      color: 'var(--ed-ink)',
                    }}
                  >
                    {nf.format(src.cohort_n)}
                  </span>
                  <span
                    className="tabular-nums ed-prose-italic"
                    style={{
                      fontSize: 13,
                      color: 'var(--ed-ink-muted)',
                    }}
                  >
                    {src.fti_n} FTI · {src.fti_rate_pct?.toFixed(2) ?? '—'}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConversionBand({ band, maxN, isBaseline, isControl }) {
  if (!band) return null;
  const widthPct = maxN > 0 ? (100 * (band.cohort_n ?? 0)) / maxN : 0;
  const ftiWidthPct =
    band.cohort_n > 0 && band.fti_n
      ? (100 * (band.fti_n / band.cohort_n))
      : 0;

  return (
    <li className="grid items-center gap-x-4" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 2fr) auto' }}>
      <div className="min-w-0">
        <p
          className="font-normal truncate"
          style={{
            fontFamily: 'var(--ed-display)',
            fontStyle: 'italic',
            fontSize: 15,
            color: isBaseline ? 'var(--ed-ink-muted)' : 'var(--ed-ink)',
          }}
        >
          {band.label}
        </p>
        <p
          className="ed-caption tabular-nums"
          style={{
            fontFamily: 'var(--ed-mono)',
            fontSize: 11,
            color: 'var(--ed-ink-faint)',
          }}
        >
          {nf.format(band.cohort_n ?? 0)} users · {nf.format(band.fti_n ?? 0)} FTI
        </p>
      </div>

      {/* Bar — outer = cohort width, inner = FTI fraction within band. */}
      <div
        className="relative h-3"
        style={{ background: 'var(--ed-rule-faint)' }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${widthPct}%`,
            background: isControl ? 'var(--ed-ink-muted)' : 'var(--ed-ink)',
            transition: 'width 0.3s ease-out',
          }}
        >
          {ftiWidthPct > 0 && (
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${ftiWidthPct}%`,
                background: 'var(--ed-forest)',
                opacity: 0.8,
              }}
              aria-hidden
            />
          )}
        </div>
      </div>

      <span
        className="tabular-nums text-right"
        style={{
          fontFamily: 'var(--ed-mono)',
          fontSize: 16,
          fontVariantNumeric: 'tabular-nums',
          minWidth: '4.5em',
          color: isControl ? 'var(--ed-ink-muted)' : 'var(--ed-ink)',
        }}
      >
        {band.fti_rate_pct != null
          ? `${band.fti_rate_pct.toFixed(2)}%`
          : '—'}
      </span>
    </li>
  );
}

function prettifyEntrySource(src) {
  const map = {
    top_chip: 'Top chip',
    bottom_nav: 'Bottom nav',
    deep_link: 'Deep link',
    direct: 'Direct',
    unknown: 'Unknown source',
  };
  return map[src] ?? src;
}

function EngagementFunnel({ treatment }) {
  const cohort = treatment.total_non_invested_users ?? 0;
  const visitors = treatment.learn_page_visitors ?? 0;
  const players = treatment.unique_video_players ?? 0;
  const plays = treatment.total_video_plays ?? 0;
  const ftiUsers = treatment.fti_users ?? 0;

  const stages = [
    { label: 'Bucketed', value: cohort, share: 100 },
    { label: 'Visited', value: visitors, share: cohort ? (100 * visitors) / cohort : 0 },
    { label: 'Played', value: players, share: cohort ? (100 * players) / cohort : 0 },
    { label: 'Plays', value: plays, share: null }, // event count, not share
    { label: 'Invested', value: ftiUsers, share: cohort ? (100 * ftiUsers) / cohort : 0 },
  ];

  return (
    <div className="mt-10 border-t border-b border-[var(--ed-ink)] py-5">
      <p className="ed-overline mb-4">THE FUNNEL · LATEST WEEK</p>
      <ol className="grid gap-x-6 gap-y-3 grid-cols-2 sm:grid-cols-5">
        {stages.map((s, i) => (
          <li key={s.label} className="flex flex-col">
            <span
              className="ed-caption"
              style={{ fontSize: 10.5, color: 'var(--ed-ink-faint)' }}
            >
              {i + 1}. {s.label}
            </span>
            <span
              className="tabular-nums"
              style={{
                fontFamily: 'var(--ed-mono)',
                fontSize: 'clamp(22px, 2.4vw, 32px)',
                color: 'var(--ed-ink)',
                lineHeight: 1.05,
              }}
            >
              {nf.format(s.value)}
            </span>
            {s.share != null && (
              <span
                className="ed-prose-italic"
                style={{ fontSize: 12, color: 'var(--ed-ink-muted)' }}
              >
                {s.share.toFixed(1)}% of cohort
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function EngagementVignette({ vignette, treatment }) {
  const items = vignette.keys
    .map((k) => ({ col: COLUMNS.find((c) => c.key === k), value: treatment[k] }))
    .filter((x) => x.col);

  return (
    <div className="mt-12">
      <div className="flex items-baseline gap-3 border-b border-[var(--ed-rule-faint)] pb-2 mb-4">
        <h4
          className="ed-headline"
          style={{ fontSize: 'clamp(20px, 2.2vw, 24px)' }}
        >
          {vignette.title}
        </h4>
        <p
          className="ed-prose-italic"
          style={{ fontSize: 13, color: 'var(--ed-ink-muted)' }}
        >
          {vignette.italic}
        </p>
      </div>
      <ul
        className="grid gap-x-6 gap-y-5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
      >
        {items.map(({ col, value }) => (
          <li key={col.key} className="border-t border-[var(--ed-rule-faint)] pt-3">
            <p
              className="ed-caption"
              style={{ fontSize: 10.5, letterSpacing: '0.08em' }}
            >
              {col.label}
            </p>
            <p
              className="mt-1 tabular-nums"
              style={{
                fontFamily: 'var(--ed-mono)',
                fontSize: 'clamp(22px, 2.5vw, 30px)',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--ed-ink)',
                lineHeight: 1.1,
              }}
            >
              {formatCell(value, col.kind)}
            </p>
            {col.hint && (
              <p
                className="ed-prose-italic"
                style={{ fontSize: 12, color: 'var(--ed-ink-muted)' }}
              >
                {col.hint}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* HealthSection + HealthBlock removed 2026-05-28. The collapsible
 * "Editor's Note on Confidence" (MarginNotes) above-the-fold and the
 * verdict box inside §II The Ledger together cover the same ground
 * with better integration. SECTIONS now ends at §IV The Reading.
 *
 * Stub removed too — both §I Overview and §III Engagement have proper
 * empty-state handling inline. */

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

/* ProseColumn, Figure, HealthBlock — primitives from the V1 design.
 * Dropped 2026-05-28: the Overview/Engagement rewrites use bespoke layouts
 * inline. Re-introduce if a future section needs them, but don't keep
 * dead code on the chance. */

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
