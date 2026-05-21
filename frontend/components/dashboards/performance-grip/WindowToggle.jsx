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
    <div className="window-toggle inline-flex items-center gap-x-2">
      <span className="ed-caption">
        Data: {daysCollected ?? 0} days collected · viewing last
      </span>
      {OPTIONS.map(opt => {
        const active = value === opt.days;
        return (
          <button
            key={opt.days}
            type="button"
            onClick={() => onChange(opt.days)}
            className="ed-caption px-2 py-1"
            style={{
              // Touch target — minimum 32px (spec §6.5)
              minHeight: 32,
              border: active ? "1px solid var(--ed-ink)" : "1px solid var(--ed-rule-faint)",
              background: active ? "var(--ed-ink)" : "transparent",
              color: active ? "var(--ed-paper)" : "var(--ed-ink-muted)",
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
