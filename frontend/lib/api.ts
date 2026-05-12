// lib/api.ts — typed API client for the FastAPI backend

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
}

export interface StreamToken {
  type: "thinking" | "text" | "done";
  text: string;
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
