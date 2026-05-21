"use client";
import * as React from "react";

const APPS = [
  { slug: "gi-client-static", label: "GI Client Static" },
  { slug: "gi-client-web",    label: "GI Client Web"    },
];

export default function AppSwitcher({ value, onChange }) {
  return (
    <div role="tablist" aria-label="App switcher" className="flex gap-x-6 border-b"
         style={{ borderColor: "var(--ed-rule-faint)" }}>
      {APPS.map(app => {
        const active = value === app.slug;
        return (
          <button
            key={app.slug}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(app.slug)}
            className="ed-section-link shrink-0 whitespace-nowrap"
          >
            {app.label}
          </button>
        );
      })}
    </div>
  );
}
