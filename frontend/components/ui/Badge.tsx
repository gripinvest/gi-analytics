import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "navy" | "teal" | "success" | "error" | "warning";
type Variant = "soft" | "solid" | "outline";

const soft: Record<Tone, string> = {
  neutral: "bg-muted text-secondary",
  navy: "bg-tint-navy text-navy-700",
  teal: "bg-tint-teal text-teal-800",
  success: "bg-status-success-bg text-success-700",
  error: "bg-status-error-bg text-error-700",
  warning: "bg-status-warning-bg text-warning-800",
};
const solid: Record<Tone, string> = {
  neutral: "bg-neutral-700 text-white",
  navy: "bg-navy-700 text-white",
  teal: "bg-teal-500 text-teal-900",
  success: "bg-success-600 text-white",
  error: "bg-error-500 text-white",
  warning: "bg-warning-500 text-warning-900",
};
const outline: Record<Tone, string> = {
  neutral: "border border-border-strong text-secondary",
  navy: "border border-navy-300 text-navy-700",
  teal: "border border-teal-300 text-teal-800",
  success: "border border-success-300 text-success-700",
  error: "border border-error-300 text-error-700",
  warning: "border border-warning-300 text-warning-800",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  variant?: Variant;
  /** Show a small leading dot in the tone color. */
  dot?: boolean;
}

export function Badge({ className, tone = "neutral", variant = "soft", dot = false, children, ...props }: BadgeProps) {
  const styles = variant === "solid" ? solid : variant === "outline" ? outline : soft;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 t-emphasis-sm",
        styles[tone],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "neutral" && "bg-neutral-500",
            tone === "navy" && "bg-navy-500",
            tone === "teal" && "bg-teal-500",
            tone === "success" && "bg-success-500",
            tone === "error" && "bg-error-500",
            tone === "warning" && "bg-warning-500"
          )}
        />
      )}
      {children}
    </span>
  );
}
