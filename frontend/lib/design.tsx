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
  // Editorial is now the product's default surface. The flash-prevention IIFE
  // in app/layout.js sets data-design on <html> at first paint (defaulting to
  // editorial when localStorage is empty), so the initial paint uses the
  // editorial token set with no flicker.
  const [design, setDesignState] = React.useState<Design>("editorial");

  // Initial read from localStorage. Wrapped in useEffect so it runs once on
  // the client only. If the user explicitly set "classic" we honour it;
  // anything else (missing key, garbage value, private-mode throw) falls
  // through to the editorial default the IIFE already painted.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "editorial" || raw === "classic") setDesignState(raw);
    } catch { /* localStorage may be blocked (private mode) — silently keep default */ }
  }, []);

  // Reflect on BOTH <html> and <body>. Previously only <body> was updated on
  // switch, but the bootstrap IIFE in layout.js sets the attribute on <html>;
  // that meant after a runtime switch the two disagreed and editorial's
  // [data-design="editorial"] custom-property overrides on <html> kept
  // cascading into <body>'s background through --gi-bg-page. Updating both
  // keeps them in lock-step.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-design", design);
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
