import { useData } from '../data/data-context';
import { eventTone } from '../lib/derive';
import { ChartCard, Empty, PageHeader } from '../kit/ui';

export function Activity() {
  const { log } = useData();

  return (
    <div className="animate-page-enter space-y-4">
      <PageHeader title="Activity" subtitle="engine phase transitions and controls, newest first" />
      <ChartCard title="Engine events" subtitle="from the engine log; refreshed every 60 s">
        {log.length ? (
          <div className="max-h-[70vh] overflow-y-auto scrollbar-slim font-mono text-[11.5px] leading-relaxed">
            {log.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
              <div key={i} style={{ color: eventTone(l) }}>{l}</div>
            ))}
          </div>
        ) : (
          <Empty>No events logged yet</Empty>
        )}
      </ChartCard>
    </div>
  );
}
