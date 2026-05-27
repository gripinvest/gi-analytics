// lib/api.ts — typed API client for the FastAPI backend
//
// All requests go through the Next.js reverse-proxy at /api/proxy (same origin),
// which injects the backend Basic Auth header server-side. Same-origin means the
// browser auto-sends its cached Basic Auth (gated by middleware.ts) without any
// CORS or credentials: 'include' dance.
//
// For local dev without the proxy you can still hit the backend directly by
// setting NEXT_PUBLIC_API_URL=http://localhost:8000 — but the default (and the
// only config that ships to Vercel) is the same-origin proxy path.

const BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window === "undefined" ? "http://localhost:8000" : "/api/proxy");

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "draft" | "archived";
  tags: string[];
  table_count: number;
  tables: string[];
  updated_at: string;
  owner?: string;
  jira_ticket?: string;
  dashboard_component?: string;
  refreshable?: boolean;
  freshness?: { reuse_window_minutes?: number };
  manifest?: {
    refreshed_at?: string;
    tables?: Record<string, { last_refreshed_at: string }>;
    /** Learn (Grip Education) — A/B integrity indicators written by the
     *  cron. Optional; absent on other projects + on Learn before V2. */
    margin_notes?: {
      as_of_week: string;
      srm: { control_n?: number; treatment_n?: number; p_value?: number | null; verdict: string };
      control_leak: { control_visitors?: number; control_cohort?: number; leak_pct?: number | null; verdict: string };
      fti_lift_ci: { control_pct?: number | null; treatment_pct?: number | null; delta_pp?: number | null; ci_lower_pp?: number | null; ci_upper_pp?: number | null; verdict: string };
      mde: { n_per_arm?: number; pooled_rate_pct?: number; mde_abs_pp?: number | null; mde_rel_pct?: number | null };
    };
  } | null;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // For assistant messages: which model the advisor picked for this turn.
  // 'reject' means the advisor classified the user's question as off-topic
  // and the content is the fixed redirect. Undefined on user messages and
  // on historical messages that pre-date the advisor.
  model?: "haiku" | "sonnet" | "opus" | "reject";
  // Follow-up question suggestions generated server-side after the answer
  // finished streaming. Rendered as clickable chips under the assistant
  // bubble that auto-send when clicked. Undefined on user messages and on
  // any turn where the follow-up generator returned no usable JSON.
  followups?: string[];
}

// Server can emit five event kinds:
//   thinking  - status update during the tool-use loop ("Running: …")
//   text      - a chunk of the final answer being streamed
//   model     - one-time event near the start: { label: 'haiku' | 'sonnet' |
//               'opus' | 'reject' }. Tells the UI which model the advisor
//               picked for this turn. "reject" means the question was off-
//               topic and the text that follows is a fixed redirect, not a
//               model answer.
//   followups - one-time event after the answer streams: { suggestions:
//               string[] } — 3 short follow-up questions the UI renders as
//               clickable chips. Empty/absent when the follow-up generator
//               errors or the answer was a reject.
//   done      - terminal sentinel (also encoded as "data: [DONE]")
export interface StreamToken {
  type: "thinking" | "text" | "done" | "model" | "followups";
  text?: string;
  label?: "haiku" | "sonnet" | "opus" | "reject";
  suggestions?: string[];
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE}/api/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(id: string): Promise<Project> {
  const res = await fetch(`${BASE}/api/projects/${id}`);
  if (!res.ok) throw new Error(`Project ${id} not found`);
  return res.json();
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function runQuery(
  projectId: string,
  sql: string,
  limit = 500
): Promise<QueryResult> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, limit }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status}`);
  return res.json();
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadCSVs(
  projectId: string,
  files: File[]
): Promise<{ uploaded: string[]; tables: string[] }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${BASE}/api/upload/${projectId}`, {
    method: "POST",
    body: form,
  });
  return res.json();
}

// ── Chat (streaming SSE) ──────────────────────────────────────────────────────

export async function* streamChat(
  projectId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamToken> {
  const res = await fetch(`${BASE}/api/chat/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok || !res.body) throw new Error("Chat stream failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        yield JSON.parse(payload) as StreamToken;
      } catch {
        // malformed SSE line — skip
      }
    }
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────

export interface RefreshJob {
  status: "running" | "done" | "error";
  log?: string[];
  error?: string | null;
}

// Kick a background refresh; returns a job id to poll. A 409 (a refresh is
// already running) resolves to the in-flight job's id and marks
// `alreadyRunning: true` so the caller can attach to that job silently
// instead of starting a new one. `job_id` is null in the rare race where the
// running job finishes between the 409 and reading its body.
export async function refreshProject(
  projectId: string
): Promise<{ job_id: string | null; alreadyRunning: boolean }> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/refresh`, {
    method: "POST",
  });
  if (res.status === 409) {
    const body = await res.json();
    return { job_id: body?.detail?.job_id ?? null, alreadyRunning: true };
  }
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const body = await res.json();
  return { job_id: body.job_id, alreadyRunning: false };
}

// Poll a refresh job. status is "running" | "done" | "error".
export async function pollRefresh(
  projectId: string,
  jobId: string
): Promise<RefreshJob> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/refresh/${jobId}`);
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

// ── FRA YouTube insights ──────────────────────────────────────────────────────

export interface FraInsights {
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  snapshot_date?: string;
}

/** GET /api/projects/fra_youtube/insights — returns the cached AI narrative brief. */
export async function fetchFraInsights(): Promise<FraInsights> {
  const res = await fetch(`${BASE}/api/projects/fra_youtube/insights`);
  if (!res.ok) throw new Error(`fetchFraInsights failed: ${res.status}`);
  return res.json();
}
