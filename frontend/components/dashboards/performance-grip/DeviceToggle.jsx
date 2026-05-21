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
    <div role="group" aria-label="Device filter" className="inline-flex items-center gap-x-2">
      <span className="ed-caption mr-1">Device</span>
      {DEVICES.map(d => {
        const active = value === d.value;
        return (
          <button
            key={d.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(d.value)}
            className="ed-caption px-2 py-1"
            style={{
              minHeight: 32,
              border: "1px solid var(--ed-rule-faint)",
              background: active ? "var(--ed-ink)" : "transparent",
              color: active ? "var(--ed-paper)" : "var(--ed-ink-muted)",
              cursor: "pointer",
            }}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
