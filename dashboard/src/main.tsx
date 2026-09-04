import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './kit/app.css';
import App from './App';
import { liveDataSource } from './data/data-source';

// Resolve theme before first paint (mirrors kit/ThemeProvider exactly: absent stored
// preference resolves via prefers-color-scheme; an explicit stored choice always wins).
// Key is 'pm-theme', kept in lockstep with kit/ThemeProvider.tsx's STORAGE_KEY (was
// 'battcal-theme' until 2026-09-02 - see that file's header for why it changed).
const VALID = ['light', 'dark', 'midnight', 'forest', 'warm'];
const stored = localStorage.getItem('pm-theme');
// An absent OR unrecognized preference (including the legacy 'auto') resolves from the OS and is
// deliberately NOT written back: persisting it would outrank the OS on every later visit, so a
// user who flipped their Mac to dark would stay light forever. readStoredMode does the same.
const pref =
  stored && VALID.includes(stored)
    ? stored
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
document.documentElement.classList.toggle('dark', ['dark', 'midnight', 'forest'].includes(pref));
if (pref === 'light') document.documentElement.removeAttribute('data-theme');
else document.documentElement.setAttribute('data-theme', pref);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App source={liveDataSource()} />
  </StrictMode>,
);
