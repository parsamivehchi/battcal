// Vendored from aecom.engineering/packages/theme/src/ThemeProvider.tsx (via the
// netstats copy). Standalone SPA variant: no 'use client', no cross-subdomain
// cookie. An absent stored preference resolves via prefers-color-scheme (SYSTEM
// default); an explicit stored choice always wins, including an explicit 'system'
// choice, which keeps following the OS scheme live. Persisted to localStorage
// 'battcal-theme'. The token layer lives in kit/theme.css (5 themes).

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

export type ThemeName = 'light' | 'dark' | 'midnight' | 'forest' | 'warm';
/** Theme preference: a concrete theme, or 'system' to follow the OS color scheme live. */
export type ThemeMode = 'system' | ThemeName;

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark', 'midnight', 'forest', 'warm'];

const STORAGE_KEY = 'battcal-theme';
const DARKISH: ThemeName[] = ['dark', 'midnight', 'forest'];

export function isDarkTheme(t: ThemeName): boolean {
  return DARKISH.includes(t);
}

function isValidMode(v: string | null | undefined): v is ThemeMode {
  return !!v && (THEME_MODES as string[]).includes(v);
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Resolve a preference to the concrete theme to apply. */
function resolveMode(mode: ThemeMode): ThemeName {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function readStoredMode(): ThemeMode {
  try {
    const ls = localStorage.getItem(STORAGE_KEY);
    if (isValidMode(ls)) return ls;
  } catch {
    /* ignore */
  }
  return 'system'; // no stored (or unrecognized) choice -> never persist a resolved theme as if chosen.
}

function writeStoredMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function applyTheme(t: ThemeName) {
  const el = document.documentElement;
  el.classList.toggle('dark', isDarkTheme(t));
  if (t === 'light') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
}

interface ThemeContextValue {
  mode: ThemeMode;
  theme: ThemeName;
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  theme: 'light',
  isDark: false,
  setMode: () => {},
  cycleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [theme, setThemeName] = useState<ThemeName>('light');

  // On mount: read the stored preference, resolve it, apply it.
  useEffect(() => {
    const m = readStoredMode();
    const resolved = resolveMode(m);
    setModeState(m);
    setThemeName(resolved);
    applyTheme(resolved);
  }, []);

  // Follow OS scheme changes live whenever the preference is 'system', so it is truly dynamic.
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const handler = () => {
      if (mode === 'system') {
        const resolved: ThemeName = mq.matches ? 'dark' : 'light';
        setThemeName(resolved);
        applyTheme(resolved);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    const resolved = resolveMode(m);
    setModeState(m);
    setThemeName(resolved);
    applyTheme(resolved);
    writeStoredMode(m);
  }, []);

  const cycleTheme = useCallback(() => {
    setModeState((prev) => {
      const idx = THEME_MODES.indexOf(prev);
      const next = THEME_MODES[(idx + 1) % THEME_MODES.length]!;
      const resolved = resolveMode(next);
      setThemeName(resolved);
      applyTheme(resolved);
      writeStoredMode(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, theme, isDark: isDarkTheme(theme), setMode, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
