import type { ErfLinkageRow } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { LinkIcon } from 'lucide-react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { StageBadge } from '@/components/StageBadge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/reports/erf-linkage')({ component: ErfLinkagePage });

const LINKAGE: Record<ErfLinkageRow['linkage'], { label: string; className: string }> = {
  match: { label: 'Match', className: 'bg-success/15 text-success' },
  mismatch: { label: 'Mismatch', className: 'bg-destructive text-destructive-foreground' },
  sf_only: { label: 'SF only', className: 'bg-warning text-warning-foreground' },
  ccq_only: { label: 'CCQ only', className: 'bg-warning text-warning-foreground' },
  both_missing: { label: 'Neither', className: 'bg-muted text-muted-foreground' },
};

const col = createColumnHelper<ErfLinkageRow>();
const columns = [
  col.accessor('quoteNumber', {
    header: 'Quote',
    meta: { primary: true },
    cell: (c) => (
      <Link
        to="/quotes/$quoteNumber"
        params={{ quoteNumber: c.getValue() }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {c.getValue()}
      </Link>
    ),
  }),
  col.accessor('stageKey', {
    header: 'CCQ stage',
    cell: (c) => <StageBadge stageKey={c.getValue()} />,
  }),
  col.accessor('sfOpportunityName', {
    header: 'SF opportunity',
    cell: (c) => c.getValue() ?? c.row.original.sfOpportunityId,
  }),
  col.accessor('sfStage', { header: 'SF stage', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('sfErfNumber', { header: 'SF ERF #', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('ccqErfNumber', { header: 'CCQ ERF #', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('linkage', {
    header: 'Linkage',
    cell: (c) => (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-semibold',
          LINKAGE[c.getValue()].className,
        )}
      >
        {LINKAGE[c.getValue()].label}
      </span>
    ),
  }),
  col.accessor('sfStatusFlag', {
    header: 'SF status',
    cell: (c) => c.getValue()?.replace('_', ' ') ?? '—',
  }),
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className="font-display mt-1 text-2xl tabular-nums">{value}</dd>
      {hint && <dd className="text-muted-foreground text-xs">{hint}</dd>}
    </div>
  );
}

/**
 * ERF linkage (B-06): for each CCQ quote, the SF ERF number next to the CCQ one. Supports the PRD
 * success measure "% of SF opportunities linked to an ERF number". SF's ERF field is used
 * inconsistently, so numbers are compared ignoring case, spacing and an "ERF" prefix.
 */
function ErfLinkagePage() {
  useDocumentTitle('ERF linkage');
  const report = useQuery({
    queryKey: ['admin', 'reports', 'erf-linkage'],
    queryFn: api.erfLinkage,
  });
  const s = report.data?.summary;

  return (
    <div data-testid="page" data-page-title="ERF linkage">
      <PageHeader
        eyebrow="Reports"
        title="ERF linkage"
        description="CCQ quotes with their Salesforce opportunity's ERF number and the CCQ ERF number. Operational; not D&A-certified."
      />
      {report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <>
          {s && (
            <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="SF linked to an ERF"
                value={`${Math.round(s.sfLinkedPct * 100)}%`}
                hint={`${s.sfLinked} of ${s.quotes} quotes`}
              />
              <Stat label="Quotes" value={String(s.quotes)} />
              <Stat label="CCQ ERF # recorded" value={String(s.ccqLinked)} />
              <Stat label="Mismatches" value={String(s.mismatches)} />
            </dl>
          )}
          <DataTable
            caption="ERF linkage by quote"
            columns={columns}
            data={report.data?.items ?? []}
            getRowId={(r) => r.quoteNumber}
            isLoading={report.isLoading}
            empty={
              <EmptyState
                icon={LinkIcon}
                title="No quotes yet"
                description="Quotes appear here once intake creates them."
              />
            }
          />
        </>
      )}
    </div>
  );
}
