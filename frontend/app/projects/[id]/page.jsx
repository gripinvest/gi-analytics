"use client";

import * as React from "react";
import Link from "next/link";
import { fetchProject } from "@/lib/api";
import { getDashboard } from "@/components/dashboards";
import { ChatPanel } from "@/components/ChatPanel";
import { PageChrome } from "@/components/PageChrome";
import { useDesign } from "@/lib/design";
import { PageHeader, Button, Badge, Card, Skeleton } from "@/components/ui";

const STATUS_TONE = { active: "success", draft: "warning", archived: "neutral" };

export default function ProjectPage({ params }) {
  const id = params.id;
  const { design } = useDesign();
  const isEditorial = design === "editorial";

  const [project, setProject] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [chatOpen, setChatOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setProject(null);
    setError(null);
    fetchProject(id)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch((e) => { if (!cancelled) setError(String((e && e.message) || e)); });
    return () => { cancelled = true; };
  }, [id]);

  const Dashboard = project ? getDashboard(project.dashboard_component, design) : null;
  const niceId = id.replace(/_/g, " ");

  // Editorial mode owns its own masthead and chrome — the classic PageHeader
  // would clash. The container width and background also differ.
  if (isEditorial) {
    return (
      <main className="min-h-screen">
        <PageChrome />
        {/* pt-20 on mobile reserves space for the fixed PageChrome cluster
            (~62px tall) so it clears the dashboard's top content; sm:py-16
            reverts it once there's room beside the chrome. */}
        <div className="mx-auto max-w-[920px] px-5 py-12 pt-20 sm:px-8 sm:py-16">
          {error ? (
            <section>
              <h2 className="ed-headline mb-3">We can't render <em>{niceId}</em>.</h2>
              <p className="ed-prose-italic">{error}</p>
              <Link href="/" className="ed-btn ed-btn-ghost mt-6 inline-block">← Back to the index</Link>
            </section>
          ) : !project ? (
            <EditorialSkeleton />
          ) : (
            <Dashboard project={project} />
          )}
        </div>

        {/* Floating "Ask the editor" trigger — bottom-right, paper-on-ink. */}
        {project && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="ed-btn fixed bottom-6 right-6 z-40 shadow-[2px_4px_0_rgba(27,24,24,0.20)]"
          >
            Ask the editor ↗
          </button>
        )}
        <ChatPanel projectId={id} isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      </main>
    );
  }

  // Classic mode — unchanged from before.
  return (
    <main className="min-h-screen bg-page">
      <PageChrome />
      {/* pt-20 on mobile reserves space for the fixed PageChrome cluster
          (~62px tall) so it doesn't overlap the PageHeader breadcrumb/title;
          sm:py-7 reverts it once there's room beside the header. */}
      <div className="mx-auto max-w-[1180px] px-4 py-5 pt-20 sm:px-6 sm:py-7 md:px-8">
        <PageHeader
          breadcrumb={<Link href="/" className="text-link hover:underline">← Grip Analytics</Link>}
          overline="Project"
          title={project?.name || (error ? "Project not found" : <Skeleton className="h-8 w-56 inline-block align-middle" />)}
          description={
            project?.description ||
            (error ? <span className="text-error-700">{error}</span> : <Skeleton className="h-4 w-full max-w-[34rem] inline-block align-middle" />)
          }
          actions={
            project && (
              <>
                <Button variant="secondary" size="md"
                  onClick={() => window.open(`/api/proxy/api/projects/${id}`, "_blank")}>
                  Project JSON
                </Button>
                <Button variant="primary" size="md" onClick={() => setChatOpen(true)}>
                  Ask the data
                </Button>
              </>
            )
          }
        />

        {project && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[project.status] || "neutral"} variant="soft" dot className="capitalize">
              {project.status || "active"}
            </Badge>
            {(project.tags || []).map((t) => <Badge key={t} tone="neutral" variant="soft">{t}</Badge>)}
            <span className="t-body-xs text-tertiary">{project.tables?.length || 0} tables</span>
            {project.owner && <span className="t-body-xs text-tertiary">· Owner {project.owner}</span>}
            {project.jira_ticket && (
              <a href="#" className="t-body-xs text-link hover:underline">· {project.jira_ticket}</a>
            )}
          </div>
        )}

        <div className="mt-7">
          {error ? (
            <Card pad="lg" className="text-center">
              <p className="t-heading-md text-heading">We couldn't load <span className="font-mono">{niceId}</span>.</p>
              <p className="t-body-sm text-tertiary mt-1">{error}</p>
              <p className="t-body-sm text-tertiary mt-3">
                Is the backend running on <span className="font-mono">localhost:8000</span>?
                <Link href="/" className="text-link hover:underline ml-1">Back to projects</Link>
              </p>
            </Card>
          ) : !project ? (
            <DashboardSkeleton />
          ) : (
            <Dashboard project={project} />
          )}
        </div>
      </div>

      <ChatPanel projectId={id} isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card pad="lg">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-16" /></div>
          ))}
        </div>
      </Card>
      <div className="flex gap-5 border-b border-border-default">
        {["Overview", "Terms & assets", "Instrumentation"].map((t) => <Skeleton key={t} className="h-4 w-24 mb-2" />)}
      </div>
      <Card pad="md"><Skeleton className="h-[300px] w-full" /></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card pad="md"><Skeleton className="h-[260px] w-full" /></Card>
        <Card pad="md"><Skeleton className="h-[260px] w-full" /></Card>
      </div>
    </div>
  );
}

function EditorialSkeleton() {
  return (
    <div>
      <div className="ed-set">
        <div className="h-3 w-40 bg-[var(--ed-rule-faint)] mb-3" />
        <div className="h-20 w-3/4 bg-[var(--ed-rule-faint)] mb-3" />
        <hr className="ed-rule-double mt-5" />
        <div className="h-3 w-1/2 bg-[var(--ed-rule-faint)] mt-3" />
      </div>
      <div className="mt-12 grid gap-10 md:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <div className="h-3 w-24 bg-[var(--ed-rule-faint)]" />
          <div className="h-12 w-full bg-[var(--ed-rule-faint)]" />
          <div className="h-12 w-4/5 bg-[var(--ed-rule-faint)]" />
        </div>
        <div className="h-40 w-full bg-[var(--ed-rule-faint)] opacity-60" />
      </div>
    </div>
  );
}
