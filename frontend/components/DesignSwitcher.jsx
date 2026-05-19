"use client";
// Design switcher — two pills.
//  · Design pill (always): Classic / Editorial.
//  · Theme pill (editorial only): Sepia / Light — a colour-only variant of
//    the editorial system. Hidden in classic mode, where it has no effect.
// Styled to fit both designs: paper pill with ink labels in editorial mode,
// a neutral pill in classic mode. Placement (fixed, top-right) is owned by
// <PageChrome />, which lays this out beside <SignOut />.

import * as React from "react";
import { useDesign } from "@/lib/design";
import { cn } from "@/lib/cn";

export function DesignSwitcher({ className }) {
  const { design, setDesign, edTheme, setEdTheme } = useDesign();
  const isEditorial = design === "editorial";

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap justify-end", className)}>
      <Pill ariaLabel="Design" editorial={isEditorial}>
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
      </Pill>

      {/* Theme pill — only meaningful inside editorial, so only shown there. */}
      {isEditorial && (
        <Pill ariaLabel="Editorial colour theme" editorial>
          <PillButton
            active={edTheme === "sepia"}
            onClick={() => setEdTheme("sepia")}
            editorial
            label="Sepia"
          />
          <PillButton
            active={edTheme === "light"}
            onClick={() => setEdTheme("light")}
            editorial
            label="Light"
          />
        </Pill>
      )}
    </div>
  );
}

// The pill shell — a rounded radiogroup container. Editorial and classic get
// different surfaces; the editorial one reads from --ed-* vars so it follows
// whichever editorial theme is active.
function Pill({ children, ariaLabel, editorial }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "select-none flex items-center gap-0.5 p-0.5 rounded-full",
        "transition-colors duration-150",
        editorial
          ? "bg-[var(--ed-paper-deep)] border border-[var(--ed-rule)] shadow-[0_2px_6px_rgba(0,0,0,0.10)]"
          : "bg-white/80 border border-border-default shadow-sm backdrop-blur-sm",
      )}
    >
      {children}
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
        // min-h-[44px] is the touch-target floor; the visible pill stays
        // compact because the label is small. inline-flex centres the text
        // within that taller hit area.
        "inline-flex items-center justify-center min-h-[44px] px-3 rounded-full",
        "transition-[color,background-color,transform] duration-150",
        "active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
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
