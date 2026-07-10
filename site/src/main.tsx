import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import './index.css';
import App from './App';

inject();

// NOTE: no BotID client here on purpose. The page is served through the mivehchi.app
// proxy where BotID's beacon paths do not exist, and its fetch interception then makes
// every genuine form POST reject (verified live 2026-07-10). Bot defense is layered in
// api/contact.ts instead: honeypot, minimum fill time, per-IP rate limit, deceptive 200.
// If real CAPTCHA pressure appears, add Cloudflare Turnstile (works cross-proxy).

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
