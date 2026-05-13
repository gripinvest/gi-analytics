// Sign-in API. Validates username/password against env vars (falling back to
// the hardcoded demo defaults), then sets an HTTP-only cookie that the
// middleware checks on every subsequent request.
//
// The cookie value is base64("user:pass") — same encoding as Basic Auth.
// Middleware decodes and re-validates against env vars on every request, so
// the cookie alone is not a self-attesting credential; the server is always
// the source of truth.

import { NextRequest, NextResponse } from "next/server";

const DEFAULT_USER = "gripper";
const DEFAULT_PASS = "unicorn@grip.status";

const COOKIE_NAME = "grip-auth";
// 12 hours — generous for a demo, short enough that a forgotten session
// doesn't linger. The cookie itself is HTTP-only and Secure in prod.
const COOKIE_MAX_AGE = 60 * 60 * 12;

export async function POST(req: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER || DEFAULT_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS || DEFAULT_PASS;

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { username = "", password = "" } = body;
  if (username !== expectedUser || password !== expectedPass) {
    // Don't disclose which one is wrong. Add a tiny delay so a brute-forcer
    // doesn't get to do 10K req/sec against a 22-char password.
    await new Promise((r) => setTimeout(r, 350));
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Cookie value = base64("user:pass"). Server validates on every request.
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
