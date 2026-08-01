// prsa.me OIDC relying-party client. battcal is a registered OAuth client (client_id "battcal") on the
// prsa.me identity provider; this module runs the OAuth 2.1 authorization-code + PKCE flow and
// verifies the returned RS256 id_token against prsa.me's JWKS. Server-only (node runtime): it uses
// node:crypto for PKCE and holds the client secret, so it must never be imported into the edge
// middleware or any client component.
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";

const ISSUER = process.env.PRSA_OIDC_ISSUER ?? "https://prsa.me";

// The platform broker answers on two co-equal apexes; pmcdn.me exists because prsa.me is
// unreachable from the owner's office network. Browser-visible hops (the authorize redirect and
// the callback return) MUST stay on the apex the visitor asked for, or the flow strands them on
// a blocked host. Server-side hops (token redemption) follow the same apex so the minted iss
// matches what the callback verifies. This list mirrors APEX_HOSTS in @prsa/auth (the template
// is vendored into standalone repos, so it cannot import the package).
const BROKER_APEXES = ["prsa.me", "pmcdn.me"];

export const OIDC = {
  issuer: ISSUER,
  clientId: process.env.PRSA_OIDC_CLIENT_ID ?? "battcal",
  clientSecret: process.env.PRSA_OIDC_CLIENT_SECRET ?? "",
  redirectUri: process.env.PRSA_OIDC_REDIRECT_URI ?? "https://mivehchi.dev/battcal/auth/callback",
  authorizeUrl: `${ISSUER}/oauth/authorize`,
  tokenUrl: `${ISSUER}/oauth/token`,
  jwksUrl: `${ISSUER}/oauth/jwks`,
};

/** Per-flow OIDC endpoints, derived from the host that served /auth/start.
 *
 *  Same-apex RPs (an app path-mounted on prsa.me/pmcdn.me, redirect_uri host is a broker apex):
 *  every endpoint and the redirect_uri swing to the REQUESTING apex, so a pmcdn.me visitor's
 *  whole round trip stays on pmcdn.me. Both apex redirect_uris must be registered on the client.
 *
 *  External-apex RPs (mivehchi.dev, dashboard.* - redirect_uri host is NOT a broker apex): the
 *  env-pinned values are returned unchanged, exactly the pre-dual-apex behavior.
 *
 *  The host is allowlist-matched (never reflected): an unrecognized or spoofed Host header falls
 *  back to the env-pinned configuration. */
export function oidcFor(host: string | null | undefined): typeof OIDC {
  const h = (host ?? "").split(":")[0].toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  const registered = new URL(OIDC.redirectUri);
  const sameApexRp = BROKER_APEXES.includes(registered.hostname);
  if (!sameApexRp || !BROKER_APEXES.includes(h)) return OIDC;
  const origin = `https://${h}`;
  return {
    ...OIDC,
    issuer: origin,
    redirectUri: `${origin}${registered.pathname}`,
    authorizeUrl: `${origin}/oauth/authorize`,
    tokenUrl: `${origin}/oauth/token`,
    // jwksUrl stays env-pinned: both apexes publish the same keypair and the fetch is
    // server-side (Vercel egress, unaffected by the office network block).
  };
}

// Lazy remote JWKS (fetched + cached on first verify). One set serves every issuer: the broker
// signs with a single keypair regardless of which apex minted the token.
const jwks = createRemoteJWKSet(new URL(OIDC.jwksUrl));

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const randToken = (): string => randomBytes(16).toString("base64url");

// The login transaction (PKCE verifier + state + nonce + the flow's issuer) survives the
// round-trip to the broker inside a signed, short-lived httpOnly cookie. Signed with
// SESSION_SECRET (shared with the session cookie).
function txKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

// `next` is the sanitized post-login destination carried from proxy.ts's auto-start redirect
// through /auth/start (see lib/auth/next.ts sanitizeNext) so /auth/callback can land the owner
// back where they started instead of always falling back to the app root. Absent on a direct
// /login -> "Sign in with SSO" click (no destination beyond the app itself) and on every
// broker-side error return (the tx cookie for those was minted by the ORIGINAL /auth/start call,
// which never received a next= worth carrying in an error scenario the login card handles).
export type OidcTx = { verifier: string; state: string; nonce: string; iss?: string; next?: string };

export async function signTx(tx: OidcTx): Promise<string> {
  return new SignJWT({ ...tx }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(txKey());
}

export async function verifyTx(token: string | undefined): Promise<OidcTx | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, txKey(), { algorithms: ["HS256"] });
    const { verifier, state, nonce, iss, next } = payload as JWTPayload & Partial<OidcTx>;
    if (!verifier || !state || !nonce) return null;
    return { verifier, state, nonce, iss, next: typeof next === "string" ? next : undefined };
  } catch {
    return null;
  }
}

export type IdClaims = { sub: string; email?: string; name?: string; amr?: string[] };

// Verifies the RS256 id_token against the broker's JWKS (signature, issuer, audience) and the
// nonce. `issuer` is the flow's issuer from the transaction cookie; defaults to the env pin.
export async function verifyIdToken(idToken: string, nonce: string, issuer: string = OIDC.issuer): Promise<IdClaims> {
  const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: OIDC.clientId });
  if (payload.nonce !== nonce) throw new Error("nonce_mismatch");
  return {
    sub: String(payload.sub),
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    amr: payload.amr as string[] | undefined,
  };
}
