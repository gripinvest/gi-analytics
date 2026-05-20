"use client";
import * as React from "react";

const OPTIONS = [
  { days: 7,  label: "7d"  },
  { days: 14, label: "14d" },
  { days: 30, label: "1M"  },
  { days: 90, label: "3M"  },
];

export default function WindowToggle({ value, onChange, daysCollected }) {
  return (
    <div className="window-toggle" style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 16,
    }}>
      <div style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 11,
        color: "var(--ed-ink-soft)",
      }}>
        Data: {daysCollected ?? 0} days collected · viewing last
      </div>
      {OPTIONS.map(opt => (
        <button
          key={opt.days}
          onClick={() => onChange(opt.days)}
          style={{
            fontFamily: "var(--ed-mono)",
            fontSize: 11,
            padding: "4px 12px",
            border: value === opt.days
              ? "1px solid var(--ed-ink)"
              : "1px solid var(--ed-rule-faint)",
            background: value === opt.days ? "var(--ed-paper-deep)" : "transparent",
            cursor: "pointer",
            borderRadius: 999,
            // Touch target — minimum 44px on touch devices (spec §6.5)
            minHeight: 32,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
