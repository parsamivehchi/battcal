// Adapted from the netstats sidebar (itself derived from @aecom/ui AppShell): pinned
// 240px sidebar, 64px collapsed, localStorage-persisted, accent rail on the active
// route. Brand + nav are battcal's; `extras` renders a live status mini-block and
// `signoutAction` (cloud mount only) shows the SSO sign-out button.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BatteryCharging, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV_ITEMS } from '../../nav';
import { ThemeSwitcher } from './ThemeSwitcher';

const COLLAPSE_KEY = 'battcal.sidebar.collapsed';
const MOBILE_QUERY = '(max-width: 767px)';
const ACCENT = 'var(--accent)';

export function Sidebar({ extras, signoutAction }: { extras?: ReactNode; signoutAction?: string }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      // Mobile starts collapsed regardless of the stored desktop preference.
      if (window.matchMedia(MOBILE_QUERY).matches) return true;
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      try {
        setCollapsed(e.matches ? true : localStorage.getItem(COLLAPSE_KEY) === '1');
      } catch {
        setCollapsed(e.matches);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        // Persist only the desktop preference; the mobile auto-collapse stays ephemeral.
        if (!window.matchMedia(MOBILE_QUERY).matches) localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <aside
      className="flex shrink-0 flex-col border-r transition-[width] duration-200"
      style={{
        width: collapsed ? 64 : 240,
        background: 'var(--card)',
        borderColor: 'var(--card-border)',
        height: '100vh',
        position: 'sticky',
        top: 0,
      }}
    >
      {/* Brand */}
      <Link
        to="/overview"
        aria-label="BattCal home"
        className="flex items-center gap-2.5 border-b px-4 py-3.5"
        style={{ borderColor: 'var(--card-border)', textDecoration: 'none' }}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${ACCENT} 16%, transparent)`, color: ACCENT }}
        >
          <BatteryCharging size={17} />
        </span>
        {!collapsed && (
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--tx)' }}>
              BattCal
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--tx-3)' }}>
              band cycler
            </span>
          </span>
        )}
      </Link>

      {/* Nav */}
      <nav className="scrollbar-slim space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className="group flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] font-medium transition-colors"
              style={({ isActive }) => ({
                background: isActive ? `color-mix(in srgb, ${ACCENT} 12%, transparent)` : 'transparent',
                color: isActive ? ACCENT : 'var(--tx-2)',
                boxShadow: isActive ? `inset 2px 0 0 ${ACCENT}` : 'none',
              })}
              onMouseEnter={(e) => {
                if (e.currentTarget.getAttribute('aria-current') === 'page') return;
                e.currentTarget.style.background = 'var(--card-hover)';
              }}
              onMouseLeave={(e) => {
                if (e.currentTarget.getAttribute('aria-current') === 'page') return;
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon size={17} className="shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && item.shortcut && (
                <kbd className="font-mono text-[10px]" style={{ color: 'var(--tx-3)' }}>
                  {item.shortcut}
                </kbd>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Live status mini-block (Phase 1 wires the data) */}
      {!collapsed && extras && (
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--card-border)' }}>
          {extras}
        </div>
      )}
      <div className="flex-1" />

      {/* Footer */}
      <div
        className="flex items-center gap-2 border-t px-2 py-2.5"
        style={{ borderColor: 'var(--card-border)', justifyContent: collapsed ? 'center' : 'space-between' }}
      >
        {!collapsed && <ThemeSwitcher openUp align="left" />}
        {/* Sign out of the SSO session (cloud mount only; POST-only route, plain form). */}
        {!collapsed && signoutAction && (
          <form method="post" action={signoutAction}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-card-hover"
              style={{ color: 'var(--tx-3)' }}
            >
              <LogOut size={16} />
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-card-hover"
          style={{ color: 'var(--tx-3)' }}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
    </aside>
  );
}
