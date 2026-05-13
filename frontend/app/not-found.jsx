import Link from "next/link";
import { PageHeader, Card, Button } from "@/components/ui";

// Custom 404 — matches the rest of the app's chrome instead of Next.js's
// stark default. Kept server-rendered (no "use client") so it stays tiny.
export const metadata = { title: "Not found" };

export default function NotFound() {
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
