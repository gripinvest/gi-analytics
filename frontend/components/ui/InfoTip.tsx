"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface InfoTipProps {
  title: React.ReactNode;
  body: React.ReactNode;
  /** e.g. the SQL the figure comes from. */
  source?: React.ReactNode;
  /** false → show a "not live" marker (figure comes from offline analysis). */
  live?: boolean;
  /** Popover side; defaults to bottom-left aligned. */
  align?: "left" | "right";
  className?: string;
}

/** A small "?" chip that toggles a popover explaining what a metric is and where
 *  it comes from. Toggle with the chip; closes on any outside pointer-down,
 *  on Escape, and on scroll. */
export function InfoTip({ title, body, source, live = true, align = "left", className }: InfoTipProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: Event) => {
      if (!ref.current || !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label="What is this?"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className={cn(
          "inline-flex size-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none transition-colors",
          open ? "bg-action text-on-primary" : "bg-muted text-tertiary hover:bg-subtle hover:text-secondary"
        )}
      >
        ?
      </button>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 w-[clamp(220px,22rem,80vw)] cursor-default rounded-sm border border-border-default bg-surface p-3 text-left normal-case tracking-normal shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className="t-heading-sm text-heading">{title}</span>
            {!live && <span className="rounded-xs bg-status-warning-bg px-1 py-0.5 t-label-sm text-warning-800">offline</span>}
          </span>
          <span className="mt-1 block t-body-sm text-secondary leading-relaxed">{body}</span>
          {source && (
            <span className="mt-2 block border-t border-border-default pt-2 t-body-xs text-tertiary">
              <span className="t-emphasis-sm text-secondary">Source: </span>
              <code className="font-mono break-all">{source}</code>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
