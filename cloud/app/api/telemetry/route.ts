// GET /battcal/api/telemetry?hours=N - engine telemetry rows in the window, mapped back to the
// exact TelemetryRow wire shape the SPA consumes (column names are the lowercase mirror).
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseEnabled, T } from '@/lib/supabase';
import { requireOwner, unauthorized } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 3000;

interface Row {
  ts: string; state: string | null; pct: number | null; charging: string | null;
  raw_current_mah: number | null; raw_max_mah: number | null; voltage_mv: number | null;
  amperage_ma: number | null; battery_w: number | null; adapter_w: number | null; temp_c: number | null;
}

export async function GET(req: Request) {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  const hours = Math.min(Math.max(Number(new URL(req.url).searchParams.get('hours')) || 24, 0), 2160);
  let q = supabaseAdmin().from(T.telemetry).select('*').order('ts', { ascending: true }).limit(MAX_ROWS);
  if (hours > 0) q = q.gte('ts', new Date(Date.now() - hours * 3600e3).toISOString());
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Downsample like the local server does (<= ~1500 points is plenty for the charts).
  let rows = (data ?? []) as Row[];
  if (rows.length > 1500) {
    const step = Math.ceil(rows.length / 1500);
    rows = rows.filter((_, i) => i % step === 0);
  }
  return NextResponse.json(rows.map((r) => ({
    ts: r.ts,
    state: r.state ?? '',
    pct: r.pct ?? 0,
    charging: r.charging ?? '',
    raw_current_mAh: r.raw_current_mah ?? 0,
    raw_max_mAh: r.raw_max_mah ?? 0,
    voltage_mV: r.voltage_mv ?? 0,
    amperage_mA: r.amperage_ma ?? 0,
    battery_W: r.battery_w ?? 0,
    adapter_W: r.adapter_w ?? 0,
    temp_C: r.temp_c ?? 0,
  })));
}
