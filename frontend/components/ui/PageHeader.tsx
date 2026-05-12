import * as React from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  /** Small uppercase kicker above the title. */
  overline?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned actions (buttons, links). */
  actions?: React.ReactNode;
  /** Breadcrumb / back link rendered above the overline. */
  breadcrumb?: React.ReactNode;
  className?: string;
}

export function PageHeader({ overline, title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5 t-label-md text-tertiary">{breadcrumb}</div>}
        {overline && <div className="t-overline text-action">{overline}</div>}
        <h1 className="t-display-lg text-heading mt-1">{title}</h1>
        {description && <p className="t-body-md text-secondary mt-1.5 max-w-[70ch]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
