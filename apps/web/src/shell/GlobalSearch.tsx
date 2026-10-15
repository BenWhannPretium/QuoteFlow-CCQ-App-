import { useNavigate } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Header search. Submitting opens the pipeline list with `?q=`; B-14 implements the search itself.
 * On mobile it collapses to an icon that opens the same list.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const id = useId();
  return (
    <form
      role="search"
      aria-label="Quotes"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        void navigate({ to: '/quotes', search: query ? { q: query } : {} });
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
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search quote number, customer, opportunity"
        className="bg-header-control text-header-foreground placeholder:text-header-muted min-h-10 w-full rounded-pill border border-white/25 pr-4 pl-9 text-sm"
      />
    </form>
  );
}
