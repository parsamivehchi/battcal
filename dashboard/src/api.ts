export interface Status {
  state: string;
  paused: boolean;
  pct: number | null;
  charging: boolean;
  plugged: boolean;
  adapterW: number;
  batteryW: number | null;
  tempC: number | null;
  rawMah: number | null;
  nominalMah: number | null;
  designMah: number | null;
  rawHealthPct: number | null;
  nominalHealthPct: number | null;
  cycles: number | null;
  appleHealth: string | number | null;
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
export const postPause = () => fetch('/api/pause', { method: 'POST' });
export const postResume = () => fetch('/api/resume', { method: 'POST' });
