import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Battery, Zap, Thermometer, HeartPulse, Apple, RotateCw, Pause, Play } from 'lucide-react';
import { useData } from '../data/data-context';
import { flowOf, fmtDur, stateMeta, toneColor } from '../lib/derive';
import { Card, Kpi, PageHeader, Segmented, Skeleton } from '../kit/ui';

const OverviewCharts = lazy(() => import('../Charts').then((m) => ({ default: m.OverviewCharts })));

const RANGES = [
  { value: '3', label: '3h' },
  { value: '12', label: '12h' },
  { value: '24', label: '24h' },
  { value: '72', label: '3d' },
  { value: '0', label: 'All' },
];

const DEFAULT_BAND = { low: 10, high: 90 };

function ChartsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card><Skeleton height={252} /></Card>
      <Card><Skeleton height={252} /></Card>
      <Card><Skeleton height={252} /></Card>
    </div>
  );
}

export function Overview() {
  const { status, cycles, chartPts, usingLiveBuf, story, eta, hours, setHours, readOnly, doControl } = useData();

  // 1s countdown clock, ticking only while a benchmark-break countdown is on screen.
  const [now, setNow] = useState(() => Date.now());
  // A schedule (off-hours) pause also carries a breakUntil epoch (the next window start)
  // but is NOT a benchmark break - the state pill explains it, no countdown banner.
  const breakUntilMs = status?.breakUntil != null && status.pausedBy !== 'schedule' ? status.breakUntil * 1000 : null;
  const breakActive = breakUntilMs != null && breakUntilMs > now;
  useEffect(() => {
    if (!breakActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [breakActive]);

  // Throttle banner only when the Mac genuinely runs on battery: adapter software-cut by
  // BattCal (server-reported ground truth) or physically unplugged. batteryW alone is NOT
  // enough: paused at full under load, the battery briefly supplements a maxed adapter.
  const discharging = status?.batteryW != null && status.batteryW < -0.5;
  const throttled = discharging && (status?.adapterCut === true || status?.plugged === false);

  const meta = stateMeta(status);
  const flow = flowOf(status);
  const band = status?.band ?? DEFAULT_BAND;
  const mode = status?.mode ?? 'longevity';

  return (
    <div className="animate-page-enter space-y-4">
      <PageHeader
        title="Overview"
        subtitle="live battery state, band cycling, and the last day at a glance"
        right={
          <div className="flex items-center gap-2">
            {eta && (
              <span className="rounded-full border px-2.5 py-1 text-[11px] tabular-nums"
                style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}
                title="At current draw, from the battery gauge">
                ~{eta.text} to {eta.targetPct}%
              </span>
            )}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
              style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}
              title={status?.updatedAt || ''}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: toneColor(meta.tone) }} />
              {meta.label}
            </span>
            {!readOnly && (
              status?.paused ? (
                <button
                  type="button"
                  onClick={() => doControl('resume', 'Resume')}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'var(--accent)' }}
                >
                  <Play size={13} /> Resume cycling
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => doControl('pause', 'Pause')}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'var(--accent)' }}
                >
                  <Pause size={13} /> Charge full now
                </button>
              )
            )}
          </div>
        }
      />

      {breakActive ? (
        <Card className="flex flex-wrap items-center justify-between gap-3" >
          <div className="text-sm" style={{ color: 'var(--tx)' }} aria-live="polite">
            <b>Benchmark break active.</b> Full speed now, calibration resumes in <span className="tabular-nums">{fmtDur(breakUntilMs! - now)}</span>. Run Geekbench.
          </div>
          {!readOnly && (
            <button type="button" onClick={() => doControl('resume', 'Resume')}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: 'var(--card-border)', color: 'var(--tx)' }}>
              Resume calibration now
            </button>
          )}
        </Card>
      ) : throttled ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm" style={{ color: 'var(--tx)' }} aria-live="polite">
            <b style={{ color: 'var(--st-warning)' }}>CPU is power-throttled.</b>{' '}
            {status?.adapterCut
              ? 'BattCal is draining (adapter cut), so the Mac runs on battery. Benchmarks and heavy compute score low, and worse as the battery drops.'
              : 'On battery. CPU-heavy benchmarks score lower than plugged in, and worse as the battery drops.'}
          </div>
          {!readOnly && (
            <button type="button" onClick={() => doControl('break', 'Benchmark break', 30)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: 'var(--st-warning)' }}>
              Benchmark break (30 min)
            </button>
          )}
        </Card>
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Battery" value={status?.pct ?? '--'} unit="%" icon={Battery}
          sub={status?.plugged ? `plugged in (${status.adapterW}W)` : 'on battery'} />
        <Kpi label="Power flow" icon={Zap}
          value={status?.batteryW != null ? (status.batteryW > 0 ? '+' : '') + status.batteryW : '--'} unit="W"
          tint={flow === 'charging' ? 'var(--st-success)' : flow === 'draining' ? 'var(--st-error)' : 'var(--accent)'}
          tintValue={flow !== 'steady'}
          sub={status == null ? '--' : flow === 'charging' ? 'charging' : flow === 'draining' ? (status.plugged && !status.adapterCut ? 'supplementing the adapter' : 'discharging') : status.plugged ? 'holding (not charging)' : 'on battery'} />
        <Kpi label="Temperature" value={status?.tempC ?? '--'} unit="°C" icon={Thermometer} sub="battery pack" />
        <Kpi label="True health" value={status?.rawHealthPct ?? '--'} unit="%" icon={HeartPulse}
          sub={`${status?.rawMah ?? '--'} / ${status?.designMah ?? '--'} mAh`} />
        <Kpi label="Apple health" value={status?.appleHealth ?? '--'} icon={Apple} sub="smoothed (powerd)" />
        <Kpi label="Cycles" value={status?.cycles ?? '--'} icon={RotateCw} sub={`${cycles.length} band cycles logged`} />
      </div>

      {/* Range control + live-buffer notice */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Chart range" options={RANGES} value={String(hours)} onChange={(v) => setHours(Number(v))} />
        {!chartPts.length ? (
          <span className="text-xs" style={{ color: 'var(--tx-3)' }}>
            No live chart data yet. Readings appear within a few seconds; engine telemetry resumes when cycling is active.
          </span>
        ) : usingLiveBuf ? (
          <span className="text-xs" style={{ color: 'var(--tx-3)' }}>
            Live readings captured since this page opened (engine telemetry is paused; charts resume from the engine when cycling restarts).
          </span>
        ) : null}
      </div>

      <Suspense fallback={<ChartsSkeleton />}>
        <OverviewCharts chartPts={chartPts} band={band} mode={mode} />
      </Suspense>

      {story && (
        <Card>
          <div className="mb-3">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--tx)' }}>Last 24 hours</div>
            <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>how the cycling went while you were away</div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
            {[
              [String(story.turnarounds), 'band cycles'],
              [`${story.drainH}h`, 'draining'],
              [`${story.chargeH}h`, 'charging'],
              [`${story.idleH}h`, 'paused / idle'],
              [`${story.dischargeWh} Wh`, 'energy discharged'],
              [`${story.minPct ?? '--'}-${story.maxPct ?? '--'}%`, 'battery range'],
              [`${story.minT ?? '--'}-${story.maxT ?? '--'}°C`, 'temp range'],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="tabular-nums text-lg font-bold" style={{ color: 'var(--tx)' }}>{v}</div>
                <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>{l}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px]" style={{ color: 'var(--tx-3)' }}>
            Full cycle log and health trends live in <Link to="/health" className="underline" style={{ color: 'var(--accent-dark)' }}>Health</Link>.
          </div>
        </Card>
      )}
    </div>
  );
}
