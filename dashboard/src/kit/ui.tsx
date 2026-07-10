// Shared UI primitives, vendored from the aecom.engineering charts package (via the
// netstats copy) and extended with the TimeOps KPI-tile grammar (icon chip + delta +
// optional progress bar). Every color is a theme token so all 5 themes work untouched.
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Card({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border ${pad ? 'p-4 sm:p-5' : ''} ${className}`}
      style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--tx)' }}>{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px]" style={{ color: 'var(--tx-3)' }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Section({
  id,
  title,
  subtitle,
  right,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--tx)' }}>{title}</h2>
          {subtitle && <p className="text-xs" style={{ color: 'var(--tx-3)' }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// TimeOps-grammar KPI tile: uppercase label + tinted icon chip, big tabular value,
// muted sub-line. `tint` colors the chip and (optionally) the value.
export function Kpi({
  label,
  value,
  unit,
  sub,
  icon: Icon,
  tint = 'var(--accent)',
  tintValue = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  icon?: LucideIcon;
  tint?: string;
  tintValue?: boolean;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tx-3)' }}>
          {label}
        </div>
        {Icon && (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            style={{ background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}
          >
            <Icon size={14} />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="tabular-nums text-2xl font-bold leading-none"
          style={{ color: tintValue ? tint : 'var(--tx)' }}
        >
          {value}
        </span>
        {unit && <span className="text-sm font-medium" style={{ color: 'var(--tx-2)' }}>{unit}</span>}
      </div>
      {sub && <div className="mt-1 truncate text-xs" style={{ color: 'var(--tx-3)' }}>{sub}</div>}
    </Card>
  );
}

// Card + title header for a chart body (the aecom ChartCard grammar).
export function ChartCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--tx)' }}>{title}</div>
          {subtitle && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--tx-3)' }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

export function Chip({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        borderColor: 'var(--card-border)',
        color: color ?? 'var(--tx-2)',
        background: 'color-mix(in srgb, var(--card) 88%, transparent)',
      }}
    >
      {children}
    </span>
  );
}

// Small segmented control (range picker, mode picker). Buttons only; caller owns state.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  label,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--card-border)', opacity: disabled ? 0.5 : 1 }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--card)',
              color: active ? 'var(--accent-dark)' : 'var(--tx-2)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card>
      <div className="py-6 text-center text-sm" style={{ color: 'var(--tx-3)' }}>{children}</div>
    </Card>
  );
}

// Skeleton block that reserves layout while data (or a lazy chunk) loads.
export function Skeleton({ height, className = '' }: { height: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height }} aria-hidden />;
}
