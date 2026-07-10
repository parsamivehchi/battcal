// DataProvider owns every poll and shared derivation the old App.tsx inlined:
// status every 15 s, telemetry/cycles/log every 60 s, the live status ring buffer
// (charts stay populated while the engine is paused and writes no telemetry), and
// the derived series (chartPts, healthPts, story, impact, eta). Both mounts (local
// Vite with controls, cloud Next read-only) share this provider; only the injected
// BattcalDataSource differs.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BattcalDataSource } from './data-source';
import type { CycleRow, HealthPt, Mode, Pt, Status, TelemetryRow } from './types';
import { csvDateMs, flowTargetOf, pos } from '../lib/derive';

export interface Errs { status?: string; data?: string; action?: string }

export interface Story {
  drainH: string; chargeH: string; idleH: string; dischargeWh: string;
  minPct: number | null; maxPct: number | null; minT: number | null; maxT: number | null;
  turnarounds: number;
}

export interface Impact {
  sinceDays: string; startCycle: number; cyclesAdded: number; perDay: string; perMonth: number;
  ratedPctPerMonth: string; rawStartPct: number | null; rawNowPct: number | null; rawDelta: string | null;
  appleStart: number | null; appleNow: number | null;
}

interface DataCtx {
  source: BattcalDataSource;
  readOnly: boolean;
  status: Status | null;
  cycles: CycleRow[];
  log: string[];
  errs: Errs;
  hours: number;
  setHours: (h: number) => void;
  refreshStatus: () => void;
  // Control helper: runs a control fn, surfaces failure in errs.action, refreshes.
  // No-op when the source has no controls (read-only mount).
  doControl: (fn: string, label: string, arg?: number | Mode | object) => void;
  // Derived series
  chartPts: Pt[];
  usingLiveBuf: boolean;
  healthPts: HealthPt[];
  story: Story | null;
  impact: Impact | null;
  eta: { text: string; targetPct: number } | null;
}

const Ctx = createContext<DataCtx | null>(null);

