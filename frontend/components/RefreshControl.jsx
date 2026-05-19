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

  const stale = React.useMemo(() => {
    if (!asOf) return false;
    const t = new Date(asOf).getTime();
    if (Number.isNaN(t)) return false;
    return (Date.now() - t) / 3600000 > STALE_AFTER_HOURS;
  }, [asOf]);

  return { refresh, asOf, nonce, stale, handleRefresh };
}

/* Presentational control. `state` is the object returned by useProjectRefresh;
   `variant` selects the classic or editorial design. Renders nothing for a
   project without live data (refreshable !== true). */
export function RefreshControl({ project, state, variant = "classic" }) {
  if (!project || project.refreshable !== true) return null;
  const { refresh, asOf, stale, handleRefresh } = state;
  const running = refresh.state === "running";

  if (variant === "editorial") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={running}
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
        disabled={running}
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
