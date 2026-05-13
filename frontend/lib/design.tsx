"use client";
// Design switcher — context + hook + localStorage sync.
// Two designs ship: "classic" (current SaaS look) and "editorial" (Weekly Report).
// The provider sets data-design on <body> so editorial CSS (scoped via
// [data-design="editorial"]) cascades. localStorage key: "grip-design".

import * as React from "react";

export type Design = "classic" | "editorial";

interface DesignCtx {
  design: Design;
  setDesign: (d: Design) => void;
}

const Ctx = React.createContext<DesignCtx | null>(null);
const STORAGE_KEY = "grip-design";

export function DesignProvider({ children }: { children: React.ReactNode }) {
  // SSR has no localStorage. Start "classic" then hydrate. The flash of classic
  // → editorial is unavoidable without a cookie-backed pre-render path, and is
  // brief enough to tolerate (one paint). The body attribute is updated as soon
  // as React commits, so the editorial CSS swap is a single frame.
  const [design, setDesignState] = React.useState<Design>("classic");

  // Initial read from localStorage. Wrapped in useEffect so it runs once on
  // the client only.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "editorial" || raw === "classic") setDesignState(raw);
    } catch { /* localStorage may be blocked (private mode) — silently keep default */ }
  }, []);

  // Reflect on <body> so the editorial CSS cascade works for ALL pages
  // (including any portal-rendered content like modals).
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-design", design);
  }, [design]);

  const setDesign = React.useCallback((d: Design) => {
    setDesignState(d);
    try { window.localStorage.setItem(STORAGE_KEY, d); } catch { /* see above */ }
  }, []);

  return <Ctx.Provider value={{ design, setDesign }}>{children}</Ctx.Provider>;
}

export function useDesign(): DesignCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useDesign must be used inside <DesignProvider>");
  return c;
}
