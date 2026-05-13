// Reverse-proxy from the Next.js origin to the FastAPI backend on Render.
//
// Why this exists:
//  1. The browser already authenticated against the frontend via Basic Auth
//     (see middleware.ts). The backend on Render lives on a different origin,
//     so the browser does NOT auto-send those credentials cross-origin.
//  2. Embedding backend credentials in the client bundle would defeat the auth.
//
// So: the browser calls /api/proxy/* (same origin, no CORS), the route handler
// runs server-side on Vercel, injects an Authorization header from server-only
// env vars (BACKEND_AUTH_USER / BACKEND_AUTH_PASS — same values as the user-
// facing BASIC_AUTH_*, but read from env vars that are NOT prefixed with
// NEXT_PUBLIC_ and therefore never reach the bundle), and forwards to BACKEND_URL.
//
// Supports JSON GET/POST and the SSE streaming used by the chat endpoint.

import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const AUTH_USER   = process.env.BACKEND_AUTH_USER || process.env.BASIC_AUTH_USER || "";
const AUTH_PASS   = process.env.BACKEND_AUTH_PASS || process.env.BASIC_AUTH_PASS || "";

function authHeader() {
  if (!AUTH_USER || !AUTH_PASS) return undefined;
  const b64 = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64");
  return `Basic ${b64}`;
}

async function forward(req: NextRequest, params: { path: string[] }) {
  // Pure pass-through: /api/proxy/foo/bar?x=1 → ${BACKEND_URL}/foo/bar?x=1.
  // The existing client sends fully-qualified paths like "/api/projects/asset_search",
  // so the rewritten URL is "${BACKEND_URL}/api/projects/asset_search" — correct.
  const target = `${BACKEND_URL}/${params.path.join("/")}${req.nextUrl.search}`;

  // Strip headers that don't belong on the upstream request: the browser's
  // Authorization (intended for our middleware, not the backend), Host, cookies,
  // and hop-by-hop bits. Forward Content-Type + Accept which the backend cares
  // about for JSON vs SSE.
  const fwdHeaders: Record<string, string> = {};
  const ct = req.headers.get("content-type"); if (ct) fwdHeaders["content-type"] = ct;
  const ac = req.headers.get("accept");       if (ac) fwdHeaders["accept"] = ac;
  const auth = authHeader();
  if (auth) fwdHeaders["authorization"] = auth;

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: fwdHeaders,
    // cache: 'no-store' — per-query results must never sit at the edge cache.
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // For multipart uploads we must NOT read-to-text (that mangles binary).
    // Read the raw bytes once and forward as ArrayBuffer; small enough for the
    // CSV uploads we deal with (≤ a few MB) and far simpler than stream-tee'ing.
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  // Pass through streaming bodies as-is (chat uses text/event-stream); for
  // everything else, the default Response constructor copies the stream body
  // anyway. Forward status, content-type, and the SSE cache hints.
  const respHeaders = new Headers();
  const ctOut = upstream.headers.get("content-type"); if (ctOut) respHeaders.set("content-type", ctOut);
  const cc = upstream.headers.get("cache-control");   if (cc)    respHeaders.set("cache-control", cc);
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: { path: string[] } })  { return forward(req, ctx.params); }
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) { return forward(req, ctx.params); }
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } })  { return forward(req, ctx.params); }
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) { return forward(req, ctx.params); }
