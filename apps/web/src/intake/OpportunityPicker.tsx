import type { SfOpportunitySummary } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, SearchIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { StageBadge } from '@/components/StageBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

import { formatDate, formatUsd } from './model';
import { Notice, Pill } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Step 1. Every quote starts in Salesforce (DEC-12): search the KAM's own open opportunities (or all),
 * pick one, or open the active CCQ quote it already has (one per opportunity).
 */
export function OpportunityPicker({
  onPick,
  picking,
  selectedId,
  newOpportunityUrl,
}: {
  onPick: (o: SfOpportunitySummary) => void;
  /** Id being picked right now (spinner state). */
  picking: string | null;
  selectedId?: string | null | undefined;
  newOpportunityUrl: string | null;
}) {
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(true);
  const query = useDebounced(q.trim(), 300);
  const searchId = useId();

  const results = useQuery({
    queryKey: ['salesforce', 'opportunities', { q: query, mine }],
    queryFn: () => api.searchOpportunities({ q: query, mine }),
    staleTime: 30_000,
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:flex sm:items-end">
        <div className="grid flex-1 gap-1.5">
          <label htmlFor={searchId} className="text-sm font-medium">
            Find the Salesforce opportunity
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              id={searchId}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Opportunity or account name"
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </div>
        <div role="group" aria-label="Whose opportunities" className="flex gap-1">
          {[
            { value: true, label: 'Mine' },
            { value: false, label: 'All' },
          ].map((o) => (
            <Button
              key={o.label}
              variant={mine === o.value ? 'primary' : 'outline'}
              aria-pressed={mine === o.value}
              onClick={() => setMine(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>

      {results.data?.liveError && <Notice tone="info">{results.data.liveError}</Notice>}

      {results.isError ? (
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      ) : results.isPending ? (
        <p className="text-muted-foreground text-sm" role="status">
          Searching Salesforce…
        </p>
      ) : results.data.items.length === 0 ? (
        <EmptyState
          title="Create the opportunity in Salesforce first"
          description={
            <>
              Every CCQ quote starts from a Salesforce opportunity, so pipeline, priority and
              outcomes stay linked to the deal. {mine && 'Not yours? Try “All”. '}
              Once it exists in Salesforce, search for it here.
            </>
          }
          action={
            newOpportunityUrl ? (
              <Button asChild variant="outline">
                <a href={newOpportunityUrl} target="_blank" rel="noreferrer">
                  New opportunity in Salesforce <ExternalLinkIcon aria-hidden />
                </a>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3" aria-label="Salesforce opportunities">
          {results.data.items.map((o) => (
            <OpportunityCard
              key={o.id}
              o={o}
              selected={o.id === selectedId}
              busy={picking === o.id}
              disabled={picking !== null}
              onPick={() => onPick(o)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OpportunityCard({
  o,
  selected,
  busy,
  disabled,
  onPick,
}: {
  o: SfOpportunitySummary;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <li
      data-testid="opportunity-card"
      data-opportunity-id={o.id}
      className={cn(
        'bg-card rounded-card grid gap-3 border p-4 sm:grid-cols-[1fr_auto] sm:items-center',
        selected && 'border-primary border-2',
      )}
    >
      <div className="grid min-w-0 gap-1">
        <p className="font-semibold break-words">{o.name}</p>
        <p className="text-muted-foreground text-sm break-words">
          {o.accountName ?? 'No account in Salesforce'}
        </p>
        <dl className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <div className="flex gap-1">
            <dt>Amount</dt>
            <dd className="text-foreground tabular-nums">{formatUsd(o.amount)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Close</dt>
            <dd className="text-foreground">{formatDate(o.closeDate)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>SF stage</dt>
            <dd className="text-foreground">{o.stage ?? '—'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Owner</dt>
            <dd className="text-foreground">{o.ownerAlias ?? '—'}</dd>
          </div>
        </dl>
        {o.dataQuality.includes('amount_suspect') && (
          <p className="text-muted-foreground text-xs">
            The Salesforce amount looks like a placeholder; you can correct the revenue later.
          </p>
        )}
      </div>
      {o.activeQuote ? (
        <div className="grid justify-items-start gap-2 sm:justify-items-end">
          <Pill className="bg-muted text-foreground">Has quote {o.activeQuote.quoteNumber}</Pill>
          <StageBadge stageKey={o.activeQuote.stageKey} />
          <Button asChild variant="outline">
            <Link to="/quotes/$quoteNumber" params={{ quoteNumber: o.activeQuote.quoteNumber }}>
              Open existing
            </Link>
          </Button>
        </div>
      ) : (
        <Button
          onClick={onPick}
          disabled={disabled}
          variant={selected ? 'primary' : 'action'}
          aria-label={`Use ${o.name}`}
        >
          {busy ? 'Loading…' : selected ? 'Selected' : 'Use this opportunity'}
        </Button>
      )}
    </li>
  );
}
