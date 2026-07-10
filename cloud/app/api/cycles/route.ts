// GET /battcal/api/cycles - the full cycle-history doc (CycleRow[]) the Mac pushed.
import { NextResponse } from 'next/server';
import { docPayload, supabaseEnabled, T } from '@/lib/supabase';
import { requireOwner, unauthorized } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json([], { status: 200 });
  const doc = await docPayload(T.cycles);
  return NextResponse.json(doc?.payload ?? []);
}
