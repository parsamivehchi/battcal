// prsa.me OIDC relying-party client. battcal is a registered OAuth client (client_id "battcal") on the
// prsa.me identity provider; this module runs the OAuth 2.1 authorization-code + PKCE flow and
// verifies the returned RS256 id_token against prsa.me's JWKS. Server-only (node runtime): it uses
// node:crypto for PKCE and holds the client secret, so it must never be imported into the edge
// middleware or any client component.
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";

const ISSUER = process.env.PRSA_OIDC_ISSUER ?? "https://prsa.me";

export const OIDC = {
  issuer: ISSUER,
  clientId: process.env.PRSA_OIDC_CLIENT_ID ?? "battcal",
  clientSecret: process.env.PRSA_OIDC_CLIENT_SECRET ?? "",
  redirectUri: process.env.PRSA_OIDC_REDIRECT_URI ?? "https://mivehchi.dev/battcal/auth/callback",
  authorizeUrl: `${ISSUER}/oauth/authorize`,
  tokenUrl: `${ISSUER}/oauth/token`,
  jwksUrl: `${ISSUER}/oauth/jwks`,
};

// Lazy remote JWKS (fetched + cached on first verify).
const jwks = createRemoteJWKSet(new URL(OIDC.jwksUrl));

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const randToken = (): string => randomBytes(16).toString("base64url");

// The login transaction (PKCE verifier + state + nonce) survives the round-trip to prsa.me inside
// a signed, short-lived httpOnly cookie. Signed with SESSION_SECRET (shared with the session cookie).
function txKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type OidcTx = { verifier: string; state: string; nonce: string };

export async function signTx(tx: OidcTx): Promise<string> {
  return new SignJWT({ ...tx }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(txKey());
}

export async function verifyTx(token: string | undefined): Promise<OidcTx | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, txKey(), { algorithms: ["HS256"] });
    const { verifier, state, nonce } = payload as JWTPayload & Partial<OidcTx>;
    if (!verifier || !state || !nonce) return null;
    return { verifier, state, nonce };
  } catch {
    return null;
  }
}

export type IdClaims = { sub: string; email?: string; name?: string; amr?: string[] };

// Verifies the RS256 id_token against prsa.me's JWKS (signature, issuer, audience) and the nonce.
export async function verifyIdToken(idToken: string, nonce: string): Promise<IdClaims> {
  const { payload } = await jwtVerify(idToken, jwks, { issuer: OIDC.issuer, audience: OIDC.clientId });
  if (payload.nonce !== nonce) throw new Error("nonce_mismatch");
  return {
    sub: String(payload.sub),
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    amr: payload.amr as string[] | undefined,
  };
}
