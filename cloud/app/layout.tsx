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
// explicit localStorage 'battcal-theme' choice always wins, .dark class for the three
// dark themes). Keep this in lockstep with ThemeProvider.tsx's resolveMode/readStoredMode.
const themeInit = `(function(){try{var v=localStorage.getItem('battcal-theme');var names=['light','dark','midnight','forest','warm'];var t=(!v||v==='system'||names.indexOf(v)<0)?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):v;var d=['dark','midnight','forest'].indexOf(t)>=0;var e=document.documentElement;e.classList.toggle('dark',d);if(t==='light')e.removeAttribute('data-theme');else e.setAttribute('data-theme',t);}catch(e){}})();`;

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
