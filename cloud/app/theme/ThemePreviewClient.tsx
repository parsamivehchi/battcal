'use client';
// Theme contact sheet content. Imports the SAME vendored kit the cloud mirror already mounts
// (../../../dashboard/src/kit/*), so this page shares the exact tokens, primitives and
// ThemeSwitcher used by the real app; it needs its own ThemeProvider because this route sits
// outside the shared SPA's <App> tree (it is a plain Next page, not a react-router view).
// ThemeProvider itself only touches localStorage/document inside effects and event handlers, so
// unlike DashboardClient it does not need next/dynamic's ssr:false - nothing here depends on
// BrowserRouter (the actual reason App is mounted client-only).
import Link from 'next/link';
import { ThemeProvider, useTheme } from '../../../dashboard/src/kit/ThemeProvider';
import { ThemeSwitcher } from '../../../dashboard/src/kit/shell/ThemeSwitcher';
import { Card, PageHeader, ChartCard, Kpi, Chip } from '../../../dashboard/src/kit/ui';

const SURFACES: { token: string; label: string }[] = [
  { token: '--bg', label: 'Page background' },
  { token: '--card', label: 'Card' },
  { token: '--card-hover', label: 'Card hover' },
  { token: '--card-border', label: 'Card border' },
  { token: '--form-bg', label: 'Form field' },
  { token: '--input-border', label: 'Input border' },
];

const TEXT_RAMP: { cls: string; label: string }[] = [
  { cls: 'text-text', label: 'Primary text (--tx)' },
  { cls: 'text-text-secondary', label: 'Secondary text (--tx-2)' },
  { cls: 'text-text-muted', label: 'Muted text (--tx-3) - must stay readable' },
];

const STATUS: { cls: string; label: string }[] = [
  { cls: 'text-status-success', label: 'success' },
  { cls: 'text-status-error', label: 'error' },
  { cls: 'text-status-warning', label: 'warning' },
  { cls: 'text-status-info', label: 'info' },
];

const CHART_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--card-border)' }}>
      <div
        className="h-10 w-full rounded border"
        style={{ background: `var(${token})`, borderColor: 'var(--card-border)' }}
        aria-hidden
      />
      <div className="mt-2 text-xs" style={{ color: 'var(--tx-2)' }}>{label}</div>
      <code className="text-[10px] font-mono" style={{ color: 'var(--tx-3)' }}>{token}</code>
    </div>
  );
}

function ThemePreviewPage() {
  const { theme } = useTheme();

  return (
    <div className="animate-page-enter mx-auto max-w-[1000px] space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Theme preview"
        subtitle="Every surface, text ramp, status colour, accent pairing and chart token in the active theme. Switch themes and look for anything that vanishes."
        right={<ThemeSwitcher />}
      />

      <Card>
        <p className="text-xs" style={{ color: 'var(--tx-3)' }}>
          Active: <code className="font-mono">{theme}</code>. All five palettes (light, dark,
          midnight, forest, warm) must render every block on this page; a blank swatch or
          invisible label means a token is missing from that theme.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Charge" value={82} unit="%" tint="var(--accent)" tintValue />
        <Kpi label="Power" value="+18.4" unit="W" />
        <Kpi label="Cycles" value={214} />
        <Kpi label="Uptime" value={14} unit="d" />
      </div>

      <ChartCard title="Surfaces">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((s) => (
            <Swatch key={s.token} token={s.token} label={s.label} />
          ))}
        </div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Text ramp">
          <div className="space-y-2">
            {TEXT_RAMP.map((t) => (
              <p key={t.cls} className={`text-sm ${t.cls}`}>{t.label}</p>
            ))}
            <div className="rounded-lg p-3" style={{ background: 'var(--card-hover)' }}>
              <p className="text-sm text-text-muted">Muted text on card-hover: the pairing that must stay readable in every theme.</p>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Status + chips">
          <div className="flex flex-wrap gap-3">
            {STATUS.map((s) => (
              <span key={s.cls} className={`text-sm font-medium ${s.cls}`}>{s.label}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip>default</Chip>
            <Chip color="var(--st-success)">success</Chip>
            <Chip color="var(--st-error)">error</Chip>
            <Chip color="var(--st-warning)">warning</Chip>
            <Chip color="var(--accent)">accent</Chip>
            <Chip color="var(--st-info)">info</Chip>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Accent" subtitle="the sidebar/KPI tint chip, and the GeniusBar solid CTA button">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}
          >
            accent tint
          </span>
          <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--accent)' }}>
            accent CTA
          </span>
          <span className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            accent outline
          </span>
        </div>
      </ChartCard>

      <ChartCard title="Chart series">
        <div className="flex flex-wrap gap-3">
          {CHART_TOKENS.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span
                className="h-6 w-6 rounded border"
                style={{ background: `var(${t})`, borderColor: 'var(--card-border)' }}
                aria-hidden
              />
              <code className="text-[10px] font-mono" style={{ color: 'var(--tx-3)' }}>{t}</code>
            </div>
          ))}
        </div>
      </ChartCard>

      <Link href="/" className="text-xs underline" style={{ color: 'var(--tx-3)' }}>
        Back to dashboard
      </Link>
    </div>
  );
}

export default function ThemePreviewClient() {
  return (
    <ThemeProvider>
      <ThemePreviewPage />
    </ThemeProvider>
  );
}