export function DataProvider({ source, children }: { source: BattcalDataSource; children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [dayRows, setDayRows] = useState<TelemetryRow[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [liveBuf, setLiveBuf] = useState<Pt[]>([]);
  const [hours, setHours] = useState(12);
  // Per-source errors: a status-poll success must not clear a data-fetch failure, and a
  // control failure must not be wiped by the refresh that follows it.
  const [errs, setErrs] = useState<Errs>({});

  const refreshStatus = useCallback(async () => {
    try { setStatus(await source.getStatus()); setErrs((p) => ({ ...p, status: undefined })); }
    catch (e) { setErrs((p) => ({ ...p, status: String(e) })); }
  }, [source]);

  const refreshData = useCallback(async (h: number) => {
    try {
      const [t, d, c, l] = await Promise.all([
        source.getTelemetry(h), source.getTelemetry(24), source.getCycles(), source.getLog(),
      ]);
      setRows(t); setDayRows(d); setCycles(c); setLog(l); setErrs((p) => ({ ...p, data: undefined }));
    } catch (e) { setErrs((p) => ({ ...p, data: String(e) })); }
  }, [source]);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 15000);
    return () => clearInterval(id);
  }, [refreshStatus]);
  useEffect(() => {
    refreshData(hours);
    const id = setInterval(() => refreshData(hours), 60000);
    return () => clearInterval(id);
  }, [hours, refreshData]);

  // Live chart buffer: the engine writes telemetry only while cycling, so when paused the
  // charts would go blank. Status reads live hardware every poll regardless, so mirror each
  // sample into a small ring buffer and fall back to it when engine telemetry is stale.
  useEffect(() => {
    if (!status || status.pct == null) return;
    const t = status.updatedAt ? new Date(status.updatedAt).getTime() : Date.now();
    if (!Number.isFinite(t)) return;
    setLiveBuf((buf) => {
      if (buf.length && buf[buf.length - 1].t === t) return buf; // same sample, skip
      const next = buf.concat({ t, pct: status.pct as number, w: status.batteryW ?? 0, temp: pos(status.tempC), state: status.state });
      return next.length > 240 ? next.slice(next.length - 240) : next;
    });
  }, [status]);

  // Control dispatcher. Checks res.ok and surfaces a failed action instead of silently
  // refreshing as if it worked.
  const doControl = useCallback(async (fn: string, label: string, arg?: number | Mode | object) => {
    const controls = source.controls;
    if (!controls) return;
    try {
      let res: Response;
      switch (fn) {
        case 'pause': res = await controls.pause(); break;
        case 'resume': res = await controls.resume(); break;
        case 'break': res = await controls.benchmarkBreak(arg as number); break;
        case 'mode': res = await controls.setMode(arg as Mode); break;
        case 'startPrep': res = await controls.startPrep(); break;
        case 'endPrep': res = await controls.endPrep(); break;
        case 'schedule': res = await controls.writeSchedule(arg as { enabled: boolean }); break;
        default: return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setErrs((p) => ({ ...p, action: undefined }));
    } catch (e) { setErrs((p) => ({ ...p, action: `${label} failed: ${String(e)}` })); }
    refreshStatus();
  }, [source, refreshStatus]);

  const pts: Pt[] = useMemo(() => rows.map((r) => ({
    t: new Date(r.ts).getTime(), pct: r.pct, w: r.battery_W, temp: pos(r.temp_C), state: r.state,
  })).filter((p) => Number.isFinite(p.t)), [rows]);

  // Engine telemetry when present and fresh; otherwise the live status buffer.
  const chartPts = useMemo(() => {
    const stale = !pts.length || (Date.now() - pts[pts.length - 1].t) > 120e3;
    return stale && liveBuf.length ? liveBuf : pts;
  }, [pts, liveBuf]);
  const usingLiveBuf = chartPts === liveBuf && liveBuf.length > 0;

  const healthPts = useMemo(() => cycles.map((c) => ({
    t: csvDateMs(c.date),
    cycle: c.cycle_count,
    mode: c.mode ?? '-',
    raw: status?.designMah ? pos(+(100 * c.raw_mAh / status.designMah).toFixed(1)) : null,
    nominal: status?.designMah ? pos(+(100 * c.nominal_mAh / status.designMah).toFixed(1)) : null,
    apple: pos(typeof c.apple_health === 'string' ? Number(String(c.apple_health).replace('%', '')) : c.apple_health),
  })).filter((h) => Number.isFinite(h.t)), [cycles, status?.designMah]);

  // "Last 24h story": dt-weighted aggregates from full-day telemetry.
  const story = useMemo<Story | null>(() => {
    if (dayRows.length < 2) return null;
    let drainMs = 0, chargeMs = 0, idleMs = 0, dischargeWh = 0;
    let minPct = Infinity, maxPct = -Infinity, minT = Infinity, maxT = -Infinity;
    for (let i = 1; i < dayRows.length; i++) {
      const a = dayRows[i - 1], b = dayRows[i];
      const dt = Math.min(new Date(b.ts).getTime() - new Date(a.ts).getTime(), 5 * 60e3);
      if (dt <= 0) continue;
      if (a.state === 'drain') drainMs += dt;
      else if (a.state === 'charge' || a.state === 'hold') chargeMs += dt;
      else idleMs += dt;
      if (a.battery_W < 0) dischargeWh += (Math.abs(a.battery_W) * dt) / 3600e3;
      minPct = Math.min(minPct, a.pct); maxPct = Math.max(maxPct, a.pct);
      const tc = pos(a.temp_C);
      if (tc != null) { minT = Math.min(minT, tc); maxT = Math.max(maxT, tc); }
    }
    const turnarounds = cycles.filter((c) => Date.now() - csvDateMs(c.date) < 24 * 3600e3).length;
    const hrs = (ms: number) => (ms / 3600e3).toFixed(1);
    // Fold in the final row's pct (the loop only reads dayRows[i-1]) and guard the
    // +/-Infinity seed from leaking to the UI when no interval had dt>0.
    const lastPct = dayRows[dayRows.length - 1]?.pct;
    if (typeof lastPct === 'number') { minPct = Math.min(minPct, lastPct); maxPct = Math.max(maxPct, lastPct); }
    return {
      drainH: hrs(drainMs), chargeH: hrs(chargeMs), idleH: hrs(idleMs), dischargeWh: dischargeWh.toFixed(1),
      minPct: Number.isFinite(minPct) ? minPct : null, maxPct: Number.isFinite(maxPct) ? maxPct : null,
      minT: Number.isFinite(minT) ? minT : null, maxT: Number.isFinite(maxT) ? maxT : null, turnarounds,
    };
  }, [dayRows, cycles]);

  // How is BattCal affecting the cycle counter and the health numbers?
  const impact = useMemo<Impact | null>(() => {
    if (!healthPts.length || !status?.cycles) return null;
    const first = healthPts[0];
    const days = Math.max((Date.now() - first.t) / 86400e3, 0.25);
    const cyclesAdded = status.cycles - first.cycle;
    const perDay = cyclesAdded / days;
    const perMonth = perDay * 30;
    const ratedPctPerMonth = (perMonth / status.designCycles) * 100;
    const appleNow = pos(typeof status.appleHealth === 'string' ? Number(String(status.appleHealth).replace('%', '')) : status.appleHealth);
    return {
      sinceDays: days.toFixed(1),
      startCycle: first.cycle,
      cyclesAdded,
      perDay: perDay.toFixed(1),
      perMonth: Math.round(perMonth),
      ratedPctPerMonth: ratedPctPerMonth.toFixed(1),
      rawStartPct: first.raw,
      rawNowPct: status.rawHealthPct,
      rawDelta: first.raw != null && status.rawHealthPct != null ? (status.rawHealthPct - first.raw).toFixed(1) : null,
      appleStart: first.apple,
      appleNow,
    };
  }, [healthPts, status]);

  // Time to band edge at CURRENT draw (gauge math, like the OS's estimate).
  const eta = useMemo(() => {
    const s = status;
    if (!s || s.paused || !s.rawCurrentMah || !s.rawMah || !s.amperageMa || Math.abs(s.amperageMa) < 50) return null;
    const targetPct = flowTargetOf(s);
    if (targetPct === null) return null;
    const targetMah = (targetPct / 100) * s.rawMah;
    const deltaMah = targetMah - s.rawCurrentMah;
    // Direction sanity: the draw sign must match the heading, else it's a transition.
    if (deltaMah * s.amperageMa <= 0) return null;
    const mins = (deltaMah / s.amperageMa) * 60;
    if (!Number.isFinite(mins) || mins <= 0 || mins > 48 * 60) return null;
    const m = Math.round(mins);
    return { text: m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`, targetPct };
  }, [status]);

  const value: DataCtx = {
    source,
    readOnly: source.readOnly,
    status, cycles, log, errs, hours, setHours, refreshStatus, doControl,
    chartPts, usingLiveBuf, healthPts, story, impact, eta,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData must be used within DataProvider');
  return c;
}
