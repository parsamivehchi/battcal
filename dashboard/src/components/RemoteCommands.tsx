// Remote command queue card - the cloud mirror's ONLY interactive surface. Renders solely
// when the injected source exposes `queue` (cloudDataSource); the local mount and any source
// without it never show this. Buttons enqueue whitelisted intents; the Mac polls, validates,
// executes, and settles each row, and the list below shows that acknowledgement honestly
// (pending -> done/rejected/expired). This is fire-and-acknowledge, not direct control.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coffee, Gauge, Pause, Play, RotateCcw } from 'lucide-react';
import { useData } from '../data/data-context';
import type { CommandRow } from '../data/data-source';
import { ChartCard } from '../kit/ui';

const STATUS_TONE: Record<CommandRow['status'], string> = {
  pending: 'var(--st-info)',
  done: 'var(--st-success)',
  rejected: 'var(--st-warning)',
  expired: 'var(--tx-3)',
};

const label = (r: CommandRow) =>
  r.command === 'mode' ? `mode ${r.arg}` : r.command === 'break' ? `break ${r.arg}m` : r.command;

export function RemoteCommands() {
  const { source, refreshStatus } = useData();
  const queue = source.queue;
  const [rows, setRows] = useState<CommandRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!queue) return;
    try { setRows(await queue.list()); setErr(null); } catch (e) { setErr(String(e)); }
  }, [queue]);

  const hasPending = useMemo(() => rows.some((r) => r.status === 'pending'), [rows]);

  // Poll fast while a command is in flight (the Mac settles within one 30 s tick),
  // lazily otherwise. A settled command also refreshes status so the header/state
  // chips reflect the effect without waiting for the regular 15 s poll.
  useEffect(() => {
    if (!queue) return;
    refresh();
    const id = setInterval(refresh, hasPending ? 5000 : 30000);
    return () => clearInterval(id);
  }, [queue, refresh, hasPending]);
  useEffect(() => {
    if (!hasPending && rows.length) refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on settle only
  }, [hasPending]);

  if (!queue) return null;

  const send = async (command: 'pause' | 'resume' | 'mode' | 'break', arg?: string | number) => {
    setBusy(true);
    try { await queue.enqueue(command, arg); setErr(null); await refresh(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  const btn = (text: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        borderColor: 'var(--card-border)',
        background: 'var(--card)',
        color: 'var(--tx)',
        opacity: busy ? 0.6 : 1,
        cursor: busy ? 'default' : 'pointer',
      }}
    >
      {icon} {text}
    </button>
  );

  return (
    <ChartCard
      title="Remote commands"
      subtitle="queued to the Mac, which validates and executes within ~30 s; this list shows its acknowledgement"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {btn('Pause', <Pause size={13} />, () => send('pause'))}
          {btn('Resume', <Play size={13} />, () => send('resume'))}
          {btn('Longevity', <RotateCcw size={13} />, () => send('mode', 'longevity'))}
          {btn('Calibration', <Gauge size={13} />, () => send('mode', 'calibration'))}
          {btn('Break 30m', <Coffee size={13} />, () => send('break', 30))}
        </div>
        {err && (
          <p className="text-xs" role="alert" style={{ color: 'var(--st-warning)' }}>{err}</p>
        )}
        {rows.length > 0 && (
          <ul className="space-y-1">
            {rows.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs tabular-nums" style={{ color: 'var(--tx-2)' }}>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    background: `color-mix(in srgb, ${STATUS_TONE[r.status]} 14%, transparent)`,
                    color: STATUS_TONE[r.status],
                  }}
                >
                  {r.status}
                </span>
                <span style={{ color: 'var(--tx)' }}>{label(r)}</span>
                <span style={{ color: 'var(--tx-3)' }}>
                  {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {r.result && r.status !== 'pending' ? ` · ${r.result}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ChartCard>
  );
}
