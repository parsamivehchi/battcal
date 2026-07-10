// GET /battcal/api/status - the latest status snapshot the Mac pushed, served verbatim
// (the SPA's Status shape). staleSeconds lets the UI say "last seen Xs ago" honestly.
import { NextResponse } from 'next/server';
import { docPayload, supabaseEnabled, T } from '@/lib/supabase';
import { requireOwner, unauthorized } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  const doc = await docPayload(T.status);
  if (!doc) return NextResponse.json({ error: 'no data yet' }, { status: 404 });
  return NextResponse.json(doc.payload);
}
