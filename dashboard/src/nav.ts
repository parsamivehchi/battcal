import { LayoutDashboard, HeartPulse, Stethoscope, ScrollText, SlidersHorizontal, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, shortcut: '1' },
  { to: '/health', label: 'Health', icon: HeartPulse, shortcut: '2' },
  { to: '/genius-bar', label: 'Genius Bar', icon: Stethoscope, shortcut: '3' },
  { to: '/activity', label: 'Activity', icon: ScrollText, shortcut: '4' },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal, shortcut: '5' },
];

// Links to pages OUTSIDE this SPA's router, rendered as real anchors after the nav.
// They cannot be NavLinks: a react-router `to` would match the SPA's catch-all and
// bounce to /overview instead of leaving for the host app's own route.
export interface ExternalNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// The cloud mirror's Next-owned QA route. Only the cloud mount passes this (see
// cloud/app/DashboardClient.tsx); the local dashboard has no such page, so it must
// never appear there.
export const CLOUD_EXTERNAL_NAV: ExternalNavItem[] = [
  { href: '/battcal/theme', label: 'Theme', icon: Palette },
];
