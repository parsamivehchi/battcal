// The shared BattCal dashboard SPA. Host-agnostic: each mount injects a data source
// (local Vite = live server with controls; cloud Next = read-only Supabase mirror),
// an optional router basename (cloud runs under /battcal), and an optional SSO
// sign-out action for the sidebar.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './kit/ThemeProvider';
import { AppShell } from './kit/shell/AppShell';
import { DataProvider, useData } from './data/data-context';
import type { BattcalDataSource } from './data/data-source';
import { stateMeta, toneColor } from './lib/derive';
import { Overview } from './views/Overview';
import { Health } from './views/Health';
import { GeniusBar } from './views/GeniusBar';
import { Activity } from './views/Activity';
import { Settings } from './views/Settings';

// Live status mini-block in the sidebar: always-visible state + the two numbers that
// matter at a glance. Refreshes with the 15 s status poll.
function SidebarStatus() {
  const { status, errs } = useData();
  const meta = stateMeta(status);
  if (errs.status && !status) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--st-error)' }}>Engine API unreachable</div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--tx-2)' }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: toneColor(meta.tone) }} />
        <span className="truncate" title={meta.label}>{meta.label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="tabular-nums text-lg font-bold" style={{ color: 'var(--tx)' }}>{status?.pct ?? '--'}%</span>
        <span className="tabular-nums text-[11px]" style={{ color: 'var(--tx-3)' }}>
          {status?.batteryW != null ? `${status.batteryW > 0 ? '+' : ''}${status.batteryW} W` : ''}
        </span>
      </div>
    </div>
  );
}

// Global notices rendered above every view: per-source fetch errors and the
// two-installs conflict warning.
function GlobalNotices() {
  const { errs, status } = useData();
  return (
    <>
      {errs.action && (
        <div role="alert" className="mb-3 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--st-error)', color: 'var(--st-error)', background: 'color-mix(in srgb, var(--st-error) 7%, transparent)' }}>
          {errs.action}
        </div>
      )}
      {(errs.status || errs.data) && (
        <div role="alert" className="mb-3 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--st-error)', color: 'var(--st-error)', background: 'color-mix(in srgb, var(--st-error) 7%, transparent)' }}>
          Cannot reach the BattCal data API: {errs.status || errs.data}
        </div>
      )}
      {status?.namespaceConflict && (
        <div role="status" className="mb-3 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--st-warning)', color: 'var(--tx-2)', background: 'color-mix(in srgb, var(--st-warning) 8%, transparent)' }}>
          <b style={{ color: 'var(--st-warning)' }}>Two BattCal installs detected.</b>{' '}
          Both installs' state files are present, so controls target {status.namespace}. Remove the unused install to avoid ambiguous control.
        </div>
      )}
    </>
  );
}

export interface AppProps {
  source: BattcalDataSource;
  basename?: string;
  signoutAction?: string;
}

export default function App({ source, basename, signoutAction }: AppProps) {
  return (
    <ThemeProvider>
      <DataProvider source={source}>
        <BrowserRouter basename={basename}>
          <AppShell sidebarExtras={<SidebarStatus />} signoutAction={signoutAction}>
            <GlobalNotices />
            <Routes>
              <Route path="/overview" element={<Overview />} />
              <Route path="/health" element={<Health />} />
              <Route path="/genius-bar" element={<GeniusBar />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </DataProvider>
    </ThemeProvider>
  );
}
