import type { OutcomesReport } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonCard } from '@/components/Skeletons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/reports/outcomes')({ component: OutcomesPage });

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 1000) / 10}%`);

/**
 * The outcomes report (B-13): how quotes close, by outcome and reason, the win rate (awarded ÷
 * awarded + lost: expired is excluded, "silence is not a loss") and the outcome capture rate.
 * Read by analytics roles; the API checks analytics.read.
 */
function OutcomesPage() {
  useDocumentTitle('Outcomes report');
  const report = useQuery({ queryKey: ['outcomes-report'], queryFn: () => api.outcomesReport() });
  return (
    <div className="grid gap-6" data-testid="outcomes-report">
      <PageHeader
        className="mb-0"
        title="Outcomes"
        eyebrow="Reports"
        description="Every closed quote has an outcome, a reason, an owner and a date. Expired is counted apart from Lost. Operational; not D&A-certified."
      />
      {report.isPending ? (
        <SkeletonCard />
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <ReportBody r={report.data} />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card rounded-card grid gap-1 border p-4">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

function ReportBody({ r }: { r: OutcomesReport }) {
  return (
    <>
      {r.taxonomyProvisional && (
        <p role="note" className="bg-warning text-warning-foreground rounded-card p-3 text-sm">
          The outcome taxonomy and reason codes are provisional until D-15 is approved.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="outcome-stats">
        <Stat
          label="Outcome capture rate"
          value={pct(r.capture.rate)}
          hint={`${r.capture.recorded} recorded, ${r.capture.goneDark} gone dark`}
        />
        <Stat
          label="Win rate"
          value={pct(r.customer.winRate)}
          hint={`${r.customer.awarded} awarded, ${r.customer.lost} lost (expired excluded)`}
        />
        <Stat label="Expired (no response)" value={String(r.customer.expired)} />
        <Stat
          label="Awaiting the customer"
          value={String(r.capture.awaiting)}
          hint="Within validity"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">By outcome and reason</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm" data-testid="outcome-table">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 font-medium">Outcome</th>
                <th className="py-2 font-medium">Reason</th>
                <th className="py-2 text-right font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {r.outcomes.map((o) => (
                <OutcomeRows key={o.outcome} outcome={o} />
              ))}
            </tbody>
          </table>
          {r.incompleteClosures > 0 && (
            <p className="text-destructive mt-3 text-sm" role="alert">
              {r.incompleteClosures} closed quote(s) are missing a closure field (legacy rows).
            </p>
          )}
          <p className="text-muted-foreground mt-3 text-xs">
            Generated {absoluteTime(r.generatedAt)}.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function OutcomeRows({ outcome: o }: { outcome: OutcomesReport['outcomes'][number] }) {
  const reasons = o.reasons.length > 0 ? o.reasons : [{ code: null, label: '–', count: 0 }];
  return (
    <>
      {reasons.map((reason, i) => (
        <tr
          key={`${o.outcome}-${reason.code ?? 'none'}`}
          className="border-t"
          data-outcome={o.outcome}
        >
          {i === 0 && (
            <th
              scope="rowgroup"
              rowSpan={reasons.length}
              className="py-2 pr-4 text-left align-top font-medium"
            >
              {o.label}{' '}
              <span className="text-muted-foreground text-xs font-normal">
                ({o.kind === 'customer' ? 'customer' : 'internal'}, {o.count})
              </span>
            </th>
          )}
          <td className="py-2 pr-4">{reason.label}</td>
          <td className="py-2 text-right tabular-nums">{reason.count}</td>
        </tr>
      ))}
    </>
  );
}
