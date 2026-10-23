import type { UsageReportResponse } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonRows } from '@/components/Skeletons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/reports/usage')({ component: UsageReportPage });

const ROLE_LABEL: Record<string, string> = {
  KAM: 'KAM',
  SalesLeader: 'Sales leader',
  EngLead: 'Eng lead',
  Engineer: 'Engineer',
  Pricing: 'Pricing',
  PricingLead: 'Pricing lead',
  Approver: 'Approver',
  Leadership: 'Leadership',
  Admin: 'Admin',
  PostAward: 'Post-award',
};

type Range = { from?: string | undefined; to?: string | undefined };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className="font-display mt-1 text-2xl tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}

/** Days × roles, newest day first, from the report's flat rows. */
function pivot(report: UsageReportResponse) {
  const roles = [...new Set(report.dailyActiveUsers.map((r) => r.role))].sort(
    (a, b) => Object.keys(ROLE_LABEL).indexOf(a) - Object.keys(ROLE_LABEL).indexOf(b),
  );
  const days = [
    ...new Set([
      ...report.dailyActiveUsers.map((r) => r.day),
      ...report.quotesViewed.map((r) => r.day),
    ]),
  ].sort((a, b) => b.localeCompare(a));
  const users = new Map(report.dailyActiveUsers.map((r) => [`${r.day}|${r.role}`, r.users]));
  const viewed = new Map(report.quotesViewed.map((r) => [r.day, r]));
  return { roles, days, users, viewed };
}

/**
 * Adoption (PRD 8.2), measured from the usage audit log: daily active users by role, quotes viewed
 * and actions by type. Operational; not D&A-certified.
 */
function UsageReportPage() {
  useDocumentTitle('Usage report');
  const ids = { from: useId(), to: useId() };
  const [draft, setDraft] = useState<Range>({});
  const [range, setRange] = useState<Range>({});
  const report = useQuery({
    queryKey: ['admin', 'reports', 'usage', range],
    queryFn: () => api.usageReport(range),
  });
  const r = report.data;
  const table = r ? pivot(r) : null;

  return (
    <div data-testid="page" data-page-title="Usage report">
      <PageHeader
        eyebrow="Reports"
        title="Usage report"
        description="Adoption measured from the audit log: who uses QuoteFlow, how often and for what. Operational; not D&A-certified."
        actions={
          <Link to="/admin/audit" className={buttonVariants({ variant: 'outline' })}>
            Audit log
          </Link>
        }
      />
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        aria-label="Report range"
        onSubmit={(e) => {
          e.preventDefault();
          setRange(draft);
        }}
      >
        <div className="grid gap-1">
          <label htmlFor={ids.from} className="text-xs font-medium">
            From
          </label>
          <Input
            id={ids.from}
            type="date"
            value={draft.from ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.to} className="text-xs font-medium">
            To
          </label>
          <Input
            id={ids.to}
            type="date"
            value={draft.to ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
          />
        </div>
        <Button type="submit" variant="primary">
          Show
        </Button>
        {r && (
          <p className="text-muted-foreground text-sm">
            {r.from} to {r.to} ({r.timeZone.replace('_', ' ')})
          </p>
        )}
      </form>

      {report.isPending && <SkeletonRows rows={5} />}
      {report.isError && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {r && table && (
        <div className="grid gap-8">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Active users" value={r.totals.activeUsers} />
            <Stat label="Quotes viewed" value={r.totals.quotesViewed} />
            <Stat label="Quote views" value={r.totals.views} />
            <Stat label="Audited actions" value={r.totals.events} />
          </dl>

          <section className="grid gap-2" aria-labelledby="dau-heading">
            <h2 id="dau-heading" className="text-base font-semibold">
              Daily active users by role
            </h2>
            {table.days.length === 0 ? (
              <p className="text-muted-foreground text-sm">No activity in this range.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm" data-testid="usage-dau">
                  <thead className="bg-muted text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Day
                      </th>
                      {table.roles.map((role) => (
                        <th key={role} scope="col" className="px-3 py-2 text-right font-medium">
                          {ROLE_LABEL[role] ?? role}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Quotes viewed
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Views
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.days.map((day) => (
                      <tr key={day} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-normal tabular-nums">
                          {day}
                        </th>
                        {table.roles.map((role) => (
                          <td key={role} className="px-3 py-2 text-right tabular-nums">
                            {table.users.get(`${day}|${role}`) ?? 0}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums">
                          {table.viewed.get(day)?.quotes ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {table.viewed.get(day)?.views ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-2" aria-labelledby="actions-heading">
            <h2 id="actions-heading" className="text-base font-semibold">
              Actions by type
            </h2>
            <ul className="grid gap-1.5 sm:max-w-md" data-testid="usage-actions">
              {r.actionsByType.map((a) => {
                const max = r.actionsByType[0]?.count ?? 1;
                return (
                  <li
                    key={a.action}
                    className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm"
                  >
                    <span>{a.action.replace(/_/g, ' ')}</span>
                    <span className="bg-muted h-2 rounded-full" aria-hidden="true">
                      <span
                        className="bg-primary block h-2 rounded-full"
                        style={{ width: `${Math.max(2, (a.count / max) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{a.count.toLocaleString()}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
