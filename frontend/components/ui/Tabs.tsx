"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  idBase: string;
}
const Ctx = React.createContext<TabsCtx | null>(null);
function useTabs() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("Tabs.* must be used inside <Tabs>");
  return c;
}

export interface TabsProps {
  value?: string;
  defaultValue: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value ?? internal;
  const idBase = React.useId();
  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [value, onValueChange]
  );
  return (
    <Ctx.Provider value={{ value: current, setValue, idBase }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabList({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn("flex items-stretch gap-5 border-b border-border-default", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
}

export function Tab({ value, className, children, ...props }: TabProps) {
  const { value: active, setValue, idBase } = useTabs();
  const selected = active === value;
  return (
    <button
      role="tab"
      type="button"
      id={`${idBase}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${idBase}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        "relative -mb-px border-b-2 pb-2 pt-1 t-heading-sm transition-colors duration-150 ease-out",
        selected
          ? "border-action text-heading"
          : "border-transparent text-tertiary hover:text-body",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabPanel({
  value,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const { value: active, idBase } = useTabs();
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      className={cn("animate-rise", className)}
      {...props}
    >
      {children}
    </div>
  );
}
