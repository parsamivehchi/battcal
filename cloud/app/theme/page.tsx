// Theme preview: a live contact sheet of every surface, text ramp, status colour, accent
// pairing and chart token in the active theme (~/.claude/rules/app-template-flagship.md pages
// contract). var(--x) has no error state, so a token defined in one theme block but missing from
// another renders transparent with no warning; this route turns that into something you SEE
// across all 5 themes instead of discovering it on a page you rarely open
// (~/.claude/rules/web-frontend-patterns.md). Same owner-only gate as the main mirror (defense
// in depth; the edge proxy already covers everything except /login and /auth/*).
import { redirect } from 'next/navigation';
import ThemePreviewClient from './ThemePreviewClient';
import { requireOwner } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function ThemePage() {
  // Local dev without SESSION_SECRET stays ungated, mirroring proxy.ts and the catch-all page
  // (production always gates).
  const devUngated = process.env.NODE_ENV === 'development' && !process.env.SESSION_SECRET;
  if (!devUngated && !(await requireOwner()).ok) redirect('/battcal/login');
  return <ThemePreviewClient />;
}
