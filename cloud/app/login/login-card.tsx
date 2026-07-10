"use client";

// The sign-in card. Fully self-contained (inline <style>, no Tailwind, no @prsa/ui) so it renders
// identically in every host app regardless of that app's CSS. That is also why the shared ThemeToggle
// is not used here.
//
// Client component on purpose:
//   - Behind a path rewrite (mivehchi.net/investments -> investments-*.vercel.app) the SERVER sees the
//     child's host, so the domain chip must come from location.hostname in the browser.
//   - The clock is local-timezone.
//   - Anything the page writes into the DOM before hydration gets reset by React, so both must be
//     rendered from state after mount.
//
// Generated from templates/relying-party by scripts/sync-rp-login.mjs. Edit the TEMPLATE, not the copies.
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const MODES: Mode[] = ["system", "light", "dark"];
const STORAGE_KEY = "prsa-theme";

function resolve(mode: Mode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
}

// data-prsa-* rather than data-theme: several host apps ship their own theme provider that owns and
// strips data-theme on hydration, which left this card unstyled whenever the saved choice differed
// from the OS setting.
function apply(mode: Mode): void {
  const d = document.documentElement;
  d.setAttribute("data-prsa-mode", mode);
  d.setAttribute("data-prsa-theme", resolve(mode));
}

function formatNow(now: Date): string {
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function LoginCard({ authStart, error }: { authStart: string; error: string | null }) {
  const [host, setHost] = useState("");
  const [clock, setClock] = useState("");
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    setHost(window.location.hostname);

    const tick = () => setClock(formatNow(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // private mode / storage disabled: fall back to system
    }
    const initial: Mode = (MODES as string[]).includes(stored ?? "") ? (stored as Mode) : "system";
    setMode(initial);
    // Also re-apply here: on a client-side navigation the inline boot script never runs.
    apply(initial);

    // While on "system", follow the OS if it flips (e.g. macOS auto dark at sunset).
    const mq = window.matchMedia("(prefers-color-scheme:dark)");
    const onSystemChange = () => {
      if (document.documentElement.getAttribute("data-prsa-mode") === "system") apply("system");
    };
    mq.addEventListener("change", onSystemChange);

    return () => {
      window.clearInterval(id);
      mq.removeEventListener("change", onSystemChange);
    };
  }, []);

  const cycle = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage disabled: the choice simply does not persist
    }
    apply(next);
  };

  return (
    <main className="prsa-login">
      <style>{CSS}</style>

      <div className="prsa-bg-glow" aria-hidden="true" />
      <div className="prsa-bg-grid" aria-hidden="true" />

      <div className="prsa-card">
        <div className="prsa-top">
          <div className="prsa-brand">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span suppressHydrationWarning>{host}</span>
          </div>
          <button type="button" onClick={cycle} className="prsa-theme" aria-label={`Theme: ${mode}`} title={`Theme: ${mode}`}>
            {mode === "system" && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            )}
            {mode === "light" && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            )}
            {mode === "dark" && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </div>

        <h1 className="prsa-title">Battcal</h1>
        <p className="prsa-clock" suppressHydrationWarning>{clock}</p>

        {error && (
          <div role="alert" className="prsa-error">
            {error}
          </div>
        )}

        <a href={authStart} className="prsa-btn">Sign in with SSO</a>
      </div>
    </main>
  );
}

const CSS = `
:root{
  --bg:#f8fafc; --card:#ffffff; --card-border:#e2e8f0; --accent:#4f46e5;
  --tx:#0f172a; --tx-2:#64748b; --hover:rgba(15,23,42,.05);
}
:root[data-prsa-theme="dark"]{
  --bg:#09090b; --card:#18181b; --card-border:#27272a; --accent:#6366f1;
  --tx:#fafafa; --tx-2:#a1a1aa; --hover:rgba(255,255,255,.07);
}
/* Pre-JS fallback: honor the OS unless the owner has explicitly chosen light. */
@media (prefers-color-scheme:dark){
  :root:not([data-prsa-theme="light"]){
    --bg:#09090b; --card:#18181b; --card-border:#27272a; --accent:#6366f1;
    --tx:#fafafa; --tx-2:#a1a1aa; --hover:rgba(255,255,255,.07);
  }
}
.prsa-login{position:fixed;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--tx);-webkit-font-smoothing:antialiased;}
.prsa-bg-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(70% 60% at 50% 28%, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 62%);}
.prsa-bg-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(var(--card-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--card-border) 1px, transparent 1px);
  background-size:32px 32px;
  -webkit-mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);
  mask-image:radial-gradient(80% 70% at 50% 40%, black 0%, transparent 78%);}
.prsa-card{position:relative;z-index:1;width:100%;max-width:360px;background:var(--card);
  border:1px solid var(--card-border);border-radius:16px;padding:26px 28px 28px;
  display:flex;flex-direction:column;gap:10px;
  box-shadow:0 1px 2px rgba(16,24,40,.04),0 12px 32px rgba(16,24,40,.08);}
:root[data-prsa-theme="dark"] .prsa-card{box-shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.5);}
.prsa-top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px;}
.prsa-brand{display:flex;align-items:center;gap:7px;color:var(--tx-2);font-size:12px;font-weight:600;
  letter-spacing:.02em;min-width:0;}
.prsa-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prsa-theme{display:grid;place-items:center;width:28px;height:28px;flex:none;padding:0;
  background:transparent;border:1px solid var(--card-border);border-radius:8px;color:var(--tx-2);
  cursor:pointer;transition:background .15s ease,color .15s ease;}
.prsa-theme:hover{background:var(--hover);color:var(--tx);}
.prsa-title{margin:6px 0 0;font-size:21px;font-weight:700;letter-spacing:-.01em;}
.prsa-clock{margin:0;font-size:12px;color:var(--tx-2);min-height:1.1em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}
.prsa-error{margin-top:4px;font-size:13px;color:#b42318;background:#fef3f2;border:1px solid #fee4e2;
  border-radius:8px;padding:9px 11px;}
:root[data-prsa-theme="dark"] .prsa-error{color:#fca5a5;background:rgba(239,68,68,.10);
  border-color:rgba(239,68,68,.30);}
.prsa-btn{margin-top:8px;background:var(--accent);color:#fff;border:none;border-radius:10px;
  padding:12px 14px;font-weight:600;font-size:15px;text-align:center;text-decoration:none;
  cursor:pointer;transition:filter .15s ease;}
.prsa-btn:hover{filter:brightness(1.08);}
.prsa-btn:focus-visible,.prsa-theme:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
@media (prefers-reduced-motion:reduce){.prsa-btn,.prsa-theme{transition:none;}}
`;
