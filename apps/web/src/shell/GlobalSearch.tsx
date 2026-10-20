import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { useCan } from '@/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_RESULTS = 8;

/**
 * Header search (B-14): type-ahead over quote number, opportunity name and account (the top 8 the
 * caller can see, newest first). Arrow keys move through the results, Enter opens the highlighted
 * quote, or the full filtered list when none is highlighted. ARIA 1.2 combobox pattern.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const canRead = useCan('quote.read');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const listId = `${id}-results`;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const query = { q: debounced, pageSize: String(MAX_RESULTS), sort: 'updated' };
  const results = useQuery({
    queryKey: ['pipeline', 'typeahead', query],
    queryFn: () => api.quotes(query),
    enabled: canRead && debounced.length >= 2,
    staleTime: 30_000,
  });
  const items = debounced.length >= 2 ? (results.data?.items ?? []) : [];
  const showList = open && debounced.length >= 2;

  const openQuote = (quoteNumber: string) => {
    setOpen(false);
    setQ('');
    void navigate({ to: '/quotes/$quoteNumber', params: { quoteNumber } });
  };
  const openList = () => {
    const text = q.trim();
    setOpen(false);
    void navigate({ to: '/quotes', search: text ? { q: text } : {} });
  };

  return (
    <form
      role="search"
      aria-label="Quotes"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        const pick = items[active];
        if (showList && pick) openQuote(pick.quoteNumber);
        else openList();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Search quotes
      </label>
      <SearchIcon
        className="text-header-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === 'Escape') {
            setOpen(false);
            setActive(-1);
          }
        }}
        placeholder="Search quote number, customer, opportunity"
        className="bg-header-control text-header-foreground placeholder:text-header-muted min-h-10 w-full rounded-pill border border-header-line pr-4 pl-9 text-sm"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching quotes"
        hidden={!showList}
        className="bg-popover text-popover-foreground rounded-card absolute top-full right-0 left-0 z-50 mt-1 grid max-h-[60dvh] overflow-y-auto border p-1 shadow-lg"
        data-testid="search-results"
      >
        {items.map((item, i) => (
          <li
            key={item.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={cn(
              'grid min-h-11 cursor-pointer gap-0.5 rounded-md px-3 py-2 text-sm',
              i === active ? 'bg-accent' : 'hover:bg-accent',
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openQuote(item.quoteNumber)}
          >
            <span className="font-semibold">{item.quoteNumber}</span>
            <span className="text-muted-foreground truncate text-xs">
              {[item.accountName, item.opportunityName].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
        {showList && !results.isPending && items.length === 0 && (
          <li
            role="option"
            aria-selected={false}
            aria-disabled
            className="text-muted-foreground px-3 py-2 text-sm"
          >
            No matching quotes
          </li>
        )}
        {showList && items.length > 0 && (
          <li
            role="option"
            aria-selected={false}
            className="text-emphasis hover:bg-accent min-h-11 cursor-pointer rounded-md px-3 py-2 text-sm underline-offset-4"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openList}
          >
            See all results (Enter)
          </li>
        )}
      </ul>
    </form>
  );
}
