// Pure derivation helpers carried over from the pre-rehaul App.tsx. No React here.
import type { Status } from '../data/types';

export type Flow = 'charging' | 'draining' | 'steady';

// Actual power flow from measured battery watts (positive = charging, negative =
// discharging). Source of truth for direction: during an idle-gate activity hold the
// engine state is still "drain" while the adapter is re-enabled and the battery charges.
export function flowOf(s: Status | null): Flow {
  if (!s) return 'steady';
  if (s.batteryW != null) {
    if (s.batteryW > 0.5) return 'charging';
    if (s.batteryW < -0.5) return 'draining';
    return 'steady';
  }
  if (s.charging) return 'charging';
  if (s.state === 'drain') return 'draining';
  return 'steady';
}

// Percentage the battery is heading toward, given the real flow. Charging: band.high in
// a real charge phase, else the 100% batt limit during an activity-hold top-up.
export function flowTargetOf(s: Status | null): number | null {
  if (!s) return null;
  switch (flowOf(s)) {
    case 'charging': return s.state === 'charge' ? s.band.high : 100;
    case 'draining': return s.band.low;
    default: return null;
  }
}

// "8:00" today, "Mon 8:00" any other day - when scheduled cycling resumes.
export function fmtResume(epoch: number): string {
  const d = new Date(epoch * 1000);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

export interface StateMeta { label: string; tone: 'good' | 'warn' | 'muted' | 'info' }

export function stateMeta(s: Status | null): StateMeta {
  // Paused / stopped come straight from state; the cycling states are driven by the real
  // power flow so an activity hold (state "drain" but charging) reads correctly.
  if (!s || s.state === 'stopped') return { label: 'Engine off - normal charging', tone: 'muted' };
  // The work schedule's off-hours pause is normal charging with a known resume time.
  if (s.paused && s.pausedBy === 'schedule') {
    return {
      label: `Off hours - charging normally${s.breakUntil ? `, cycling resumes ${fmtResume(s.breakUntil)}` : ''}`,
      tone: 'info',
    };
  }
  if (s.paused) return { label: 'Paused - charging like normal', tone: 'info' };
  switch (flowOf(s)) {
    case 'charging': return { label: `Charging to ${flowTargetOf(s) ?? s.band.high}%`, tone: 'good' };
    case 'draining': return { label: `Draining to ${s.band.low}%`, tone: 'warn' };
    default: return s.state === 'hold'
      ? { label: 'Holding at full (calibration)', tone: 'good' }
      : { label: `Holding at ${s.pct ?? 0}%`, tone: 'good' };
  }
}

export function toneColor(tone: StateMeta['tone']): string {
  switch (tone) {
    case 'good': return 'var(--st-success)';
    case 'warn': return 'var(--st-warning)';
    case 'info': return 'var(--st-info)';
    default: return 'var(--tx-3)';
  }
}

// Treat non-finite / non-positive readings as missing. The engine writes temp=0.0 on a failed
// ioreg read and can emit blank health cells; coalescing them to null keeps a stray 0 from
// crushing the temp axis or drawing a phantom 0% health point.
export const pos = (n: unknown): number | null =>
  (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Parse an engine CSV timestamp ("YYYY-MM-DD HH:MM" or "...:SS") to epoch ms. Only append
// seconds when the stamp lacks them; a full "HH:MM:SS" already parses, and blindly appending
// ":00" produced an invalid date that silently dropped that cycle from the health charts.
export function csvDateMs(d: unknown): number {
  const iso = String(d).replace(' ', 'T');
  return new Date(/T\d{2}:\d{2}$/.test(iso) ? iso + ':00' : iso).getTime();
}

// Color class for an engine log line.
export function eventTone(line: string): string {
  if (/DRAIN|drain/.test(line)) return 'var(--st-warning)';
  if (/CHARGE|charged|charge/.test(line)) return 'var(--st-success)';
  if (/PAUSED|RESUMED|mode|started/.test(line)) return 'var(--st-info)';
  return 'var(--tx-2)';
}
