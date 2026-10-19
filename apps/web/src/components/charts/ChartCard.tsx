import type { MetricInfo } from '@ccq/contracts';
import { BarChart3Icon, TableIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { InfoTip } from './InfoTip';

export interface TableColumn {
  key: string;
  label: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
}
export interface TableSpec {
  caption: string;
  columns: TableColumn[];
  rows: Record<string, ReactNode>[];
}

/** The accessible alternative to a chart: the same numbers, as a real table. */
export function DataTableView({ spec }: { spec: TableSpec }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={spec.caption}>
      <table className="w-full text-sm">
        <caption className="sr-only">{spec.caption}</caption>
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            {spec.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('py-2 pr-3 font-medium', c.numeric && 'text-right tabular-nums')}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {spec.columns.map((c, j) =>
                j === 0 ? (
                  <th key={c.key} scope="row" className="py-2 pr-3 text-left font-medium">
                    {row[c.key]}
                  </th>
                ) : (
                  <td
                    key={c.key}
                    className={cn('py-2 pr-3', c.numeric && 'text-right tabular-nums')}
                  >
                    {row[c.key]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Guidance shown when a window holds too little data for the chart to say anything. */
export function ThinData({ hint }: { hint?: string }) {
  return (
    <div
      className="rounded-card text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-1 border border-dashed px-4 py-6 text-center text-sm"
      data-testid="thin-data"
    >
      <p className="text-foreground font-medium">Not enough data in this window yet</p>
      <p className="max-w-sm">
        {hint ??
          'Widen the date range or clear a filter. Early in the pilot, charts fill in as quotes pass their gates.'}
      </p>
    </div>
  );
}

/**
 * One chart: a title, the info tooltip (definition and time window), the window stated in words, the
 * chart, and a toggle to the same numbers as a table. `empty` swaps the chart for guidance.
 */
export function ChartCard({
  title,
  info,
  summary,
  table,
  empty = false,
  emptyHint,
  note,
  children,
  className,
  testId,
}: {
  title: string;
  info: MetricInfo;
  /** One sentence for screen readers describing what the chart shows. */
  summary: string;
  table: TableSpec;
  empty?: boolean;
  emptyHint?: string;
  /** A caveat shown under the chart (thin samples, missing amounts). */
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  return (
    <Card
      className={cn('min-w-0', className)}
      data-testid={testId ?? 'chart-card'}
      data-chart-card=""
    >
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <div className="grid gap-0.5">
            <h3 id={headingId} className="text-base font-semibold">
              {title}
            </h3>
            <p className="text-muted-foreground text-xs font-normal" data-testid="chart-window">
              {info.window}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!empty && (
              <button
                type="button"
                aria-pressed={asTable}
                onClick={() => setAsTable((v) => !v)}
                className="text-foreground-2 hover:bg-accent focus-visible:ring-ring rounded-pill inline-flex min-h-8 items-center gap-1.5 border px-3 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                {asTable ? (
                  <BarChart3Icon className="size-3.5" aria-hidden="true" />
                ) : (
                  <TableIcon className="size-3.5" aria-hidden="true" />
                )}
                {asTable ? 'Chart' : 'Table'}
                <span className="sr-only"> view of {title}</span>
              </button>
            )}
            <InfoTip label={title} info={info} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {empty ? (
          <ThinData {...(emptyHint ? { hint: emptyHint } : {})} />
        ) : asTable ? (
          <DataTableView spec={table} />
        ) : (
          <div role="img" aria-labelledby={headingId} aria-description={summary}>
            {children}
          </div>
        )}
        {!empty && note && <p className="text-muted-foreground text-xs">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** A headline number with its definition. Missing data shows an en dash and says why in `hint`. */
export function Stat({
  label,
  value,
  hint,
  info,
  tone = 'default',
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  info?: MetricInfo;
  tone?: 'default' | 'alert';
  testId?: string;
}) {
  return (
    <div
      className="bg-card rounded-card grid min-w-0 content-start gap-1 border p-4"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        {info && <InfoTip label={label} info={info} />}
      </div>
      <span
        className={cn(
          'font-display text-3xl leading-none tabular-nums',
          tone === 'alert' && 'text-emphasis',
        )}
      >
        {value}
      </span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      {info && <span className="text-muted-foreground text-xs">{info.window}</span>}
    </div>
  );
}
