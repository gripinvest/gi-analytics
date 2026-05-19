"use client";
// Design switcher — context + hook + localStorage sync.
//
// Two orthogonal axes:
//  · design   "classic" | "editorial"  — the whole design system. data-design.
//  · edTheme  "sepia"   | "light"       — a colour-only variant WITHIN
//             editorial (white page instead of sepia paper). data-ed-theme.
//             Has no effect in classic mode; the attribute is still set so
//             switching back into editorial is instant.
//
// Both attributes are mirrored onto <html> and <body> so the editorial CSS
// (scoped via [data-design="editorial"] / [data-ed-theme="light"]) cascades.
// localStorage keys: "grip-design", "grip-ed-theme".

import * as React from "react";

export type Design = "classic" | "editorial";
export type EdTheme = "sepia" | "light";

interface DesignCtx {
  design: Design;
  setDesign: (d: Design) => void;
  edTheme: EdTheme;
  setEdTheme: (t: EdTheme) => void;
}

const Ctx = React.createContext<DesignCtx | null>(null);
const DESIGN_KEY = "grip-design";
const THEME_KEY = "grip-ed-theme";

export function DesignProvider({ children }: { children: React.ReactNode }) {
  // Editorial is the product's default surface; sepia is the default editorial
  // theme. The flash-prevention IIFE in app/layout.js stamps both attributes
  // on <html> at first paint, so the initial paint is correct with no flicker.
  const [design, setDesignState] = React.useState<Design>("editorial");
  const [edTheme, setEdThemeState] = React.useState<EdTheme>("sepia");

  // Initial read from localStorage — client-only. Anything other than an
  // explicit valid value falls through to the default the IIFE already
  // painted (classic only on explicit "classic"; light only on "light").
  React.useEffect(() => {
    try {
      const d = window.localStorage.getItem(DESIGN_KEY);
      if (d === "editorial" || d === "classic") setDesignState(d);
      const t = window.localStorage.getItem(THEME_KEY);
      if (t === "sepia" || t === "light") setEdThemeState(t);
    } catch { /* localStorage may be blocked (private mode) — keep defaults */ }
  }, []);

  // Reflect on BOTH <html> and <body> so the attribute the bootstrap IIFE set
  // on <html> and the one React owns on <body> never disagree (a mismatch
  // would let editorial's custom-property overrides leak across — see the
  // git history of the html/body data-design fix).
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-design", design);
    document.body.setAttribute("data-design", design);
  }, [design]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-ed-theme", edTheme);
    document.body.setAttribute("data-ed-theme", edTheme);
  }, [edTheme]);

  const setDesign = React.useCallback((d: Design) => {
    setDesignState(d);
    try { window.localStorage.setItem(DESIGN_KEY, d); } catch { /* see above */ }
  }, []);

  const setEdTheme = React.useCallback((t: EdTheme) => {
    setEdThemeState(t);
    try { window.localStorage.setItem(THEME_KEY, t); } catch { /* see above */ }
  }, []);

  return (
    <Ctx.Provider value={{ design, setDesign, edTheme, setEdTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDesign(): DesignCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useDesign must be used inside <DesignProvider>");
  return c;
}
