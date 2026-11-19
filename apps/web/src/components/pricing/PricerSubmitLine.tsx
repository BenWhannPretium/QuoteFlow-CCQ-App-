import type { LeadReviewView, QuotingDetail } from '@ccq/contracts';
import { uniqueRequirements } from '@ccq/domain';
import { useMutation } from '@tanstack/react-query';
import { SendIcon } from 'lucide-react';
import { useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { SAVE_FIRST_TEXT, useHasUnsavedChanges } from '@/lib/unsaved-changes';

import { problemErrors } from '../forms';
import { MISSING_LABELS } from '../GateDecisionDialog';

/** The id of the "When you are finished" section at the bottom of the Quoting tab. */
export const PRICING_NEXT_STEP_ID = 'quoting-next-step';

/**
 * FB-21 Part C (N17-23): in the demo the pricer finished and nobody found "Submit to pricing lead" at the
 * bottom of a long tab. The same action is offered at the top, beside the lead-review status, to the
 * assigned pricer only (`canSubmit`): one action, two places, the same endpoint. While something is
 * missing, the line says what and links to the full list at the bottom instead.
 */
export function PricerSubmitLine({
  quoteNumber,
  review,
  submit,
  onDone,
}: {
  quoteNumber: string;
  review: LeadReviewView;
  submit: () => Promise<QuotingDetail>;
  onDone: (detail: QuotingDetail) => Promise<unknown>;
}) {
  const unsaved = useHasUnsavedChanges(quoteNumber);
  const saveFirstId = useId();
  const inFlight = useRef(false);
  const submitting = useMutation({
    mutationFn: submit,
    onSuccess: async (detail) => {
      await onDone(detail);
      toast.success({
        title: 'Submitted to the pricing lead',
        description: 'They have been notified. You can edit again if they send it back.',
      });
    },
    onError: (err) =>
      toast.error({
        title: 'Not submitted',
        description: problemErrors(err)[0]?.message ?? 'Please try again.',
      }),
  });
  if (!review.canSubmit || !review.submitMissing) return null;
  const missing = uniqueRequirements(review.submitMissing);
  const ready = missing.length === 0;
  return (
    <section
      aria-label="Submit to the pricing lead"
      className="bg-card rounded-card flex flex-wrap items-center gap-3 border p-4 text-sm"
      data-testid="pricer-submit-top"
      data-ready={ready}
    >
      {ready ? (
        <>
          <span className="font-medium">Your part is done?</span>
          <Button
            size="sm"
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              submitting.mutate(undefined, {
                onSettled: () => {
                  inFlight.current = false;
                },
              });
            }}
            disabled={submitting.isPending || unsaved}
            aria-describedby={unsaved ? saveFirstId : undefined}
            data-testid="pricer-submit-top-button"
          >
            <SendIcon aria-hidden="true" />
            {submitting.isPending ? 'Submitting…' : 'Submit to pricing lead'}
          </Button>
          {unsaved && (
            <span id={saveFirstId} className="text-muted-foreground">
              {SAVE_FIRST_TEXT}
            </span>
          )}
        </>
      ) : (
        <p data-testid="pricer-submit-top-missing">
          <span className="font-medium">Before you submit to the pricing lead:</span>{' '}
          {missing.map((m) => MISSING_LABELS[m.field] ?? m.message).join('; ')}.{' '}
          <a className="underline underline-offset-2" href={`#${PRICING_NEXT_STEP_ID}`}>
            See what is still needed
          </a>
        </p>
      )}
    </section>
  );
}
