'use client';
// Route-level error boundary for anything under /battcal that throws during render or in a
// server action (a bad Supabase read, a rendering bug in a view). Next.js requires this file to
// be a Client Component and to accept {error, reset}. Does NOT cover an error thrown by
// RootLayout itself - that is global-error.tsx, the one file this component cannot catch.
// Reuses the dashboard's own kit, same as not-found.tsx; the theme is already stamped on <html>
// by layout.tsx's no-flash init script before this ever mounts.
import { useEffect } from 'react';
import Link from 'next/link';
import { Card, PageHeader } from '../../dashboard/src/kit/ui';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[battcal] route error:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[560px] p-6 pt-16 sm:pt-24">
      <PageHeader title="Something went wrong" subtitle="BattCal hit an error loading this page." />
      <Card>
        <p className="text-sm" style={{ color: 'var(--tx-2)' }}>
          Try again, or head back to the dashboard.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-foreground, #ffffff)' }}
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
            style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}
          >
            Back to BattCal
          </Link>
        </div>
      </Card>
    </div>
  );
}
