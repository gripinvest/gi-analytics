"use client";

import Link from "next/link";
import { PageHeader, Card, Button } from "@/components/ui";
import { useDesign } from "@/lib/design";

// Custom 404 — dispatches on design. Editorial variant is a single
// solemn page: black-bar dateline, italic headline, the byline does
// the explanatory work. No card.
//
// Now a client component because it dispatches on useDesign(); the
// SSR pass renders classic and the editorial swap happens on hydrate.
// The flash is one frame — acceptable for a not-found state.

export default function NotFound() {
  const { design } = useDesign();
  if (design === "editorial") return <EditorialNotFound />;
  return <ClassicNotFound />;
}

function ClassicNotFound() {
  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 sm:py-20">
        <PageHeader
          breadcrumb={<Link href="/" className="text-link hover:underline">← Grip Analytics</Link>}
          overline="404"
          title="We can't find that page."
          description="The link may be stale, or the project moved. Head back to the index — your dashboards are still there."
        />
        <Card pad="lg" className="mt-8 flex flex-col items-start gap-4">
          <p className="t-body-sm text-tertiary">
            If you arrived from a saved link, the URL shape changed when we shipped the project-id routing.
            All current projects live under <span className="font-mono">/projects/&lt;id&gt;</span>.
          </p>
          <Link href="/">
            <Button variant="primary" size="md">Back to projects</Button>
          </Link>
        </Card>
      </div>
    </main>
  );
}

function EditorialNotFound() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[720px] px-5 py-16 sm:px-8 sm:py-24">
        <Link href="/" className="ed-caption hover:underline" style={{ color: "var(--ed-ink-muted)" }}>
          ← BACK TO INDEX
        </Link>
        <p className="ed-overline mt-10 mb-3">ERRATUM · NO. 404</p>
        <h1 className="ed-headline" style={{ fontSize: "clamp(48px, 8vw, 88px)", lineHeight: 0.95 }}>
          <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
            The page you sought
          </em><br/>
          is not in this volume.
        </h1>
        <hr className="ed-rule-double mt-8" />
        <p className="ed-lede mt-6" style={{ maxWidth: "52ch", fontStyle: "italic" }}>
          Some links bind together pages that no longer share a spine. If you arrived from a saved
          address, the URL shape changed when we shipped the project-id routing. All current issues
          now live under <span style={{ fontFamily: "var(--ed-mono)", fontStyle: "normal" }}>/projects/&lt;id&gt;</span>.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/" className="ed-btn">Back to the index ↗</Link>
        </div>
        <p className="ed-byline mt-12" style={{ fontSize: 12 }}>
          — The Editor regrets the inconvenience.
        </p>
      </div>
    </main>
  );
}
