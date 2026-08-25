// Owner-session cookie for the prsa.me OIDC relying-party flow. battcal holds no auth session of its
// own: prsa.me is the identity provider (password + passkey + TOTP, with MFA enforced there). After
// /auth/callback verifies the prsa.me id_token, we mint this short HS256 cookie; the edge middleware
// (proxy.ts) and requireOwner() verify it. Signed with SESSION_SECRET, which is server-only and
// inlined into the edge bundle at build time.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "battcal_session";

// Always-persist + idle lock (owner decision 2026-08-23, superseding the 2026-08-11 P1 split):
// the broker now always sends persist=1 (the "Remember" checkbox is gone), so every session is
// PERSIST_MAX_AGE and the window SLIDES - proxy.ts re-mints this cookie on activity with a fresh
// `las` (last-seen) claim, and refuses once `las` is older than the idle window, sending the
// navigation through the zero-click broker hop (where an idle BROKER seat requires one passkey
// tap). ONE_TIME_MAX_AGE is retained only for a legacy persist=0 code from a pre-2026-08-23
// broker in flight during a deploy. Kept separate from the cookie's own Max-Age
// (callback/route.ts) so the two can never drift: the cookie should never outlive the token.
export const ONE_TIME_MAX_AGE = 60 * 60 * 8; // legacy in-flight codes only - see above.
export const PERSIST_MAX_AGE = 60 * 60 * 24 * 30; // 30 days - matches the broker's PERSIST_DAYS.

/** Idle window (ms): past this much inactivity the session refuses and re-auths through the
 *  broker hop. Override for tests/tuning via SESSION_IDLE_MS. */
export const IDLE_MS_DEFAULT = 15 * 60 * 1000;
export function idleMs(): number {
  const v = Number(process.env.SESSION_IDLE_MS);
  return Number.isFinite(v) && v > 0 ? v : IDLE_MS_DEFAULT;
}
/** Re-mint (slide) the session at most this often. */
export const SESSION_REFRESH_MS = 5 * 60 * 1000;

// Local dev escape: without SESSION_SECRET configured (the common case for `next dev` without
// wiring the full prsa.me OIDC round-trip locally), the gate fails closed and every route
// redirects to /login with no way to see the UI. NODE_ENV is "production" in every deployed
// environment (Vercel sets it), so this can never activate outside a local dev server - prod
// stays fail-closed regardless.
export const DEV_UNGATED = process.env.NODE_ENV === "development" && !process.env.SESSION_SECRET;

export type Session = { sub: string; email: string };
/** A verified session plus its freshness facts, for the proxy's idle/slide decisions. */
export type VerifiedSession = Session & {
  /** Last-seen activity, epoch seconds. Old tokens without the claim read as their iat. */
  lastSeen: number;
  /** Mint time, epoch seconds (0 for a malformed token that somehow verified). */
  iat: number;
};

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

/** `persist` mirrors the broker id_token's own claim (verifyIdToken -> IdClaims.persist) - the
 *  owner's "Remember for 30 days" choice, propagated here rather than re-decided locally. */
export async function signSession(s: Session, persist: boolean): Promise<string> {
  const maxAge = persist ? PERSIST_MAX_AGE : ONE_TIME_MAX_AGE;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: s.email, las: now })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + maxAge)
    .sign(key());
}

// Returns null on anything wrong (missing/invalid/expired token, or even a missing secret): the
// caller treats null as "no session" and fails closed to /login.
export async function verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const email = payload.email;
    if (!payload.sub || typeof email !== "string") return null;
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    // A pre-2026-08-23 token has no `las`: read its iat as the last activity, so it slides (or
    // idles) from its mint time instead of being treated as forever-fresh.
    const las = typeof payload.las === "number" ? payload.las : iat;
    return { sub: payload.sub, email, lastSeen: las, iat };
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
