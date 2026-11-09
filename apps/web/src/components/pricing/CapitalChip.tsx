import type { CapitalReadiness } from '@ccq/contracts';

import { CAPITAL_LABELS } from './QuotingTab';

import { cn } from '@/lib/utils';

const CAPITAL_STYLE: Record<CapitalReadiness, string> = {
  not_required: 'bg-secondary text-secondary-foreground',
  pending: 'bg-warning text-warning-foreground',
  pre_approved: 'bg-secondary text-secondary-foreground',
  not_approved: 'bg-destructive text-destructive-foreground',
};

/** The capital readiness status as a chip (pricing queue, Final Review). Commercial: absent for other roles. */
export function CapitalChip({ value }: { value: CapitalReadiness | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">Not recorded</span>;
  return (
    <span
      className={cn(
        // The labels say "budgetary" (F-064), so they can be long: let them wrap on a phone, not scroll.
        'rounded-pill inline-flex max-w-full px-2 py-0.5 text-xs',
        CAPITAL_STYLE[value],
      )}
      data-testid="capital-readiness"
    >
      {CAPITAL_LABELS[value]}
    </span>
  );
}
