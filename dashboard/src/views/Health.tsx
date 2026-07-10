import { lazy, Suspense } from 'react';
import { useData } from '../data/data-context';
import { Card, ChartCard, Empty, PageHeader, Skeleton } from '../kit/ui';

const HealthCharts = lazy(() => import('../Charts').then((m) => ({ default: m.HealthCharts })));

export function Health() {
  const { status, cycles, healthPts, impact } = useData();

  return (
    <div className="animate-page-enter space-y-4">
      <PageHeader title="Health" subtitle="capacity trend per completed cycle, odometer, and what the cycling costs" />

      <Suspense fallback={<div className="grid gap-4 xl:grid-cols-2"><Card><Skeleton height={240} /></Card><Card><Skeleton height={240} /></Card></div>}>
        <HealthCharts healthPts={healthPts} status={status} />
      </Suspense>

      <ChartCard title="Impact since BattCal started" subtitle="what this method is costing in cycles, and doing to the health numbers">
        {impact ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-4">
            <div>
              <div className="tabular-nums text-lg font-bold" style={{ color: 'var(--tx)' }}>+{impact.cyclesAdded}</div>
              <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>cycles in {impact.sinceDays}d ({impact.perDay}/day)</div>
            </div>
            <div>
              <div className="tabular-nums text-lg font-bold" style={{ color: 'var(--tx)' }}>~{impact.perMonth}/mo</div>
              <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>{impact.ratedPctPerMonth}% of rated {status?.designCycles ?? 1000}-cycle life</div>
            </div>
            <div>
              <div className="tabular-nums text-lg font-bold" style={{ color: 'var(--tx)' }}>
                {impact.rawStartPct ?? '--'}% <span aria-hidden>{'→'}</span>{impact.rawNowPct ?? '--'}%
              </div>
              <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>
                true health ({impact.rawDelta != null && Number(impact.rawDelta) >= 0 ? '+' : ''}{impact.rawDelta ?? '--'} pp)
              </div>
            </div>
            <div>
              <div className="tabular-nums text-lg font-bold" style={{ color: 'var(--tx)' }}>
                {impact.appleStart ?? '--'}% <span aria-hidden>{'→'}</span>{impact.appleNow ?? '--'}%
              </div>
              <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>Apple smoothed</div>
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--tx-3)' }}>Needs at least one completed cycle snapshot.</p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--tx-3)' }}>
          Wear math: band cycling spends cycle count like normal usage does; the tradeoff is avoiding time parked
          at 100%, which is the bigger aging factor for lithium cells. Health estimates move as the gauge
          re-learns; expect wobble, judge by the multi-day trend.
        </p>
      </ChartCard>

      <ChartCard title="Cycle history" subtitle="one row per completed cycle (longevity turnaround or calibration hold)">
        {cycles.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {['Completed', 'Mode', 'Band', 'Duration', 'Raw mAh', 'Nominal', 'Apple'].map((h) => (
                    <th key={h} className="border-b px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[10px]"
                      style={{ borderColor: 'var(--card-border)', color: 'var(--tx-3)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cycles.map((c, i) => ({ c, i })).reverse().map(({ c, i }) => (
                  <tr key={i} className="hover:bg-card-hover">
                    <td className="border-b px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>{c.date}</td>
                    <td className="border-b px-2 py-1.5" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>{c.mode ?? '-'}</td>
                    <td className="border-b px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>
                      {c.band_low != null ? `${c.band_low}-${c.band_high}%` : '-'}
                    </td>
                    <td className="border-b px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>
                      {typeof c.duration_min === 'number' ? `${Math.floor(c.duration_min / 60)}h${String(c.duration_min % 60).padStart(2, '0')}` : '-'}
                    </td>
                    <td className="border-b px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>{c.raw_mAh}</td>
                    <td className="border-b px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>{c.nominal_mAh}</td>
                    <td className="border-b px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--card-border)', color: 'var(--tx-2)' }}>{String(c.apple_health)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No completed cycles yet</Empty>
        )}
      </ChartCard>
    </div>
  );
}
