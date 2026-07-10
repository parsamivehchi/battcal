// Begin "Sign in with prsa.me": mint a PKCE challenge + state + nonce, stash them in a signed
// short-lived cookie, and redirect to the prsa.me authorization endpoint. prsa.me enforces the
// owner's password + passkey/TOTP (AAL2) before it will issue a code back to /auth/callback.
import { NextResponse } from "next/server";
import { OIDC, pkce, randToken, signTx } from "@/lib/auth/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { verifier, challenge } = pkce();
  const state = randToken();
  const nonce = randToken();
  const tx = await signTx({ verifier, state, nonce });

  const u = new URL(OIDC.authorizeUrl);
  u.searchParams.set("client_id", OIDC.clientId);
  u.searchParams.set("redirect_uri", OIDC.redirectUri);
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
