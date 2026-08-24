"use client";

// The sign-in card. Fully self-contained (inline <style>, no Tailwind, no @prsa/ui) so it renders
// identically in every host app regardless of that app's CSS.
//
// THEME (owner decision 2026-08-23, superseding the 2026-08-11 committed-dark exception): the card
// follows the SAME three-mode contract as the fleet - system default, explicit light/dark wins.
// No bootstrap of its own: every host app's root layout already runs the vendored themeInitScript,
// which stamps `.dark` on <html> from the stored mode + OS pre-paint, so the token block
// below just keys its dark values off `html.dark`. The corner toggle cycles the mode and writes
// the SAME storage key the host app reads, so a choice made at the door carries into the app.
// Keep the toggle's resolution in LOCKSTEP with the vendored @prsa/theme.
//
// Client component on purpose:
//   - Behind a path rewrite (mivehchi.net/investments -> investments-*.vercel.app) the SERVER sees
//     the child's host, so the domain chip must come from location.hostname in the browser.
//   - The clock is local-timezone.
//   - Anything the page writes into the DOM before hydration gets reset by React, so both must be
//     rendered from state after mount.
//
// Generated from templates/relying-party by scripts/sync-rp-login.mjs. Edit the TEMPLATE, not the copies.
import { Geist, Geist_Mono } from "next/font/google";
import { useEffect, useState } from "react";

// Self-contained font load: this card renders identically in every host app regardless of that
// app's own typeface, so it binds its own Geist pair the same way the prsa.me hub login does.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

function formatNow(now: Date): string {
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

// --- Theme toggle (three modes, matching the vendored @prsa/theme contract) ------------------
// Substituted per target by sync-rp-login.mjs: prsa-theme for in-repo apps, pm-theme for the
// external fleet - each app's vendored themeInitScript reads the same key.
const THEME_KEY = "pm-theme";
const MODES = ["system", "light", "dark"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };
const MODE_SWATCH: Record<Mode, string> = {
  system: "linear-gradient(135deg, #f8fafc 0 50%, #18181b 50% 100%)",
  light: "#f8fafc",
  dark: "#18181b",
};

function readMode(): Mode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage blocked - system */
  }
  return "system";
}

