import { useEffect, useState } from 'react';
import { Evidence, Status, endPrep, fetchEvidence, postPrep } from './api';

// Honest AppleCare evidence + pre-appointment prep. Leads with the macOS number
// (what Apple actually decides on); raw gauge is secondary and labeled. Reports
// "no symptoms" plainly when the data shows none.
export function GeniusBarPrep({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const [ev, setEv] = useState<Evidence | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchEvidence().then(setEv).catch(() => setEv(null));
    const id = setInterval(() => fetchEvidence().then(setEv).catch(() => {}), 60000);
    return () => clearInterval(id);
  }, [open]);

  const prepActive = status?.prep?.active === true;

  return (
    <div className="card genius">
      <button className="how-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '▾' : '▸'} Genius Bar prep &amp; AppleCare evidence
      </button>
      {open && (
        <div className="genius-body">
          <div className="genius-actions no-print">
            {prepActive ? (
              <button className="action primary" onClick={async () => { await endPrep(); onChange(); }}>
                Stop prep (back to Longevity)
              </button>
            ) : (
              <button className="action primary" onClick={async () => { await postPrep(); onChange(); }}>
                Start prep cycle
              </button>
            )}
            <button className="action" onClick={() => window.print()}>Print / Save PDF</button>
            <span className="genius-hint">
              {prepActive
                ? 'Prep running: full 5-100% calibration cycle. Let it finish before your appointment.'
                : 'Run this the evening before an appointment: one full 5-100% cycle so macOS re-estimates capacity (it nudges the real number, it does not fake it).'}
            </span>
          </div>

          {/* The printable report */}
          <div className="report">
            <h3 className="report-title">BattCal battery evidence</h3>
            <p className="report-sub">Generated {ev ? new Date(ev.generatedAt).toLocaleString() : '…'} · tracking since {ev?.startedTracking ?? '—'}</p>

            <div className="report-hero">
              <div><span className="rl">macOS Maximum Capacity</span><b>{ev?.macos.capacity ?? status?.appleHealth ?? '--'}</b><span className="rn">the number Apple decides on</span></div>
              <div><span className="rl">macOS Condition</span><b className={/service/i.test(String(ev?.macos.condition)) ? 'flag' : ''}>{ev?.macos.condition ?? status?.condition ?? '--'}</b><span className="rn">"Service Recommended" = automatic approval</span></div>
              <div><span className="rl">Cycle count</span><b>{ev?.cycles ?? status?.cycles ?? '--'}</b><span className="rn">of {ev?.projection?.designCycles ?? 1000} rated</span></div>
            </div>

            {ev?.projection && (
              <p className="report-arg">
                <b>Degradation vs. cycle life:</b> {ev.projection.lostPct}% capacity lost in {ev.projection.cyclesNow} cycles
                ({(ev.projection.perCycle * 100).toFixed(3)}% per cycle). At that rate the battery reaches
                <b> ~{ev.projection.projectedAtDesign}%</b> by its {ev.projection.designCycles}-cycle rating, versus Apple's
                80%-at-1000 design spec. A supporting engineering point for a senior advisor.
              </p>
            )}

            <h4 className="report-h">Behavioral evidence (the lever that actually works)</h4>
            <table className="data report-table">
              <tbody>
                <tr><td>Estimated runtime</td><td>{ev?.runtime ? `~${ev.runtime.hours} h at ${ev.runtime.atWatts} W` : '—'}</td><td className="rn">{ev?.runtime?.note ?? ''}</td></tr>
                <tr><td>Internal resistance</td><td>{ev?.resistanceMohm != null ? `${ev.resistanceMohm} mΩ` : '—'}</td><td className="rn">{ev?.resistanceElevated ? 'ELEVATED – a real "not functioning normally" signal' : 'within normal range'}</td></tr>
                <tr><td>Unexpected shutdowns (&gt;15%)</td><td>{ev ? ev.shutdowns.length : '—'}</td><td className="rn">{ev && ev.shutdowns.length ? ev.shutdowns.map((s) => `${s.pct}% on ${s.at}`).join('; ') : 'none detected'}</td></tr>
                <tr><td>Battery temperature range</td><td>{ev?.tempRange ? `${ev.tempRange.min}–${ev.tempRange.max} °C` : '—'}</td><td className="rn">normal operating range</td></tr>
              </tbody>
            </table>

            <div className={`report-verdict ${ev?.symptomsFound ? 'ok' : 'thin'}`}>
              {ev?.symptomsFound
                ? 'Real symptoms detected above. Lead with these at the Genius Bar.'
                : 'No behavioral symptoms detected so far. Honest read: with macOS at ' + (ev?.macos.capacity ?? '89%') + ' and Condition "' + (ev?.macos.condition ?? 'Normal') + '", a free replacement is unlikely today (~5-15%). Best paths: run prep cycles and watch for macOS to reach ≤80% or the Condition flag to trip, and open an AppleCare case before it expires.'}
            </div>

            <p className="report-raw">Raw gauge (records only): {ev?.raw.pct ?? status?.rawHealthPct ?? '--'}% · {ev?.raw.mah ?? '--'}/{ev?.raw.designMah ?? '--'} mAh. {ev?.raw.note}</p>

            <h4 className="report-h">At the Genius Bar</h4>
            <div className="dodont">
              <div><div className="dd-h do">Do</div><ul>
                <li>Lead with behavioral symptoms (runtime, shutdowns, drops).</li>
                <li>Cite the {ev?.projection?.lostPct ?? 20}%-in-{ev?.cycles ?? 355}-cycles degradation as support.</li>
                <li>Ask them to run the diagnostic and note the exact reading.</li>
                <li>Ask them to log the case even if they say no today.</li>
                <li>Open an AppleCare case before it expires (preserves coverage).</li>
              </ul></div>
              <div><div className="dd-h dont">Don't</div><ul>
                <li>Lead with coconutBattery / terminal output (dismissed as third-party).</li>
                <li>Say you drained the battery to hit 80%.</li>
                <li>Argue macOS is "inflating" the number.</li>
                <li>Accept the first no without asking for a senior review.</li>
                <li>Conflate iPhone battery policy with MacBook policy.</li>
              </ul></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
