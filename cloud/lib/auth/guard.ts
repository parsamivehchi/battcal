// Server-side owner guard for route handlers and server components (second auth layer after the
// edge middleware). A direct request to /api/* bypasses any client gate, so every route that
// returns private data must call requireOwner() and bail on a non-owner. Identity comes from the
// prsa.me OIDC session cookie minted by /auth/callback; MFA (passkey / TOTP) was already enforced
// upstream on prsa.me before it issued the id_token.
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { isOwnerEmail } from "@/lib/auth/owner";

export type OwnerCheck =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "no_session" | "not_owner" };

export async function requireOwner(): Promise<OwnerCheck> {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return { ok: false, reason: "no_session" };
  if (!isOwnerEmail(session.email)) {
    return { ok: false, reason: "not_owner" };
  }
  return { ok: true, userId: session.sub, email: session.email };
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
