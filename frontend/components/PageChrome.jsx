"use client";
// Shared page chrome — the fixed top-right control cluster: Sign out + the
// design switcher. Rendered once per page.
//
// Why this component exists: Sign out and the switcher used to be two
// independently `fixed`-positioned elements, with Sign out pinned at a
// hard-coded `right-[182px]` guess of the switcher's width. Any change to
// that width — and the editorial mono font with wide tracking is visibly
// wider than the classic font — pushed the two controls into each other.
//
// Grouping both inside ONE fixed flex container removes the magic number
// entirely: a flex row with a gap cannot overlap at any breakpoint, in
// either design. This is the single source of truth for chrome placement.

import * as React from "react";
import { DesignSwitcher } from "@/components/DesignSwitcher";
import { SignOut } from "@/components/SignOut";

export function PageChrome() {
  return (
    <div className="fixed top-3 right-3 z-50 flex items-stretch gap-2">
      <SignOut />
      <DesignSwitcher />
    </div>
  );
}
