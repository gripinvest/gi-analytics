// Basic-auth gate for the entire app. The credentials are server-only env vars
// (BASIC_AUTH_USER / BASIC_AUTH_PASS) — they are NEVER exposed to the browser
// bundle. The Authorization header the user enters via the browser's prompt is
// the only thing checked here.
//
// Why edge middleware: it runs before any page render OR API route, so the same
// credentials gate the dashboard, the /api/proxy reverse-proxy, and static
// metadata routes (icon.svg, robots.txt) in one place.
//
// When the env vars are unset (local dev), middleware skips entirely.

import { NextRequest, NextResponse } from "next/server";

const REALM = 'Basic realm="grip-analytics"';

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

// Constant-time compare. Edge runtime doesn't ship Node's `crypto.timingSafeEqual`
// but lengths-and-XOR is good enough for a 2-credential gate; the threat model
// here is "stop random pokers", not "defeat a nation-state".
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  // Auth disabled when either env var is missing (local dev convenience).
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return unauthorized();

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorized();
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return unauthorized();
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  if (!safeEqual(u, user) || !safeEqual(p, pass)) return unauthorized();

  return NextResponse.next();
}

// Skip Next internals + the public _vercel paths. Everything else (pages, API
// routes, static favicons under /app, etc.) gets gated.
export const config = {
  matcher: ["/((?!_next/static|_next/image|_vercel).*)"],
};
