// prsa.me OIDC callback. Verifies the returned state against the signed transaction cookie,
// exchanges the code (+ PKCE verifier) for tokens at prsa.me, verifies the RS256 id_token, and
// only when the identity is the owner mints the local owner-session cookie. Every failure lands
// back on /login with a reason and clears the transaction cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OIDC, verifyTx, verifyIdToken } from "@/lib/auth/oidc";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { isOwnerEmail } from "@/lib/auth/owner";
import { onAuthEvent } from "@/lib/auth/hooks";

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

  // Exchange the authorization code (+ PKCE verifier) for tokens at prsa.me.
  let idToken: string | undefined;
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: OIDC.redirectUri,
      client_id: OIDC.clientId,
      client_secret: OIDC.clientSecret,
      code_verifier: tx.verifier,
    });
    const r = await fetch(OIDC.tokenUrl, {
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
  try {
    const claims = await verifyIdToken(idToken, tx.nonce);
    email = claims.email;
    sub = claims.sub;
  } catch {
    return backToLogin("bad_id_token");
  }

  if (!isOwnerEmail(email)) {
    void onAuthEvent("denied_not_owner", { email: email ?? null });
    return backToLogin("not_owner");
  }

  void onAuthEvent("sign_in", { email });
  const token = await signSession({ sub, email: email! });
  const res = new NextResponse(null, {
    status: 307,
    headers: { Location: BASE || "/" },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  res.cookies.delete("battcal_oidc_tx");
  return res;
}
