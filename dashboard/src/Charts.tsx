// Recharts-dependent chart region, split into its own chunk and React.lazy-loaded by App so
// the ~350 KB recharts bundle stays out of the initial page load. Purely presentational: every
// value it renders is computed in App and passed as a prop (no data fetching, no hooks here).
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtTimeTick } from './chartUtils';
import type { Scale } from './chartUtils';
import type { Status } from './api';

export interface Pt { t: number; pct: number; w: number; temp: number | null; state: string }
export interface HealthPt { t: number; cycle: number; mode: string; raw: number | null; nominal: number | null; apple: number | null }
export interface Impact {
  sinceDays: string; startCycle: number; cyclesAdded: number; perDay: string; perMonth: number;
  ratedPctPerMonth: string; rawStartPct: number | null; rawNowPct: number | null; rawDelta: string | null;
  appleStart: number | null; appleNow: number | null;
}

const axis = { stroke: 'var(--baseline)', tick: { fill: 'var(--text-secondary)', fontSize: 11.5 }, tickLine: false } as const;

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

interface Props {
  chartPts: Pt[];
  band: { low: number; high: number };
  mode: string;
  timeTicks: number[];
  spanMs: number;
  powScale: Scale;
  powerOffset: number;
  tempScale: Scale;
  healthPts: HealthPt[];
  healthTicks: number[];
  healthScale: Scale;
  lastHealth: HealthPt | undefined;
  cycleScale: Scale;
  impact: Impact | null;
  status: Status | null;
}

export default function DashboardCharts({
  chartPts, band, mode, timeTicks, spanMs, powScale, powerOffset, tempScale,
  healthPts, healthTicks, healthScale, lastHealth, cycleScale, impact, status,
}: Props) {
  return (
    <>
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
    </>
  );
}
