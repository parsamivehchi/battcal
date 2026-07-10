// The BattCal mirror. An optional catch-all so the shared SPA's BrowserRouter routes
// (/battcal/overview, /battcal/health, ...) all resolve to this one server page; the
// more-specific /auth/* and /login routes win over the catch-all. force-dynamic so the
// auth gate runs for every request (a statically prerendered page can be served from
// the edge cache and skip it).
import { redirect } from 'next/navigation';
import DashboardClient from '../DashboardClient';
import { requireOwner } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // Second auth layer (same pattern as the API routes): the edge proxy covers the app root only
  // because of the explicit "/" matcher entry, so the page defends itself too. Local dev without
  // SESSION_SECRET stays ungated, mirroring proxy.ts (production always gates).
  const devUngated = process.env.NODE_ENV === 'development' && !process.env.SESSION_SECRET;
  if (!devUngated && !(await requireOwner()).ok) redirect('/battcal/login');
  return <DashboardClient />;
}
