import type { LeadReviewView } from '@ccq/contracts';
import { uniqueRequirements } from '@ccq/domain';
import { useMutation } from '@tanstack/react-query';
import { CornerUpLeftIcon, LockIcon, SendIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { SAVE_FIRST_TEXT, useHasUnsavedChanges } from '@/lib/unsaved-changes';

import { problemErrors, type ServerError } from './forms';
import { MISSING_LABELS } from './GateDecisionDialog';

export type LeadReviewKind = 'engineering' | 'pricing';
/** FB-16 (W13-19): who a send-back goes to: the assignee (engineer, pricer) or the production scheduler. */
export type SendBackTarget = NonNullable<LeadReviewView['returnTargets']>[number]['target'];

const TARGET_NOUN: Record<SendBackTarget, string> = {
  assignee: 'engineer',
  scheduler: 'production scheduler',
};

const NOUN: Record<LeadReviewKind, { assignee: string; lead: string; work: string }> = {
  engineering: { assignee: 'engineer', lead: 'engineering lead', work: 'engineering review' },
  pricing: { assignee: 'pricer', lead: 'pricing lead', work: 'pricing work' },
};

/**
 * Lead review (2026-10-30), on the Engineering and Quoting tabs, in two parts:
 *
 * - `LeadReviewStatus`, at the top of the tab: where the work stands (waiting on the lead, or sent back
 *   with the lead's note).
 * - `LeadReviewActions`, at the bottom, after the work: the one next step. The assignee submits to the
 *   lead; the lead decides the gate, or sends the work back with a note.
 *
 * The API decides who may do what (`canSubmit`, `canSendBack`).
 */
export function LeadReviewStatus({
  kind,
  review,
}: {
  kind: LeadReviewKind;
  review: LeadReviewView;
}) {
  const noun = NOUN[kind];
  if (review.status === 'none') return null;
  return (
    <section
      className="bg-card rounded-card grid gap-3 border p-4 text-sm"
      data-testid="lead-review"
      data-status={review.status}
    >
      {review.status === 'submitted' && (
        <p className="flex items-start gap-2" data-testid="lead-review-submitted">
          <LockIcon className="text-emphasis mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Submitted to the {noun.lead}</span>
            {review.submittedAt ? ` on ${absoluteTime(review.submittedAt)}` : ''}
            {review.submittedByName ? ` by ${review.submittedByName}` : ''}. Waiting on their
            review. The {noun.assignee} cannot edit until it is sent back.
          </span>
        </p>
      )}
      {review.status === 'returned' && (
        <div
          role="status"
          className="bg-warning text-warning-foreground grid gap-1 rounded-md px-3 py-2"
          data-testid="lead-review-returned"
        >
          <p className="flex items-start gap-2 font-semibold">
            <CornerUpLeftIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {/* FB-16 (W13-19, W13-17): who it went back to (the engineer or the scheduler). */}
            Sent back{review.returnedToName ? ` to ${review.returnedToName}` : ''} by{' '}
            {review.returnedByName ?? `the ${noun.lead}`}
            {review.returnedAt ? ` on ${absoluteTime(review.returnedAt)}` : ''}
          </p>
          {review.returnNote && <p className="whitespace-pre-wrap">{review.returnNote}</p>}
        </div>
      )}
    </section>
  );
}

export function LeadReviewActions<T>({
  kind,
  quoteNumber,
  review,
  submit,
  sendBack,
  onDone,
  decide,
}: {
  kind: LeadReviewKind;
  /** UX-001: the quote, to know whether one of its cards still has unsaved changes. */
  quoteNumber: string;
  review: LeadReviewView;
  submit: () => Promise<T>;
  /** FB-16 (W13-19): `to` is sent only when the lead had a choice (a production scheduler is assigned). */
  sendBack: (note: string, to?: SendBackTarget) => Promise<T>;
  onDone: (result: T) => Promise<unknown>;
  /**
   * The lead's decision (the gate), when the viewer may decide it. The primary button appears only when
   * the quote can move forward (`ready`); until then the list says what is missing, and `onOther` opens
   * the decisions that do not need the work finished (hold, send back to the KAM, stop).
   */
  decide?:
    | {
        label: string;
        onClick: () => void;
        ready: boolean;
        missing: readonly { field: string; message: string }[];
        onOther?: (() => void) | undefined;
      }
    | undefined;
}) {
  const noun = NOUN[kind];
  // FB-16 (W13-19): more than one target only in Engineering, when a production scheduler is assigned.
  const targets = review.returnTargets ?? [];
  const [missing, setMissing] = useState<ServerError[]>([]);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  // UX-001: submitting sends what is saved, then locks it. Typed values that are not saved yet would
  // be left behind, so Submit waits for the save.
  const unsaved = useHasUnsavedChanges(quoteNumber);
  const saveFirstId = useId();
  const submitting = useMutation({
    mutationFn: submit,
    onSuccess: async (result) => {
      setMissing([]);
      await onDone(result);
      toast.success({
        title: `Submitted to the ${noun.lead}`,
        description: 'They have been notified. You can edit again if they send it back.',
      });
    },
    onError: (err) => setMissing(problemErrors(err)),
  });

  // Submit appears once the server says nothing is missing (unknown right after a save: held back).
  const submitReady = review.canSubmit && review.submitMissing?.length === 0;
  if (!review.canSubmit && !review.canSendBack && !review.submitBlockedReason && !decide) {
    return null;
  }
  return (
    <section
      aria-label="Next step"
      className="bg-card rounded-card grid gap-3 border p-4 text-sm"
      data-testid="lead-review-actions"
    >
      <h2 className="text-base font-semibold">
        {decide ? 'Your decision' : 'When you are finished'}
      </h2>
      {review.canSubmit && submitReady && (
        <p className="text-muted-foreground">
          Everything needed is filled in. Submit it and the {noun.lead} reviews it and decides.
        </p>
      )}
      {review.canSubmit && review.submitMissing && review.submitMissing.length > 0 && (
        <StillNeeded
          intro={`Fill these in and save. Then you can submit to the ${noun.lead}:`}
          items={review.submitMissing}
          testId="lead-review-needed"
        />
      )}
      {decide && !decide.ready && decide.missing.length > 0 && (
        <StillNeeded
          intro="Still needed before this quote can move forward:"
          items={decide.missing}
          testId="decide-needed"
        />
      )}
      {review.submitBlockedReason && (
        <p className="text-muted-foreground" data-testid="lead-review-blocked">
          {review.submitBlockedReason}
        </p>
      )}
      {missing.length > 0 && (
        <div role="alert" className="text-destructive grid gap-1" data-testid="lead-review-missing">
          <p className="font-semibold">Fill these in before you submit:</p>
          <ul className="list-disc pl-5">
            {uniqueRequirements(
              missing.map((m) => ({ ...m, field: m.path.replace(/^\//, '') })),
            ).map((m) => (
              <li key={`${m.path}-${m.message}`}>{MISSING_LABELS[m.field] ?? m.message}</li>
            ))}
          </ul>
        </div>
      )}
      {(submitReady || review.canSendBack || decide) && (
        <div className="flex flex-wrap gap-2">
          {decide?.ready && (
            <Button onClick={decide.onClick} data-testid="decide-gate">
              {decide.label}
            </Button>
          )}
          {decide && !decide.ready && decide.onOther && (
            <Button variant="outline" onClick={decide.onOther} data-testid="decide-other">
              Send back, hold or stop
            </Button>
          )}
          {submitReady && (
            <Button
              onClick={() => {
                // DR-pricing-finance-04: one request per click burst (the API also refuses a second).
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
            >
              <SendIcon aria-hidden="true" />
              {submitting.isPending ? 'Submitting…' : `Submit to ${noun.lead}`}
            </Button>
          )}
          {review.canSendBack && (
            <Button variant="outline" onClick={() => setSending(true)}>
              <CornerUpLeftIcon aria-hidden="true" />
              {targets.length > 1 ? 'Send back to…' : `Send back to ${noun.assignee}`}
            </Button>
          )}
        </div>
      )}
      {submitReady && unsaved && (
        <p id={saveFirstId} className="text-muted-foreground" data-testid="save-first">
          {SAVE_FIRST_TEXT}
        </p>
      )}
      {sending && (
        <SendBackDialog
          kind={kind}
          targets={targets}
          onOpenChange={setSending}
          sendBack={sendBack}
          onDone={onDone}
        />
      )}
    </section>
  );
}

/** What is left to do before the next step, in the same words the decision dialog uses. */
function StillNeeded({
  intro,
  items,
  testId,
}: {
  intro: string;
  items: readonly { field: string; message: string }[];
  testId: string;
}) {
  return (
    <div className="grid gap-1" data-testid={testId}>
      <p className="font-medium">{intro}</p>
      <ul className="text-muted-foreground list-disc pl-5">
        {/* FB-16 (W13-12): "Process & machine type" is two rules and one pick: listed once. */}
        {uniqueRequirements(items).map((m) => (
          <li key={m.field + m.message}>{MISSING_LABELS[m.field] ?? m.message}</li>
        ))}
      </ul>
    </div>
  );
}

function SendBackDialog<T>({
  kind,
  targets,
  onOpenChange,
  sendBack,
  onDone,
}: {
  kind: LeadReviewKind;
  /** FB-16 (W13-19): the people the lead may choose between; one or none = the assignee, no choice shown. */
  targets: NonNullable<LeadReviewView['returnTargets']>;
  onOpenChange: (open: boolean) => void;
  sendBack: (note: string, to?: SendBackTarget) => Promise<T>;
  onDone: (result: T) => Promise<unknown>;
}) {
  const noun = NOUN[kind];
  const id = useId();
  const choice = targets.length > 1;
  // The engineer is the default.
  const [to, setTo] = useState<SendBackTarget>('assignee');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toNoun = choice ? TARGET_NOUN[to] : noun.assignee;
  const mutation = useMutation({
    mutationFn: () => sendBack(note.trim(), choice ? to : undefined),
    onSuccess: async (result) => {
      await onDone(result);
      toast.success({
        title: `Sent back to the ${toNoun}`,
        description: 'They have been notified with your note.',
      });
      onOpenChange(false);
    },
    onError: (err) => setError(problemErrors(err)[0]?.message ?? 'Try again.'),
  });
  return (
    <Dialog open onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {choice ? 'Send back to…' : `Send back to the ${noun.assignee}`}
          </DialogTitle>
          <DialogDescription>
            {!choice
              ? `They can edit the ${noun.work} again and resubmit it to you.`
              : to === 'scheduler'
                ? 'The production scheduler reworks the capacity part. The engineer submits it to you again. Only the person you choose is notified.'
                : 'The engineer can edit the solution again and resubmit it to you. Only the person you choose is notified.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="send-back-form"
          className="grid gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) {
              setError('Enter what should change.');
              return;
            }
            setError(null);
            mutation.mutate();
          }}
        >
          {choice && (
            <fieldset className="grid gap-2" data-testid="send-back-target">
              <legend className="mb-1 text-sm font-medium">Who should rework it?</legend>
              {targets.map((t) => (
                <label key={t.target} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${id}-to`}
                    className="size-4"
                    value={t.target}
                    checked={to === t.target}
                    onChange={() => setTo(t.target)}
                  />
                  <span>
                    {t.target === 'assignee' ? 'Engineer' : 'Production scheduler'}
                    {t.name ? `: ${t.name}` : ''}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <label htmlFor={id} className="text-sm font-medium">
            What should change?
          </label>
          <Textarea
            id={id}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            aria-invalid={!!error}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" form="send-back-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Sending…' : 'Send back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
