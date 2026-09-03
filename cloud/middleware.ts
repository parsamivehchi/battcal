// Edge middleware, kept as middleware.ts rather than Next 16's newer proxy.ts convention every
// other in-repo RP ships (templates/relying-party/src/proxy.ts). PILOT (2026-09-01) for a
// Cloudflare Workers build via OpenNext: proxy.ts is nodejs-runtime only and cannot be switched,
// so OpenNext routes it through Node.js-middleware support the build itself warns is
// experimental and unmaintained. middleware.ts keeps the mature edge-runtime path OpenNext has
// supported since inception - see domains/mivehchi.space/src/middleware.ts for the same choice.
// Do NOT add `runtime: "edge"` below: it is this file's documented default, and an explicit
// value trips a known "edge" vs "experimental-edge" enum mismatch between Next and the adapter.
// First of the auth
// layers: gate every non-public route on a valid owner-session cookie. Identity and MFA are
// delegated to prsa.me (the OIDC identity provider); this only verifies the short HS256 session
// minted by /auth/callback. Fail closed: no/invalid session -> /login.
// Shape copied from the netstats reference (the basePath deviations are load-bearing).
import { type NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE, signSession, idleMs, SESSION_REFRESH_MS, PERSIST_MAX_AGE } from "@/lib/auth/session";
import { isOwnerEmail } from "@/lib/auth/owner";
import { isNavigationRequest, nextDestFor } from "@/lib/auth/next";

// /login and the whole /auth/* flow (start, callback, signout) must be reachable signed-out.
// Segment match, not a bare prefix, so a future "/login-x" cannot become silently public.
const PUBLIC_PREFIXES = ["/login", "/auth"];

// Local dev without auth env (bare `npm run dev`, no SESSION_SECRET): stay ungated so the mirror
// can be developed against stub data. Production always has NODE_ENV=production, so a missing
// secret there still fails CLOSED (everything -> /login).
const devUngated = () => process.env.NODE_ENV === "development" && !process.env.SESSION_SECRET;

// mivehchi.dev/battcal is the ONLY public version. The apex project proxies to this app and
// forwards the original host (x-forwarded-host: mivehchi.dev), so any other host reaching us is
// a direct hit on plumbing (the vercel.app alias or a deployment URL) and gets a permanent
// redirect to the canonical URL.
const CANONICAL_HOST = "mivehchi.dev";
const isLocalHost = (h: string) =>
  h.startsWith("localhost") || h.endsWith(".localhost") || h.startsWith("127.");

export async function middleware(request: NextRequest) {
  if (devUngated()) return NextResponse.next();
  const host = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
  if (host !== CANONICAL_HOST && !isLocalHost(host)) {
    const u = request.nextUrl.clone();
    u.protocol = "https:";
    u.host = CANONICAL_HOST;
    u.port = "";
    return NextResponse.redirect(u, 308);
  }
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isOwner = !!session && isOwnerEmail(session.email);

  // basePath /battcal: nextUrl.pathname EXCLUDES the basePath (so the checks above are prefix-
  // free), and cloning nextUrl re-serializes redirects WITH it; new URL("/login", request.url)
  // would not.
  const redirectTo = (pathname: string) => {
    const u = request.nextUrl.clone();
    u.pathname = pathname;
    u.search = "";
    return NextResponse.redirect(u);
  };
  // Signed-in owner sitting on /login -> home.
  if (isOwner && path === "/login") {
    return redirectTo("/");
  }
  // Signed-out visitor to a private route: zero-click hub hop straight to /auth/start (carrying
  // the original destination, basePath-prefixed, as next=) instead of stopping at a /login card
  // requiring a manual click - the broker has no consent interstitial for this client, so a
  // valid broker session + satisfied AAL lands the owner right back on /battcal/... where they
  // started.
  //
  // Restricted to genuine top-level navigations (isNavigationRequest): a signed-out fetch()/XHR
  // (this app's own client code, or a Next.js client-side <Link> soft-navigation fetching the
  // RSC payload) must never be redirected into an OAuth hop mid-flight - it gets a clean 401
  // instead. The /login card itself is untouched (PUBLIC_PREFIXES exempts it unconditionally),
  // so a broken sign-in never auto-restarts into a loop; it always stops on a manual button.
  if (!isOwner && !isPublic) {
    if (!isNavigationRequest(request.headers)) {
      return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const u = request.nextUrl.clone();
    const dest = nextDestFor(request.nextUrl.basePath, request.nextUrl.pathname, request.nextUrl.search);
    u.pathname = "/auth/start";
    u.search = "";
    if (dest) u.searchParams.set("next", dest);
    return NextResponse.redirect(u);
  }
  // IDLE LOCK + SLIDING WINDOW (owner decision 2026-08-23, applied to the external fleet
  // 2026-08-24). This app received the new session library in the same round - PERSIST_MAX_AGE,
  // idleMs(), SESSION_REFRESH_MS and the `las` claim all landed in lib/auth/session.ts - but
  // scripts/sync-rp-auth.mjs gates proxy.ts to in-repo apps only, so NOTHING here ever called any
  // of it. The result was a session with the exports of a sliding one and the behaviour of a fixed
  // one: 30 days from the moment of sign-in regardless of use, then a hard re-login, and no idle
  // lock at all. That last part matters most - always-persist was justified BY the idle lock as its
  // compensating control, and this app had the persist without the control.
  //
  // The redirect below is built exactly the way this file's own signed-out branch builds it, on
  // purpose: that construction is already proven correct for this app's basePath and mount, and a
  // second, subtly different one is how a redirect silently escapes the app.
  if (session && isOwner && !isPublic) {
    const now = Date.now();
    if (now - session.lastSeen * 1000 > idleMs()) {
      // Locked. A top-level navigation re-auths through the zero-click broker hop: an active
      // broker seat resolves silently, an idle one costs one passkey tap - either way `next`
      // lands the owner back HERE. A background fetch gets 423 so client code can tell locked
      // from signed-out (the shared SessionLockBanner in @prsa/ui reads exactly this).
      if (!isNavigationRequest(request.headers)) {
        return new NextResponse(JSON.stringify({ error: "locked" }), {
          status: 423,
          headers: { "content-type": "application/json" },
        });
      }
      const u = request.nextUrl.clone();
      const dest = nextDestFor(request.nextUrl.basePath, request.nextUrl.pathname, request.nextUrl.search);
      u.pathname = "/auth/start";
      u.search = "";
      if (dest) u.searchParams.set("next", dest);
      return NextResponse.redirect(u);
    }
    // Active: slide. Re-mint with a fresh `las` and a full window, throttled off the token's own
    // iat so this costs one Set-Cookie every few minutes rather than a signature per request.
    // Legacy sub-less tokens (iat 0) are skipped rather than re-minted.
    if (session.iat > 0 && now - session.iat * 1000 > SESSION_REFRESH_MS) {
      const res = NextResponse.next();
      try {
        const token = await signSession({ sub: session.sub, email: session.email }, true);
        res.cookies.set(SESSION_COOKIE, token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: PERSIST_MAX_AGE,
        });
      } catch {
        // A failed re-mint must never break the request - the existing cookie still has life.
      }
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // The app root: the negative-lookahead pattern below does NOT match the bare "/" (verified
    // empirically under a basePath - the page served ungated without this entry).
    "/",
    // Everything else except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
