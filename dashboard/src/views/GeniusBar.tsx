import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { useData } from '../data/data-context';
import type { Evidence } from '../data/types';
import { Card, PageHeader } from '../kit/ui';

// Honest AppleCare evidence + pre-appointment prep. Leads with the macOS number
// (what Apple actually decides on); raw gauge is secondary and labeled. Reports
// "no symptoms" plainly when the data shows none.
export function GeniusBar() {
  const { source, status, readOnly, doControl, errs } = useData();
  const [ev, setEv] = useState<Evidence | null>(null);

  useEffect(() => {
    source.getEvidence().then(setEv).catch(() => setEv(null));
    const id = setInterval(() => source.getEvidence().then(setEv).catch(() => {}), 60000);
    return () => clearInterval(id);
  }, [source]);

  const prepActive = status?.prep?.active === true;
  const label = 'text-[10px] font-semibold uppercase tracking-wider';
  const cellBorder = { borderColor: 'var(--card-border)' } as const;

  return (
    <div className="animate-page-enter space-y-4">
      <PageHeader
        title="Genius Bar"
        subtitle="AppleCare evidence report and the pre-appointment prep cycle"
        right={
          <div className="no-print flex items-center gap-2">
            {!readOnly && (
              prepActive ? (
                <button type="button" onClick={() => doControl('endPrep', 'Stop prep')}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--accent)' }}>
                  Stop prep (back to Longevity)
                </button>
              ) : (
                <button type="button" onClick={() => doControl('startPrep', 'Start prep')}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--accent)' }}>
                  Start prep cycle
                </button>
              )
            )}
            <button type="button" onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: 'var(--card-border)', color: 'var(--tx)' }}>
              <Printer size={13} /> Print / Save PDF
            </button>
          </div>
        }
      />

      <p className="no-print text-xs" style={{ color: 'var(--tx-3)' }}>
        {prepActive
          ? 'Prep running: full 5-100% calibration cycle. Let it finish before your appointment.'
          : 'Run this the evening before an appointment: one full 5-100% cycle so macOS re-estimates capacity (it nudges the real number, it does not fake it).'}
        {errs.action && <span role="alert" style={{ color: 'var(--st-error)' }}> {errs.action}</span>}
      </p>

      {/* The printable report */}
      <Card>
        <h3 className="text-base font-bold" style={{ color: 'var(--tx)' }}>BattCal battery evidence</h3>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--tx-3)' }}>
          Generated {ev ? new Date(ev.generatedAt).toLocaleString() : '...'} · tracking since {ev?.startedTracking ?? '--'}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3" style={cellBorder}>
            <div className={label} style={{ color: 'var(--tx-3)' }}>macOS Maximum Capacity</div>
            <div className="tabular-nums mt-1 text-2xl font-bold" style={{ color: 'var(--tx)' }}>{ev?.macos.capacity ?? status?.appleHealth ?? '--'}</div>
            <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>the number Apple decides on</div>
          </div>
          <div className="rounded-lg border p-3" style={cellBorder}>
            <div className={label} style={{ color: 'var(--tx-3)' }}>macOS Condition</div>
            <div className="mt-1 text-2xl font-bold"
              style={{ color: /service/i.test(String(ev?.macos.condition)) ? 'var(--st-error)' : 'var(--tx)' }}>
              {ev?.macos.condition ?? status?.condition ?? '--'}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>"Service Recommended" = automatic approval</div>
          </div>
          <div className="rounded-lg border p-3" style={cellBorder}>
            <div className={label} style={{ color: 'var(--tx-3)' }}>Cycle count</div>
            <div className="tabular-nums mt-1 text-2xl font-bold" style={{ color: 'var(--tx)' }}>{ev?.cycles ?? status?.cycles ?? '--'}</div>
            <div className="text-[11px]" style={{ color: 'var(--tx-3)' }}>of {ev?.projection?.designCycles ?? 1000} rated</div>
          </div>
        </div>

        {ev?.projection && (
          <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--tx-2)' }}>
            <b>Degradation vs. cycle life:</b> {ev.projection.lostPct}% capacity lost in {ev.projection.cyclesNow} cycles
            ({(ev.projection.perCycle * 100).toFixed(3)}% per cycle so far), against Apple's 80%-at-{ev.projection.designCycles}-cycle
            design spec. Lithium fade is nonlinear (faster early, then it flattens), so this is the measured rate to date,
            not a forward projection. A supporting engineering point for a senior advisor.
          </p>
        )}

        <h4 className="mt-5 text-[13px] font-semibold" style={{ color: 'var(--tx)' }}>Behavioral evidence (the lever that actually works)</h4>
        <table className="mt-2 w-full border-collapse text-xs">
          <tbody>
            {[
              ['Estimated runtime', ev?.runtime ? `~${ev.runtime.hours} h at ${ev.runtime.atWatts} W` : '--', ev?.runtime?.note ?? ''],
              ['Internal resistance', ev?.resistanceMohm != null ? `${ev.resistanceMohm} mΩ` : '--',
                ev?.resistanceElevated ? 'ELEVATED - a real "not functioning normally" signal' : 'within normal range'],
              ['Possible unmonitored drops (>15%)', ev ? String(ev.shutdowns.length) : '--',
                ev && ev.shutdowns.length
                  ? ev.shutdowns.map((s) => `${s.dropPct}% drop from ${s.pct}% on ${s.at}`).join('; ') + ' (could also be sleeping on battery; shown for context, not asserted as a symptom)'
                  : 'none detected'],
              ['Battery temperature range', ev?.tempRange ? `${ev.tempRange.min}-${ev.tempRange.max} °C` : '--', 'normal operating range'],
            ].map(([k, v, note]) => (
              <tr key={k}>
                <td className="border-b px-2 py-1.5 font-medium" style={{ ...cellBorder, color: 'var(--tx)' }}>{k}</td>
                <td className="border-b px-2 py-1.5 tabular-nums" style={{ ...cellBorder, color: 'var(--tx)' }}>{v}</td>
                <td className="border-b px-2 py-1.5" style={{ ...cellBorder, color: 'var(--tx-3)' }}>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 rounded-lg border p-3 text-xs leading-relaxed"
          style={{
            borderColor: ev?.symptomsFound ? 'var(--st-success)' : 'var(--card-border)',
            color: 'var(--tx-2)',
            background: ev?.symptomsFound ? 'color-mix(in srgb, var(--st-success) 8%, transparent)' : 'var(--card-hover)',
          }}>
          {ev?.symptomsFound
            ? 'Real symptoms detected above. Lead with these at the Genius Bar.'
            : `No behavioral symptoms detected so far. Honest read: with macOS at ${ev?.macos.capacity ?? status?.appleHealth ?? 'its current level'} and Condition "${ev?.macos.condition ?? status?.condition ?? 'unknown'}", a free replacement is unlikely today (~5-15%). Best paths: run prep cycles and watch for macOS to reach 80% or below, or the Condition flag to trip, and open an AppleCare case before it expires.`}
        </div>

        <p className="mt-3 text-[11px]" style={{ color: 'var(--tx-3)' }}>
          Raw gauge (records only): {ev?.raw.pct ?? status?.rawHealthPct ?? '--'}% · {ev?.raw.mah ?? '--'}/{ev?.raw.designMah ?? '--'} mAh. {ev?.raw.note}
        </p>

        <h4 className="mt-5 text-[13px] font-semibold" style={{ color: 'var(--tx)' }}>At the Genius Bar</h4>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--st-success)' }}>Do</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs" style={{ color: 'var(--tx-2)' }}>
              <li>Lead with behavioral symptoms (runtime, internal resistance, drops).</li>
              <li>{ev?.projection ? `Cite the ${ev.projection.lostPct}%-in-${ev.projection.cyclesNow}-cycles degradation as support.` : 'Cite the measured degradation rate (shown above) as support.'}</li>
              <li>Ask them to run the diagnostic and note the exact reading.</li>
              <li>Ask them to log the case even if they say no today.</li>
              <li>Open an AppleCare case before it expires (preserves coverage).</li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--st-error)' }}>Don't</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs" style={{ color: 'var(--tx-2)' }}>
              <li>Lead with coconutBattery / terminal output (dismissed as third-party).</li>
              <li>Say you drained the battery to hit 80%.</li>
              <li>Argue macOS is "inflating" the number.</li>
              <li>Accept the first no without asking for a senior review.</li>
              <li>Conflate iPhone battery policy with MacBook policy.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
