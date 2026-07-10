// Vendored from aecom.engineering/packages/charts/src/config.ts. Theme-aware chart
// config for Recharts. Series colors come two ways:
//   - CHART.* / SERIES_VARS: CSS-var strings for direct fill/stroke props (they resolve
//     against the --chart-* tokens in kit/theme.css, so charts recolor on theme switch).
//   - useChartColors(): the same tokens resolved to concrete hex via getComputedStyle,
//     for JS-computed fills (<Cell>, conditional up/down coloring) where a CSS var in
//     an SVG attribute is not reliable.
import { useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider';

// CSS-var references. Use directly in JSX: <Area stroke={CHART.green} fill={CHART.green} />
export const CHART = {
  green: 'var(--chart-1)',
  blue: 'var(--chart-2)',
  amber: 'var(--chart-3)',
  violet: 'var(--chart-4)',
  pink: 'var(--chart-5)',
  teal: 'var(--chart-6)',
} as const;

// Ordered categorical palette (CSS-var strings). seriesVar(i) wraps around.
export const SERIES_VARS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)',
] as const;

export const seriesVar = (i: number): string => SERIES_VARS[((i % 6) + 6) % 6];

// Hex fallbacks (mirror kit/theme.css :root). Used before getComputedStyle can resolve.
const FALLBACK: Record<string, string> = {
  '--chart-1': '#00AB61', '--chart-2': '#3b82f6', '--chart-3': '#f59e0b',
  '--chart-4': '#8b5cf6', '--chart-5': '#ec4899', '--chart-6': '#14b8a6',
  '--tx-3': '#64748b', '--card-border': '#e2e8f0', '--card': '#ffffff',
  '--st-error': '#dc2626', '--st-success': '#059669', '--st-warning': '#d97706',
  '--tx': '#0f172a', '--accent': '#30D158',
};

function readVar(name: string): string {
  if (typeof window === 'undefined') return FALLBACK[name] ?? '#000000';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || FALLBACK[name] || '#000000';
}

export interface ChartColors {
  green: string; blue: string; amber: string; violet: string; pink: string; teal: string;
  series: string[];
  axis: string; grid: string; card: string;
  error: string; success: string; warning: string; text: string; accent: string;
}

function resolveColors(): ChartColors {
  return {
    green: readVar('--chart-1'), blue: readVar('--chart-2'), amber: readVar('--chart-3'),
    violet: readVar('--chart-4'), pink: readVar('--chart-5'), teal: readVar('--chart-6'),
    series: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'].map(readVar),
    axis: readVar('--tx-3'), grid: readVar('--card-border'), card: readVar('--card'),
    error: readVar('--st-error'), success: readVar('--st-success'), warning: readVar('--st-warning'),
    text: readVar('--tx'), accent: readVar('--accent'),
  };
}

// Resolved hex colors that update when the theme changes. For JS-computed fills like
// <Cell fill={c.series[i]} /> or conditional positive/negative coloring.
export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  const [colors, setColors] = useState<ChartColors>(resolveColors);
  useEffect(() => { setColors(resolveColors()); }, [theme]);
  return colors;
}

// Shared presentational props (theme-aware via CSS vars). Spread onto Recharts elements:
//   <XAxis {...axisProps} />  <CartesianGrid {...gridProps} />  <Tooltip contentStyle={tooltipContentStyle} />
export const axisProps = {
  stroke: 'var(--tx-3)',
  tick: { fill: 'var(--tx-3)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = {
  stroke: 'var(--card-border)',
  strokeDasharray: '3 3',
  vertical: false,
} as const;

export const tooltipContentStyle = {
  background: 'var(--card)',
  border: '1px solid var(--card-border)',
  borderRadius: 8,
  color: 'var(--tx)',
  fontSize: 12,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
} as const;
