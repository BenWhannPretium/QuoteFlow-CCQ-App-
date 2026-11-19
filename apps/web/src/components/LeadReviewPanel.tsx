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
          {review.parts ? (
            // FB-22 (N17-14): every part is in; `EngPartsStatus` says who submitted what.
            <span>
              <span className="font-semibold">Every part is with the {noun.lead}.</span> Waiting on
              their review. Each part is read-only for its owner until it is sent back.
            </span>
          ) : (
            <span>
              <span className="font-semibold">Submitted to the {noun.lead}</span>
              {review.submittedAt ? ` on ${absoluteTime(review.submittedAt)}` : ''}
              {review.submittedByName ? ` by ${review.submittedByName}` : ''}. Waiting on their
              review. The {noun.assignee} cannot edit until it is sent back.
            </span>
          )}
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
  hideSubmit = false,
  selfReview = false,
}: {
  kind: LeadReviewKind;
  /**
   * FB-22 (N17-14): Engineering shows each person's Submit at the end of their own section
   * (`PartSubmit`), so this section keeps only the lead's decision and send-back.
   */
  hideSubmit?: boolean;
  /** FB-22 (D2): the viewer is the lead and the assignee: their own part needs no submit. */
  selfReview?: boolean;
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
        /** The name of the `onOther` button (a quote on hold is not offered Hold: UX-004). */
        otherLabel?: string | undefined;
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
  // UX-001: submitting sends what is saved, then locks it, and a decision is recorded on what is saved.
  // Typed values that are not saved yet would be left behind, so Submit and the decisions wait for the
  // save.
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
  const submitReady = !hideSubmit && review.canSubmit && review.submitMissing?.length === 0;
  const canSubmit = !hideSubmit && review.canSubmit;
  const blockedReason = hideSubmit ? null : review.submitBlockedReason;
  if (!canSubmit && !review.canSendBack && !blockedReason && !decide) {
    return null;
  }
  return (
    <section
      // FB-22 (N17-11): "Go to the decision" and `?tab=engineering#decision` land here.
      id={decide ? 'decision' : undefined}
      tabIndex={decide ? -1 : undefined}
      aria-label={decide ? 'Your decision' : 'Next step'}
      className="bg-card rounded-card grid scroll-mt-20 gap-3 border p-4 text-sm"
      data-testid="lead-review-actions"
    >
      <h2 className="text-base font-semibold">
        {decide ? 'Your decision' : 'When you are finished'}
      </h2>
      {selfReview && decide && (
        <p className="text-muted-foreground" data-testid="lead-self-review">
          You are the {noun.assignee} and the {noun.lead} on this quote, so there is nothing to
          submit: decide when the work is done.
        </p>
      )}
      {canSubmit && submitReady && (
        <p className="text-muted-foreground">
          Everything needed is filled in. Submit it and the {noun.lead} reviews it and decides.
        </p>
      )}
      {canSubmit && review.submitMissing && review.submitMissing.length > 0 && (
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
      {blockedReason && (
        <p className="text-muted-foreground" data-testid="lead-review-blocked">
          {blockedReason}
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
            <Button
              onClick={decide.onClick}
              disabled={unsaved}
              aria-describedby={unsaved ? saveFirstId : undefined}
              data-testid="decide-gate"
            >
              {decide.label}
            </Button>
          )}
          {decide && !decide.ready && decide.onOther && (
            <Button
              variant="outline"
              onClick={decide.onOther}
              disabled={unsaved}
              aria-describedby={unsaved ? saveFirstId : undefined}
              data-testid="decide-other"
            >
              {decide.otherLabel ?? 'Send back, hold or stop'}
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
      {(submitReady || decide?.ready || (decide && decide.onOther)) && (
        // UX-018: the live region is on the page before the line appears, so the line is announced.
        <p role="status" className={unsaved ? 'text-muted-foreground' : 'sr-only'}>
          {unsaved && (
            <span id={saveFirstId} data-testid="save-first">
              {SAVE_FIRST_TEXT}
            </span>
          )}
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
                ? 'The production scheduler reworks the capacity part and submits it to you again. The engineer’s part stays with you. Only the person you choose is notified.'
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

/**
 * FB-22 (N17-14): one person's Submit, at the end of their own section of the Engineering tab: the
 * engineer's part ("Submit to engineering lead") or the production scheduler's ("Submit capacity to
 * engineering lead"). It shows only for the person who may submit now; until the server says nothing is
 * missing, the "Still needed" list says what to fill in.
 */
export function PartSubmit<T>({
  quoteNumber,
  canSubmit,
  missing,
  label,
  submit,
  onDone,
  testId,
  neededTestId,
  blockedReason,
}: {
  quoteNumber: string;
  canSubmit: boolean;
  /** DR-pricing-finance-10: why a team member sees no Submit (shown instead of the button). */
  blockedReason: string | null;
  neededTestId: string;
  /** What the part still needs (empty = ready; undefined = unknown right after a save). */
  missing: readonly { field: string; message: string }[] | undefined;
  label: string;
  submit: () => Promise<T>;
  onDone: (result: T) => Promise<unknown>;
  testId: string;
}) {
  const [errors, setErrors] = useState<ServerError[]>([]);
  const inFlight = useRef(false);
  const unsaved = useHasUnsavedChanges(quoteNumber);
  const saveFirstId = useId();
  const submitting = useMutation({
    mutationFn: submit,
    onSuccess: async (result) => {
      setErrors([]);
      await onDone(result);
      toast.success({
        title: 'Submitted to the engineering lead',
        description:
          'They are told once every part is in. You can edit again if they send it back.',
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  if (!canSubmit) {
    return blockedReason ? (
      <p className="text-muted-foreground text-sm" data-testid="lead-review-blocked">
        {blockedReason}
      </p>
    ) : null;
  }
  const ready = missing?.length === 0;
  return (
    <section
      aria-label={label}
      className="bg-card rounded-card grid gap-3 border p-4 text-sm"
      data-testid={testId}
    >
      {ready ? (
        <p className="text-muted-foreground">
          Everything needed is filled in. Submit it and the engineering lead reviews it.
        </p>
      ) : (
        missing &&
        missing.length > 0 && (
          <StillNeeded
            intro="Fill these in and save. Then you can submit to the engineering lead:"
            items={missing}
            testId={neededTestId}
          />
        )
      )}
      {errors.length > 0 && (
        <div role="alert" className="text-destructive grid gap-1">
          <p className="font-semibold">Fill these in before you submit:</p>
          <ul className="list-disc pl-5">
            {uniqueRequirements(
              errors.map((m) => ({ ...m, field: m.path.replace(/^\//, '') })),
            ).map((m) => (
              <li key={`${m.path}-${m.message}`}>{MISSING_LABELS[m.field] ?? m.message}</li>
            ))}
          </ul>
        </div>
      )}
      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
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
          >
            <SendIcon aria-hidden="true" />
            {submitting.isPending ? 'Submitting…' : label}
          </Button>
          <p role="status" className={unsaved ? 'text-muted-foreground' : 'sr-only'}>
            {unsaved && (
              <span id={saveFirstId} data-testid="save-first">
                {SAVE_FIRST_TEXT}
              </span>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * FB-22 (N17-14): where each part of an engineering review stands, for everyone on the tab, so the lead
 * sees which part is in and which is not. Shown once a part has an owner.
 */
export function EngPartsStatus({ review }: { review: LeadReviewView }) {
  const parts = review.parts;
  if (!parts || (!parts.engineer.ownerName && !parts.scheduler)) return null;
  const line = (
    name: string,
    p: NonNullable<LeadReviewView['parts']>['engineer'],
    testId: string,
  ) => (
    <li className="flex flex-wrap items-baseline gap-x-2" data-testid={testId} data-in={p.in}>
      <span className="font-medium">{name}:</span>
      <span className={p.in ? '' : 'text-muted-foreground'}>
        {p.submittedAt
          ? `Submitted${p.submittedByName ? ` by ${p.submittedByName}` : ''} on ${absoluteTime(p.submittedAt)}`
          : p.ownerIsLead
            ? `${p.ownerName ?? 'The engineer'} is an engineering lead: no submit needed`
            : `Not submitted yet${p.ownerName ? ` (${p.ownerName})` : ''}`}
      </span>
    </li>
  );
  return (
    <section
      aria-label="Parts submitted to the engineering lead"
      className="bg-card rounded-card grid gap-2 border p-4 text-sm"
      data-testid="eng-parts"
    >
      <h2 className="text-base font-semibold">With the engineering lead</h2>
      <ul className="grid gap-1">
        {line('Engineer’s part', parts.engineer, 'eng-part-engineer')}
        {parts.scheduler && line('Capacity', parts.scheduler, 'eng-part-scheduler')}
      </ul>
    </section>
  );
}

/**
 * FB-22 (N17-11): a link at the top of the tab to the lead's decision at the bottom (`#decision`). It
 * scrolls there (smoothly unless the reader asked for reduced motion) and moves keyboard focus to it. It
 * never scrolls by itself on load: the lead may want to read first.
 */
export function GoToDecision() {
  return (
    <p className="text-sm" data-testid="go-to-decision-line">
      <a
        href="#decision"
        className="text-emphasis font-semibold underline underline-offset-4"
        data-testid="go-to-decision"
        onClick={(e) => {
          e.preventDefault();
          focusDecision();
          window.history.replaceState(window.history.state, '', '#decision');
        }}
      >
        Go to the decision
      </a>
    </p>
  );
}

/** Scroll to the decision section and focus it (honours prefers-reduced-motion). */
export function focusDecision(): boolean {
  const target = document.getElementById('decision');
  if (!target) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
  return true;
}
