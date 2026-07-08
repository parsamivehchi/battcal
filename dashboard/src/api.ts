export type Mode = 'longevity' | 'calibration';

export interface Status {
  state: string;
  paused: boolean;
  breakUntil: number | null;   // unix epoch a timed benchmark break auto-resumes at; null = indefinite pause / none
  mode: Mode;
  band: { low: number; high: number };
  pct: number | null;
  charging: boolean;
  plugged: boolean;
  adapterCut: boolean;  // plugged AND ExternalConnected=No: BattCal has the adapter software-cut right now
  adapterW: number;
  batteryW: number | null;
  amperageMa: number | null;
  rawCurrentMah: number | null;
  tempC: number | null;
  rawMah: number | null;
  nominalMah: number | null;
  designMah: number | null;
  rawHealthPct: number | null;
  nominalHealthPct: number | null;
  cycles: number | null;
  designCycles: number;
  appleHealth: string | number | null;
  condition: string | null;
  prep: { active: boolean; startedAt: number | null } | null;
  updatedAt: string;
}

export interface TelemetryRow {
  ts: string;
  state: string;
  pct: number;
  charging: string;
  raw_current_mAh: number;
  raw_max_mAh: number;
  voltage_mV: number;
  amperage_mA: number;
  battery_W: number;
  adapter_W: number;
  temp_C: number;
}

export interface CycleRow {
  date: string;
  cycle_count: number;
  raw_mAh: number;
  nominal_mAh: number;
  apple_health: string | number;
  mode?: string;
  band_low?: number;
  band_high?: number;
  duration_min?: number | string;
}

export interface Evidence {
  macos: { capacity: string | number | null; condition: string | null };
  raw: { pct: number | null; mah: number | null; designMah: number | null; note: string };
  cycles: number | null;
  runtime: { hours: number; atWatts: number; note: string } | null;
  resistanceMohm: number | null;
  resistanceElevated: boolean;
  shutdowns: Array<{ at: string; pct: number; gapMin: number; dropPct: number }>;
  tempRange: { min: number; max: number } | null;
  projection: { lostPct: number; cyclesNow: number; perCycle: number; designCycles: number } | null;
  symptomsFound: boolean;
  startedTracking: string | null;
  generatedAt: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchStatus = () => get<Status>('/api/status');
export const fetchTelemetry = (hours: number) => get<TelemetryRow[]>(`/api/telemetry?hours=${hours}`);
export const fetchCycles = () => get<CycleRow[]>('/api/cycles');
export const fetchLog = (lines = 120) => get<string[]>(`/api/log?lines=${lines}`);
// Every state-changing call carries the x-battcal header the server requires (CSRF guard);
// requests without it are rejected with 403.
const send = (path: string, method: 'POST' | 'DELETE') =>
  fetch(path, { method, headers: { 'x-battcal': '1' } });

export const postPause = () => send('/api/pause', 'POST');
export const postResume = () => send('/api/resume', 'POST');
export const postBreak = (minutes: number) => send(`/api/break?minutes=${minutes}`, 'POST');
export const postMode = (mode: Mode) => send(`/api/mode?mode=${mode}`, 'POST');
export const fetchEvidence = () => get<Evidence>('/api/evidence');
export const postPrep = () => send('/api/prep', 'POST');
export const endPrep = () => send('/api/prep', 'DELETE');
