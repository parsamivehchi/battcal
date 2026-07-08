import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CycleRow, Mode, Status, TelemetryRow,
  fetchCycles, fetchLog, fetchStatus, fetchTelemetry, postBreak, postMode, postPause, postResume,
} from './api';
import { fmtTimeTick, niceTimeTicks, powerStep, steppedScale } from './chartUtils';
import { GeniusBarPrep } from './GeniusBarPrep';

const RANGES = [
  { label: '3h', hours: 3 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: 'All', hours: 0 },
];

const THEMES = ['auto', 'light', 'dark'] as const;
type ThemePref = (typeof THEMES)[number];

const DEFAULT_BAND = { low: 10, high: 90 };

type Flow = 'charging' | 'draining' | 'steady';

// Actual power flow from measured battery watts (positive = charging, negative =
// discharging). Source of truth for direction: during an idle-gate activity hold the
// engine state is still "drain" while the adapter is re-enabled and the battery charges.
// Parse an engine CSV timestamp ("YYYY-MM-DD HH:MM" or "...:SS") to epoch ms. Only append seconds when
// the stamp lacks them; a full "HH:MM:SS" already parses, and blindly appending ":00" produced an
// invalid date that silently dropped that cycle from the health charts and the 24h turnaround count.
function csvDateMs(d: unknown): number {
  const iso = String(d).replace(' ', 'T');
  return new Date(/T\d{2}:\d{2}$/.test(iso) ? iso + ':00' : iso).getTime();
}

