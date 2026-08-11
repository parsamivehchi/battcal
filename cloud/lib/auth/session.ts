// Owner-session cookie for the prsa.me OIDC relying-party flow. battcal holds no auth session of its
// own: prsa.me is the identity provider (password + passkey + TOTP, with MFA enforced there). After
// /auth/callback verifies the prsa.me id_token, we mint this short HS256 cookie; the edge middleware
// (proxy.ts) and requireOwner() verify it. Signed with SESSION_SECRET, which is server-only and
// inlined into the edge bundle at build time.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "battcal_session";

// P1 (2026-08-11): the JWT's own expiry now DEPENDS on the broker's `persist` claim rather than a
// single fixed constant - this used to be a flat 8h everywhere (netstats) or a hand-diverged
// 30-day fork (water), an inconsistency that existed only because there was no shared signal to
// key off. `PERSIST_MAX_AGE` (30 days) mirrors the broker's own @prsa/auth PERSIST_DAYS; a
// one-time login gets `ONE_TIME_MAX_AGE`, deliberately short (this JWT itself cannot be a true
// "until browser close" cookie the way prsa_persist is at the broker - it needs SOME expiry - but
// it can and should be short enough that staying signed into an RP app for a whole browser
// session, with no explicit remember, does not silently turn into a month-long credential the way
// the old flat 8h/30d constants did for whichever app happened to pick the longer one). Kept
// separate from the cookie's own Max-Age (callback/route.ts) so the two can never drift: the
// cookie should never outlive the token it carries.
export const ONE_TIME_MAX_AGE = 60 * 60 * 8; // 8 hours - a normal single working session.
export const PERSIST_MAX_AGE = 60 * 60 * 24 * 30; // 30 days - matches the broker's PERSIST_DAYS.

// Local dev escape: without SESSION_SECRET configured (the common case for `next dev` without
// wiring the full prsa.me OIDC round-trip locally), the gate fails closed and every route
// redirects to /login with no way to see the UI. NODE_ENV is "production" in every deployed
// environment (Vercel sets it), so this can never activate outside a local dev server - prod
// stays fail-closed regardless.
export const DEV_UNGATED = process.env.NODE_ENV === "development" && !process.env.SESSION_SECRET;

export type Session = { sub: string; email: string };

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

/** `persist` mirrors the broker id_token's own claim (verifyIdToken -> IdClaims.persist) - the
 *  owner's "Remember for 30 days" choice, propagated here rather than re-decided locally. */
export async function signSession(s: Session, persist: boolean): Promise<string> {
  const maxAge = persist ? PERSIST_MAX_AGE : ONE_TIME_MAX_AGE;
  return new SignJWT({ email: s.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
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

// Seconds remaining until the session cookie's JWT expires. Upstreamed here 2026-08-11 (P1
// closure-rule fix): squared-dashboard had grown this locally to back a session-timer ping
// (public/assets/app.v1.3.js -> GET /api/auth/session, warns the owner before a forced sign-out)
// and it was never part of the canonical template, so bringing session.ts's sync to EVERY target
// (not just in-repo apps) would otherwise have deleted a real, in-use export out from under it.
// Generically useful for any RP that wants the same warning, and harmless for the ones that
// don't (an unused export costs nothing) - upstreaming beats leaving squared-dashboard as a
// permanently hand-diverged fork. Same fail-safe contract as verifySession: null on anything
// wrong, never throws.
export async function sessionRemaining(token: string | undefined | null): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.exp !== "number") return null;
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  } catch {
    return null;
  }
}
