"use client";
import * as React from "react";

const APPS = [
  { slug: "gi-client-static", label: "GI Client Static" },
  { slug: "gi-client-web",    label: "GI Client Web"    },
];

export default function AppSwitcher({ value, onChange }) {
  return (
    <div role="tablist" aria-label="App switcher" style={{
      display: "flex",
      gap: 24,
      borderBottom: "1px solid var(--ed-rule-faint)",
      marginBottom: 16,
    }}>
      {APPS.map(app => {
        const active = value === app.slug;
        return (
          <button
            key={app.slug}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(app.slug)}
            style={{
              fontFamily: "var(--ed-display)",
              fontSize: 16,
              padding: "12px 4px",
              background: "none",
              border: "none",
              borderBottom: active ? "2px solid var(--ed-ink)" : "2px solid transparent",
              color: active ? "var(--ed-ink)" : "var(--ed-ink-soft)",
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {app.label}
          </button>
        );
      })}
    </div>
  );
}
