"use client";

// The sign-in card. Fully self-contained (inline <style>, no Tailwind, no @prsa/ui) so it renders
// identically in every host app regardless of that app's CSS.
//
// Visual identity: matches the prsa.me hub login (dark glass card, quiet glow, one accent) and is
// deliberately theme-INDEPENDENT - pre-auth surfaces are always dark glass, so there is no theme
// toggle and no theme boot script here. Values mirror @prsa/theme's --glass-* tokens, inlined
// because this card cannot import workspace packages.
//
// Client component on purpose:
//   - Behind a path rewrite (mivehchi.net/investments -> investments-*.vercel.app) the SERVER sees the
//     child's host, so the domain chip must come from location.hostname in the browser.
//   - The clock is local-timezone.
//   - Anything the page writes into the DOM before hydration gets reset by React, so both must be
//     rendered from state after mount.
//
// Generated from templates/relying-party by scripts/sync-rp-login.mjs. Edit the TEMPLATE, not the copies.
import { Geist, Geist_Mono } from "next/font/google";
import { useEffect, useState } from "react";

// Self-contained font load: this card renders identically in every host app regardless of that
// app's own typeface (oscar loads DM Sans, other RPs may load nothing at all), so it cannot
// inherit a --font-geist variable from a parent layout the way an in-platform app does - it has
// to bind its own, same as the prsa.me hub's own login screen (apps/portal/src/app/layout.tsx)
// this card is designed to visually match. next/font/google needs no workspace package, so this
// works even though the card otherwise imports nothing beyond React.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

function formatNow(now: Date): string {
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function LoginCard({ authStart, error }: { authStart: string; error: string | null }) {
  const [host, setHost] = useState("");
  const [clock, setClock] = useState("");

  useEffect(() => {
    // Deliberate mount-only reconcile: host/clock are browser-only values that MUST be written
    // post-hydration (SSR renders them empty), per the fleet login-screen conventions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(window.location.hostname);

    const tick = () => setClock(formatNow(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main className={`prsa-login ${geist.variable} ${geistMono.variable}`}>
      <style>{CSS}</style>

      <div className="prsa-bg-glow" aria-hidden="true" />
      <div className="prsa-bg-grid" aria-hidden="true" />

      <div className="prsa-card">
        <div className="prsa-brand">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span suppressHydrationWarning>{host}</span>
        </div>

        <h1 className="prsa-title">BattCal</h1>
        <p className="prsa-clock" suppressHydrationWarning>{clock}</p>

        {error && (
          <div role="alert" className="prsa-error">
            {error}
          </div>
        )}

        <a href={authStart} className="prsa-btn">
          Sign in with SSO
        </a>
      </div>
    </main>
  );
}

// Mirrors @prsa/theme --glass-* values (glass surface/border/accent) so the RP gate reads as the
// same surface as the hub login form.
const CSS = `
.prsa-login{position:fixed;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;
  font-family:var(--font-geist, 'Geist'),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:#08090c;color:#fafafa;color-scheme:dark;-webkit-font-smoothing:antialiased;}
.prsa-bg-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(60% 50% at 50% 30%, rgba(38,128,255,.14) 0%, transparent 62%);}
.prsa-bg-grid{position:absolute;inset:0;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
  background-size:32px 32px;
  -webkit-mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);
  mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);}
.prsa-card{position:relative;z-index:1;width:100%;max-width:352px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;
  padding:24px 26px 26px;display:flex;flex-direction:column;gap:10px;
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  box-shadow:0 1px 2px rgba(0,0,0,.4),0 24px 48px rgba(0,0,0,.45);}
.prsa-brand{display:flex;align-items:center;gap:7px;color:rgba(255,255,255,.55);font-size:12px;
  font-weight:600;letter-spacing:.02em;min-width:0;min-height:20px;}
.prsa-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prsa-title{margin:8px 0 0;font-size:20px;font-weight:650;letter-spacing:-.01em;color:#fff;}
.prsa-clock{margin:0;font-size:12px;color:rgba(255,255,255,.45);min-height:1.1em;
  font-family:var(--font-geist-mono, 'Geist Mono'),ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums;}
.prsa-error{margin-top:4px;font-size:13px;color:#fca5a5;background:rgba(239,68,68,.10);
  border:1px solid rgba(239,68,68,.30);border-radius:8px;padding:9px 11px;}
.prsa-btn{margin-top:10px;background:#2680ff;color:#fff;border:none;border-radius:10px;
  padding:11px 14px;font-weight:600;font-size:14px;text-align:center;text-decoration:none;
  cursor:pointer;transition:background .15s ease;}
.prsa-btn:hover{background:#4d96ff;}
.prsa-btn:focus-visible{outline:2px solid rgba(38,128,255,.6);outline-offset:2px;}
@media (prefers-reduced-motion:reduce){.prsa-btn{transition:none;}}
`;