function applyMode(mode: Mode) {
  const dark =
    mode === "dark" ||
    (mode === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const d = document.documentElement;
  d.classList.toggle("dark", dark);
  if (dark) d.setAttribute("data-theme", "dark");
  else d.removeAttribute("data-theme");
  try {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", dark ? "#09090b" : "#f8fafc");
  } catch {
    /* chrome tint is never load-bearing */
  }
}

export function LoginCard({ authStart, error }: { authStart: string; error: string | null }) {
  const [host, setHost] = useState("");
  const [clock, setClock] = useState("");
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    // Deliberate mount-only reconcile: host/clock are browser-only values that MUST be written
    // post-hydration (SSR renders them empty), per the fleet login-screen conventions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(window.location.hostname);
    setMode(readMode());

    const tick = () => setClock(formatNow(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cycleMode = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked - still apply for this page's lifetime */
    }
    setMode(next);
    applyMode(next);
  };

  return (
    <main className={`prsa-login ${geist.variable} ${geistMono.variable}`}>
      <style>{CSS}</style>

      <div className="prsa-bg-glow" aria-hidden="true" />
      <div className="prsa-bg-grid" aria-hidden="true" />

      <button
        type="button"
        className="prsa-theme-btn"
        onClick={cycleMode}
        title={`Theme: ${MODE_LABEL[mode]}. Click to change.`}
        aria-label={`Theme: ${MODE_LABEL[mode]}. Click to change.`}
      >
        <span aria-hidden style={{ background: MODE_SWATCH[mode] }} />
      </button>

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

// Token-based palette: light defaults on .prsa-login, dark values keyed off html.dark (stamped by
// the host's vendored themeInitScript pre-paint, and by the corner toggle on change). Emerald
// accent #00AB61 stays the one constant across both schemes. Pure class selectors - no
// data-theme attribute here to fight the host's theme system.
const CSS = `
.prsa-login{position:fixed;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;
  font-family:var(--font-geist, 'Geist'),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --lp-bg:#f8fafc;--lp-tx:#09090b;--lp-tx-2:rgba(9,9,11,.55);--lp-tx-3:rgba(9,9,11,.45);
  --lp-card:rgba(9,9,11,.03);--lp-border:rgba(9,9,11,.12);--lp-grid:rgba(9,9,11,.05);
  --lp-err:#dc2626;--lp-err-bg:rgba(220,38,38,.08);--lp-err-border:rgba(220,38,38,.25);
  --lp-shadow:0 1px 2px rgba(0,0,0,.06),0 24px 48px rgba(0,0,0,.08);
  background:var(--lp-bg);color:var(--lp-tx);color-scheme:light;-webkit-font-smoothing:antialiased;}
html.dark .prsa-login{
  --lp-bg:#08090c;--lp-tx:#fafafa;--lp-tx-2:rgba(255,255,255,.55);--lp-tx-3:rgba(255,255,255,.45);
  --lp-card:rgba(255,255,255,.05);--lp-border:rgba(255,255,255,.1);--lp-grid:rgba(255,255,255,.06);
  --lp-err:#fca5a5;--lp-err-bg:rgba(239,68,68,.10);--lp-err-border:rgba(239,68,68,.30);
  --lp-shadow:0 1px 2px rgba(0,0,0,.4),0 24px 48px rgba(0,0,0,.45);
  color-scheme:dark;}
.prsa-bg-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(60% 50% at 50% 30%, rgba(0,171,97,.14) 0%, transparent 62%);}
.prsa-bg-grid{position:absolute;inset:0;pointer-events:none;opacity:.35;
  background-image:linear-gradient(var(--lp-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--lp-grid) 1px, transparent 1px);
  background-size:32px 32px;
  -webkit-mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);
  mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);}
.prsa-theme-btn{position:fixed;top:16px;right:16px;z-index:2;width:36px;height:36px;display:grid;
  place-items:center;background:var(--lp-card);border:1px solid var(--lp-border);border-radius:10px;
  cursor:pointer;transition:border-color .15s ease;}
.prsa-theme-btn:hover{border-color:var(--lp-tx-3);}
.prsa-theme-btn:focus-visible{outline:2px solid rgba(0,171,97,.6);outline-offset:2px;}
.prsa-theme-btn span{width:14px;height:14px;border-radius:999px;border:1px solid var(--lp-border);display:block;}
.prsa-card{position:relative;z-index:1;width:100%;max-width:352px;
  background:var(--lp-card);border:1px solid var(--lp-border);border-radius:16px;
  padding:24px 26px 26px;display:flex;flex-direction:column;gap:10px;
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  box-shadow:var(--lp-shadow);}
.prsa-brand{display:flex;align-items:center;gap:7px;color:var(--lp-tx-2);font-size:12px;
  font-weight:600;letter-spacing:.02em;min-width:0;min-height:20px;}
.prsa-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prsa-title{margin:8px 0 0;font-size:20px;font-weight:650;letter-spacing:-.01em;color:var(--lp-tx);}
.prsa-clock{margin:0;font-size:12px;color:var(--lp-tx-3);min-height:1.1em;
  font-family:var(--font-geist-mono, 'Geist Mono'),ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums;}
.prsa-error{margin-top:4px;font-size:13px;color:var(--lp-err);background:var(--lp-err-bg);
  border:1px solid var(--lp-err-border);border-radius:8px;padding:9px 11px;}
.prsa-btn{margin-top:10px;background:#00AB61;color:#04150e;border:none;border-radius:10px;
  padding:11px 14px;font-weight:600;font-size:14px;text-align:center;text-decoration:none;
  cursor:pointer;transition:background .15s ease;}
.prsa-btn:hover{background:#00c470;}
.prsa-btn:focus-visible{outline:2px solid rgba(0,171,97,.6);outline-offset:2px;}
@media (prefers-reduced-motion:reduce){.prsa-btn,.prsa-theme-btn{transition:none;}}
`;
