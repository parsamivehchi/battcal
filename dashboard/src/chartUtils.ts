// Axis helpers: round wall-clock time ticks and padded, duplicate-free Y domains.

const MIN = 60e3;
const TIME_STEPS = [15 * MIN, 30 * MIN, 60 * MIN, 180 * MIN, 360 * MIN, 720 * MIN, 1440 * MIN];

export function niceTimeTicks(min: number, max: number): number[] {
  if (!(max > min)) return [];
  const target = (max - min) / 5;
  const step = TIME_STEPS.find((s) => s >= target) ?? TIME_STEPS[TIME_STEPS.length - 1];
  // Snap to local wall-clock boundaries (steps divide 24h; align via timezone offset).
  const tz = new Date(min).getTimezoneOffset() * MIN;
  const first = Math.ceil((min - tz) / step) * step + tz;
  const ticks: number[] = [];
  for (let t = first; t <= max; t += step) ticks.push(t);
  return ticks;
}

export function fmtTimeTick(t: number, spanMs: number): string {
  const d = new Date(t);
  const midnight = d.getHours() === 0 && d.getMinutes() === 0;
  if (spanMs > 48 * 3600e3) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (midnight) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export interface Scale { domain: [number, number]; ticks: number[] }

// Domain padded outward to multiples of `step`, ticks at every step (deduped by construction).
export function steppedScale(values: number[], step: number, opts?: { clampMin?: number; clampMax?: number; includeZero?: boolean }): Scale {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { domain: [0, 1], ticks: [0, 1] };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (opts?.includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  let dLo = Math.floor(lo / step) * step;
  let dHi = Math.ceil(hi / step) * step;
  if (dLo === lo) dLo -= step;
  if (dHi === hi) dHi += step;
  if (opts?.clampMin !== undefined) dLo = Math.max(dLo, opts.clampMin);
  if (opts?.clampMax !== undefined) dHi = Math.min(dHi, opts.clampMax);
  const ticks: number[] = [];
  for (let v = dLo; v <= dHi + step / 1e6; v += step) ticks.push(+v.toFixed(6));
  return { domain: [dLo, dHi], ticks };
}

// Pick a tick step so a power axis lands on clean 5/10/20/50 W lines.
export function powerStep(values: number[]): number {
  const m = Math.max(1, ...values.filter(Number.isFinite).map(Math.abs));
  if (m <= 12) return 5;
  if (m <= 30) return 10;
  if (m <= 60) return 20;
  return 50;
}
