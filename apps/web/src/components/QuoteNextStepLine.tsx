import type { QuoteDetail } from '@ccq/contracts';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

import { Button, buttonVariants } from '@/components/ui/button';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { nextStepLine, nothingToDecideText } from '@/lib/next-step';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * UX-002: one line under the stage tracker of every quote: who it is waiting on and what happens next.
 * When it is the reader's own move, the line carries the way to where they make it: the rework draft for
 * the KAM, the Engineering or Quoting tab for the people who work there. A gate decided in its own
 * dialog keeps its button in the page header.
 *
 * Everything shown comes from `QuoteDetail.nextStep` (the server's facts); the gate's name from the
 * workflow config. On hold, the line is the hold sentence (FB-17: the same one the timeline shows).
 */
export function QuoteNextStepLine({
  quote,
  nothingToDecide = null,
}: {
  quote: QuoteDetail;
  /**
   * UX-003: the reader is offered a gate decision but the server would refuse every outcome: what each
   * of them lacks (`blockedDecision`). The line then says so, where the decision button would be.
   */
  nothingToDecide?: readonly { message: string }[] | null;
}) {
  const { data: config } = usePublicConfig();
  const navigate = useNavigate();
  const { tab } = useSearch({ from: '/quotes/$quoteNumber' });
  const startRework = useMutation({
    mutationFn: () => api.startRework(quote.quoteNumber),
    // FB-15 (W13-05): straight to the review step, at the first thing to fix.
    onSuccess: (draft) =>
      void navigate({ to: '/intake/new', search: { draft: draft.id, at: 'review' } }),
    onError: () => toast.error({ title: 'Could not open the rework draft' }),
  });
  const step = quote.nextStep;
  if (!step) return null;
  const line = nextStepLine(step, config?.gates.find((g) => g.key === step.gateKey)?.label);
  const action = line.action;
  // Back with the KAM: the one sentence says who has it, since when and what the reader waits for.
  const onlyNothingToDecide = nothingToDecide !== null && step.state === 'rework';

  return (
    <div
      data-testid="quote-next-step"
      data-state={step.state}
      data-waiting-on={step.waitingOn}
      data-your-move={step.yourMove || undefined}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4"
    >
      {!onlyNothingToDecide && (
        <p
          className={cn('text-sm', step.yourMove && 'font-medium')}
          // FB-17 (W13-26): the hold sentence of the quote header.
          {...(step.state === 'on_hold' ? { 'data-testid': 'quote-status' } : {})}
        >
          {line.text}
        </p>
      )}
      {nothingToDecide !== null && (
        <p className="text-sm" data-testid="nothing-to-decide">
          {nothingToDecideText(step, nothingToDecide, step.since ? absoluteTime(step.since) : null)}
        </p>
      )}
      {action?.kind === 'rework' && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => startRework.mutate()}
          disabled={startRework.isPending}
        >
          {action.label}
        </Button>
      )}
      {/* On the tab already: nothing to open. */}
      {action?.kind === 'tab' && action.tab !== tab && (
        <Link
          to="/quotes/$quoteNumber"
          params={{ quoteNumber: quote.quoteNumber }}
          search={{ tab: action.tab }}
          replace
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
