// APP-OWNED auth-event hook (NOT synced by sync-rp-auth.mjs - customize freely per app).
// The synced auth route handlers call onAuthEvent() at the audit-worthy moments; the default is a
// no-op so apps without an audit sink pay nothing. An app with an audit table (e.g. investments'
// auth_events) delegates here to its own logger. Must never throw: an audit failure must never
// take down an auth flow.
export type AuthHookEvent = "sign_in" | "sign_out" | "denied_not_owner";

export async function onAuthEvent(
  _event: AuthHookEvent,
  _opts: { email?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  // no-op by default
}
