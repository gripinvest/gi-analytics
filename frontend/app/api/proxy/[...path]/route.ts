// Reverse-proxy from the Next.js origin to the FastAPI backend.
//
// The browser called us authenticated (middleware.ts verified the
// grip-auth cookie). Here, server-side, we inject an Authorization header
// for the backend so the backend can validate independently. The backend
// credentials are env vars (or hardcoded demo defaults) — never reach the
// browser bundle.

import { NextRequest } from "next/server";

const DEFAULT_USER = "gripper";
const DEFAULT_PASS = "unicorn@grip.status";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const AUTH_USER =
  process.env.BACKEND_AUTH_USER ||
  process.env.BASIC_AUTH_USER ||
  DEFAULT_USER;
const AUTH_PASS =
  process.env.BACKEND_AUTH_PASS ||
  process.env.BASIC_AUTH_PASS ||
  DEFAULT_PASS;

function authHeader() {
  const b64 = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64");
  return `Basic ${b64}`;
}

async function forward(req: NextRequest, params: { path: string[] }) {
  // Pure pass-through: /api/proxy/foo/bar?x=1 → ${BACKEND_URL}/foo/bar?x=1.
  // The client sends fully-qualified paths like "/api/projects/asset_search",
  // so the rewritten URL becomes "${BACKEND_URL}/api/projects/asset_search".
  const target = `${BACKEND_URL}/${params.path.join("/")}${req.nextUrl.search}`;

  const fwdHeaders: Record<string, string> = {};
  const ct = req.headers.get("content-type"); if (ct) fwdHeaders["content-type"] = ct;
  const ac = req.headers.get("accept");       if (ac) fwdHeaders["accept"] = ac;
  fwdHeaders["authorization"] = authHeader();

  const init: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // ArrayBuffer (not text) — preserves multipart/form-data binary uploads.
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  // Forward status + content-type + cache-control. Stream the body through as
  // a ReadableStream so SSE (chat) and large payloads don't buffer entirely.
  const respHeaders = new Headers();
  const ctOut = upstream.headers.get("content-type"); if (ctOut) respHeaders.set("content-type", ctOut);
  const cc = upstream.headers.get("cache-control");   if (cc)    respHeaders.set("cache-control", cc);
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: { path: string[] } })    { return forward(req, ctx.params); }
export async function POST(req: NextRequest, ctx: { params: { path: string[] } })   { return forward(req, ctx.params); }
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } })    { return forward(req, ctx.params); }
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) { return forward(req, ctx.params); }
