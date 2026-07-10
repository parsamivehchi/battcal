// Centralized owner allowlist: the single source of truth for "who is the owner".
// Shared by the client gate, the edge middleware (proxy.ts), and the server-side guard
// so the three layers can never disagree. Pure module (no React, no Supabase), safe to
// import anywhere.
//
// Override per-deployment with OWNER_EMAILS (comma-separated). Server-only (NOT NEXT_PUBLIC) so the
// allowlist is never inlined into a client bundle. Defaults to parsa@mivehchi.net so a missing OR
// EMPTY env var can never lock the owner out (|| not ?? - an empty string must fall through to the
// default, else the allowlist would be empty and gate everyone out). Compared lowercase.

const RAW = process.env.OWNER_EMAILS?.trim() || "parsa@mivehchi.net";

export const OWNER_EMAILS: string[] = RAW.split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** True when `email` belongs to the owner (case-insensitive). */
export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && OWNER_EMAILS.includes(email.toLowerCase());
}
