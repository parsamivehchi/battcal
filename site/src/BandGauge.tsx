import { useEffect, useRef, useState } from 'react';

// The signature element: a live instrument gauge of the 10-90 band. A charge marker
// cycles drain -> charge -> repeat exactly like the engine does; the zones the battery
// never visits anymore (0-10, 90-100) are hatched out. Reduced motion pins it at 63%.
const LOW = 10;
const HIGH = 90;
const PERIOD_MS = 26000;

function pctAt(t: number): { pct: number; charging: boolean } {
  const phase = (t % PERIOD_MS) / PERIOD_MS; // 0..1, drain first half, charge second
  if (phase < 0.5) return { pct: HIGH - (HIGH - LOW) * (phase / 0.5), charging: false };
  return { pct: LOW + (HIGH - LOW) * ((phase - 0.5) / 0.5), charging: true };
}

export function BandGauge() {
  const [state, setState] = useState({ pct: 63, charging: false });
  const raf = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    const tick = (now: number) => {
      setState(pctAt(now - start + PERIOD_MS * 0.22)); // start mid-drain, moving
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const { pct, charging } = state;

  return (
    <figure aria-label={`Battery band gauge: charge cycles between ${LOW}% and ${HIGH}%`} className="w-full">
      <div className="flex items-baseline justify-between font-mono text-xs" style={{ color: 'var(--ink-3, #7c877f)' }}>
        <span>battcal-telemetry</span>
        <span aria-hidden="true">
          <span style={{ color: charging ? 'var(--amber, #d98f2b)' : 'var(--green, #179161)' }}>
            {charging ? 'charge' : 'drain'}
          </span>
          {' '}
          <span className="tabular-nums" style={{ color: 'var(--ink, #17201b)' }}>{pct.toFixed(1)}%</span>
        </span>
      </div>

      <div className="relative mt-2 h-16">
        {/* track */}
        <div className="absolute inset-x-0 top-5 h-6 overflow-hidden rounded-md border" style={{ borderColor: 'var(--line, #e2e6df)' }}>
          <div className="absolute inset-y-0 hatch" style={{ left: 0, width: `${LOW}%` }} />
          <div className="absolute inset-y-0 hatch" style={{ left: `${HIGH}%`, right: 0 }} />
          <div className="absolute inset-y-0" style={{ left: `${LOW}%`, width: `${HIGH - LOW}%`, background: 'var(--green-tint, #e5f3ec)' }} />
          {/* fill up to the marker */}
          <div
            className="absolute inset-y-0"
            style={{
              left: `${LOW}%`,
              width: `${Math.max(0, pct - LOW)}%`,
              background: `color-mix(in srgb, ${charging ? 'var(--amber, #d98f2b)' : 'var(--green, #179161)'} 38%, transparent)`,
            }}
          />
        </div>
        {/* marker */}
        <div className="absolute top-3.5 h-9 w-[3px] rounded-full" style={{ left: `calc(${pct}% - 1px)`, background: charging ? 'var(--amber, #d98f2b)' : 'var(--green-deep, #0d6b46)' }} />
        {/* ticks */}
        {[0, LOW, 25, 50, 75, HIGH, 100].map((t) => (
          <div key={t} className="absolute top-11 flex -translate-x-1/2 flex-col items-center" style={{ left: `${t}%` }}>
            <div className="h-2 w-px" style={{ background: 'var(--line, #e2e6df)' }} />
            <span className="mt-1 font-mono text-[10px] tabular-nums" style={{ color: t === LOW || t === HIGH ? 'var(--green, #179161)' : 'var(--ink-3, #7c877f)', fontWeight: t === LOW || t === HIGH ? 600 : 400 }}>
              {t}
            </span>
          </div>
        ))}
      </div>

      <figcaption className="mt-4 flex flex-wrap gap-2 font-mono text-[11px]" style={{ color: 'var(--ink-2, #48544d)' }}>
        <span className="rounded-full border px-2.5 py-1" style={{ borderColor: 'var(--line, #e2e6df)' }}>drain to {LOW}%</span>
        <span className="rounded-full border px-2.5 py-1" style={{ borderColor: 'var(--line, #e2e6df)' }}>charge to {HIGH}%</span>
        <span className="rounded-full border px-2.5 py-1" style={{ borderColor: 'var(--line, #e2e6df)' }}>repeat, plugged in the whole time</span>
        <span className="rounded-full border px-2.5 py-1" style={{ borderColor: 'color-mix(in srgb, var(--red, #c4463d) 40%, transparent)', color: 'var(--red, #c4463d)' }}>never parks at 100%</span>
      </figcaption>
    </figure>
  );
}
