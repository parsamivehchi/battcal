import { useEffect, useState } from 'react';
import { RotateCcw, Gauge, Eye } from 'lucide-react';
import { useData } from '../data/data-context';
import type { Mode, Schedule } from '../data/types';
import { Card, ChartCard, PageHeader } from '../kit/ui';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toColon = (hhmm?: string) => (hhmm && hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : '');

const HOW_ROWS: Array<{ key: string; title: string; body: string }> = [
  {
    key: 'longevity',
    title: 'Longevity · 10-90% (default)',
    body: 'BattCal software-cuts wall power so the Mac runs on battery down to 10%, then restores power and charges to 90%, then turns around and repeats. It never reaches 100% and never sits at full: lithium cells age fastest parked at high charge. The charger stays plugged in the whole time; BattCal decides when power actually flows.',
  },
  {
    key: 'calibration',
    title: 'Calibration · 5-100% (on demand)',
    body: 'Full-range passes: drain to 5%, charge to 100%, hold one hour, repeat. This feeds the battery gauge and macOS the full-range data their health estimates calibrate against, so the "Maximum Capacity" numbers converge on the truth. Use it for a few days when you want the health numbers re-learned, then switch back to Longevity.',
  },
  {
    key: 'off',
    title: 'Paused or Off',
    body: 'Pause and the software cut lifts immediately: your Mac charges to 100% like a normal Mac. Unplugging the charger also suspends cycling automatically until AC returns. Nothing persists except the logs.',
  },
  {
    key: 'led',
    title: 'What the charger light means',
    body: "The MagSafe LED is BattCal's status light (the hardware only has amber and green, no other colors exist). Dark while plugged in = draining in longevity mode (a normal Mac never shows a dark connector, so dark = BattCal is working). Slow green pulse = calibration drain. Amber = actually charging. Green = at target, not charging. Paused or off = normal Apple behavior.",
  },
];

// Work-schedule editor: cycle only inside a weekly window, Apple-default charging outside
// it. The server file is the source of truth; controls seed from status.schedule once and
// every edit POSTs immediately (matching the menu bar's Settings > Work Schedule pane).
function ScheduleEditor({ schedule, onSave, readOnly }: {
  schedule?: Schedule;
  onSave: (s: { enabled: boolean; days?: number[]; start?: string; end?: string }) => void;
  readOnly: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('18:00');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || !schedule) return;
    setSeeded(true);
    setEnabled(schedule.enabled);
    if (schedule.days?.length) setDays(schedule.days);
    if (schedule.start) setStart(toColon(schedule.start));
    if (schedule.end) setEnd(toColon(schedule.end));
  }, [schedule, seeded]);

  if (readOnly) {
    return (
      <p className="text-xs" style={{ color: 'var(--tx-2)' }}>
        {schedule?.enabled
          ? `Cycling ${(schedule.days ?? []).map((d) => DAY_NAMES[d - 1]).join(' ')} ${toColon(schedule.start)}-${toColon(schedule.end)} · ${schedule.inWindow ? 'inside work hours now' : 'off hours now (charging normally)'}`
          : 'No work schedule set - cycling runs whenever the other gates allow.'}
        <span style={{ color: 'var(--tx-3)' }}> Editing is local-only (this is the read-only mirror).</span>
      </p>
    );
  }

  const valid = days.length > 0 && start < end;
  const save = (en: boolean, d: number[], s: string, e: string) => {
    if (!en) { onSave({ enabled: false }); return; }
    if (!d.length || s >= e) return; // invalid edit in progress; hint below explains
    onSave({ enabled: true, days: d, start: s, end: e });
  };
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    setDays(next); save(enabled, next, start, end);
  };

  return (
    <div className="space-y-3">
      <label className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--tx)' }}>
        <input type="checkbox" checked={enabled}
          onChange={(ev) => { setEnabled(ev.target.checked); save(ev.target.checked, days, start, end); }} />
        Enabled
      </label>
      <div className="flex flex-wrap items-center gap-2" style={{ opacity: enabled ? 1 : 0.5 }}>
        <div role="group" aria-label="Schedule days" className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
          {DAY_NAMES.map((n, i) => {
            const on = days.includes(i + 1);
            return (
              <button key={n} type="button" aria-pressed={on} disabled={!enabled} onClick={() => toggleDay(i + 1)}
                className="px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--card)',
                  color: on ? 'var(--accent-dark)' : 'var(--tx-2)',
                }}>
                {n}
              </button>
            );
          })}
        </div>
        <span className="text-xs" style={{ color: 'var(--tx-3)' }}>from</span>
        <input type="time" value={start} disabled={!enabled}
          className="rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--input-border)', background: 'var(--form-bg)', color: 'var(--tx)' }}
          onChange={(ev) => { setStart(ev.target.value); save(enabled, days, ev.target.value, end); }} />
        <span className="text-xs" style={{ color: 'var(--tx-3)' }}>to</span>
        <input type="time" value={end} disabled={!enabled}
          className="rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--input-border)', background: 'var(--form-bg)', color: 'var(--tx)' }}
          onChange={(ev) => { setEnd(ev.target.value); save(enabled, days, start, ev.target.value); }} />
      </div>
      {enabled && !valid && (
        <p className="text-xs" role="alert" style={{ color: 'var(--st-warning)' }}>
          Pick at least one day and a start before the end - the schedule keeps its last valid window until then.
        </p>
      )}
    </div>
  );
}

