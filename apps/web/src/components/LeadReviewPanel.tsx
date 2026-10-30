import type { LeadReviewView } from '@ccq/contracts';
import { useMutation } from '@tanstack/react-query';
import { CornerUpLeftIcon, LockIcon, SendIcon } from 'lucide-react';
import { useId, useState } from 'react';

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

import { problemErrors, type ServerError } from './forms';
import { MISSING_LABELS } from './GateDecisionDialog';

export type LeadReviewKind = 'engineering' | 'pricing';

const NOUN: Record<LeadReviewKind, { assignee: string; lead: string; work: string; gate: string }> =
  {
    engineering: {
      assignee: 'engineer',
      lead: 'engineering lead',
      work: 'engineering review',
      gate: 'G2',
    },
    pricing: { assignee: 'pricer', lead: 'pricing lead', work: 'pricing work', gate: 'G3' },
  };

/**
 * Lead review (2026-10-30), on the Engineering and Quoting tabs. The assigned engineer or pricer
 * submits their part to the lead ("Submit to lead"), which locks it for them; the lead reviews, then
 * decides the gate (the tab's own buttons) or sends it back with a note ("Send back…"). The API
 * decides who may do what (`canSubmit`, `canSendBack`).
 */
export function LeadReviewPanel<T>({
  kind,
  review,
  submit,
  sendBack,
  onDone,
}: {
  kind: LeadReviewKind;
  review: LeadReviewView;
  submit: () => Promise<T>;
  sendBack: (note: string) => Promise<T>;
  onDone: (result: T) => Promise<unknown>;
}) {
  const noun = NOUN[kind];
  const [missing, setMissing] = useState<ServerError[]>([]);
  const [sending, setSending] = useState(false);
  const submitting = useMutation({
    mutationFn: submit,
    onSuccess: async (result) => {
      setMissing([]);
      await onDone(result);
      toast.success({
        title: `Submitted to the ${noun.lead}`,
        description: 'They have been notified. It is locked for you until they send it back.',
      });
    },
    onError: (err) => setMissing(problemErrors(err)),
  });

  if (review.status === 'none' && !review.canSubmit) return null;
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
            review; the {noun.assignee} cannot edit until it is sent back.
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
            Sent back by {review.returnedByName ?? `the ${noun.lead}`}
            {review.returnedAt ? ` on ${absoluteTime(review.returnedAt)}` : ''}
          </p>
          {review.returnNote && <p className="whitespace-pre-wrap">{review.returnNote}</p>}
        </div>
      )}
      {missing.length > 0 && (
        <div role="alert" className="text-destructive grid gap-1" data-testid="lead-review-missing">
          <p className="font-semibold">Not ready to submit yet:</p>
          <ul className="list-disc pl-5">
            {missing.map((m) => (
              <li key={`${m.path}-${m.message}`}>
                {MISSING_LABELS[m.path.replace(/^\//, '')] ?? m.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(review.canSubmit || review.canSendBack) && (
        <div className="flex flex-wrap gap-2">
          {review.canSubmit && (
            <Button size="sm" onClick={() => submitting.mutate()} disabled={submitting.isPending}>
              <SendIcon aria-hidden="true" />
              {submitting.isPending ? 'Submitting…' : `Submit to ${noun.lead}`}
            </Button>
          )}
          {review.canSendBack && (
            <Button size="sm" variant="outline" onClick={() => setSending(true)}>
              <CornerUpLeftIcon aria-hidden="true" />
              Send back to {noun.assignee}…
            </Button>
          )}
        </div>
      )}
      {sending && (
        <SendBackDialog kind={kind} onOpenChange={setSending} sendBack={sendBack} onDone={onDone} />
      )}
    </section>
  );
}

function SendBackDialog<T>({
  kind,
  onOpenChange,
  sendBack,
  onDone,
}: {
  kind: LeadReviewKind;
  onOpenChange: (open: boolean) => void;
  sendBack: (note: string) => Promise<T>;
  onDone: (result: T) => Promise<unknown>;
}) {
  const noun = NOUN[kind];
  const id = useId();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => sendBack(note.trim()),
    onSuccess: async (result) => {
      await onDone(result);
      toast.success({
        title: `Sent back to the ${noun.assignee}`,
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
          <DialogTitle>Send back to the {noun.assignee}</DialogTitle>
          <DialogDescription>
            They can edit the {noun.work} again and resubmit. To move the quote on instead, decide{' '}
            {noun.gate}.
          </DialogDescription>
        </DialogHeader>
        <form
          id="send-back-form"
          className="grid gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) {
              setError('Say what to change.');
              return;
            }
            setError(null);
            mutation.mutate();
          }}
        >
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
