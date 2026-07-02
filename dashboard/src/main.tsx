import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Resolve theme before first paint: Auto (default) follows the system appearance.
const pref = localStorage.getItem('battcal-theme') ?? 'auto';
const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = pref === 'auto' ? (sysDark ? 'dark' : 'light') : pref;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
