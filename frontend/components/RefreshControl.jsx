"use client";

/* Shared live-data refresh control for project dashboards.

   `useProjectRefresh` owns the refresh state machine and a `nonce` counter
   that bumps once a refresh completes — feed `nonce` into the dashboard's
   data hook so the report re-fetches in place. `RefreshControl` is the
   presentational half: a Refresh button, a transient updated/failed chip,
   an "as of" stamp, and a staleness warning. It renders in either the
   classic or editorial design so both dashboard variants share one
   implementation (spec §12). */

import * as React from "react";
import { refreshProject, pollRefresh } from "@/lib/api";
import { Button, Badge } from "@/components/ui";

// Human-readable "as of" stamp (IST) for a refresh timestamp.
function fmtAsOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Hours past which a daily-cron snapshot counts as stale. The cron runs at
// 00:00 IST (spec D7); 26h = the 24h cadence plus a couple hours of slack for
// a slow run, so a healthy dashboard never trips the warning.
const STALE_AFTER_HOURS = 26;

// Refresh-job polling budget — MAX_POLLS × POLL_INTERVAL_MS = a 5-minute ceiling.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 150;
// Spec §12: the Refresh button stays disabled for 60 s after a refresh
// completes, so a viewer cannot hammer Metabase with back-to-back pulls.
const REFRESH_COOLDOWN_MS = 60_000;
// "Refresh failed ⚠" stays on screen long enough to read, then auto-clears
// so a viewer who looks back later isn't staring at a stuck-feeling error
// from minutes ago. Longer than the "Updated ✓" reset (3 s) since errors
// need more reading time.
const ERROR_DISPLAY_MS = 10_000;
// How often the "as of"-vs-now staleness check re-evaluates. `Date.now()`
// is captured each tick, so a tab left open across the 26 h threshold
// flips to "stale" without needing a manual reload.
const STALE_RECHECK_MS = 60_000;

/* Refresh controller hook. Mirrors GripConnect's in-component logic so the
   two dashboards behave identically: POST a refresh, poll to completion,
   then bump `nonce`. Returns the state machine, the current "as of" stamp,
   a `stale` flag, and the `handleRefresh` action. */
