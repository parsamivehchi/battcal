// Shared API types (the exact wire contract of the local server AND the cloud
// mirror; the Supabase columns are named after TelemetryRow/CycleRow on purpose).
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
  namespace: string;           // the install controls target (personal vs OSS namespace)
  namespaceConflict: boolean;  // both installs' state files exist; controls silently target the first
  prep: { active: boolean; startedAt: number | null } | null;
  pausedBy?: 'schedule' | 'user' | null;  // 'schedule' = the engine's off-hours pause; undefined on older servers
  schedule?: Schedule;         // work-schedule config + whether now is inside the window
  updatedAt: string;
}

export interface Schedule {
  enabled: boolean;
  days?: number[];        // ISO weekdays, 1=Mon..7=Sun
  start?: string;         // HHMM
  end?: string;           // HHMM
  inWindow?: boolean | null;
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

// A telemetry point on the shared time axis (engine rows and the live status
// ring buffer both normalize to this).
export interface Pt { t: number; pct: number; w: number; temp: number | null; state: string }

export interface HealthPt {
  t: number; cycle: number; mode: string;
  raw: number | null; nominal: number | null; apple: number | null;
}
