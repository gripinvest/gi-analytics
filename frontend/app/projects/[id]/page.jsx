"use client";

import * as React from "react";
import Link from "next/link";
import { fetchProject } from "@/lib/api";
import { getDashboard } from "@/components/dashboards";
import { ChatPanel } from "@/components/ChatPanel";
import { PageHeader, Button, Badge, Card, Skeleton } from "@/components/ui";

const STATUS_TONE = { active: "success", draft: "warning", archived: "neutral" };

export default function ProjectPage({ params }) {
  const id = params.id;
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

  const Dashboard = project ? getDashboard(project.dashboard_component) : null;
  const niceId = id.replace(/_/g, " ");

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7 md:px-8">
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
