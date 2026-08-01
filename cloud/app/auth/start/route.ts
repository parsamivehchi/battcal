// Begin "Sign in with prsa.me": mint a PKCE challenge + state + nonce, stash them in a signed
// short-lived cookie, and redirect to the broker's authorization endpoint. The broker enforces
// the owner's password + passkey/TOTP (AAL2) before it will issue a code back to /auth/callback.
//
// Host-aware: the flow's endpoints derive from the apex that served this request (oidcFor), so a
// pmcdn.me visitor's whole round trip stays on pmcdn.me. The chosen issuer rides in the signed
// transaction cookie so /auth/callback redeems and verifies against the same apex.
//
// `next`: proxy.ts's auto-start redirect (and the /login card's manual button, unchanged) may
// carry a `?next=` destination to land the owner back where they started after sign-in instead of
// the app root. It is a public, unauthenticated query param, so sanitizeNext rejects anything that
// is not a same-origin relative path before it is allowed into the signed tx cookie.
import { type NextRequest, NextResponse } from "next/server";
import { oidcFor, pkce, randToken, signTx } from "@/lib/auth/oidc";
import { sanitizeNext } from "@/lib/auth/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const flow = oidcFor(req.headers.get("x-forwarded-host") ?? req.nextUrl.host);
  const { verifier, challenge } = pkce();
  const state = randToken();
  const nonce = randToken();
  const next = sanitizeNext(req.nextUrl.searchParams.get("next")) ?? undefined;
  const tx = await signTx({ verifier, state, nonce, iss: flow.issuer, next });

  const u = new URL(flow.authorizeUrl);
  u.searchParams.set("client_id", flow.clientId);
  u.searchParams.set("redirect_uri", flow.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(u);
  res.cookies.set("battcal_oidc_tx", tx, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
