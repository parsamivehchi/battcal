// Shown while an async route segment under /battcal is resolving (the requireOwner() check in
// [[...slug]]/page.tsx and theme/page.tsx). Shimmer content slot only, per app-template-flagship.md
// - no nav, no chrome; the real shell only exists once DashboardClient decides what to render.
import { Skeleton } from '../../dashboard/src/kit/ui';

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
