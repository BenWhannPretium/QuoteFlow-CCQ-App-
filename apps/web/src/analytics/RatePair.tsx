import type { MetricInfo, OutcomeRates } from '@ccq/contracts';
import { TriangleAlertIcon } from 'lucide-react';

import { Stat, fmtCount, fmtPct } from '@/components/charts';

/**
 * Win rate and outcome capture rate, always side by side (S-06/S-07). A win rate on few recorded
 * outcomes misleads, so when capture is low the pair says so in words next to the number.
 */
export function RatePair({
  rates,
  info,
  captureInfo,
  lowCaptureBelow,
  testId = 'rate-pair',
}: {
  rates: OutcomeRates;
  info: MetricInfo;
  captureInfo: MetricInfo;
  lowCaptureBelow: number;
  testId?: string;
}) {
  const decided = rates.awarded + rates.lost;
  return (
    <div className="grid gap-3" data-testid={testId}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          testId={`${testId}-win`}
          label="Win rate (decided quotes only)"
          value={fmtPct(rates.winRate)}
          hint={
            decided === 0
              ? 'No decided quotes yet: nothing awarded or lost.'
              : `${fmtCount(rates.awarded)} awarded of ${fmtCount(decided)} decided. By amount: ${fmtPct(rates.winRateByAmount)}.`
          }
          info={info}
          {...(rates.lowCapture ? { tone: 'alert' as const } : {})}
        />
        <Stat
          testId={`${testId}-capture`}
          label="Outcome capture rate"
          value={fmtPct(rates.captureRate)}
          hint={`${fmtCount(rates.recorded)} recorded, ${fmtCount(rates.goneDark)} gone dark, ${fmtCount(rates.awaiting)} still waiting.`}
          info={captureInfo}
          {...(rates.lowCapture ? { tone: 'alert' as const } : {})}
        />
      </div>
      {rates.lowCapture && (
        <p
          role="note"
          data-testid={`${testId}-warning`}
          className="bg-tier-high text-tier-high-foreground rounded-card flex items-start gap-2 p-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Only {fmtPct(rates.captureRate)} of proposals have an outcome recorded (below{' '}
            {fmtPct(lowCaptureBelow)}). Read the win rate with care: the missing outcomes could move
            it a long way either way.
          </span>
        </p>
      )}
    </div>
  );
}
