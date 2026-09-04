// Shown while [[...slug]]/page.tsx's requireOwner() check is resolving - the SPA catch-all only,
// never /login or /auth/* (Next scopes loading.tsx to the segment it lives in and its children,
// per app-template-flagship.md's "app/(app)/loading.tsx" contract; a copy at the app root would
// also wrap the login door and could flash a dashboard-shaped skeleton in front of the sign-in
// card). Shimmer content slot only - no nav, no chrome; the real shell only exists once
// DashboardClient decides what to render.
import { Skeleton } from '../../../dashboard/src/kit/ui';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1000px] space-y-4 p-4 sm:p-6" aria-hidden="true">
      <Skeleton height={28} className="w-48" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Skeleton height={84} />
        <Skeleton height={84} />
        <Skeleton height={84} />
        <Skeleton height={84} />
      </div>
      <Skeleton height={240} />
    </div>
  );
}