function flowOf(s: Status | null): Flow {
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
function flowTargetOf(s: Status | null): number | null {
  if (!s) return null;
  switch (flowOf(s)) {
    case 'charging': return s.state === 'charge' ? s.band.high : 100;
    case 'draining': return s.band.low;
    default: return null;
  }
}

function stateMeta(s: Status | null) {
  // Paused / stopped come straight from state; the cycling states are driven by the real
  // power flow so an activity hold (state "drain" but charging) reads correctly.
  if (!s || s.state === 'stopped') return { label: 'Engine off - normal charging', color: 'var(--text-muted)', icon: '○' };
  if (s.paused) return { label: 'Paused - charging like normal', color: 'var(--series-1)', icon: '⏸' };
  switch (flowOf(s)) {
    case 'charging': return { label: `Charging to ${flowTargetOf(s) ?? s.band.high}%`, color: 'var(--status-good)', icon: '⇡' };
    case 'draining': return { label: `Draining to ${s.band.low}%`, color: 'var(--status-serious)', icon: '⇣' };
    default: return s.state === 'hold'
      ? { label: 'Holding at full (calibration)', color: 'var(--status-good)', icon: '✓' }
      : { label: `Holding at ${s.pct ?? 0}%`, color: 'var(--status-good)', icon: '✓' };
  }
}

interface Pt { t: number; pct: number; w: number; temp: number | null; state: string }

// Treat non-finite / non-positive readings as missing. The engine writes temp=0.0 on a failed
// ioreg read and can emit blank health cells; coalescing them to null keeps a stray 0 from
// crushing the temp axis or drawing a phantom 0% health point. Number.isFinite-guarded so a null
// can never coerce back to 0 in a downstream Math.min.
const pos = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const eventClass = (line: string): string => {
  if (/DRAIN|drain/.test(line)) return 'ev-drain';
  if (/CHARGE|charged|charge/.test(line)) return 'ev-charge';
  if (/PAUSED|RESUMED|mode|started/.test(line)) return 'ev-ctl';
  return '';
};

function ChartTooltip({ active, payload, label, unit }:
  { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: number; unit: string }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="tooltip">
      <div className="t">{new Date(label).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
      {payload.map((p) => (
        <div className="row" key={p.name}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
          {p.name}: <b>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}{unit}</b>
        </div>
      ))}
    </div>
  );
}

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
    body: 'Pause (button above) or quit the engine and the software cut lifts immediately: your Mac charges to 100% like a normal Mac. Unplugging the charger also suspends cycling automatically until AC returns. Nothing persists except the logs.',
  },
  {
    key: 'led',
    title: 'What the charger light means',
    body: 'The MagSafe LED is BattCal\'s status light (the hardware only has amber and green, no other colors exist). Dark while plugged in = draining in longevity mode (a normal Mac never shows a dark connector, so dark = BattCal is working). Slow green pulse = calibration drain. Amber = actually charging. Green = at target, not charging. Paused or off = normal Apple behavior.',
  },
];

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [dayRows, setDayRows] = useState<TelemetryRow[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [liveBuf, setLiveBuf] = useState<Pt[]>([]);
  const [hours, setHours] = useState(12);
  // Per-source errors: a status-poll success must not clear a data-fetch failure, and a control-POST
  // failure must not be wiped by the refreshStatus() that follows it. One shared string did both.
  const [errs, setErrs] = useState<{ status?: string; data?: string; action?: string }>({});
  const [showHow, setShowHow] = useState(false);
  const [themePref, setThemePref] = useState<ThemePref>(
    () => ((localStorage.getItem('battcal-theme') as ThemePref) || 'auto'),
  );

  // Theme: Auto follows the system appearance live; manual pins it.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = themePref === 'auto' ? (mq.matches ? 'dark' : 'light') : themePref;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themePref]);

  const pickTheme = (p: ThemePref) => {
    localStorage.setItem('battcal-theme', p);
    setThemePref(p);
  };

  const refreshStatus = useCallback(async () => {
    try { setStatus(await fetchStatus()); setErrs((prev) => ({ ...prev, status: undefined })); }
    catch (e) { setErrs((prev) => ({ ...prev, status: String(e) })); }
  }, []);
  const refreshData = useCallback(async (h: number) => {
    try {
      const [t, d, c, l] = await Promise.all([fetchTelemetry(h), fetchTelemetry(24), fetchCycles(), fetchLog()]);
      setRows(t); setDayRows(d); setCycles(c); setLog(l); setErrs((prev) => ({ ...prev, data: undefined }));
    } catch (e) { setErrs((prev) => ({ ...prev, data: String(e) })); }
  }, []);

  useEffect(() => { refreshStatus(); const id = setInterval(refreshStatus, 15000); return () => clearInterval(id); }, [refreshStatus]);
  useEffect(() => { refreshData(hours); const id = setInterval(() => refreshData(hours), 60000); return () => clearInterval(id); }, [hours, refreshData]);

  // Live chart buffer. The engine writes telemetry only while cycling, so when paused the charts
  // would go blank. /api/status reads ioreg live on every poll regardless, so mirror each sample
  // into a small ring buffer and fall back to it when engine telemetry is empty or stale.
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

  // 1s countdown clock, ticking only while a throttle banner or benchmark break is on screen.
  const [now, setNow] = useState(() => Date.now());
  // Throttle banner only when the Mac genuinely runs on battery: adapter software-cut by
  // BattCal (server-reported ground truth from ioreg ExternalConnected) or physically
  // unplugged. batteryW alone is NOT enough: paused at 100% under a heavy load, the battery
  // briefly supplements a maxed adapter (negative watts) while charging stays perfectly
  // normal - that must never claim "adapter cut".
  const discharging = status?.batteryW != null && status.batteryW < -0.5;
  const throttled = discharging && (status?.adapterCut === true || status?.plugged === false);
  const breakUntilMs = status?.breakUntil != null ? status.breakUntil * 1000 : null;
  const breakActive = breakUntilMs != null && breakUntilMs > now;
  // Tick the 1s clock only while a benchmark-break countdown is on screen. A plain drain shows a
  // static throttle banner with no countdown, so ticking every second during it just re-rendered
  // the whole dashboard for nothing.
  useEffect(() => {
    if (!breakActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [breakActive]);

  // POST control helper: check res.ok and surface a failed action instead of silently
  // refreshing as if it worked (a rejected pause/resume/mode/break used to look successful).
  const doPost = useCallback(async (fn: () => Promise<Response>, label: string) => {
    try {
      const res = await fn();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setErrs((prev) => ({ ...prev, action: undefined }));
    } catch (e) { setErrs((prev) => ({ ...prev, action: `${label} failed: ${String(e)}` })); }
    refreshStatus();
  }, [refreshStatus]);

  const switchMode = (m: Mode) => doPost(() => postMode(m), `Switch to ${m}`);

  const pts: Pt[] = useMemo(() => rows.map((r) => ({
    t: new Date(r.ts).getTime(), pct: r.pct, w: r.battery_W, temp: pos(r.temp_C), state: r.state,
  })).filter((p) => Number.isFinite(p.t)), [rows]);

  // Engine telemetry when present and fresh; otherwise the live status buffer, so the charts stay
  // populated while paused. Mirrors the menu-bar popover live-buffer fix.
  const chartPts = useMemo(() => {
    const stale = !pts.length || (Date.now() - pts[pts.length - 1].t) > 120e3;
    return stale && liveBuf.length ? liveBuf : pts;
  }, [pts, liveBuf]);
  const usingLiveBuf = chartPts === liveBuf && liveBuf.length > 0;

  const spanMs = useMemo(() => (chartPts.length > 1 ? chartPts[chartPts.length - 1].t - chartPts[0].t : 3600e3), [chartPts]);
  const timeTicks = useMemo(() => (chartPts.length > 1 ? niceTimeTicks(chartPts[0].t, chartPts[chartPts.length - 1].t) : []), [chartPts]);
  const tempScale = useMemo(() => steppedScale(chartPts.map((p) => p.temp ?? NaN), 0.5), [chartPts]);
  const powScale = useMemo(() => steppedScale(chartPts.map((p) => p.w), powerStep(chartPts.map((p) => p.w)), { includeZero: true }), [chartPts]);

  const powerOffset = useMemo(() => {
    const [lo, hi] = powScale.domain;
    return hi === lo ? 0.5 : hi / (hi - lo);
  }, [powScale]);

  const healthPts = useMemo(() => cycles.map((c) => ({
    t: csvDateMs(c.date),
    cycle: c.cycle_count,
    mode: c.mode ?? '-',
    raw: status?.designMah ? pos(+(100 * c.raw_mAh / status.designMah).toFixed(1)) : null,
    nominal: status?.designMah ? pos(+(100 * c.nominal_mAh / status.designMah).toFixed(1)) : null,
    apple: pos(typeof c.apple_health === 'string' ? Number(String(c.apple_health).replace('%', '')) : c.apple_health),
  })).filter((h) => Number.isFinite(h.t)), [cycles, status?.designMah]);

  const healthTicks = useMemo(() => (healthPts.length > 1 ? niceTimeTicks(healthPts[0].t, healthPts[healthPts.length - 1].t) : []), [healthPts]);
  const healthScale = useMemo(() => steppedScale(
    healthPts.flatMap((h) => [h.raw, h.nominal, h.apple]).filter((v): v is number => v != null).concat([80]),
    2, { clampMin: 70, clampMax: 100 },
  ), [healthPts]);

  // "Last 24h story": dt-weighted aggregates from full-day telemetry.
  const story = useMemo(() => {
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
    // Fold in the final row's pct (the loop only reads dayRows[i-1]) and guard the +/-Infinity seed from
    // leaking to the UI (rendered "Infinity-Infinity%") when no interval had dt>0.
    const lastPct = dayRows[dayRows.length - 1]?.pct;
    if (typeof lastPct === 'number') { minPct = Math.min(minPct, lastPct); maxPct = Math.max(maxPct, lastPct); }
    return { drainH: hrs(drainMs), chargeH: hrs(chargeMs), idleH: hrs(idleMs), dischargeWh: dischargeWh.toFixed(1), minPct: Number.isFinite(minPct) ? minPct : null, maxPct: Number.isFinite(maxPct) ? maxPct : null, minT: Number.isFinite(minT) ? minT : null, maxT: Number.isFinite(maxT) ? maxT : null, turnarounds };
  }, [dayRows, cycles]);

  // How is BattCal affecting the cycle counter and the health numbers?
  const impact = useMemo(() => {
    if (!healthPts.length || !status?.cycles) return null;
    const first = healthPts[0];
    const days = Math.max((Date.now() - first.t) / 86400e3, 0.25);
    const cyclesAdded = status.cycles - first.cycle;
    const perDay = cyclesAdded / days;
    const perMonth = perDay * 30;
    const ratedPctPerMonth = (perMonth / status.designCycles) * 100;
    const rawStartPct = first.raw;
    const rawNowPct = status.rawHealthPct;
    const appleNow = pos(typeof status.appleHealth === 'string' ? Number(String(status.appleHealth).replace('%', '')) : status.appleHealth);
    return {
      sinceDays: days.toFixed(1),
      startCycle: first.cycle,
      cyclesAdded,
      perDay: perDay.toFixed(1),
      perMonth: Math.round(perMonth),
      ratedPctPerMonth: ratedPctPerMonth.toFixed(1),
      rawStartPct,
      rawNowPct,
      rawDelta: rawStartPct != null && rawNowPct != null ? (rawNowPct - rawStartPct).toFixed(1) : null,
      appleStart: first.apple,
      appleNow,
    };
  }, [healthPts, status]);

  // Fit the axis to the plotted per-cycle data (do not pad up to the live odometer, which left a
  // dead gap at the top with no line reaching it; the current count shows in the Cycles tile).
  const cycleScale = useMemo(() => steppedScale(healthPts.map((h) => h.cycle), 1), [healthPts]);

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

  const lastHealth = healthPts.at(-1);
  const meta = stateMeta(status);
  const flow = flowOf(status);
  const band = status?.band ?? DEFAULT_BAND;
  const mode = status?.mode ?? 'longevity';
  const activeHowKey = status?.paused || status?.state === 'stopped' ? 'off' : mode;
  const axis = { stroke: 'var(--baseline)', tick: { fill: 'var(--text-secondary)', fontSize: 11.5 }, tickLine: false } as const;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">BattCal<small>battery band cycler</small></div>
        <span className="pill" title={status?.updatedAt || ''}>
          <span className="dot" style={{ background: meta.color }} />
          {meta.icon} {meta.label}
        </span>
        {eta && <span className="pill" title="At current draw, from the battery gauge">~{eta.text} to {eta.targetPct}%</span>}
        <div className="spacer" />
        {status?.paused
          ? <button className="action primary" onClick={() => doPost(postResume, 'Resume')}>Resume cycling</button>
          : <button className="action primary" onClick={() => doPost(postPause, 'Pause')}>Charge full now (pause)</button>}
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t} className={themePref === t ? 'on' : ''} aria-pressed={themePref === t} onClick={() => pickTheme(t)}>
              {t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </header>

      {errs.action && <div className="err" role="alert">{errs.action}</div>}
      {(errs.status || errs.data) && <div className="err" role="alert">Cannot reach the BattCal engine API: {errs.status || errs.data}</div>}

      {breakActive ? (
        <div className="banner banner-break" aria-live="polite">
          <div className="banner-text">
            <b>Benchmark break active.</b> Full speed now, calibration resumes in {fmtDur(breakUntilMs! - now)}. Run Geekbench.
          </div>
          <button className="action" onClick={() => doPost(postResume, 'Resume')}>Resume calibration now</button>
        </div>
      ) : throttled ? (
        <div className="banner banner-warn" aria-live="polite">
          <div className="banner-text">
            <b>CPU is power-throttled.</b> {status?.adapterCut
              ? 'BattCal is draining (adapter cut), so the Mac runs on battery. Benchmarks and heavy compute score low, and worse as the battery drops.'
              : 'On battery. CPU-heavy benchmarks score lower than plugged in, and worse as the battery drops.'}
          </div>
          <button className="action primary" onClick={() => doPost(() => postBreak(30), 'Benchmark break')}>Benchmark break (30 min)</button>
        </div>
      ) : null}

      <section className="tiles">
        <div className="tile"><div className="label">Battery</div><div className="value">{status?.pct ?? '--'}<small>%</small></div>
          <div className="sub">{status?.plugged ? `plugged in (${status.adapterW}W)` : 'on battery'}</div></div>
        <div className="tile"><div className="label">Power flow</div>
          <div className="value" style={{ color: flow === 'charging' ? 'var(--diverge-pos)' : flow === 'draining' ? 'var(--diverge-neg)' : undefined }}>
            {status?.batteryW !== null && status?.batteryW !== undefined ? (status.batteryW > 0 ? '+' : '') + status.batteryW : '--'}<small>W</small></div>
          <div className="sub">{status == null ? '--' : flow === 'charging' ? 'charging' : flow === 'draining' ? (status.plugged && !status.adapterCut ? 'supplementing the adapter' : 'discharging') : status.plugged ? 'holding (not charging)' : 'on battery'}</div></div>
        <div className="tile"><div className="label">Temperature</div><div className="value">{status?.tempC ?? '--'}<small>&deg;C</small></div>
          <div className="sub">battery pack</div></div>
        <div className="tile"><div className="label">True health</div><div className="value">{status?.rawHealthPct ?? '--'}<small>%</small></div>
          <div className="sub">{status?.rawMah ?? '--'} / {status?.designMah ?? '--'} mAh</div></div>
        <div className="tile"><div className="label">Apple health</div><div className="value">{status?.appleHealth ?? '--'}</div>
          <div className="sub">smoothed (powerd)</div></div>
        <div className="tile"><div className="label">Cycles</div><div className="value">{status?.cycles ?? '--'}</div>
          <div className="sub">{cycles.length} band cycles logged</div></div>
      </section>

      <div className="filters">
        <span className="label">Range</span>
        {RANGES.map((r) => (
          <button key={r.label} className={hours === r.hours ? 'on' : ''} aria-pressed={hours === r.hours} onClick={() => setHours(r.hours)}>{r.label}</button>
        ))}
        <div className="spacer" />
        <span className="label">Mode</span>
        <div className="seg" role="group" aria-label="Mode">
          <button className={mode === 'longevity' ? 'on' : ''} aria-pressed={mode === 'longevity'} onClick={() => switchMode('longevity')} title="Cycle 10-90%, never sit at 100%">
            Longevity 10-90
          </button>
          <button className={mode === 'calibration' ? 'on' : ''} aria-pressed={mode === 'calibration'} onClick={() => switchMode('calibration')} title="Full 5-100% passes to re-train the health numbers">
            Calibration 5-100
          </button>
        </div>
      </div>

      {!chartPts.length ? (
        <p className="hint" style={{ margin: '0 0 6px' }}>No live chart data yet. Readings appear within a few seconds; engine telemetry resumes when cycling is active.</p>
      ) : usingLiveBuf ? (
        <p className="hint" style={{ margin: '0 0 6px' }}>Live readings captured since this page opened (engine telemetry is paused; the charts resume from the engine when cycling restarts).</p>
      ) : null}

      <div className="grid2">
        <div className="card">
          <h2>Battery charge</h2>
          <p className="hint">percent; shaded band = {band.low}-{band.high}% ({mode})</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="pctFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={timeTicks} tickFormatter={(t) => fmtTimeTick(t, spanMs)} {...axis} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axis} />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <ReferenceArea y1={band.low} y2={band.high} fill="var(--accent-wash)" stroke="none" />
              <ReferenceLine y={band.low} stroke="var(--text-muted)" strokeDasharray="4 4" />
              <ReferenceLine y={band.high} stroke="var(--text-muted)" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="pct" name="charge" stroke="var(--series-1)" strokeWidth={2.5} fill="url(#pctFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Power flow</h2>
          <p className="hint">watts: positive = charging, negative = discharging</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartPts} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="wStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={powerOffset} stopColor="var(--diverge-pos)" />
                  <stop offset={powerOffset} stopColor="var(--diverge-neg)" />
                </linearGradient>
                <linearGradient id="wFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={powerOffset} stopColor="var(--diverge-pos)" stopOpacity={0.22} />
                  <stop offset={powerOffset} stopColor="var(--diverge-neg)" stopOpacity={0.22} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={timeTicks} tickFormatter={(t) => fmtTimeTick(t, spanMs)} {...axis} />
              <YAxis domain={powScale.domain} ticks={powScale.ticks} tickFormatter={(v) => `${v}`} {...axis} />
              <Tooltip content={<ChartTooltip unit=" W" />} />
              <ReferenceLine y={0} stroke="var(--baseline)" />
              <Area type="monotone" dataKey="w" name="power" baseValue={0} stroke="url(#wStroke)" strokeWidth={2.5} fill="url(#wFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Temperature</h2>
          <p className="hint">battery pack, &deg;C</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={timeTicks} tickFormatter={(t) => fmtTimeTick(t, spanMs)} {...axis} />
              <YAxis domain={tempScale.domain} ticks={tempScale.ticks} tickFormatter={(v) => v.toFixed(1)} {...axis} />
              <Tooltip content={<ChartTooltip unit=" °C" />} />
              <Line type="monotone" dataKey="temp" name="temp" stroke="var(--series-2)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Health per cycle</h2>
          <p className="hint">percent of design capacity; AppleCare threshold at 80%</p>
          <div className="legend">
            <span className="key"><span className="swatch" style={{ background: 'var(--series-1)' }} />gauge raw{lastHealth?.raw != null ? ` · ${lastHealth.raw}%` : ''}</span>
            <span className="key"><span className="swatch" style={{ background: 'var(--series-2)' }} />gauge nominal{lastHealth?.nominal != null ? ` · ${lastHealth.nominal}%` : ''}</span>
            <span className="key"><span className="swatch" style={{ background: 'var(--series-3)' }} />Apple smoothed{lastHealth?.apple != null ? ` · ${lastHealth.apple}%` : ''}</span>
          </div>
          {healthPts.length ? (
          <ResponsiveContainer width="100%" height={186}>
            <LineChart data={healthPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={healthTicks} tickFormatter={(t) => fmtTimeTick(t, healthPts.length > 1 ? healthPts[healthPts.length - 1].t - healthPts[0].t : 3600e3)} {...axis} />
              <YAxis domain={healthScale.domain} ticks={healthScale.ticks} {...axis} />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <ReferenceLine y={80} stroke="var(--status-critical)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="raw" name="gauge raw" stroke="var(--series-1)" strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="nominal" name="gauge nominal" stroke="var(--series-2)" strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="apple" name="Apple smoothed" stroke="var(--series-3)" strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          ) : (
            <p className="hint">No cycle snapshots yet. This chart fills in after the first completed band cycle.</p>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Battery cycle count</h2>
          <p className="hint">the gauge's odometer; one cycle = 100% worth of discharge (a 10-90 pass adds 0.8)</p>
          {healthPts.length ? (
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={healthPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={healthTicks} tickFormatter={(t) => fmtTimeTick(t, healthPts.length > 1 ? healthPts[healthPts.length - 1].t - healthPts[0].t : 3600e3)} {...axis} />
              <YAxis domain={cycleScale.domain} ticks={cycleScale.ticks} allowDecimals={false} {...axis} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <Line type="stepAfter" dataKey="cycle" name="cycle count" stroke="var(--series-1)" strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          ) : (
            <p className="hint">No cycle snapshots yet. The odometer chart fills in after the first completed band cycle.</p>
          )}
        </div>

        <div className="card">
          <h2>Impact since BattCal started</h2>
          <p className="hint">what this method is costing in cycles, and doing to the health numbers</p>
          {impact ? (
            <div className="story">
              <div><b>+{impact.cyclesAdded}</b><span>cycles in {impact.sinceDays}d ({impact.perDay}/day)</span></div>
              <div><b>~{impact.perMonth}/mo</b><span>{impact.ratedPctPerMonth}% of rated {status?.designCycles ?? 1000}-cycle life</span></div>
              <div><b>{impact.rawStartPct ?? '--'}% → {impact.rawNowPct ?? '--'}%</b><span>true health ({impact.rawDelta != null && Number(impact.rawDelta) >= 0 ? '+' : ''}{impact.rawDelta ?? '--'} pp)</span></div>
              <div><b>{impact.appleStart ?? '--'}% → {impact.appleNow ?? '--'}%</b><span>Apple smoothed</span></div>
            </div>
          ) : (
            <p className="hint">Needs at least one completed cycle snapshot.</p>
          )}
          <p className="hint">Wear math: band cycling spends cycle count like normal usage does; the tradeoff is
            avoiding time parked at 100%, which is the bigger aging factor for lithium cells. Health estimates
            move as the gauge re-learns; expect wobble, judge by the multi-day trend.</p>
        </div>
      </div>

      <GeniusBarPrep status={status} onChange={refreshStatus} />

      {story && (
        <div className="card">
          <h2>Last 24 hours</h2>
          <p className="hint">how the cycling went while you were away</p>
          <div className="story">
            <div><b>{story.turnarounds}</b><span>band cycles</span></div>
            <div><b>{story.drainH}h</b><span>draining</span></div>
            <div><b>{story.chargeH}h</b><span>charging</span></div>
            <div><b>{story.idleH}h</b><span>paused / idle</span></div>
            <div><b>{story.dischargeWh} Wh</b><span>energy discharged</span></div>
            <div><b>{story.minPct ?? '--'}-{story.maxPct ?? '--'}%</b><span>battery range</span></div>
            <div><b>{story.minT ?? '--'}-{story.maxT ?? '--'}°C</b><span>temp range</span></div>
          </div>
        </div>
      )}

      <div className="card">
        <button className="how-toggle" onClick={() => setShowHow((s) => !s)} aria-expanded={showHow}>
          {showHow ? '▾' : '▸'} How BattCal works
        </button>
        {showHow && (
          <div className="how-rows">
            {HOW_ROWS.map((r) => (
              <div key={r.key} className={`how-row${activeHowKey === r.key ? ' active' : ''}`}>
                <div className="how-title">
                  {r.title}
                  {activeHowKey === r.key && <span className="how-now">active now</span>}
                </div>
                <div className="how-body">{r.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Cycle history</h2>
          <p className="hint">one row per completed cycle (longevity turnaround or calibration hold)</p>
          <table className="data">
            <thead><tr><th>Completed</th><th>Mode</th><th>Band</th><th>Duration</th><th>Raw mAh</th><th>Nominal</th><th>Apple</th></tr></thead>
            <tbody>
              {cycles.map((c, i) => ({ c, i })).reverse().map(({ c, i }) => (
                <tr key={i}>
                  <td>{c.date}</td>
                  <td>{c.mode ?? '-'}</td>
                  <td>{c.band_low != null ? `${c.band_low}-${c.band_high}%` : '-'}</td>
                  <td>{typeof c.duration_min === 'number' ? `${Math.floor(c.duration_min / 60)}h${String(c.duration_min % 60).padStart(2, '0')}` : '-'}</td>
                  <td>{c.raw_mAh}</td><td>{c.nominal_mAh}</td><td>{String(c.apple_health)}</td>
                </tr>
              ))}
              {!cycles.length && <tr><td colSpan={7}>No completed cycles yet</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Engine events</h2>
          <p className="hint">phase transitions and controls, newest first</p>
          <div className="loglines">
            {log.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => <div key={i} className={eventClass(l)}>{l}</div>)}
            {!log.length && <div>No events logged yet</div>}
          </div>
        </div>
      </div>

      <p className="footer">
        BattCal &middot; <a href="https://github.com/parsamivehchi/battcal">github.com/parsamivehchi/battcal</a>
        &middot; engine polls every 15s, dashboard refreshes every 60s
      </p>
    </div>
  );
}
