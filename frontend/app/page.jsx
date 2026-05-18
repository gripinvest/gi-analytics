"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fetchProjects, uploadCSVs } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import { PageChrome } from "@/components/PageChrome";
import { useDesign } from "@/lib/design";
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
  const { design } = useDesign();
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

  // Editorial mode owns its own masthead and chrome. Hand off entirely.
  if (design === "editorial") {
    return (
      <EditorialHome
        projects={projects}
        loadError={loadError}
        showUpload={showUpload}
        setShowUpload={setShowUpload}
        chatProject={chatProject}
        setChatProject={setChatProject}
        load={load}
        onOpen={(id) => router.push(`/projects/${id}`)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-page">
      <PageChrome />
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

/* ── editorial home (the cover of the weekly) ─────────────────────────────── */

const ED_STATUS_LABEL = { active: "Live · this issue", draft: "Draft", archived: "Archived" };
const ED_EXTRAS = {
  asset_search: { weeks: "W1–W6", events: "~27.8K events", tagline: "Post-launch read on the new asset search feature." },
};

function EditorialHome({ projects, loadError, showUpload, setShowUpload, chatProject, setChatProject, load, onOpen }) {
  return (
    <main className="min-h-screen">
      <PageChrome />
      <div className="mx-auto max-w-[920px] px-5 py-12 sm:px-8 sm:py-16">
        {/* ── masthead ────────────────────────────────────────────────── */}
        <header className="ed-set">
          <p className="ed-caption mb-2">A FINANCIAL WEEKLY · INTERNAL EDITION</p>
          <h1 className="ed-masthead" style={{ fontSize: "clamp(72px, 14vw, 144px)" }}>
            Grip<br/>Weekly.
          </h1>
          <p className="ed-lede mt-5" style={{ maxWidth: "44ch", fontStyle: "italic" }}>
            A standing analytical column on Grip's products — bound, dated, footnoted.
          </p>
          <hr className="ed-rule-double mt-6" />
          <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>VOL. I</span><span>·</span>
            <span>NO. 06</span><span>·</span>
            <span>MAY 11, 2026</span><span>·</span>
            <span>NEW DELHI</span>
          </p>
        </header>

        {/* ── table of contents (the issues) ──────────────────────────── */}
        <section className="mt-14 ed-set ed-set-delay-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="ed-overline">IN THIS VOLUME</p>
            {loadError && (
              <p className="ed-prose-italic" style={{ fontSize: 13, color: "var(--ed-rust)" }}>
                Press is down — {loadError}
              </p>
            )}
          </div>
          <hr className="ed-rule mt-2" />

          {projects === null ? (
            <EditorialHomeSkeleton />
          ) : !projects.length ? (
            <p className="ed-prose-italic py-10">No issues are out yet. Upload some CSVs to set the first.</p>
          ) : (
            <ol className="mt-2 flex flex-col" style={{ listStyle: "none", padding: 0 }}>
              {projects.map((p, i) => (
                <EditorialIssueRow
                  key={p.id}
                  index={i + 1}
                  project={p}
                  onOpen={() => onOpen(p.id)}
                  onChat={() => setChatProject(p.id)}
                />
              ))}
            </ol>
          )}
        </section>

        {/* ── new-issue uploader (kept inline, editorial-styled) ──────── */}
        <section className="mt-14 ed-set ed-set-delay-2">
          <hr className="ed-rule-thick" />
          <div className="mt-5 flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <p className="ed-overline mb-1">SET A NEW ISSUE</p>
              <p className="ed-prose-italic" style={{ fontSize: 13 }}>
                Drop CSVs into an existing project's slot. DuckDB picks them up immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowUpload((v) => !v)}
              className={showUpload ? "ed-btn ed-btn-ghost" : "ed-btn"}
            >
              {showUpload ? "Close" : "Upload CSVs ↗"}
            </button>
          </div>
          {showUpload && (
            <div className="mt-6">
              <EditorialUploadPanel projects={projects || []} onClose={() => setShowUpload(false)} onUploaded={load} />
            </div>
          )}
        </section>

        {/* ── colophon ────────────────────────────────────────────────── */}
        <footer className="mt-20 ed-set ed-set-delay-3">
          <hr className="ed-rule" />
          <dl className="mt-5 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {[
              ["FRONT OF HOUSE", "Next.js 14 · Vercel"],
              ["BACK OF HOUSE", "FastAPI + DuckDB · Render"],
              ["EDITOR-IN-RESIDENCE", "Claude · tool_use → SQL"],
              ["MORGUE", "CSVs → DuckDB tables on startup"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3">
                <dt className="ed-caption" style={{ minWidth: 160 }}>{k}</dt>
                <dd className="ed-prose" style={{ fontSize: 13, color: "var(--ed-ink-muted)" }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="ed-byline mt-6" style={{ fontSize: 12 }}>
            Set in <strong style={{ fontWeight: 500, fontStyle: "normal" }}>Fraunces</strong>,
            <strong style={{ fontWeight: 500, fontStyle: "normal" }}> Newsreader</strong>, and
            <strong style={{ fontWeight: 500, fontStyle: "normal" }}> IBM Plex Mono</strong>.
            Printed on screen at 144dpi. © Grip Invest 2026.
          </p>
        </footer>
      </div>
      <ChatPanel projectId={chatProject ?? "asset_search"} isOpen={chatProject !== null} onClose={() => setChatProject(null)} />
    </main>
  );
}

function EditorialIssueRow({ index, project, onOpen, onChat }) {
  const status = project.status || "active";
  const extras = ED_EXTRAS[project.id] || {};
  const desc = extras.tagline || project.description || "";
  return (
    <li className="ed-set group" style={{ borderBottom: "1px solid var(--ed-rule)" }}>
      {/* Two-column on md+, stack on mobile. The number ("01") is a folio mark. */}
      <div className="py-6 md:py-7 grid gap-5 md:grid-cols-[64px_1fr_auto] md:items-baseline">
        <div
          className="ed-section-no"
          style={{ fontSize: "clamp(26px, 4vw, 40px)", color: "var(--ed-ink)", fontStyle: "normal", fontVariationSettings: "'opsz' 48, 'SOFT' 60" }}
        >
          {String(index).padStart(2, "0")}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
            <h2 className="ed-headline" style={{ fontSize: "clamp(28px, 4.5vw, 40px)", margin: 0 }}>
              {project.name}
            </h2>
            <span className="ed-caption" style={{ color: status === "active" ? "var(--ed-forest)" : "var(--ed-ink-muted)" }}>
              {ED_STATUS_LABEL[status] || status}
            </span>
          </div>
          {desc && (
            <p className="ed-prose-italic" style={{ maxWidth: "58ch", fontSize: 14, color: "var(--ed-ink-muted)" }}>
              {desc}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 ed-caption" style={{ color: "var(--ed-ink-muted)" }}>
            <span>{project.table_count ?? project.tables?.length ?? "—"} TABLES</span>
            {extras.weeks && <><span>·</span><span>{extras.weeks}</span></>}
            {extras.events && <><span>·</span><span>{extras.events}</span></>}
            {project.owner && <><span>·</span><span>OWNER {project.owner.toUpperCase()}</span></>}
          </div>
        </div>

        <div className="flex md:flex-col items-stretch gap-2 md:gap-1.5 mt-3 md:mt-0 md:items-end">
          <button type="button" onClick={onOpen} className="ed-btn">Read the issue ↗</button>
          <button type="button" onClick={onChat} className="ed-btn ed-btn-ghost">Ask the editor</button>
        </div>
      </div>
    </li>
  );
}

function EditorialHomeSkeleton() {
  return (
    <div className="space-y-6 mt-6">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-10 w-2/3 bg-[var(--ed-rule-faint)]" />
          <div className="h-4 w-1/2 bg-[var(--ed-rule-faint)] opacity-60" />
          <div className="h-3 w-1/3 bg-[var(--ed-rule-faint)] opacity-40" />
          <hr className="ed-rule mt-3" />
        </div>
      ))}
    </div>
  );
}

function EditorialUploadPanel({ projects, onClose, onUploaded }) {
  const [projectId, setProjectId] = React.useState(projects[0]?.id || "asset_search");
  const [files, setFiles] = React.useState([]);
  const [state, setState] = React.useState({ phase: "idle", msg: "" });

  async function submit() {
    if (!files.length) return;
    setState({ phase: "uploading", msg: "" });
    try {
      const res = await uploadCSVs(projectId, files);
      if (res && res.error) throw new Error(res.error);
      setState({ phase: "done", msg: `${(res.uploaded || []).length} file(s) set · ${(res.tables || []).length} tables now in ${projectId}` });
      onUploaded?.();
      setTimeout(() => onClose?.(), 1400);
    } catch (e) {
      setState({ phase: "error", msg: String((e && e.message) || e) });
    }
  }
  const uploading = state.phase === "uploading";
  const done = state.phase === "done";

  return (
    <div style={{ borderTop: "1px solid var(--ed-rule)", borderBottom: "1px solid var(--ed-rule)" }} className="py-6">
      <div className="grid gap-5 sm:grid-cols-[200px_1fr] sm:items-start">
        <label className="block">
          <span className="ed-caption block mb-2">SLOT</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="ed-input w-full"
            style={{ fontSize: 15 }}
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {!projects.length && <option value="asset_search">Asset Search</option>}
          </select>
        </label>
        <div>
          <span className="ed-caption block mb-2">CSV FILES</span>
          <label
            className="flex cursor-pointer items-center justify-center px-4 py-5 text-center transition-colors"
            style={{
              border: `1px dashed ${files.length ? "var(--ed-forest)" : "var(--ed-rule)"}`,
              background: files.length ? "rgba(59,94,61,0.06)" : "transparent",
            }}
          >
            <input type="file" multiple accept=".csv" className="hidden"
              onChange={(e) => { setFiles(Array.from(e.target.files || [])); setState({ phase: "idle", msg: "" }); }} />
            <span className="ed-prose-italic" style={{ fontSize: 14 }}>
              {files.length === 0
                ? "Click to choose .csv files"
                : `${files.length} file${files.length > 1 ? "s" : ""}: ${files.map((f) => f.name).join(", ").slice(0, 70)}${files.map((f) => f.name).join(", ").length > 70 ? "…" : ""}`}
            </span>
          </label>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={submit}
              disabled={!files.length || uploading || done}
              className="ed-btn"
              style={{ opacity: (!files.length || uploading || done) ? 0.5 : 1 }}
            >
              {done ? "✓ Set" : uploading ? "Setting…" : `Set ${files.length || ""} ↗`}
            </button>
            {state.msg && (
              <span
                className="ed-prose-italic"
                style={{ fontSize: 13, color: state.phase === "error" ? "var(--ed-rust)" : "var(--ed-forest)" }}
              >
                {state.msg}
              </span>
            )}
            <span className="ed-caption ml-auto" style={{ fontSize: 10 }}>POST /api/upload/{projectId}</span>
          </div>
        </div>
      </div>
    </div>
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
