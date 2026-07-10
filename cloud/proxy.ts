// Edge middleware (Next 16 renamed middleware.ts -> proxy.ts, export `proxy`). First of the auth
// layers: gate every non-public route on a valid owner-session cookie. Identity and MFA are
// delegated to prsa.me (the OIDC identity provider); this only verifies the short HS256 session
// minted by /auth/callback. Fail closed: no/invalid session -> /login.
// Shape copied from the netstats reference (the basePath deviations are load-bearing).
import { type NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { isOwnerEmail } from "@/lib/auth/owner";

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

export async function proxy(request: NextRequest) {
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
  // Anyone without a valid owner session on a private route -> /login.
  if (!isOwner && !isPublic) {
    return redirectTo("/login");
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
