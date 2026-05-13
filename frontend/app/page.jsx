"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fetchProjects, uploadCSVs } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import { DesignSwitcher } from "@/components/DesignSwitcher";
import {
  PageHeader, Card, CardHeader, CardTitle, CardBody, Button, Badge, Stat, Skeleton,
} from "@/components/ui";

const STATUS_TONE = { active: "success", draft: "warning", archived: "neutral" };
const STATUS_LABEL = { active: "Live", draft: "Draft", archived: "Archived" };

/* Display extras keyed by project id — things project.json doesn't carry yet
   (weeks covered, total events). The numbers below are the analysed Asset Search figures. */
const PROJECT_EXTRAS = {
  asset_search: { weeks: "W1–W6", events: "~27.8K" },
};

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = React.useState(null);
  const [loadError, setLoadError] = React.useState(null);
  const [showUpload, setShowUpload] = React.useState(false);
  const [chatProject, setChatProject] = React.useState(null);

  const load = React.useCallback(() => {
    setLoadError(null);
    fetchProjects().then(setProjects).catch((e) => { setProjects([]); setLoadError(String((e && e.message) || e)); });
  }, []);
  React.useEffect(load, [load]);

  return (
    <main className="min-h-screen bg-page">
      <DesignSwitcher />
      <div className="mx-auto max-w-[1180px] px-6 py-7 md:px-8">
        <PageHeader
          overline="Grip Invest · Internal"
          title="Analytics Platform"
          description="Interactive dashboards and conversational Q&A on raw product event data. CSVs land in DuckDB; Claude answers questions in SQL."
          actions={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowUpload((v) => !v)}>
                {showUpload ? "Close" : "Upload CSVs"}
              </Button>
              <Button variant="primary" size="md" onClick={() => alert("Project creation is not wired up yet — upload CSVs to add data to an existing project.")}>
                New project
              </Button>
            </>
          }
        />

        {/* stack strip — inline, not a card grid */}
        <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-md border border-border-default bg-surface px-4 py-3 shadow-xs">
          {[
            ["Frontend", "Next.js 14 · Vercel"],
            ["Backend", "FastAPI + DuckDB · Render"],
            ["AI", "claude-sonnet-4 · tool_use → SQL"],
            ["Data", "CSV → DuckDB views on startup"],
          ].map(([k, v]) => (
            <span key={k} className="flex items-baseline gap-2">
              <span className="t-emphasis-sm text-heading">{k}</span>
              <span className="t-body-xs text-tertiary">{v}</span>
            </span>
          ))}
        </div>

        {showUpload && (
          <div className="mt-6">
            <UploadPanel projects={projects || []} onClose={() => setShowUpload(false)} onUploaded={load} />
          </div>
        )}

        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="t-overline text-tertiary">Projects {projects ? `(${projects.length})` : ""}</h2>
            {loadError && <span className="t-body-xs text-error-600">backend unreachable — {loadError}</span>}
          </div>

          <div className="mt-4 grid gap-5 md:grid-cols-2">
            {projects === null ? (
              <>
                <Card pad="lg"><Skeleton className="h-40 w-full" /></Card>
                <Card pad="lg"><Skeleton className="h-40 w-full" /></Card>
              </>
            ) : (
              <>
                {projects.map((p) => (
                  <ProjectCard key={p.id} project={p}
                    onOpen={() => router.push(`/projects/${p.id}`)}
                    onChat={() => setChatProject(p.id)} />
                ))}
                <NewProjectCard onClick={() => setShowUpload(true)} />
              </>
            )}
          </div>
        </section>

        <p className="mt-8 t-body-xs text-tertiary">
          Backend on <span className="font-mono">localhost:8000</span> · data at <span className="font-mono">backend/data/&lt;project&gt;/*.csv</span> · chat = Claude tool_use → DuckDB → streamed answer.
        </p>
      </div>

      <ChatPanel projectId={chatProject ?? "asset_search"} isOpen={chatProject !== null} onClose={() => setChatProject(null)} />
    </main>
  );
}

/* ── project card ─────────────────────────────────────────────────────────── */

