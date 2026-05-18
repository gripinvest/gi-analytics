"use client";
// Sign-out button — sits beside the DesignSwitcher inside <PageChrome />,
// which owns the fixed top-right placement. Adapts to editorial (italic
// mono, paper-on-ink hover) and classic (neutral text-button) without a
// design prop: reads useDesign() and styles inline.
//
// Responsive: on mobile (<sm) renders as an icon-only ↗ so the chrome
// cluster stays narrow at 375px; on desktop renders the full "Sign out"
// label. The aria-label keeps screen readers consistent either way.
//
// Behaviour: POST /api/logout (clears the grip-auth cookie), then
// router.replace("/login"). Using replace so the back-button doesn't
// bounce the user back into a now-unauthenticated page.

import * as React from "react";
import { useRouter } from "next/navigation";
import { useDesign } from "@/lib/design";

export function SignOut({ className = "" }) {
  const router = useRouter();
  const { design } = useDesign();
  const [pending, setPending] = React.useState(false);

  const onClick = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Even if the network call fails, still bounce the user — the
      // worst case is they linger logged-in on this device, which is
      // recoverable.
    }
    router.replace("/login");
  }, [pending, router]);

  const isEditorial = design === "editorial";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
      className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] select-none transition-[color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${className}`}
      style={
        isEditorial
          ? {
              fontFamily: "var(--ed-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--ed-ink-muted)",
              background: "transparent",
              padding: "8px 10px",
              border: 0,
              cursor: pending ? "default" : "pointer",
              opacity: pending ? 0.5 : 1,
            }
          : {
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 500,
              color: "var(--gi-text-tertiary)",
              background: "transparent",
              padding: "8px 10px",
              border: 0,
              borderRadius: 9999,
              cursor: pending ? "default" : "pointer",
              opacity: pending ? 0.5 : 1,
            }
      }
      onMouseEnter={(e) => {
        if (!pending) e.currentTarget.style.color = isEditorial ? "var(--ed-ink)" : "var(--gi-text-body)";
      }}
      onMouseLeave={(e) => {
        if (!pending) e.currentTarget.style.color = isEditorial ? "var(--ed-ink-muted)" : "var(--gi-text-tertiary)";
      }}
    >
      {/* Icon-only at mobile, full label at sm+. The arrow is one glyph wide so
          the mobile button never crowds the design pill or the page header. */}
      <span aria-hidden="true" className="sm:hidden">↗</span>
      <span aria-hidden="true" className="hidden sm:inline">
        {pending ? "Signing out…" : isEditorial ? "Sign out ↗" : "Sign out"}
      </span>
    </button>
  );
}
