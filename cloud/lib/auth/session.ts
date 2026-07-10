// Owner-session cookie for the prsa.me OIDC relying-party flow. battcal holds no auth session of its
// own: prsa.me is the identity provider (password + passkey + TOTP, with MFA enforced there). After
// /auth/callback verifies the prsa.me id_token, we mint this short HS256 cookie; the edge middleware
// (proxy.ts) and requireOwner() verify it. Signed with SESSION_SECRET, which is server-only and
// inlined into the edge bundle at build time.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "battcal_session";
export const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

export type Session = { sub: string; email: string };

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ email: s.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key());
}

// Returns null on anything wrong (missing/invalid/expired token, or even a missing secret): the
// caller treats null as "no session" and fails closed to /login.
export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const email = payload.email;
    if (!payload.sub || typeof email !== "string") return null;
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}
