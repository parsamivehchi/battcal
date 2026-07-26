// Owner-only sign-in gate. Identity is delegated to the prsa.me OIDC provider: one button starts the
// OAuth 2.1 authorization-code + PKCE flow, and /auth/callback verifies the id_token and mints the
// local session.
//
// Pre-auth surface: no PII, no explanatory copy. Domain, app name, clock, one button. The card is
// always dark glass (matches the hub login), so there is no theme boot script on this page.
//
// This file is the SERVER half: metadata + the ?error= lookup. The card itself is a client component
// because the domain chip and clock are browser-only values (and any DOM the server writes here
// would be clobbered when React hydrates).
//
// Generated from templates/relying-party by scripts/sync-rp-login.mjs. Edit the TEMPLATE, not the copies.
import type { Metadata } from "next";
import { LoginCard } from "./login-card";

export const metadata: Metadata = {
  title: "BattCal - Sign in",
  robots: { index: false, follow: false },
};

// Terse by design: the visitor is the owner, and a failed sign-in only needs to say what to do next.
const ERRORS: Record<string, string> = {
  not_owner: "Not an authorized account.",
  expired: "Sign-in expired. Try again.",
  missing_code: "Sign-in did not complete. Try again.",
  state_mismatch: "Sign-in could not be verified. Try again.",
  token_exchange: "Sign-in could not be completed. Try again.",
  no_id_token: "No identity was returned. Try again.",
  bad_id_token: "Identity could not be verified. Try again.",
  access_denied: "Sign-in was cancelled.",
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const msg = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;

  return <LoginCard authStart="/battcal/auth/start" error={msg} />;
}
