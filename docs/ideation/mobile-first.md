# Mobile-first, always

## Why

This isn't a thread to ship — it's a constraint applied to every other thread.
Surfacing it explicitly because past iterations regressed (legends missing,
detail panels rendering below the fold, focused element invisible). The rule
is louder than the convention.

## Pointers

### A. The bar every UI must clear at 375×844

- **No horizontal scroll** on the page itself. Inner regions (a wide table) may scroll horizontally; the page never does.
- **Touch targets ≥ 44×44**. Includes the design switcher, tab buttons, icon-only controls.
- **Text ≥ 14px body, 16px input** (iOS auto-zooms inputs below 16px — never let that happen).
- **Chart legends visible without hover.** Tooltip-only legends are desktop-only thinking.
- **Tab bars scroll horizontally** with `overflow-x-auto`, scrollbar hidden, items `whitespace-nowrap shrink-0` (`Tabs.tsx` already does this; preserve the pattern for any new tab nav including the editorial section nav).
- **User action that reveals content out of view → scroll to it.** The Issuers detail-on-click pattern (PR #5) is the precedent.
- **Modals/sheets reachable** — full-width on mobile, no fixed-pixel widths that overflow.
- **Fonts**: cap line length at ~60ch on mobile too; long measure hurts readability more on small screens, not less.

### B. The structural moves that pay back

- **Container padding scale**: `px-4 sm:px-6 md:px-8` is the established rhythm. Stick to it.
- **Grid → stack**: use `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-...` rather than absolute widths. Default to 1 column.
- **Card density**: at 375px, two side-by-side stats per row max. The editorial dashboard's 6-exhibit grid uses `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` for exactly this reason.
- **Fixed-position floaters** (DesignSwitcher, "Ask the editor"): bottom-right safe-area on mobile, top-right on desktop. Don't fight for the same corner.

### C. The audit pattern

Before merging anything UI-touching:

1. Open the route at 375×844 in DevTools or Playwright.
2. Scroll top to bottom. Anything cropped or overflowing → blocker.
3. Tap every interactive element. Anything <44px or with no feedback → blocker.
4. Trigger every state (loading, error, empty, hover-equivalent on touch).
5. Re-check at 1280×900 to confirm nothing regressed there.

This isn't QA. It's a 90-second check before "looks good on my screen" turns into a UX bug.

## Trade-offs

- "Mobile-first" sometimes costs a polished desktop layout — the asymmetric editorial hero collapses to a single column on mobile, which is less interesting than the desktop version. That's fine. The constraint is "must work at 375"; "shines at 1280" is allowed but not required.
- Touch targets at 44px make density harder. Some dashboards want to pack more info per row than is comfortable. The right answer is almost always to remove information, not shrink targets.

## Open questions

1. Should we support landscape mobile (≥667×375) as a first-class viewport, or accept that it'll look like a squashed desktop? Today we don't think about it.
2. Tablet (768–1024) sits between mobile-first decisions and desktop ones. Do we want any tablet-specific tuning, or is "mobile up to 768, desktop above" enough? Currently it's the latter.

## Suggested first slice

This thread doesn't ship anything. Its first slice is **the next PR after this one**:
before merging it, run the audit pattern from §C and add a line in the PR
description explicitly noting the 375×844 sweep.

Memory pointer: [[mobile-first-always]] (in your private memory) is the same
principle, just for cross-session continuity.
