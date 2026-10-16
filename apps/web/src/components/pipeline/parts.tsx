import {
  QUOTE_LIST_COLUMNS,
  QUOTE_LIST_DEFAULT_COLUMNS,
  type QuoteListColumnKey,
} from '@ccq/contracts';
import { isCommercialKey } from '@ccq/domain';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Columns3Icon, DownloadIcon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, downloadBlob, isApiError } from '@/lib/api';
import { clearPipelineFilters, pipelineApiQuery, type PipelineSearch } from '@/lib/pipeline-search';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const count = new Intl.NumberFormat('en-US');

export const formatUsd = (n: number | null | undefined) => (n == null ? '–' : usd.format(n));
export const formatUsdCompact = (n: number) => usdCompact.format(n);
export const formatCount = (n: number | null | undefined) => (n == null ? '–' : count.format(n));
export const formatDays = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export type PipelineView = 'list' | 'priority' | 'board';

/** List / Prioritization / Board: one set of filters, three views (the filters carry over). */
export function PipelineViewTabs({
  current,
  search,
}: {
  current: PipelineView;
  search: PipelineSearch;
}) {
  // Sort and paging belong to a view; the filters and the search text travel.
  const { sort: _s, dir: _d, page: _p, ...filters } = search;
  const tab = (active: boolean) =>
    cn(
      'inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium sm:min-h-10',
      active
        ? 'border-primary text-foreground'
        : 'text-foreground-2 hover:text-foreground border-transparent',
    );
  return (
    <nav aria-label="Pipeline views" className="flex gap-1 overflow-x-auto border-b">
      <Link
        to="/quotes"
        search={filters}
        className={tab(current === 'list')}
        aria-current={current === 'list' ? 'page' : undefined}
      >
        List
      </Link>
      <Link
        to="/quotes"
        search={{ ...filters, view: 'priority' }}
        className={tab(current === 'priority')}
        aria-current={current === 'priority' ? 'page' : undefined}
      >
        Prioritization
      </Link>
      <Link
        to="/board"
        search={filters}
        className={tab(current === 'board')}
        aria-current={current === 'board' ? 'page' : undefined}
      >
        Board
      </Link>
    </nav>
  );
}

/** CSV of the current filters and visible columns. The server drops commercial columns and audits it. */
export function ExportButton({
  search,
  columns,
}: {
  search: PipelineSearch;
  columns: readonly string[];
}) {
  const exportCsv = useMutation({
    mutationFn: () =>
      api.quotesExport(
        pipelineApiQuery({ ...search, page: undefined }, { columns: columns.join(',') }),
      ),
    onSuccess: (blob) => {
      downloadBlob(blob, `ccq-quotes-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success({
        title: 'Export ready',
        description: 'The download is recorded in the audit log.',
      });
    },
    onError: (err) =>
      toast.error({
        title: isApiError(err, 422) ? 'Too many quotes to export' : 'Export failed',
        description: isApiError(err) ? (err.problem.detail ?? err.problem.title) : 'Try again.',
      }),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => exportCsv.mutate()}
      disabled={exportCsv.isPending}
      data-testid="export-csv"
    >
      <DownloadIcon aria-hidden="true" />
      {exportCsv.isPending ? 'Exporting…' : 'Export CSV'}
    </Button>
  );
}

/** The list's column chooser. Commercial columns are offered only to roles that see them. */
export function ColumnChooser({
  value,
  onChange,
  commercialVisible,
}: {
  value: QuoteListColumnKey[];
  onChange: (next: QuoteListColumnKey[]) => void;
  commercialVisible: boolean;
}) {
  const baseId = useId();
  const keys = (Object.keys(QUOTE_LIST_COLUMNS) as QuoteListColumnKey[]).filter(
    (k) => commercialVisible || !isCommercialKey(k, []),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="column-chooser">
          <Columns3Icon aria-hidden="true" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="grid max-h-[70dvh] w-64 gap-1 overflow-y-auto" align="end">
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm font-semibold">Show columns</legend>
          {keys.map((k) => {
            const id = `${baseId}-${k}`;
            const checked = value.includes(k);
            return (
              <label
                key={k}
                htmlFor={id}
                className="hover:bg-accent flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm sm:min-h-9"
              >
                <input
                  id={id}
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={checked}
                  disabled={k === 'quoteNumber'}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? keys.filter((c) => c === k || value.includes(c))
                        : value.filter((c) => c !== k),
                    )
                  }
                />
                {QUOTE_LIST_COLUMNS[k]}
              </label>
            );
          })}
        </fieldset>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 justify-start"
          onClick={() => onChange(QUOTE_LIST_DEFAULT_COLUMNS)}
        >
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** "No quotes match" with a way out. */
export function NoMatches({
  search,
  onChange,
}: {
  search: PipelineSearch;
  onChange: (next: PipelineSearch) => void;
}) {
  return (
    <div className="bg-card rounded-card grid justify-items-start gap-2 border p-6 text-sm">
      <p className="font-semibold">No quotes match</p>
      <p className="text-muted-foreground">Clear a filter or the search to see more.</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange({ ...clearPipelineFilters(search), q: undefined })}
      >
        Clear filters and search
      </Button>
    </div>
  );
}
