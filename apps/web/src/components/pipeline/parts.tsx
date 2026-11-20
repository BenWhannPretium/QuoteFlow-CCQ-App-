import {
  QUOTE_LIST_COLUMNS,
  QUOTE_LIST_DEFAULT_COLUMNS,
  type QuoteListColumnKey,
} from '@ccq/contracts';
import { isCommercialKey } from '@ccq/domain';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDownIcon, ArrowUpIcon, Columns3Icon, DownloadIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, downloadBlob, isApiError } from '@/lib/api';
import { moveColumn, toggleColumn } from '@/lib/pipeline-columns';
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
        ? 'border-action text-foreground'
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
  // FB-19 (W13-32): one row per quote by default; ticked, one row per item with the item's columns.
  const [perItem, setPerItem] = useState(false);
  const perItemId = useId();
  const exportCsv = useMutation({
    mutationFn: () =>
      api.quotesExport(
        pipelineApiQuery(
          { ...search, page: undefined },
          { columns: columns.join(','), ...(perItem ? { perItem: 'true' } : {}) },
        ),
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
    <div className="flex flex-wrap items-center gap-2">
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
      <label htmlFor={perItemId} className="flex min-h-11 items-center gap-1.5 text-xs sm:min-h-0">
        <input
          id={perItemId}
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={perItem}
          onChange={(e) => setPerItem(e.target.checked)}
          data-testid="export-per-item"
        />
        One row per item
      </label>
    </div>
  );
}

/**
 * The list's column chooser. Commercial columns are offered only to roles that see them. FB-27
 * (N17-17): the shown columns are an ordered list with Move up / Move down (buttons, so the keyboard
 * and a screen reader can reorder), then the columns not shown. A newly ticked column joins the end.
 */
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
  const [status, setStatus] = useState('');
  const offered = (Object.keys(QUOTE_LIST_COLUMNS) as QuoteListColumnKey[]).filter(
    (k) => commercialVisible || !isCommercialKey(k, []),
  );
  const shown = value.filter((k) => offered.includes(k));
  const hidden = offered.filter((k) => !shown.includes(k));
  const move = (k: QuoteListColumnKey, delta: -1 | 1) => {
    const next = moveColumn(shown, k, delta);
    onChange(next);
    setStatus(`${QUOTE_LIST_COLUMNS[k]} is now column ${next.indexOf(k) + 1} of ${next.length}.`);
  };
  const tick = (k: QuoteListColumnKey, on: boolean) => onChange(toggleColumn(shown, k, on));
  const row = 'hover:bg-accent flex min-h-11 items-center gap-1 rounded-md px-2 text-sm sm:min-h-9';
  const checkbox = (k: QuoteListColumnKey, checked: boolean) => (
    <label
      htmlFor={`${baseId}-${k}`}
      className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 sm:min-h-9"
    >
      <input
        id={`${baseId}-${k}`}
        type="checkbox"
        className="size-4 cursor-pointer accent-[var(--primary)]"
        checked={checked}
        // The list always keeps one column: the quote number is the way into a quote.
        disabled={k === 'quoteNumber' || (checked && shown.length === 1)}
        onChange={(e) => tick(k, e.target.checked)}
      />
      {QUOTE_LIST_COLUMNS[k]}
    </label>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="column-chooser">
          <Columns3Icon aria-hidden="true" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="grid max-h-[min(70dvh,var(--radix-popover-content-available-height))] w-72 gap-1 overflow-y-auto overscroll-contain"
        align="end"
        aria-label="Columns"
      >
        <fieldset className="grid content-start gap-1">
          <legend className="mb-1 text-sm font-semibold">Shown, in order</legend>
          <ol className="grid gap-1" data-testid="columns-shown">
            {shown.map((k, i) => (
              <li key={k} className={row} data-testid={`column-row-${k}`}>
                {checkbox(k, true)}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 sm:size-8"
                  aria-label={`Move ${QUOTE_LIST_COLUMNS[k]} up`}
                  disabled={i === 0}
                  onClick={() => move(k, -1)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 sm:size-8"
                  aria-label={`Move ${QUOTE_LIST_COLUMNS[k]} down`}
                  disabled={i === shown.length - 1}
                  onClick={() => move(k, 1)}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
        </fieldset>
        {hidden.length > 0 && (
          <fieldset className="mt-2 grid gap-1">
            <legend className="mb-1 text-sm font-semibold">Not shown</legend>
            {hidden.map((k) => (
              <div key={k} className={row}>
                {checkbox(k, false)}
              </div>
            ))}
          </fieldset>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
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
