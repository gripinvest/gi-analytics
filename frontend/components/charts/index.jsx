"use client";

import * as React from "react";
import { color, semantic } from "@/lib/tokens";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui";
import { ChartSkeleton } from "@/components/ui";

/* Shared Recharts styling so every chart in the app looks the same.
   Spread these onto the Recharts elements. */

export const axisProps = {
  tick: { fill: semantic.textTertiary, fontSize: 11, fontWeight: 500 },
  tickLine: false,
  axisLine: { stroke: semantic.borderDefault },
  stroke: semantic.borderDefault,
};

export const gridProps = {
  stroke: color.neutral[200],
  strokeDasharray: "0",
  vertical: false,
};

/** Recharts <Tooltip content={...}> renderer styled like a Card. */
export function TooltipBox({ active, payload, label, valueFmt, labelFmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-sm border border-border-default bg-surface px-2.5 py-2 shadow-md">
      {label != null && (
        <div className="t-heading-sm text-heading mb-1">{labelFmt ? labelFmt(label) : label}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2 t-body-sm">
            <span className="size-2 rounded-[2px]" style={{ background: p.color || p.fill || p.stroke }} />
            <span className="text-secondary">{p.name}</span>
            <span className="ml-auto t-emphasis-sm t-num text-heading">
              {valueFmt ? valueFmt(p.value, p) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card wrapper for a chart with a title, optional subtitle, and loading state. */
export function ChartCard({ title, subtitle, loading, error, height = 240, footer, className, children }) {
  return (
    <Card pad="md" className={className}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle && <CardSubtitle>{subtitle}</CardSubtitle>}
        </div>
      </CardHeader>
      <div className="mt-3" style={{ height }}>
        {loading ? (
          <ChartSkeleton className="h-full" />
        ) : error ? (
          <div className="flex h-full items-center justify-center t-body-sm text-tertiary">
            Could not load this chart. {error}
          </div>
        ) : (
          children
        )}
      </div>
      {footer && !loading && <div className="mt-3 t-body-xs text-tertiary">{footer}</div>}
    </Card>
  );
}
