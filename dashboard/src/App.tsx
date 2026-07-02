import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CycleRow, Mode, Status, TelemetryRow,
  fetchCycles, fetchLog, fetchStatus, fetchTelemetry, postMode, postPause, postResume,
} from './api';
import { fmtTimeTick, niceTimeTicks, powerStep, steppedScale } from './chartUtils';

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

function stateMeta(s: Status | null) {
  const band = s?.band ?? DEFAULT_BAND;
  const map: Record<string, { label: string; color: string; icon: string }> = {
    drain: { label: `Draining to ${band.low}%`, color: 'var(--status-serious)', icon: '⇣' },
    charge: { label: `Charging to ${band.high}%`, color: 'var(--status-good)', icon: '⇡' },
    hold: { label: 'Holding at full (calibration)', color: 'var(--status-good)', icon: '✓' },
    paused: { label: 'Paused - charging like normal', color: 'var(--series-1)', icon: '⏸' },
    stopped: { label: 'Engine off - normal charging', color: 'var(--text-muted)', icon: '○' },
  };
  return map[s?.state || 'stopped'] || map.stopped;
}

interface Pt { t: number; pct: number; w: number; temp: number; state: string }

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
];

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [dayRows, setDayRows] = useState<TelemetryRow[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [hours, setHours] = useState(12);
  const [err, setErr] = useState<string | null>(null);
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
    try { setStatus(await fetchStatus()); setErr(null); }
    catch (e) { setErr(String(e)); }
  }, []);
  const refreshData = useCallback(async (h: number) => {
    try {
      const [t, d, c, l] = await Promise.all([fetchTelemetry(h), fetchTelemetry(24), fetchCycles(), fetchLog()]);
      setRows(t); setDayRows(d); setCycles(c); setLog(l); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { refreshStatus(); const id = setInterval(refreshStatus, 15000); return () => clearInterval(id); }, [refreshStatus]);
  useEffect(() => { refreshData(hours); const id = setInterval(() => refreshData(hours), 60000); return () => clearInterval(id); }, [hours, refreshData]);

  const switchMode = async (m: Mode) => {
    await postMode(m);
    refreshStatus();
  };

  const pts: Pt[] = useMemo(() => rows.map((r) => ({
    t: new Date(r.ts).getTime(), pct: r.pct, w: r.battery_W, temp: r.temp_C, state: r.state,
  })).filter((p) => Number.isFinite(p.t)), [rows]);

  const spanMs = useMemo(() => (pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 3600e3), [pts]);
  const timeTicks = useMemo(() => (pts.length > 1 ? niceTimeTicks(pts[0].t, pts[pts.length - 1].t) : []), [pts]);
  const tempScale = useMemo(() => steppedScale(pts.map((p) => p.temp), 0.5), [pts]);
  const powScale = useMemo(() => steppedScale(pts.map((p) => p.w), powerStep(pts.map((p) => p.w)), { includeZero: true }), [pts]);

  const powerOffset = useMemo(() => {
    const [lo, hi] = powScale.domain;
    return hi === lo ? 0.5 : hi / (hi - lo);
  }, [powScale]);

  const healthPts = useMemo(() => cycles.map((c) => ({
    t: new Date(String(c.date).replace(' ', 'T') + ':00').getTime(),
    cycle: c.cycle_count,
    mode: c.mode ?? '-',
    raw: status?.designMah ? +(100 * c.raw_mAh / status.designMah).toFixed(1) : null,
    nominal: status?.designMah ? +(100 * c.nominal_mAh / status.designMah).toFixed(1) : null,
    apple: typeof c.apple_health === 'string' ? Number(String(c.apple_health).replace('%', '')) : c.apple_health,
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
      minT = Math.min(minT, a.temp_C); maxT = Math.max(maxT, a.temp_C);
    }
    const turnarounds = cycles.filter((c) => Date.now() - new Date(String(c.date).replace(' ', 'T') + ':00').getTime() < 24 * 3600e3).length;
    const hrs = (ms: number) => (ms / 3600e3).toFixed(1);
    return { drainH: hrs(drainMs), chargeH: hrs(chargeMs), idleH: hrs(idleMs), dischargeWh: dischargeWh.toFixed(1), minPct, maxPct, minT, maxT, turnarounds };
  }, [dayRows, cycles]);

  // Time to band edge at CURRENT draw (gauge math, like the OS's estimate).
  const eta = useMemo(() => {
    const s = status;
    if (!s || s.paused || !s.rawCurrentMah || !s.rawMah || !s.amperageMa || Math.abs(s.amperageMa) < 50) return null;
    const targetPct = s.state === 'drain' ? s.band.low : s.state === 'charge' ? s.band.high : null;
    if (targetPct === null) return null;
    const targetMah = (targetPct / 100) * s.rawMah;
    const mins = ((targetMah - s.rawCurrentMah) / s.amperageMa) * 60;
    if (!Number.isFinite(mins) || mins <= 0 || mins > 48 * 60) return null;
    const m = Math.round(mins);
    return { text: m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`, targetPct };
  }, [status]);

  const lastHealth = healthPts.at(-1);
  const meta = stateMeta(status);
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
          ? <button className="action primary" onClick={async () => { await postResume(); refreshStatus(); }}>Resume cycling</button>
          : <button className="action primary" onClick={async () => { await postPause(); refreshStatus(); }}>Charge full now (pause)</button>}
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t} className={themePref === t ? 'on' : ''} onClick={() => pickTheme(t)}>
              {t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </header>

      {err && <div className="err">Cannot reach the BattCal engine API: {err}</div>}

      <section className="tiles">
        <div className="tile"><div className="label">Battery</div><div className="value">{status?.pct ?? '--'}<small>%</small></div>
          <div className="sub">{status?.plugged ? `plugged in (${status.adapterW}W)` : 'on battery'}</div></div>
        <div className="tile"><div className="label">Power flow</div>
          <div className="value" style={{ color: status?.batteryW ? (status.batteryW > 0 ? 'var(--diverge-pos)' : 'var(--diverge-neg)') : undefined }}>
            {status?.batteryW !== null && status?.batteryW !== undefined ? (status.batteryW > 0 ? '+' : '') + status.batteryW : '--'}<small>W</small></div>
          <div className="sub">{status?.charging ? 'charging' : status?.plugged ? 'not charging' : 'discharging'}</div></div>
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
          <button key={r.label} className={hours === r.hours ? 'on' : ''} onClick={() => setHours(r.hours)}>{r.label}</button>
        ))}
        <div className="spacer" />
        <span className="label">Mode</span>
        <div className="seg" role="group" aria-label="Mode">
          <button className={mode === 'longevity' ? 'on' : ''} onClick={() => switchMode('longevity')} title="Cycle 10-90%, never sit at 100%">
            Longevity 10-90
          </button>
          <button className={mode === 'calibration' ? 'on' : ''} onClick={() => switchMode('calibration')} title="Full 5-100% passes to re-train the health numbers">
            Calibration 5-100
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Battery charge</h2>
          <p className="hint">percent; shaded band = {band.low}-{band.high}% ({mode})</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
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
            <AreaChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
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
              <Area type="monotone" dataKey="w" name="power" stroke="url(#wStroke)" strokeWidth={2.5} fill="url(#wFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Temperature</h2>
          <p className="hint">battery pack, &deg;C</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={timeTicks} tickFormatter={(t) => fmtTimeTick(t, spanMs)} {...axis} />
              <YAxis domain={tempScale.domain} ticks={tempScale.ticks} tickFormatter={(v) => v.toFixed(1)} {...axis} />
              <Tooltip content={<ChartTooltip unit=" C" />} />
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
        </div>
      </div>

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
            <div><b>{story.minPct}-{story.maxPct}%</b><span>battery range</span></div>
            <div><b>{story.minT}-{story.maxT}°C</b><span>temp range</span></div>
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
              {[...cycles].reverse().map((c, i) => (
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
            {[...log].reverse().map((l, i) => <div key={i} className={eventClass(l)}>{l}</div>)}
            {!log.length && <div>No events logged yet</div>}
          </div>
        </div>
      </div>

      <p className="footer">
        BattCal &middot; <a href="https://github.com/parsamivehchi/battcal">github.com/parsamivehchi/battcal</a>
        &middot; engine polls every 30s, dashboard refreshes every 60s
      </p>
    </div>
  );
}
