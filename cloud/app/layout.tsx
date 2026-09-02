import '@fontsource-variable/dm-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '../../dashboard/src/kit/app.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'BattCal',
  description: 'Battery band cycler - hosted mirror. Private.',
  robots: { index: false, follow: false },
};

// No-flash theme init: mirrors dashboard/src/kit/ThemeProvider exactly (absent OR
// 'system' stored preference resolves via prefers-color-scheme every load, any other
// explicit localStorage 'pm-theme' choice always wins, .dark class for the three
// dark themes). Keep this in lockstep with ThemeProvider.tsx's resolveMode/readStoredMode.
//
// 'pm-theme' is the SAME key the generated login card (cloud/app/login/login-card.tsx,
// THEME_KEY - external-fleet lineage, substituted by prsa.me's sync-rp-login.mjs) reads and
// writes. Was 'battcal-theme' until 2026-09-02: a theme chosen at sign-in wrote 'pm-theme' while
// this script and ThemeProvider both read 'battcal-theme', so the choice never carried past the
// login page (fleet audit 2026-09-02, finding battcal-repo-1). Never let this drift from the key
// literal in ThemeProvider.tsx or dashboard/src/main.tsx again.
const themeInit = `(function(){try{var v=localStorage.getItem('pm-theme');var names=['light','dark','midnight','forest','warm'];var t=(!v||v==='system'||names.indexOf(v)<0)?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):v;var d=['dark','midnight','forest'].indexOf(t)>=0;var e=document.documentElement;e.classList.toggle('dark',d);if(t==='light')e.removeAttribute('data-theme');else e.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
