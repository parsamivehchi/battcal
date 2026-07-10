// Vendored + adapted from aecom.engineering/packages/ui/src/ThemeSwitcher.tsx (via
// netstats). LIGHT is the default; the five themes come from kit/theme.css. Utility
// classes resolve from the @theme alias block in index.css.

import { useState, useRef, useEffect, useId } from 'react';
import { Sun, Moon, Sparkles, Trees, Coffee, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme, THEME_MODES, type ThemeMode } from '../ThemeProvider';

const MODE_ICON: Record<ThemeMode, LucideIcon> = {
  light: Sun,
  dark: Moon,
  midnight: Sparkles,
  forest: Trees,
  warm: Coffee,
};

const MODE_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  midnight: 'Midnight',
  forest: 'Forest',
  warm: 'Warm',
};

export interface ThemeSwitcherProps {
  openUp?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

export function ThemeSwitcher({ openUp = false, align = 'right', className = '' }: ThemeSwitcherProps) {
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const TriggerIcon = MODE_ICON[mode] ?? Sun;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        id={triggerId}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${MODE_LABEL[mode]}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-input-border bg-form-bg px-2 py-1 text-xs text-text hover:bg-card-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <TriggerIcon className="w-4 h-4" aria-hidden />
        <span>{MODE_LABEL[mode]}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-labelledby={triggerId}
          className={`absolute z-50 w-40 rounded-lg border border-card-border bg-card p-1 shadow-lg ${
            align === 'left' ? 'left-0' : 'right-0'
          } ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          {THEME_MODES.map((m) => {
            const Icon = MODE_ICON[m];
            const active = m === mode;
            return (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setMode(m);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  active ? 'bg-card-hover text-text' : 'text-text-secondary hover:bg-card-hover hover:text-text'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">{MODE_LABEL[m]}</span>
                {active && <Check className="w-3.5 h-3.5 text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
