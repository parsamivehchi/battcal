// The host-injected data source. The shared SPA never fetches directly; each mount
// provides a concrete source:
//   - liveDataSource(): the local server on :4437 (relative /api/*). Controls enabled;
//     every write carries the x-battcal header the server requires (CSRF guard).
//   - cloudDataSource(): the hosted read-only twin. Reads go to the Next app's own
//     /api routes (Supabase-backed). Control methods are ABSENT from the object -
//     the cloud app ships no direct control routes, which is the real enforcement.
//     The cloud's `queue` capability is deliberately NOT a control: it enqueues an
//     intent row the Mac polls, re-validates, and executes (or rejects) on its own.
import type { CycleRow, Evidence, Mode, Status, TelemetryRow } from './types';

// A queued remote intent as the /api/command route returns it.
export interface CommandRow {
  id: number;
  created_at: string;
  command: string;
  arg: string | null;
  status: 'pending' | 'done' | 'rejected' | 'expired';
  executed_at?: string | null;
  result?: string | null;
}

// Remote command queue (cloud mirror only): fire-and-acknowledge, never direct control.
export interface BattcalQueue {
  enqueue: (command: 'pause' | 'resume' | 'mode' | 'break', arg?: string | number) => Promise<CommandRow>;
  list: () => Promise<CommandRow[]>;
}

export interface BattcalControls {
  pause: () => Promise<Response>;
  resume: () => Promise<Response>;
  benchmarkBreak: (minutes: number) => Promise<Response>;
  setMode: (mode: Mode) => Promise<Response>;
  startPrep: () => Promise<Response>;
  endPrep: () => Promise<Response>;
  writeSchedule: (s: { enabled: boolean; days?: number[]; start?: string; end?: string }) => Promise<Response>;
}

export interface BattcalDataSource {
  readOnly: boolean;
  getStatus: () => Promise<Status>;
  getTelemetry: (hours: number) => Promise<TelemetryRow[]>;
  getCycles: () => Promise<CycleRow[]>;
  getLog: (lines?: number) => Promise<string[]>;
  getEvidence: () => Promise<Evidence>;
  controls?: BattcalControls;
  queue?: BattcalQueue;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function liveDataSource(apiBase = ''): BattcalDataSource {
  const send = (path: string, method: 'POST' | 'DELETE') =>
    fetch(`${apiBase}${path}`, { method, headers: { 'x-battcal': '1' } });
  return {
    readOnly: false,
    getStatus: () => get<Status>(`${apiBase}/api/status`),
    getTelemetry: (hours) => get<TelemetryRow[]>(`${apiBase}/api/telemetry?hours=${hours}`),
    getCycles: () => get<CycleRow[]>(`${apiBase}/api/cycles`),
    getLog: (lines = 120) => get<string[]>(`${apiBase}/api/log?lines=${lines}`),
    getEvidence: () => get<Evidence>(`${apiBase}/api/evidence`),
    controls: {
      pause: () => send('/api/pause', 'POST'),
      resume: () => send('/api/resume', 'POST'),
      benchmarkBreak: (minutes) => send(`/api/break?minutes=${minutes}`, 'POST'),
      setMode: (mode) => send(`/api/mode?mode=${mode}`, 'POST'),
      startPrep: () => send('/api/prep', 'POST'),
      endPrep: () => send('/api/prep', 'DELETE'),
      writeSchedule: (s) =>
        fetch(`${apiBase}/api/schedule`, {
          method: 'POST',
          headers: { 'x-battcal': '1', 'content-type': 'application/json' },
          body: JSON.stringify(s),
        }),
    },
  };
}

// Read-only mirror. `apiBase` is the cloud app's basePath (e.g. '/battcal').
export function cloudDataSource(apiBase: string): BattcalDataSource {
  return {
    readOnly: true,
    getStatus: () => get<Status>(`${apiBase}/api/status`),
    getTelemetry: (hours) => get<TelemetryRow[]>(`${apiBase}/api/telemetry?hours=${hours}`),
    getCycles: () => get<CycleRow[]>(`${apiBase}/api/cycles`),
    getLog: (lines = 120) => get<string[]>(`${apiBase}/api/log?lines=${lines}`),
    getEvidence: () => get<Evidence>(`${apiBase}/api/evidence`),
    queue: {
      enqueue: async (command, arg) => {
        const res = await fetch(`${apiBase}/api/command`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command, arg }),
        });
        if (!res.ok) throw new Error(`enqueue ${command}: HTTP ${res.status}`);
        return res.json() as Promise<CommandRow>;
      },
      list: () => get<CommandRow[]>(`${apiBase}/api/command`),
    },
  };
}