export function Settings() {
  const { status, readOnly, doControl } = useData();
  const mode = status?.mode ?? 'longevity';
  const activeHowKey = status?.paused || status?.state === 'stopped' ? 'off' : mode;

  const modeRow = (m: Mode, title: string, desc: string) => {
    const active = mode === m && !status?.paused;
    return (
      <button
        key={m}
        type="button"
        disabled={readOnly}
        aria-pressed={active}
        onClick={() => doControl('mode', `Switch to ${m}`, m)}
        className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
        style={{
          borderColor: active ? 'var(--accent)' : 'var(--card-border)',
          background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--card)',
          cursor: readOnly ? 'default' : 'pointer',
        }}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
          {m === 'longevity' ? <RotateCcw size={16} /> : <Gauge size={16} />}
        </span>
        <span>
          <span className="block text-[13px] font-semibold" style={{ color: 'var(--tx)' }}>{title}</span>
          <span className="block text-[11px]" style={{ color: 'var(--tx-3)' }}>{desc}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="animate-page-enter space-y-4">
      <PageHeader title="Settings" subtitle="mode, work schedule, and how the cycling works" />

      {readOnly && (
        <Card className="flex items-center gap-2">
          <Eye size={15} style={{ color: 'var(--st-info)' }} />
          <span className="text-xs" style={{ color: 'var(--tx-2)' }}>
            Read-only mirror: controls run on the Mac (local dashboard or menu bar). This page shows the live configuration.
          </span>
        </Card>
      )}

      <ChartCard title="Mode" subtitle="which band the engine cycles in (pause/resume lives on Overview)">
        <div className="grid gap-2 sm:grid-cols-2">
          {modeRow('longevity', 'Longevity 10-90', 'Cycle 10-90%, never sit at 100%')}
          {modeRow('calibration', 'Calibration 5-100', 'Full 5-100% passes to re-train the health numbers')}
        </div>
      </ChartCard>

      <ChartCard title="Work schedule" subtitle="cycle only inside this window; outside it the battery charges normally to 100% like a stock Mac. Manual pause/resume wins until the next boundary.">
        <ScheduleEditor
          schedule={status?.schedule}
          readOnly={readOnly}
          onSave={(p) => doControl('schedule', 'Schedule update', p)}
        />
      </ChartCard>

      <ChartCard title="How BattCal works" subtitle="the four states, with the active one highlighted">
        <div className="space-y-2">
          {HOW_ROWS.map((r) => {
            const active = activeHowKey === r.key;
            return (
              <div key={r.key} className="rounded-lg border p-3"
                style={{
                  borderColor: active ? 'var(--accent)' : 'var(--card-border)',
                  background: active ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                }}>
                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--tx)' }}>
                  {r.title}
                  {active && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent-dark)' }}>
                      active now
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--tx-2)' }}>{r.body}</p>
              </div>
            );
          })}
        </div>
      </ChartCard>

      <p className="text-[11px]" style={{ color: 'var(--tx-3)' }}>
        BattCal · <a href="https://github.com/parsamivehchi/battcal" className="underline" style={{ color: 'var(--accent-dark)' }}>github.com/parsamivehchi/battcal</a>
        {' '}· engine polls every 15 s, dashboard refreshes every 60 s · theme switcher lives in the sidebar footer
      </p>
    </div>
  );
}
