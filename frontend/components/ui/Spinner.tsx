import * as React from "react";
import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg";
const px: Record<Size, number> = { sm: 14, md: 18, lg: 24 };

/** Indeterminate spinner. `currentColor`, so set text colour on the parent. */
export function Spinner({ size = "md", className, ...props }: { size?: Size } & React.SVGProps<SVGSVGElement>) {
  const d = px[size];
  return (
    <svg
      width={d} height={d} viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading"
      className={cn("animate-spin", className)} {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Three-dot "typing" indicator. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="size-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: `${delay}ms`, animationDuration: "900ms" }} />
      ))}
    </span>
  );
}
