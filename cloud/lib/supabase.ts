// Server-only Supabase access. The battcal_* tables have RLS enabled with no policies, so they
// are reachable ONLY with the service-role key - which lives in a server env var and never
// reaches the browser. The platform (mivehchi.dev) gates all of /battcal behind prsa.me SSO, so
// by the time a request reaches these route handlers the caller is already the owner; the routes
// still call requireOwner() as the second layer.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.BATTCAL_SUPABASE_URL;
const key = process.env.BATTCAL_SUPABASE_SERVICE_KEY;

export const supabaseEnabled = Boolean(url && key);

let client: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!url || !key) throw new Error('Supabase not configured (BATTCAL_SUPABASE_URL / BATTCAL_SUPABASE_SERVICE_KEY)');
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Single-row jsonb docs (id = 1): the Mac's uploader upserts, the routes serve payload verbatim.
export const T = {
  status: 'battcal_status',
  telemetry: 'battcal_telemetry',
  cycles: 'battcal_cycles',
  log: 'battcal_log',
  evidence: 'battcal_evidence',
  commands: 'battcal_commands',
} as const;

// Serve a single-row doc table's payload (or a fallback when unconfigured/empty).
export async function docPayload(table: string): Promise<{ payload: unknown; updatedAt: string | null } | null> {
  const { data, error } = await supabaseAdmin().from(table).select('payload,updated_at').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { payload: data.payload, updatedAt: data.updated_at as string };
}
