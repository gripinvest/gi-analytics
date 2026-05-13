// Auth gate — cookie-based now (replaces the earlier WWW-Authenticate flow).
//
// On every request we validate the `grip-auth` cookie against the expected
// credentials (env vars, or the hardcoded demo defaults). When the cookie is
// missing or invalid, the user is redirected to /login. /login itself and
// the /api/login + /api/logout endpoints are public so the redirect loop
// doesn't form.
//
// Why cookie-validate-on-every-request instead of issuing a signed session
// token: a 2-credential demo doesn't justify the secret-rotation surface
// area of a real session system. The cookie holds the same base64("u:p")
// payload as Basic Auth and is HTTP-only + SameSite=Lax + Secure (in prod),
// so it's not addressable from JS.

import { NextRequest, NextResponse } from "next/server";

const DEFAULT_USER = "gripper";
const DEFAULT_PASS = "unicorn@grip.status";
const COOKIE_NAME = "grip-auth";

// Routes that bypass auth so the redirect-to-login flow can complete.
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/login",
  "/api/logout",
]);

// Constant-time compare. Edge runtime: no Node crypto.timingSafeEqual,
// length-and-XOR is good enough for this threat model.
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const user = process.env.BASIC_AUTH_USER || DEFAULT_USER;
  const pass = process.env.BASIC_AUTH_PASS || DEFAULT_PASS;

  const token = req.cookies.get(COOKIE_NAME)?.value || "";
  if (token) {
    try {
      const decoded = atob(token);
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        if (safeEqual(u, user) && safeEqual(p, pass)) return NextResponse.next();
      }
    } catch { /* malformed cookie → fall through to redirect */ }
  }

  // Redirect to /login, preserving where the user was headed so we can
  // bounce them back after a successful sign-in.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = pathname + (search || "");
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

// Skip Next internals + static assets so they can render before login.
// /icon.svg and the Google Fonts CSS go through the public path.
export const config = {
  matcher: ["/((?!_next/static|_next/image|_vercel|favicon\\.ico).*)"],
};
