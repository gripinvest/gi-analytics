import * as React from "react";
import { cn } from "@/lib/cn";

/** Shimmer placeholder. Renders a <span> so it's valid inside <p>/<h1>/etc.
 *  Size it via className (h-4 w-32, h-40 w-full, ...). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn("inline-block animate-shimmer rounded-xs align-middle", className)}
      {...props}
    />
  );
}

/** Block placeholder shaped like a chart while data loads. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-end gap-2 px-2", className)}>
      {[40, 64, 52, 76, 60, 70].map((h, i) => (
        <span key={i} className="flex-1 animate-shimmer rounded-t-xs" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
