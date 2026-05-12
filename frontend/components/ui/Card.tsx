import * as React from "react";
import { cn } from "@/lib/cn";

type Pad = "none" | "sm" | "md" | "lg";
const padClass: Record<Pad, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5 md:p-6",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  pad?: Pad;
  /** Slightly raised + hover lift. Use for clickable cards only. */
  interactive?: boolean;
}

/** The default surface. Do not nest Cards. Not everything needs one. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, pad = "md", interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-border-default bg-surface shadow-sm",
        interactive &&
          "transition-shadow duration-200 ease-out hover:shadow-md focus-within:shadow-md",
        padClass[pad],
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("t-heading-md text-heading", className)} {...props} />;
}

export function CardSubtitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("t-body-sm text-tertiary mt-0.5", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-3", className)} {...props} />;
}
