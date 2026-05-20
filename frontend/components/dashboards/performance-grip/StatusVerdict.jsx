"use client";
import * as React from "react";

/* Pure function — no state, no effects. Takes trendline rows + thresholds,
   returns { status: 'ok' | 'watch' | 'attention', reason: string }. */
export function computeVerdict(rows, thresholds) {
  if (!rows || rows.length === 0) {
    return { status: "watch", reason: "No data yet — first cron pending." };
  }

  // For each CWV metric (LCP, INP, CLS) check every day's p75 against thresholds.
  const cwv = ["lcp", "inp", "cls"];
  let worstStatus = "ok";
  const reasons = [];

  for (const m of cwv) {
    const key = m === "cls" ? "cls_p75" : `${m}_p75_ms`;
    const t = m === "cls" ? thresholds.cls : thresholds[m];
    const goodMax = m === "cls" ? t.good : t.good_ms;
    const niMax   = m === "cls" ? t.ni   : t.ni_ms;

    let daysInNi = 0, daysInPoor = 0;
    for (const r of rows) {
      const v = r[key];
      if (v == null) continue;
      if (v > niMax) daysInPoor++;
      else if (v > goodMax) daysInNi++;
    }

    if (daysInPoor > 0) {
      worstStatus = "attention";
      reasons.push(`${m.toUpperCase()} p75 in Poor on ${daysInPoor} of last ${rows.length} days`);
    } else if (daysInNi > 0 && worstStatus !== "attention") {
      worstStatus = "watch";
      reasons.push(`${m.toUpperCase()} p75 crossed NI threshold on ${daysInNi} of last ${rows.length} days`);
    }
  }

  return {
    status: worstStatus,
    reason: reasons.length === 0 ? "All Core Web Vitals within Good for the period." : reasons[0],
  };
}

const STATUS_VISUAL = {
  ok:        { label: "All Good",         color: "var(--ed-forest)", icon: "✓" },
  watch:     { label: "Watch",            color: "var(--ed-gold)",   icon: "⚠" },
  attention: { label: "Needs Attention",  color: "var(--ed-rust)",   icon: "🚨" },
};

export default function StatusVerdict({ rows, thresholds }) {
  const { status, reason } = computeVerdict(rows, thresholds);
  const v = STATUS_VISUAL[status];

  return (
    <div className="status-verdict" style={{
      border: `1px solid ${v.color}`,
      padding: 16,
      background: "var(--ed-paper)",
      marginBottom: 24,
    }}>
      <div style={{
        fontFamily: "var(--ed-display)",
        fontSize: 24,
        color: v.color,
        marginBottom: 4,
      }}>
        Status: {v.label} <span style={{ marginLeft: 8 }}>{v.icon}</span>
      </div>
      <div style={{
        fontFamily: "var(--ed-body)",
        fontStyle: "italic",
        fontSize: 14,
        color: "var(--ed-ink)",
      }}>
        {reason}
      </div>
    </div>
  );
}