export function useProjectRefresh(project) {
  const [refresh, setRefresh] = React.useState({ state: "idle", error: null });
  const [asOf, setAsOf] = React.useState(
    (project.manifest && project.manifest.refreshed_at) || null
  );
  const [nonce, setNonce] = React.useState(0);
  const [cooldownUntil, setCooldownUntil] = React.useState(0);

  // Centralised error transition so every error path auto-clears after
  // ERROR_DISPLAY_MS — without this the "Refresh failed ⚠" chip persists
  // until page reload, which reads as "still broken" minutes later.
  const flagError = React.useCallback((msg) => {
    setRefresh({ state: "error", error: msg });
    setTimeout(() => setRefresh({ state: "idle", error: null }), ERROR_DISPLAY_MS);
  }, []);

  const handleRefresh = React.useCallback(async () => {
    setRefresh({ state: "running", error: null });
    try {
      // Whether the backend started a new job or returned an in-flight one
      // (HTTP 409 → `alreadyRunning: true`), we poll the same `job_id` and
      // the user sees a single "Refreshing… → Updated ✓" cycle — no
      // distinct "already running" state (B7 design call).
      const { job_id, alreadyRunning } = await refreshProject(project.id);
      if (!job_id) {
        if (alreadyRunning) {
          // Race: the in-flight job finished between the backend's 409 and
          // us reading the body. Treat the click as "refresh effectively
          // just completed" — bump nonce, show the done chip. Optimistic
          // but benign: the next refresh cycle reflects any real failure.
          setNonce((n) => n + 1);
          setAsOf(new Date().toISOString());
          setRefresh({ state: "done", error: null });
          setCooldownUntil(Date.now() + REFRESH_COOLDOWN_MS);
          setTimeout(() => setRefresh({ state: "idle", error: null }), 3000);
          setTimeout(() => setCooldownUntil(0), REFRESH_COOLDOWN_MS);
          return;
        }
        throw new Error("no job id returned");
      }
      let done = null;
      for (let i = 0; i < MAX_POLLS && !done; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const p = await pollRefresh(project.id, job_id);
        if (p.status === "done") done = p;
        else if (p.status === "error") { flagError(p.error || "refresh failed"); return; }
      }
      if (!done) { flagError("refresh timed out"); return; }
      setNonce((n) => n + 1);
      setAsOf(done.finished_at || new Date().toISOString());
      setRefresh({ state: "done", error: null });
      // 60 s cooldown — keep the button disabled even after the "done" chip
      // clears (spec §12). setCooldownUntil(0) at expiry re-renders to re-enable.
      setCooldownUntil(Date.now() + REFRESH_COOLDOWN_MS);
      setTimeout(() => setRefresh({ state: "idle", error: null }), 3000);
      setTimeout(() => setCooldownUntil(0), REFRESH_COOLDOWN_MS);
    } catch (e) {
      flagError(String((e && e.message) || e));
    }
  }, [project.id, flagError]);

  // `stale` re-evaluates against the wall clock on a timer — a tab left open
  // overnight crosses the 26 h threshold without a reload (the previous
  // useMemo-over-Date.now() froze the value at the most recent render).
  const [stale, setStale] = React.useState(false);
  React.useEffect(() => {
    const check = () => {
      if (!asOf) { setStale(false); return; }
      const t = new Date(asOf).getTime();
      setStale(!Number.isNaN(t) && (Date.now() - t) / 3600000 > STALE_AFTER_HOURS);
    };
    check();
    const id = setInterval(check, STALE_RECHECK_MS);
    return () => clearInterval(id);
  }, [asOf]);

  return { refresh, asOf, nonce, stale, cooldownUntil, handleRefresh };
}

/* Presentational control. `state` is the object returned by useProjectRefresh;
   `variant` selects the classic or editorial design. Renders nothing for a
   project without live data (refreshable !== true). */
export function RefreshControl({ project, state, variant = "classic" }) {
  if (!project || project.refreshable !== true) return null;
  const { refresh, asOf, stale, cooldownUntil, handleRefresh } = state;
  const running = refresh.state === "running";
  // Disabled while a job runs and through the 60 s post-refresh cooldown.
  const disabled = running || (cooldownUntil || 0) > Date.now();

  if (variant === "editorial") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={disabled}
          className="ed-btn ed-btn-ghost"
          style={{ minHeight: 44, minWidth: 44, fontSize: 12 }}
        >
          {running ? "Refreshing…" : "Refresh data ↻"}
        </button>
        {refresh.state === "done" && (
          <span className="ed-caption" style={{ color: "var(--ed-forest)" }}>Updated ✓</span>
        )}
        {refresh.state === "error" && (
          <span className="ed-caption" style={{ color: "var(--ed-rust)" }} title={refresh.error || ""}>
            Refresh failed ⚠
          </span>
        )}
        {asOf && !running && (
          <span className="ed-caption" style={{ color: "var(--ed-ink-faint)" }}>
            as of {fmtAsOf(asOf)}
          </span>
        )}
        {stale && !running && (
          <span className="ed-caption" style={{ color: "var(--ed-rust)" }}>
            · data may be stale
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        className="min-h-[44px]"
        onClick={handleRefresh}
        disabled={disabled}
      >
        {running ? "Refreshing…" : "Refresh data ↻"}
      </Button>
      {refresh.state === "done" && <Badge tone="success" variant="soft">Updated ✓</Badge>}
      {refresh.state === "error" && (
        <Badge tone="error" variant="soft" title={refresh.error || ""}>Refresh failed ⚠</Badge>
      )}
      {asOf && !running && (
        <span className="t-body-xs text-tertiary">as of {fmtAsOf(asOf)}</span>
      )}
      {stale && !running && <Badge tone="warning" variant="soft">Data may be stale</Badge>}
    </div>
  );
}
