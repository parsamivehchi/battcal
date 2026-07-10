import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import './index.css';
import App from './App';

inject();

// Vercel BotID protects the contact endpoint; classification happens server-side in
// api/contact.ts. Failure to load the client beacon must never break the page.
import('botid/client/core')
  .then((m) => m.initBotId({ protect: [{ path: '/battcal/api/contact', method: 'POST' }] }))
  .catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
