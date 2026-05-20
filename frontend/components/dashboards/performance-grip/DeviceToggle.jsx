"use client";
import * as React from "react";

const DEVICES = [
  { value: "all",     label: "All"     },
  { value: "mobile",  label: "Mobile"  },
  { value: "desktop", label: "Desktop" },
  { value: "tablet",  label: "Tablet"  },
];

export default function DeviceToggle({ value, onChange }) {
  return (
    <div role="group" aria-label="Device filter" style={{
      display: "inline-flex",
      gap: 6,
      marginBottom: 16,
    }}>
      <span style={{
        fontFamily: "var(--ed-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        color: "var(--ed-ink-soft)",
        alignSelf: "center",
        marginRight: 6,
      }}>Device:</span>
      {DEVICES.map(d => {
        const active = value === d.value;
        return (
          <button
            key={d.value}
            aria-pressed={active}
            onClick={() => onChange(d.value)}
            style={{
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid var(--ed-rule-faint)",
              background: active ? "var(--ed-paper-deep)" : "transparent",
              color: active ? "var(--ed-ink)" : "var(--ed-ink-soft)",
              cursor: "pointer",
              minHeight: 32,
            }}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
