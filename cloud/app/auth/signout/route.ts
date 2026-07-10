// Sign-out. POST-only (a GET must never mutate the session - link prefetchers would log the
// owner out). Clears the local owner-session cookie and lands on /login. (The prsa.me session
// itself is unaffected; the owner stays signed in to the identity provider.)
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  // Relative Location: behind the mivehchi.dev proxy, request.url carries the rewrite-destination
  // origin, so an absolute redirect would leak the plumbing host. 303 turns the POST into a GET.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/battcal/login" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