function ProjectCard({ project, onOpen, onChat }) {
  const extras = PROJECT_EXTRAS[project.id] || {};
  const status = project.status || "active";
  return (
    <Card pad="lg" interactive className="flex flex-col gap-4">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="t-heading-lg truncate">{project.name}</CardTitle>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[status] || "neutral"} variant="soft" dot>{STATUS_LABEL[status] || status}</Badge>
            {(project.tags || []).slice(0, 4).map((t) => <Badge key={t} tone="neutral" variant="soft">{t}</Badge>)}
          </div>
        </div>
        <div className="shrink-0 text-right t-body-xs text-tertiary leading-relaxed">
          {project.updated_at && <div>Updated {project.updated_at}</div>}
          {project.owner && <div>Owner {project.owner}</div>}
          {project.jira_ticket && <div className="text-link">{project.jira_ticket}</div>}
        </div>
      </CardHeader>

      {project.description && <p className="t-body-sm text-secondary line-clamp-3">{project.description}</p>}

      <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-sm bg-page px-3 py-2.5 [&>*+*]:border-l [&>*+*]:border-border-default [&>*+*]:pl-8">
        <MiniStat label="Tables" value={project.table_count ?? project.tables?.length ?? "—"} />
        {extras.weeks && <MiniStat label="Weeks" value={extras.weeks} />}
        {extras.events && <MiniStat label="Events" value={extras.events} />}
      </div>

      <div className="mt-auto flex gap-2 pt-1">
        <Button variant="primary" size="md" block onClick={onOpen}>Open dashboard</Button>
        <Button variant="secondary" size="md" block onClick={onChat}>Ask the data</Button>
      </div>
    </Card>
  );
}

function MiniStat({ label, value }) {
  return (
    <span className="min-w-0">
      <span className="block t-label-sm text-tertiary uppercase tracking-wide">{label}</span>
      <span className="block t-emphasis-lg t-num text-heading mt-0.5">{value}</span>
    </span>
  );
}

function NewProjectCard({ onClick }) {
  return (
    <button onClick={onClick}
      className="group flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border-default bg-transparent p-7 text-tertiary transition-colors duration-150 hover:border-navy-300 hover:bg-tint-navy/40 hover:text-navy-700">
      <span className="t-display-md leading-none">+</span>
      <span className="t-heading-sm">New project</span>
      <span className="t-body-xs text-center">Upload CSVs → instant dashboard + Q&amp;A</span>
    </button>
  );
}

/* ── upload panel (wired to the real endpoint) ────────────────────────────── */

function UploadPanel({ projects, onClose, onUploaded }) {
  const [projectId, setProjectId] = React.useState(projects[0]?.id || "asset_search");
  const [files, setFiles] = React.useState([]);
  const [state, setState] = React.useState({ phase: "idle", msg: "" }); // idle | uploading | done | error

  async function submit() {
    if (!files.length) return;
    setState({ phase: "uploading", msg: "" });
    try {
      const res = await uploadCSVs(projectId, files);
      if (res && res.error) throw new Error(res.error);
      setState({ phase: "done", msg: `${(res.uploaded || []).length} file(s) loaded · ${(res.tables || []).length} tables now in ${projectId}` });
      onUploaded?.();
      setTimeout(() => onClose?.(), 1400);
    } catch (e) {
      setState({ phase: "error", msg: String((e && e.message) || e) });
    }
  }

  const uploading = state.phase === "uploading";
  const done = state.phase === "done";

  return (
    <Card pad="lg">
      <CardHeader>
        <div><CardTitle>Upload CSV data</CardTitle>
          <p className="t-body-sm text-tertiary mt-0.5">Files are written to the project folder and registered as DuckDB views immediately. SELECT-queryable and chat-queryable right away.</p></div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
      </CardHeader>
      <CardBody className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-start">
        <label className="block">
          <span className="t-label-md text-secondary">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
            className="mt-1.5 w-full rounded-sm border border-border-default bg-surface px-2.5 py-2 t-body-sm text-heading outline-none focus:border-navy-400">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {!projects.length && <option value="asset_search">Asset Search</option>}
          </select>
        </label>
        <div>
          <span className="t-label-md text-secondary">CSV files</span>
          <label className={`mt-1.5 flex cursor-pointer items-center justify-center rounded-sm border-2 border-dashed px-4 py-5 text-center transition-colors ${files.length ? "border-success-300 bg-status-success-bg" : "border-border-default bg-page hover:border-navy-300"}`}>
            <input type="file" multiple accept=".csv" className="hidden"
              onChange={(e) => { setFiles(Array.from(e.target.files || [])); setState({ phase: "idle", msg: "" }); }} />
            <span className="t-body-sm text-secondary">
              {files.length === 0 ? "Click to choose .csv files" : `${files.length} file${files.length > 1 ? "s" : ""}: ${files.map((f) => f.name).join(", ").slice(0, 70)}${files.map((f) => f.name).join(", ").length > 70 ? "…" : ""}`}
            </span>
          </label>
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" size="md" onClick={submit} disabled={!files.length || uploading || done}>
              {done ? "✓ Uploaded" : uploading ? "Uploading…" : `Upload${files.length ? ` ${files.length}` : ""}`}
            </Button>
            {state.msg && (
              <span className={`t-body-sm ${state.phase === "error" ? "text-error-700" : "text-success-700"}`}>{state.msg}</span>
            )}
            <span className="ml-auto t-body-xs text-tertiary">POST /api/upload/{projectId}</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
