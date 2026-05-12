import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "subtle";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-1.5 font-sans font-semibold whitespace-nowrap " +
  "rounded-sm transition-colors duration-150 ease-out select-none " +
  "disabled:cursor-not-allowed disabled:bg-action-disabled-bg disabled:text-action-disabled-text disabled:border-transparent disabled:shadow-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-action text-on-primary shadow-xs hover:bg-action-hover active:bg-action-pressed",
  accent:
    "bg-action-accent text-on-accent shadow-xs hover:bg-action-accent-hover active:bg-teal-700 active:text-white",
  secondary:
    "bg-surface text-action border border-action hover:bg-tint-navy active:bg-navy-100",
  ghost: "bg-transparent text-action hover:bg-tint-navy active:bg-navy-100",
  subtle: "bg-muted text-body border border-border-default hover:bg-subtle active:bg-neutral-300",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] leading-none",
  md: "h-9 px-3.5 text-[14px] leading-none",
  lg: "h-11 px-5 text-[16px] leading-none",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Stretch to fill the parent's width. */
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", block = false, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], block && "w-full", className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
