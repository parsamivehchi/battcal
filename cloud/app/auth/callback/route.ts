// prsa.me OIDC callback. Verifies the returned state against the signed transaction cookie,
// exchanges the code (+ PKCE verifier) for tokens at prsa.me, verifies the RS256 id_token, and
// only when the identity is the owner mints the local owner-session cookie. Every failure lands
// back on /login with a reason and clears the transaction cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OIDC, oidcFor, verifyTx, verifyIdToken } from "@/lib/auth/oidc";
import { signSession, SESSION_COOKIE, ONE_TIME_MAX_AGE, PERSIST_MAX_AGE } from "@/lib/auth/session";
import { isOwnerEmail } from "@/lib/auth/owner";
import { onAuthEvent } from "@/lib/auth/hooks";
import { sanitizeNext } from "@/lib/auth/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Canonical base path derived from the registered redirect_uri (always apex + basePath +
// /auth/callback). Behind an apex rewrite, request.url carries the *.vercel.app plumbing origin -
// building absolute redirects from it strands the browser on a host where the host-only cookies
// do not exist (login then fails as "expired"). Host-relative Locations resolve on whatever
// canonical origin the browser is already on, so the plumbing host can never leak.
const BASE = new URL(OIDC.redirectUri).pathname.replace(/\/auth\/callback$/, "");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const jar = await cookies();

  const backToLogin = (reason: string) => {
    const res = new NextResponse(null, {
      status: 307,
      headers: { Location: `${BASE}/login?error=${encodeURIComponent(reason)}` },
    });
    res.cookies.delete("battcal_oidc_tx");
    return res;
  };

  if (oauthError) return backToLogin(oauthError);
  if (!code || !state) return backToLogin("missing_code");

  const tx = await verifyTx(jar.get("battcal_oidc_tx")?.value);
  if (!tx) return backToLogin("expired");
  if (tx.state !== state) return backToLogin("state_mismatch");

  // The flow's apex rode in the signed tx cookie (set by /auth/start): redeem the code and
  // verify the issuer against the SAME apex the browser flow ran on. A tx without iss (minted by
  // a pre-dual-apex deploy) falls back to the env-pinned configuration.
  const flow = tx.iss ? oidcFor(new URL(tx.iss).host) : OIDC;

  // Exchange the authorization code (+ PKCE verifier) for tokens at the broker.
  let idToken: string | undefined;
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId,
      client_secret: flow.clientSecret,
      code_verifier: tx.verifier,
    });
    const r = await fetch(flow.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!r.ok) return backToLogin("token_exchange");
    idToken = ((await r.json()) as { id_token?: string }).id_token;
  } catch {
    return backToLogin("token_exchange");
  }
  if (!idToken) return backToLogin("no_id_token");

  let email: string | undefined;
  let sub: string;
  let persist = false;
  try {
    const claims = await verifyIdToken(idToken, tx.nonce, flow.issuer);
    email = claims.email;
    sub = claims.sub;
    // P1 (2026-08-11): the broker's own "Remember for 30 days" choice, not re-decided here -
    // see @prsa/auth/persist.ts (broker) and lib/auth/session.ts (this RP's own cookie Max-Age,
    // which this claim now drives instead of a fixed per-app constant).
    persist = claims.persist === true;
  } catch {
    return backToLogin("bad_id_token");
  }

  if (!isOwnerEmail(email)) {
    void onAuthEvent("denied_not_owner", { email: email ?? null });
    return backToLogin("not_owner");
  }

  void onAuthEvent("sign_in", { email });
  const token = await signSession({ sub, email: email! }, persist);
  // Re-sanitize defensively: tx.next only ever reaches here via sanitizeNext at /auth/start, but
  // this is the value that actually becomes a Location header, so a future caller of signTx that
  // skips that step still cannot smuggle an open redirect through. A missing/unsafe next falls
  // back to BASE exactly as before this change (the app root), never to /login - only
  // backToLogin (above) ever sends the visitor there, and it never sets next=, so a broken
  // sign-in can never auto-restart into a loop.
  const dest = sanitizeNext(tx.next) ?? (BASE || "/");
  const res = new NextResponse(null, {
    status: 307,
    headers: { Location: dest },
  });
  // The cookie's own Max-Age must never outlive the JWT it carries (signSession already picked
  // ONE_TIME_MAX_AGE or PERSIST_MAX_AGE from the same `persist` flag) - keep both in lockstep by
  // deriving this from the identical boolean rather than a second computation.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: persist ? PERSIST_MAX_AGE : ONE_TIME_MAX_AGE,
  });
  res.cookies.delete("battcal_oidc_tx");
  return res;
}
