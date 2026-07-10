// GET /battcal/api/evidence - the AppleCare evidence report, computed ON the Mac (median drain,
// internal resistance, shutdown detection all need the raw CSVs) and pushed verbatim.
import { NextResponse } from 'next/server';
import { docPayload, supabaseEnabled, T } from '@/lib/supabase';
import { requireOwner, unauthorized } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  const doc = await docPayload(T.evidence);
  if (!doc) return NextResponse.json({ error: 'no data yet' }, { status: 404 });
  return NextResponse.json(doc.payload);
}
