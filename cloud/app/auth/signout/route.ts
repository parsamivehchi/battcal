// Sign-out. POST-only (a GET must never mutate the session - link prefetchers would log the
// owner out). Clears the local owner-session cookie and lands on /login. (The prsa.me session
// itself is unaffected; the owner stays signed in to the identity provider.)
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { OIDC } from "@/lib/auth/oidc";

// Host-relative Location resolved from the registered redirect_uri's basePath - request.url is the
// *.vercel.app plumbing origin behind an apex rewrite and must never decide where the browser goes.
const BASE = new URL(OIDC.redirectUri).pathname.replace(/\/auth\/callback$/, "");

export async function POST() {
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: `${BASE}/login` },
  });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
