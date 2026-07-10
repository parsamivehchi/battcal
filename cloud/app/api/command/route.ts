// /battcal/api/command - the mirror's ONLY write surface. POST enqueues a whitelisted
// intent row into battcal_commands; the Mac's server.mjs polls, re-validates against its
// own whitelist, executes locally, and settles the row (done/rejected/expired). GET returns
// the recent rows so the UI can show pending -> acknowledged state. Both are owner-gated on
// top of the platform's SSO proxy, same two-layer posture as the read routes.
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseEnabled, T } from '@/lib/supabase';
import { requireOwner, unauthorized } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODES = ['longevity', 'calibration'] as const;

// Server-side whitelist; the Mac validates again and is the authority. Returns the
// normalized {command, arg} to insert, or null when the request is not a valid intent.
function normalize(body: unknown): { command: string; arg: string | null } | null {
  if (typeof body !== 'object' || body === null) return null;
  const command = String((body as Record<string, unknown>).command ?? '');
  const rawArg = (body as Record<string, unknown>).arg;
  if (command === 'pause' || command === 'resume') return { command, arg: null };
  if (command === 'mode') {
    const m = String(rawArg ?? '');
    return (MODES as readonly string[]).includes(m) ? { command, arg: m } : null;
  }
  if (command === 'break') {
    const n = Math.round(Number(rawArg));
    return Number.isFinite(n) && n >= 1 && n <= 240 ? { command, arg: String(n) } : null;
  }
  return null;
}

export async function POST(request: Request) {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const cmd = normalize(body);
  if (!cmd) return NextResponse.json({ error: 'invalid command' }, { status: 400 });
  const { data, error } = await supabaseAdmin().from(T.commands).insert(cmd).select('id,created_at,command,arg,status').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  const { data, error } = await supabaseAdmin()
    .from(T.commands)
    .select('id,created_at,command,arg,status,executed_at,result')
    .order('id', { ascending: false })
    .limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
