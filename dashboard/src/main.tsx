import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './kit/app.css';
import App from './App';
import { liveDataSource } from './data/data-source';

// Resolve theme before first paint (mirrors kit/ThemeProvider exactly: LIGHT default).
// Pre-rehaul the stored value could be 'auto'; migrate it once to the system-resolved theme.
const VALID = ['light', 'dark', 'midnight', 'forest', 'warm'];
let pref = localStorage.getItem('battcal-theme') ?? 'light';
if (!VALID.includes(pref)) {
  pref = pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  localStorage.setItem('battcal-theme', pref);
}
document.documentElement.classList.toggle('dark', ['dark', 'midnight', 'forest'].includes(pref));
if (pref === 'light') document.documentElement.removeAttribute('data-theme');
else document.documentElement.setAttribute('data-theme', pref);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App source={liveDataSource()} />
  </StrictMode>,
);
