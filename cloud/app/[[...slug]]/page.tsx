// The BattCal mirror. An optional catch-all so the shared SPA's BrowserRouter routes
// (/battcal/overview, /battcal/health, ...) all resolve to this one server page; the
// more-specific /auth/* and /login routes win over the catch-all. force-dynamic so the
// auth gate runs for every request (a statically prerendered page can be served from
// the edge cache and skip it).
import DashboardClient from '../DashboardClient';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return <DashboardClient />;
}
