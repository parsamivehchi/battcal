'use client';
// Root-layout error boundary. Fires only when RootLayout itself throws (a font import, the
// no-flash theme script, app.css failing to resolve) - everything else is caught by error.tsx.
// Next.js requires this file to replace <html>/<body> itself, since the layout that would
// normally provide them is presumed broken; it deliberately does NOT import the dashboard kit or
// app.css and stays inline-styled and self-contained so it has nothing left to fail on.
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[battcal] root layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#09090b',
          color: '#fafafa',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 650, margin: '0 0 8px' }}>BattCal failed to load</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', margin: '0 0 16px' }}>
            A root-level error occurred. Reloading usually fixes this.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#00AB61',
              color: '#04150e',
              border: 'none',
              borderRadius: 10,
              padding: '11px 16px',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
