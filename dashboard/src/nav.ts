import { LayoutDashboard, HeartPulse, Stethoscope, ScrollText, SlidersHorizontal } from 'lucide-react';
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
