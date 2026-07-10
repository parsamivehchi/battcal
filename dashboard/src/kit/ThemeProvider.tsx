// Vendored from aecom.engineering/packages/theme/src/ThemeProvider.tsx (via the
// netstats copy). Standalone SPA variant: no 'use client', no cross-subdomain
// cookie, no 'system' mode. LIGHT is the hard default. Persisted to localStorage
// 'battcal-theme'. The token layer lives in kit/theme.css (5 themes).

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

export type ThemeName = 'light' | 'dark' | 'midnight' | 'forest' | 'warm';
export type ThemeMode = ThemeName;

export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'midnight', 'forest', 'warm'];

const STORAGE_KEY = 'battcal-theme';
const DARKISH: ThemeName[] = ['dark', 'midnight', 'forest'];

export function isDarkTheme(t: ThemeName): boolean {
  return DARKISH.includes(t);
}

function isValidMode(v: string | null | undefined): v is ThemeMode {
  return !!v && (THEME_MODES as string[]).includes(v);
}

function readStoredMode(): ThemeMode {
  try {
    const ls = localStorage.getItem(STORAGE_KEY);
    if (isValidMode(ls)) return ls;
  } catch {
    /* ignore */
  }
  return 'light'; // LIGHT default, always.
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
  const [theme, setThemeName] = useState<ThemeName>('light');

  useEffect(() => {
    const m = readStoredMode();
    setThemeName(m);
    applyTheme(m);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setThemeName(m);
    applyTheme(m);
    writeStoredMode(m);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeName((prev) => {
      const idx = THEME_MODES.indexOf(prev);
      const next = THEME_MODES[(idx + 1) % THEME_MODES.length]!;
      applyTheme(next);
      writeStoredMode(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode: theme, theme, isDark: isDarkTheme(theme), setMode, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
