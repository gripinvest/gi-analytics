import * as React from "react";

// When this frontend bundle was last built/deployed. The value is baked at
// build time by next.config.js (NEXT_PUBLIC_BUILD_TIME) and inlined into the
// bundle, so a stale Vercel alias (one not receiving new deploys) shows an old
// date while the live one shows today — a glanceable freshness check.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic IST formatting from the build's UTC ISO string. Hand-rolled
// (not toLocaleString) so server-render and client-hydrate produce identical
// text regardless of the host's ICU/locale — no hydration mismatch.
function formatIST(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`
       + `, ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())} IST`;
}

/** Inline "Last deployed …" stamp. `className`/`style` let each call site match
 *  its surroundings (editorial caption vs. design-system muted text). Renders
 *  nothing if the build time wasn't baked in (e.g. an old bundle). */
export default function BuildStamp({ className = "", style, label = "Last deployed" }) {
  const iso = process.env.NEXT_PUBLIC_BUILD_TIME;
  const sha = process.env.NEXT_PUBLIC_GIT_SHA;
  const when = iso ? formatIST(iso) : null;
  if (!when) return null;
  return (
    <span className={className} style={style} title={iso}>
      {label} {when}{sha ? ` · ${sha}` : ""}
    </span>
  );
}
