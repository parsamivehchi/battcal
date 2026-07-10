// Recharts-dependent chart region, split into its own chunk and React.lazy-loaded by the
// views so the ~350 KB recharts bundle stays out of the initial page load. Two named
// sections (Overview / Health) share this one module, so both resolve to one chunk.
// Purely presentational: every value is computed in the data context and passed down.
import { useMemo } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtTimeTick, niceTimeTicks, powerStep, steppedScale } from './chartUtils';
import { CHART, axisProps, gridProps } from './kit/chartConfig';
import { ChartCard } from './kit/ui';
import type { HealthPt, Pt, Status } from './data/types';

function ChartTooltip({ active, payload, label, unit }:
  { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: number; unit: string }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--card)', borderColor: 'var(--card-border)', color: 'var(--tx)' }}
    >
      <div className="mb-1 font-medium" style={{ color: 'var(--tx-3)' }}>
        {new Date(label).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
      </div>
      {payload.map((p) => (
        <div className="flex items-center gap-1.5" key={p.name}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
          {p.name}: <b className="tabular-nums">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}{unit}</b>
        </div>
      ))}
    </div>
  );
}

function LegendKey({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--tx-2)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      {children}
    </span>
  );
}

// ---- Overview: battery charge, power flow, temperature --------------------------------

export function OverviewCharts({ chartPts, band, mode }: { chartPts: Pt[]; band: { low: number; high: number }; mode: string }) {
  const spanMs = useMemo(() => (chartPts.length > 1 ? chartPts[chartPts.length - 1].t - chartPts[0].t : 3600e3), [chartPts]);
  const timeTicks = useMemo(() => (chartPts.length > 1 ? niceTimeTicks(chartPts[0].t, chartPts[chartPts.length - 1].t) : []), [chartPts]);
  const tempScale = useMemo(() => steppedScale(chartPts.map((p) => p.temp ?? NaN), 0.5), [chartPts]);
  const powScale = useMemo(() => steppedScale(chartPts.map((p) => p.w), powerStep(chartPts.map((p) => p.w)), { includeZero: true }), [chartPts]);
  const powerOffset = useMemo(() => {
    const [lo, hi] = powScale.domain;
    return hi === lo ? 0.5 : hi / (hi - lo);
  }, [powScale]);

  const xAxis = (
    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={timeTicks}
      tickFormatter={(t: number) => fmtTimeTick(t, spanMs)} {...axisProps} />
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Battery charge" subtitle={`percent; shaded band = ${band.low}-${band.high}% (${mode})`}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="pctFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.green} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART.green} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} />
            <Tooltip content={<ChartTooltip unit="%" />} />
            <ReferenceArea y1={band.low} y2={band.high} fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="none" />
            <ReferenceLine y={band.low} stroke="var(--tx-3)" strokeDasharray="4 4" />
            <ReferenceLine y={band.high} stroke="var(--tx-3)" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="pct" name="charge" stroke={CHART.green} strokeWidth={2} fill="url(#pctFill)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Power flow" subtitle="watts: positive = charging, negative = discharging">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartPts} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="wStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset={powerOffset} stopColor="var(--st-success)" />
                <stop offset={powerOffset} stopColor="var(--st-error)" />
              </linearGradient>
              <linearGradient id="wFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset={powerOffset} stopColor="var(--st-success)" stopOpacity={0.22} />
                <stop offset={powerOffset} stopColor="var(--st-error)" stopOpacity={0.22} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis domain={powScale.domain} ticks={powScale.ticks} tickFormatter={(v: number) => `${v}`} {...axisProps} />
            <Tooltip content={<ChartTooltip unit=" W" />} />
            <ReferenceLine y={0} stroke="var(--tx-3)" />
            <Area type="monotone" dataKey="w" name="power" baseValue={0} stroke="url(#wStroke)" strokeWidth={2} fill="url(#wFill)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Temperature" subtitle="battery pack, degrees C">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis domain={tempScale.domain} ticks={tempScale.ticks} tickFormatter={(v: number) => v.toFixed(1)} {...axisProps} />
            <Tooltip content={<ChartTooltip unit=" °C" />} />
            <Line type="monotone" dataKey="temp" name="temp" stroke={CHART.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ---- Health: health per cycle + cycle odometer -----------------------------------------

export function HealthCharts({ healthPts, status }: { healthPts: HealthPt[]; status: Status | null }) {
  const lastHealth = healthPts.at(-1);
  const healthSpan = healthPts.length > 1 ? healthPts[healthPts.length - 1].t - healthPts[0].t : 3600e3;
  const healthTicks = useMemo(() => (healthPts.length > 1 ? niceTimeTicks(healthPts[0].t, healthPts[healthPts.length - 1].t) : []), [healthPts]);
  const healthScale = useMemo(() => steppedScale(
    healthPts.flatMap((h) => [h.raw, h.nominal, h.apple]).filter((v): v is number => v != null).concat([80]),
    2, { clampMin: 70, clampMax: 100 },
  ), [healthPts]);
  // Fit the axis to the plotted per-cycle data (the live odometer shows in the Cycles tile).
  const cycleScale = useMemo(() => steppedScale(healthPts.map((h) => h.cycle), 1), [healthPts]);

  const xAxis = (
    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} ticks={healthTicks}
      tickFormatter={(t: number) => fmtTimeTick(t, healthSpan)} {...axisProps} />
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Health per cycle"
        subtitle="percent of design capacity; AppleCare threshold at 80%"
        right={<span className="text-[11px] tabular-nums" style={{ color: 'var(--tx-3)' }}>{status?.designMah ?? '--'} mAh design</span>}
      >
        <div className="mb-2 flex flex-wrap gap-3">
          <LegendKey color={CHART.green}>gauge raw{lastHealth?.raw != null ? ` · ${lastHealth.raw}%` : ''}</LegendKey>
          <LegendKey color={CHART.blue}>gauge nominal{lastHealth?.nominal != null ? ` · ${lastHealth.nominal}%` : ''}</LegendKey>
          <LegendKey color={CHART.amber}>Apple smoothed{lastHealth?.apple != null ? ` · ${lastHealth.apple}%` : ''}</LegendKey>
        </div>
        {healthPts.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={healthPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              {xAxis}
              <YAxis domain={healthScale.domain} ticks={healthScale.ticks} {...axisProps} />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <ReferenceLine y={80} stroke="var(--st-error)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="raw" name="gauge raw" stroke={CHART.green} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="nominal" name="gauge nominal" stroke={CHART.blue} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="apple" name="Apple smoothed" stroke={CHART.amber} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs" style={{ color: 'var(--tx-3)' }}>No cycle snapshots yet. This chart fills in after the first completed band cycle.</p>
        )}
      </ChartCard>

      <ChartCard title="Battery cycle count" subtitle="the gauge's odometer; one cycle = 100% worth of discharge (a 10-90 pass adds 0.8)">
        {healthPts.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={healthPts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              {xAxis}
              <YAxis domain={cycleScale.domain} ticks={cycleScale.ticks} allowDecimals={false} {...axisProps} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <Line type="stepAfter" dataKey="cycle" name="cycle count" stroke={CHART.green} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs" style={{ color: 'var(--tx-3)' }}>No cycle snapshots yet. The odometer chart fills in after the first completed band cycle.</p>
        )}
      </ChartCard>
    </div>
  );
}
