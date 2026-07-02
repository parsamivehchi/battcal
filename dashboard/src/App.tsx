import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CycleRow, Status, TelemetryRow,
  fetchCycles, fetchLog, fetchStatus, fetchTelemetry, postPause, postResume,
} from './api';

const RANGES = [
  { label: '3h', hours: 3 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: 'All', hours: 0 },
];

const STATE_META: Record<string, { label: string; color: string; icon: string }> = {
  drain: { label: 'Draining (calibration)', color: 'var(--status-serious)', icon: '⇣' },
  charge: { label: 'Charging to 100%', color: 'var(--status-good)', icon: '⇡' },
  hold: { label: 'Holding at full', color: 'var(--status-good)', icon: '✓' },
  paused: { label: 'Paused (normal charging)', color: 'var(--series-1)', icon: '⏸' },
  stopped: { label: 'Engine stopped', color: 'var(--text-muted)', icon: '○' },
};

const fmtTime = (t: number, spanH: number) => {
  const d = new Date(t);
  if (spanH > 48) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
};

interface Pt { t: number; pct: number; w: number; temp: number; state: string }

function ChartTooltip({ active, payload, label, spanH, unit }:
  { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: number; spanH: number; unit: string }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="tooltip">
      <div className="t">{new Date(label).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
      {payload.map((p) => (
        <div className="row" key={p.name}>
          <span className="swatch" style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
          {p.name}: <b>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}{unit}</b>
        </div>
      ))}
      {spanH > 0 ? null : null}
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [hours, setHours] = useState(12);
  const [err, setErr] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(document.documentElement.dataset.theme || 'light');

  const refreshStatus = useCallback(async () => {
    try { setStatus(await fetchStatus()); setErr(null); }
    catch (e) { setErr(String(e)); }
  }, []);
  const refreshData = useCallback(async (h: number) => {
    try {
      const [t, c, l] = await Promise.all([fetchTelemetry(h), fetchCycles(), fetchLog()]);
      setRows(t); setCycles(c); setLog(l); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { refreshStatus(); const id = setInterval(refreshStatus, 15000); return () => clearInterval(id); }, [refreshStatus]);
  useEffect(() => { refreshData(hours); const id = setInterval(() => refreshData(hours), 60000); return () => clearInterval(id); }, [hours, refreshData]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('battcal-theme', next);
    setTheme(next);
  };

  const pts: Pt[] = useMemo(() => rows.map((r) => ({
    t: new Date(r.ts).getTime(), pct: r.pct, w: r.battery_W, temp: r.temp_C, state: r.state,
  })).filter((p) => Number.isFinite(p.t)), [rows]);

  const spanH = useMemo(() => (pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 3600e3 : 1), [pts]);

  const powerOffset = useMemo(() => {
    if (!pts.length) return 0.5;
    const max = Math.max(...pts.map((p) => p.w), 0);
    const min = Math.min(...pts.map((p) => p.w), 0);
    return max === min ? 0.5 : max / (max - min);
  }, [pts]);

  const healthPts = useMemo(() => cycles.map((c) => ({
    cycle: c.cycle_count,
    raw: status?.designMah ? +(100 * c.raw_mAh / status.designMah).toFixed(1) : null,
    nominal: status?.designMah ? +(100 * c.nominal_mAh / status.designMah).toFixed(1) : null,
    apple: typeof c.apple_health === 'string' ? Number(String(c.apple_health).replace('%', '')) : c.apple_health,
  })), [cycles, status?.designMah]);

  const meta = STATE_META[status?.state || 'stopped'] || STATE_META.stopped;
  const axis = { stroke: 'var(--baseline)', tick: { fill: 'var(--text-muted)', fontSize: 11 }, tickLine: false } as const;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">BattCal<small>battery calibration</small></div>
        <span className="pill" title={status?.updatedAt || ''}>
          <span className="dot" style={{ background: meta.color }} />
          {meta.icon} {meta.label}
        </span>
        <div className="spacer" />
        {status?.paused
          ? <button className="action primary" onClick={async () => { await postResume(); refreshStatus(); }}>Resume calibration</button>
          : <button className="action primary" onClick={async () => { await postPause(); refreshStatus(); }}>Charge now (pause)</button>}
        <button className="action" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'} mode</button>
      </header>

      {err && <div className="err">Cannot reach the BattCal engine API: {err}</div>}

      <section className="tiles">
        <div className="tile"><div className="label">Battery</div><div className="value">{status?.pct ?? '--'}<small>%</small></div>
          <div className="sub">{status?.plugged ? `plugged in (${status.adapterW}W)` : 'on battery'}</div></div>
        <div className="tile"><div className="label">Power flow</div>
          <div className="value">{status?.batteryW !== null && status?.batteryW !== undefined ? (status.batteryW > 0 ? '+' : '') + status.batteryW : '--'}<small>W</small></div>
          <div className="sub">{status?.charging ? 'charging' : status?.plugged ? 'not charging' : 'discharging'}</div></div>
        <div className="tile"><div className="label">Temperature</div><div className="value">{status?.tempC ?? '--'}<small>&deg;C</small></div>
          <div className="sub">battery pack</div></div>
        <div className="tile"><div className="label">True health</div><div className="value">{status?.rawHealthPct ?? '--'}<small>%</small></div>
          <div className="sub">{status?.rawMah ?? '--'} / {status?.designMah ?? '--'} mAh</div></div>
        <div className="tile"><div className="label">Apple health</div><div className="value">{status?.appleHealth ?? '--'}</div>
          <div className="sub">smoothed (powerd)</div></div>
        <div className="tile"><div className="label">Cycles</div><div className="value">{status?.cycles ?? '--'}</div>
          <div className="sub">{cycles.length} calibration cycles logged</div></div>
      </section>

      <div className="filters">
        <span className="label">Range</span>
        {RANGES.map((r) => (
          <button key={r.label} className={hours === r.hours ? 'on' : ''} onClick={() => setHours(r.hours)}>{r.label}</button>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Battery charge</h2>
          <p className="hint">percent, drain floor at 5%</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="pctFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtTime(t, spanH)} {...axis} />
              <YAxis domain={[0, 100]} {...axis} />
              <Tooltip content={<ChartTooltip spanH={spanH} unit="%" />} />
              <ReferenceLine y={5} stroke="var(--text-muted)" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="pct" name="charge" stroke="var(--series-1)" strokeWidth={2} fill="url(#pctFill)" dot={false} isAnimationActive={false} />
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
                  <stop offset={powerOffset} stopColor="var(--diverge-pos)" stopOpacity={0.18} />
                  <stop offset={powerOffset} stopColor="var(--diverge-neg)" stopOpacity={0.18} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtTime(t, spanH)} {...axis} />
              <YAxis {...axis} />
              <Tooltip content={<ChartTooltip spanH={spanH} unit=" W" />} />
              <ReferenceLine y={0} stroke="var(--baseline)" />
              <Area type="monotone" dataKey="w" name="power" stroke="url(#wStroke)" strokeWidth={2} fill="url(#wFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Temperature</h2>
          <p className="hint">battery pack, &deg;C</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtTime(t, spanH)} {...axis} />
              <YAxis domain={['auto', 'auto']} {...axis} />
              <Tooltip content={<ChartTooltip spanH={spanH} unit=" C" />} />
              <Line type="monotone" dataKey="temp" name="temp" stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Health per calibration cycle</h2>
          <p className="hint">percent of design capacity, AppleCare threshold at 80%</p>
          <div className="legend">
            <span className="key"><span className="swatch" style={{ background: 'var(--series-1)' }} />gauge raw</span>
            <span className="key"><span className="swatch" style={{ background: 'var(--series-2)' }} />gauge nominal</span>
            <span className="key"><span className="swatch" style={{ background: 'var(--series-3)' }} />Apple smoothed</span>
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={healthPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="cycle" type="number" domain={['dataMin', 'dataMax']} {...axis} allowDecimals={false} />
              <YAxis domain={[70, 100]} {...axis} />
              <Tooltip content={<ChartTooltip spanH={0} unit="%" />} />
              <ReferenceLine y={80} stroke="var(--status-critical)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="raw" name="gauge raw" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="nominal" name="gauge nominal" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="apple" name="Apple smoothed" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Cycle history</h2>
          <p className="hint">one row per completed calibration cycle</p>
          <table className="data">
            <thead><tr><th>Completed</th><th>Cycle</th><th>Raw mAh</th><th>Nominal mAh</th><th>Apple</th></tr></thead>
            <tbody>
              {[...cycles].reverse().map((c, i) => (
                <tr key={i}><td>{c.date}</td><td>{c.cycle_count}</td><td>{c.raw_mAh}</td><td>{c.nominal_mAh}</td><td>{String(c.apple_health)}</td></tr>
              ))}
              {!cycles.length && <tr><td colSpan={5}>No completed cycles yet</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Engine events</h2>
          <p className="hint">phase transitions and controls, newest last</p>
          <div className="loglines">
            {log.map((l, i) => <div key={i}>{l}</div>)}
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
