// GET /battcal/api/log?lines=N - the recent engine-log tail (string[]) the Mac pushed.
import { NextResponse } from 'next/server';
import { docPayload, supabaseEnabled, T } from '@/lib/supabase';
import { requireOwner, unauthorized } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireOwner()).ok) return unauthorized();
  if (!supabaseEnabled) return NextResponse.json([], { status: 200 });
  const lines = Math.min(Math.max(Number(new URL(req.url).searchParams.get('lines')) || 120, 1), 5000);
  const doc = await docPayload(T.log);
  const all = Array.isArray(doc?.payload) ? (doc.payload as string[]) : [];
  return NextResponse.json(all.slice(-lines));
}
