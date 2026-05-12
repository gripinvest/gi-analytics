import * as React from "react";
import { cn } from "@/lib/cn";

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Small caption under the value, e.g. "of 9,526 sessions". */
  hint?: React.ReactNode;
  /** Optional small trend / delta chip rendered next to the value. */
  delta?: React.ReactNode;
  /** Override the value color (e.g. a token color for a magnitude figure). */
  valueColor?: string;
  className?: string;
}

/**
 * One labelled figure for inline stat strips. Deliberately NOT a boxed card:
 * compose several in a row separated by hairlines, not a grid of identical boxes.
 */
export function Stat({ label, value, hint, delta, valueColor, className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="t-overline text-tertiary">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="t-display-md t-num text-heading"
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </span>
        {delta}
      </div>
      {hint != null && <div className="mt-0.5 t-body-xs text-tertiary">{hint}</div>}
    </div>
  );
}

/** A row of <Stat>s with hairline separators. Wrap, don't grid. */
export function StatStrip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-x-8 gap-y-5 [&>*+*]:border-l [&>*+*]:border-border-default [&>*+*]:pl-8",
        className
      )}
    >
      {children}
    </div>
  );
}
