// Adapted from the netstats shell (derived from @aecom/ui AppShell). Sidebar +
// scrollable content column; digit keys 1-5 jump between views (URL-routed).
import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NAV_ITEMS } from '../../nav';

// Scroll the content region to the top on route change, and to a #hash if present.
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const main = document.getElementById('bc-main');
    if (hash) {
      const t = setTimeout(() => {
        document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return () => clearTimeout(t);
    }
    main?.scrollTo({ top: 0 });
    return;
  }, [pathname, hash]);
  return null;
}

// Digit-key navigation (1-5), skipped while typing in a form control.
function KeyNav() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const item = NAV_ITEMS.find((i) => i.shortcut === e.key);
      if (item) navigate(item.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return null;
}

export function AppShell({
  children,
  sidebarExtras,
  signoutAction,
}: {
  children: ReactNode;
  sidebarExtras?: ReactNode;
  signoutAction?: string;
}) {
  return (
    <div className="flex" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <Sidebar extras={sidebarExtras} signoutAction={signoutAction} />
      <div className="flex min-w-0 flex-1 flex-col" style={{ height: '100vh' }}>
        <main id="bc-main" className="scrollbar-slim flex-1 overflow-y-auto">
          <ScrollManager />
          <KeyNav />
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
