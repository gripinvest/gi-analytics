# S2 — Shared UI fixes: sign-out / theme-switcher overlap

## Goal

Fix broken UI on the project page chrome — primarily the **sign-out link
overlapping / merging with the design (theme) switcher** — and audit for other
UI breaks while there. Mobile-first.

## Context to start cold

- The known bug: on `/projects/[id]`, `<DesignSwitcher />` and `<SignOut />` are
  rendered together at the top of the page (see `frontend/app/projects/[id]/page.jsx`).
  They are fixed/absolute-positioned and **collide** — the sign-out link merges
  into the switcher.
- Components involved: `frontend/components/DesignSwitcher.jsx`,
  `frontend/components/SignOut.jsx`, and their placement in
  `frontend/app/projects/[id]/page.jsx`. Editorial and Classic render them
  differently (editorial branch vs classic branch of that page) — fix both.
- This is **shared chrome** — the fix affects both dashboards. Keep it
  independent of S1 (different files).

## Approach

Use the design skills the user attached for this work — invoke them when doing
the fix: `frontend-design`, `impeccable`, `ui-ux-pro-max`, `emil-design-eng`.
Treat it as: lay the two controls out so they never overlap at any breakpoint,
with proper spacing, touch targets ≥44 px, and a coherent visual grouping.

## Scope

**In:** `DesignSwitcher.jsx`, `SignOut.jsx`, their layout in
`projects/[id]/page.jsx`; any other clearly-broken page chrome found in a quick
audit (both Editorial and Classic shells).
**Out:** dashboard-internal layout / charts (Classic mobile-first is S1).

## Definition of done

- Sign-out and the design switcher are visually separated — no overlap at 375 px
  or desktop — and read as intentional UI.
- Touch targets ≥44 px; both reachable on mobile.
- `next build` clean; verified on `/projects/asset_search` in both designs.

## Suggested branch

`feat/shared-ui-fixes`
