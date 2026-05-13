// Sign-out — clears the grip-auth cookie. POST so it can't be triggered by
// a stray GET (CSRF would still work without anti-CSRF but logout-only CSRF
// is benign for a demo).

import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "grip-auth",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
