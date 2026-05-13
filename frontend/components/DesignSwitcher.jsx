"use client";
// Design switcher pill — fixed top-right, two-mode toggle.
// Styled to fit both designs: a paper pill with ink labels in editorial mode,
// a neutral pill in classic mode. Position is fixed so it's reachable from
// any scroll depth.

import * as React from "react";
import { useDesign } from "@/lib/design";
import { cn } from "@/lib/cn";

export function DesignSwitcher({ className }) {
  const { design, setDesign } = useDesign();
  const isEditorial = design === "editorial";

  return (
    <div
      className={cn(
        "fixed top-3 right-3 z-50 select-none",
        "flex items-center gap-1 p-1 rounded-full",
        "transition-colors duration-200",
        isEditorial
          ? "bg-[var(--ed-paper-deep)] border border-[var(--ed-rule)] shadow-[0_2px_6px_rgba(27,24,24,0.10)]"
          : "bg-white/80 border border-border-default shadow-sm backdrop-blur-sm",
        className,
      )}
      role="radiogroup"
      aria-label="Design"
    >
      <PillButton
        active={!isEditorial}
        onClick={() => setDesign("classic")}
        editorial={isEditorial}
        label="Classic"
      />
      <PillButton
        active={isEditorial}
        onClick={() => setDesign("editorial")}
        editorial={isEditorial}
        label="Editorial"
      />
    </div>
  );
}

function PillButton({ active, onClick, editorial, label }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "relative px-3 py-1.5 rounded-full transition-all duration-200",
        "text-[11px] tracking-[0.10em] uppercase font-medium",
        active
          ? editorial
            ? "bg-[var(--ed-ink)] text-[var(--ed-paper)] font-semibold"
            : "bg-action-primary text-on-primary font-semibold"
          : editorial
            ? "text-[var(--ed-ink-muted)] hover:text-[var(--ed-ink)] font-mono"
            : "text-tertiary hover:text-body",
      )}
      style={editorial ? { fontFamily: "var(--ed-mono)", letterSpacing: "0.14em" } : undefined}
    >
      {label}
    </button>
  );
}
