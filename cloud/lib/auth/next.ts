// Zero-click hub hop: the signed-out gate no longer stops at a login card requiring a click - it
// redirects straight into /auth/start, and a signed-in owner sails through the broker (no consent
// interstitial, see apps/portal's /oauth/authorize) and lands back on the page they asked for.
// This module holds the three pure pieces that make that safe: which requests are allowed to
// auto-start (proxy.ts), what destination survives the round trip (proxy.ts + /auth/start), and
// sanitizing that destination against an attacker-controlled query param (/auth/start).
//
// Duplicated rather than imported from @prsa/auth: this app is a standalone OIDC relying party
// (the template is vendored into external repos with no workspace access - see the APEX_HOSTS
// duplication note in oidc.ts for the same constraint).

/** True for a genuine full-page browser navigation. Sec-Fetch-Mode is a Fetch Metadata request
 *  header every modern browser sets on the request itself (not spoofable via app code): "navigate"
 *  only for a top-level document load (address bar, link click, form submit), "cors"/"same-origin"/
 *  "no-cors" for a fetch()/XHR call - including the app's OWN in-page fetches and a Next.js
 *  client-side <Link> soft-navigation (which fetches the RSC payload, not a top-level load).
 *
 *  ABSENCE of the header defaults to true (treat as navigation). Two reasons this default matters,
 *  not just one:
 *    - The fleet probe (apps/portal/src/lib/status-probe.ts, probeApp) issues a plain server-side
 *      fetch() with redirect:"manual" and NO Sec-Fetch-* headers at all (those are browser-only).
 *      It asserts only that a gated app's 3xx Location host matches expectedRedirectHost
 *      (packages/ui/src/apps.ts) - never the path. Defaulting to "navigation" keeps that probe on
 *      the redirect branch (still a 3xx to the same host), so the auth-bypass tripwire it exists to
 *      catch is unaffected by swapping the redirect target from /login to /auth/start. Defaulting
 *      the other way would 401 the probe instead and turn the fleet board red for all 15 apps at
 *      once with no real regression behind it.
 *    - Any other non-browser client (curl, a health check, an older Safari without Fetch Metadata
 *      support) keeps the pre-existing redirect-to-login-equivalent behavior rather than a surprise
 *      401 it never got before this change. */
export function isNavigationRequest(headers: { get(name: string): string | null }): boolean {
  const mode = headers.get("sec-fetch-mode");
  return mode === null || mode === "navigate";
}

/** Builds the post-login `next=` destination for a gated navigation, re-prepending the app's
 *  basePath. `pathname` must already be basePath-STRIPPED (as Next's NextURL reports it) - the
 *  live bug this mirrors: @prsa/auth's signedOutLoginUrl was fixed for exactly this (PR #29) after
 *  building `next=` from pathname alone dropped the basePath entirely on a bare app-root visit and
 *  pointed at the wrong app's path one level deeper. Returns null for the bare app root (no path,
 *  no query beyond it): that is already where BASE (the callback's default landing spot) points,
 *  so /auth/start is not asked to carry a redundant next=. */
export function nextDestFor(basePath: string, pathname: string, search: string): string | null {
  const strippedPath = pathname === "/" ? "" : pathname;
  const dest = `${basePath}${strippedPath}${search}`;
  return dest && dest !== basePath ? dest : null;
}

/** Sanitizes the `next` query param read on /auth/start. It arrives from a public, unauthenticated
 *  GET (a crafted link to /<app>/auth/start?next=https://evil.com reaches this route the same way
 *  /login always has), so only a same-origin RELATIVE path may survive into the signed tx cookie
 *  and the eventual post-login redirect. Mirrors @prsa/auth's safe-next.ts (sanitizeNext) exactly.
 *
 *  Unlike that version (which always returns a redirectable "/" fallback for its call site), this
 *  returns null for "no safe destination" so /auth/start and /auth/callback can tell "carry
 *  nothing" apart from "carry the app root" and fall back to the existing default (BASE) instead
 *  of writing a redundant next= into the tx cookie. */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // The URL parser strips ASCII tab/newline/CR from anywhere in the input, and trims leading
  // C0-control-or-space; either could re-form a "//" authority AFTER a naive check. Normalize first.
  const stripped = raw.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, "");
  // Safe iff a single leading slash NOT followed by "/" or "\" (both would be protocol-relative).
  if (!/^\/(?![/\\])/.test(stripped)) return null;
  return stripped === "/" ? null : stripped;
}
