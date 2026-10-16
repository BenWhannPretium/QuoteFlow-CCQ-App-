import type { PipelineFilterOptions, QuoteSortKey } from '@ccq/contracts';
import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon, SearchIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { FiltersPopover, type FilterGroup } from '@/components/FiltersPopover';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import {
  activePipelineFilterCount,
  clearPipelineFilters,
  filterValueFromSearch,
  searchWithFilterValue,
  sortDirFor,
  type PipelineSearch,
} from '@/lib/pipeline-search';

import { SavedViewsMenu } from './SavedViewsMenu';

export const SORT_LABELS: Record<QuoteSortKey, string> = {
  score: 'Score',
  tier: 'Tier',
  age: 'Time in stage',
  closeDate: 'Close date',
  amount: 'Amount',
  updated: 'Last updated',
};

/**
 * PRD F-07's compact filter pattern, shared by the quote list, the prioritization view and the board:
 * a search box, one "Filters" popover (options from config value lists and the people in scope) and an
 * inline sort. Every change goes to the URL (`onChange`), so the view is a shareable link.
 */
export function PipelineToolbar({
  search,
  onChange,
  people,
  sortKeys,
  defaultSort,
  savedViewsKey,
  children,
}: {
  search: PipelineSearch;
  onChange: (next: PipelineSearch) => void;
  people: PipelineFilterOptions | undefined;
  /** Sort choices; omit for a view with a fixed order (the board). */
  sortKeys?: readonly QuoteSortKey[];
  defaultSort?: QuoteSortKey;
  /** Saved views are kept per view ("quotes", "priority", "board"). */
  savedViewsKey: string;
  /** View-specific actions (columns, export). */
  children?: ReactNode;
}) {
  const { data: config } = usePublicConfig();
  const ids = { search: useId(), sort: useId(), aged: useId(), from: useId(), to: useId() };
  const [text, setText] = useState(search.q ?? '');
  const lastSent = useRef(search.q ?? '');

  // The URL is the source of truth: follow it when it changes from elsewhere (back button, saved view).
  useEffect(() => {
    if ((search.q ?? '') !== lastSent.current) {
      lastSent.current = search.q ?? '';
      setText(search.q ?? '');
    }
  }, [search.q]);
  // Debounced: one URL change (and one request) per pause in typing.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === (search.q ?? '')) return;
    const t = setTimeout(() => {
      lastSent.current = trimmed;
      onChange({ ...search, q: trimmed || undefined, page: undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [text, search, onChange]);

  const lists = config?.valueLists ?? {};
  const fromList = (key: string) =>
    (lists[key] ?? []).map((v) => ({ value: v.code, label: v.label }));
  const groups: FilterGroup[] = [
    {
      key: 'stage',
      label: 'Stage',
      options: (config?.stages ?? []).map((s) => ({ value: s.key, label: s.label })),
    },
    {
      key: 'status',
      label: 'Status (pick one)',
      options: [
        { value: 'open', label: 'Open (not closed)' },
        { value: 'active', label: 'Active' },
        { value: 'on_hold', label: 'On hold' },
        { value: 'closed', label: 'Closed' },
      ],
    },
    {
      key: 'tier',
      label: 'Tier',
      options: (config?.tiers ?? []).map((t) => ({ value: t.tier, label: t.label })),
    },
    {
      key: 'kam',
      label: 'KAM',
      options: [
        { value: 'me', label: 'Me' },
        ...(people?.kams ?? []).map((p) => ({ value: p.id, label: p.displayName })),
      ],
    },
    {
      key: 'engineer',
      label: 'Engineer',
      options: [
        { value: 'unassigned', label: 'Unassigned' },
        { value: 'me', label: 'Me' },
        ...(people?.engineers ?? []).map((p) => ({ value: p.id, label: p.displayName })),
      ],
    },
    { key: 'productFamily', label: 'Product family', options: fromList('product_family') },
    { key: 'market', label: 'Market', options: fromList('market') },
    { key: 'resin', label: 'Resin', options: fromList('resin') },
    {
      key: 'hasWarnings',
      label: 'Qualification warnings (pick one)',
      options: [
        { value: 'true', label: 'Has warnings' },
        { value: 'false', label: 'No warnings' },
      ],
    },
    {
      key: 'sfMismatch',
      label: 'Salesforce stage (pick one)',
      options: [
        { value: 'true', label: 'Disagrees on the outcome' },
        { value: 'false', label: 'Agrees' },
      ],
    },
  ];
  const [dir, sort] = sortDirFor(search, defaultSort ?? 'updated');
  const count = activePipelineFilterCount(search);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="pipeline-toolbar">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <label htmlFor={ids.search} className="sr-only">
          Search quotes
        </label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={ids.search}
          type="search"
          placeholder="Quote, opportunity, account…"
          className="h-11 w-full pl-8 sm:h-9 sm:w-64"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <FiltersPopover
        groups={groups}
        value={filterValueFromSearch(search)}
        onChange={(value) => onChange(searchWithFilterValue(search, value))}
        count={count}
        onClear={() => onChange(clearPipelineFilters(search))}
        extra={
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label htmlFor={ids.aged} className="text-sm font-semibold">
                In current stage for more than
              </label>
              <NativeSelect
                id={ids.aged}
                value={search.agedOverDays === undefined ? '' : String(search.agedOverDays)}
                onChange={(e) =>
                  onChange({
                    ...search,
                    agedOverDays: e.target.value ? Number(e.target.value) : undefined,
                    page: undefined,
                  })
                }
              >
                <option value="">Any time</option>
                {[3, 7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </NativeSelect>
            </div>
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-semibold">Expected close date</legend>
              <div className="grid grid-cols-2 gap-2">
                <label htmlFor={ids.from} className="grid gap-1 text-xs">
                  From
                  <Input
                    id={ids.from}
                    type="date"
                    value={search.closeDateFrom ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...search,
                        closeDateFrom: e.target.value || undefined,
                        page: undefined,
                      })
                    }
                  />
                </label>
                <label htmlFor={ids.to} className="grid gap-1 text-xs">
                  To
                  <Input
                    id={ids.to}
                    type="date"
                    value={search.closeDateTo ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...search,
                        closeDateTo: e.target.value || undefined,
                        page: undefined,
                      })
                    }
                  />
                </label>
              </div>
            </fieldset>
          </div>
        }
      />
      {sortKeys && sortKeys.length > 0 && (
        <div className="flex items-center gap-1">
          <label htmlFor={ids.sort} className="text-muted-foreground text-sm">
            Sort
          </label>
          <NativeSelect
            id={ids.sort}
            className="h-11 w-auto sm:h-9"
            value={sort}
            data-testid="sort-select"
            onChange={(e) =>
              onChange({
                ...search,
                sort: e.target.value as QuoteSortKey,
                dir: undefined,
                page: undefined,
              })
            }
          >
            {sortKeys.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="ghost"
            size="icon"
            className="sm:size-9"
            aria-label={
              dir === 'desc' ? 'Descending; switch to ascending' : 'Ascending; switch to descending'
            }
            data-testid="sort-dir"
            onClick={() =>
              onChange({ ...search, sort, dir: dir === 'desc' ? 'asc' : 'desc', page: undefined })
            }
          >
            {dir === 'desc' ? (
              <ArrowDownWideNarrowIcon aria-hidden="true" />
            ) : (
              <ArrowUpNarrowWideIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
      <SavedViewsMenu
        view={savedViewsKey}
        search={search as Record<string, unknown>}
        onApply={(s) => onChange(s)}
      />
      {count > 0 && (
        <button
          type="button"
          className="text-emphasis min-h-11 px-2 text-sm underline sm:min-h-8"
          onClick={() => onChange(clearPipelineFilters(search))}
        >
          Clear filters
        </button>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
