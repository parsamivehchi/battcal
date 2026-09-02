// 404 for any request under /battcal that matches none of the app's real routes (a stale
// bookmark, a typo, an old asset path) - the optional catch-all at app/[[...slug]]/page.tsx
// absorbs every in-SPA path, so this only fires outside that tree (e.g. app/api/*). Server
// component: it takes no props and needs no interactivity. The theme is already applied - the
// no-flash init script in layout.tsx stamps .dark/data-theme on <html> before this ever paints,
// so this page only reads the CSS var tokens, it never resolves or switches the theme itself.
// Reuses the dashboard's own kit (app-template-flagship.md pages contract) rather than hand-rolled
// markup.
import Link from 'next/link';
import { Card, PageHeader } from '../../dashboard/src/kit/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[560px] p-6 pt-16 sm:pt-24">
      <PageHeader title="Page not found" subtitle="That route doesn't exist in BattCal." />
      <Card>
        <p className="text-sm" style={{ color: 'var(--tx-2)' }}>
          Check the URL, or head back to the dashboard.
        </p>
        {/* href="/" is basePath-prefixed by next/link to "/battcal" - never hardcode the
            basePath here (see rules/vercel-basepath-sso.md section 3). */}
        <Link
          href="/"
          className="mt-4 inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#ffffff' }}
        >
          Back to BattCal
        </Link>
      </Card>
    </div>
  );
}
