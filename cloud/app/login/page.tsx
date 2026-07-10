// Owner-only sign-in gate. Identity is delegated to the prsa.me OIDC provider: one button starts the
// OAuth 2.1 authorization-code + PKCE flow, and /auth/callback verifies the id_token and mints the
// local session.
//
// Pre-auth surface: no PII, no explanatory copy. Domain, app name, clock, one button.
//
// This file is the SERVER half: metadata + the ?error= lookup + the no-flash theme script. The card
// itself is a client component because the domain chip and clock are browser-only values (and any DOM
// the server writes here would be clobbered when React hydrates).
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

  return (
    <>
      {/* Paints the theme onto <html> before first paint so a dark-mode owner is never flashed white.
          It only touches documentElement attributes, which React does not manage, so hydration keeps them. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <LoginCard authStart="/battcal/auth/start" error={msg} />
    </>
  );
}

// Uses data-prsa-* rather than data-theme/data-mode on purpose: several host apps ship their own
// theme provider that owns (and strips) data-theme on hydration, which silently unstyled this card.
const THEME_BOOT = `(function(){
  try{
    var m = localStorage.getItem('prsa-theme');
    if (['system','light','dark'].indexOf(m) < 0) m = 'system';
    var t = m === 'system'
      ? (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')
      : m;
    var d = document.documentElement;
    d.setAttribute('data-prsa-mode', m);
    d.setAttribute('data-prsa-theme', t);
  }catch(e){}
})();`;
