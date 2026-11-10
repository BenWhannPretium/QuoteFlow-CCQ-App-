import type { AdditionalApprovalView, QuoteDetail, TermsExceptionView } from '@ccq/contracts';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useValueList } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { FormErrors, errorFor, problemErrors, type ServerError } from '../forms';

/**
 * FB-08 (F-021, T-007): non-standard payment terms open an exception request. The pricing lead (or the
 * designee holding the role) approves or rejects it with a rationale; a pending or rejected one keeps
 * Final Review from releasing the offer (`g4_required_checks` terms_exception, provisional).
 */
const STATUS: Record<'pending' | 'approved' | 'rejected', { text: string; tone: string }> = {
  pending: { text: 'Waiting for the pricing lead', tone: 'bg-warning text-warning-foreground' },
  approved: { text: 'Approved', tone: 'bg-success text-success-foreground' },
  rejected: { text: 'Rejected', tone: 'bg-destructive text-destructive-foreground' },
};

export function TermsExceptionCard({
  quoteNumber,
  exception,
  onSaved,
}: {
  quoteNumber: string;
  exception: TermsExceptionView;
  onSaved: (next: QuoteDetail) => Promise<void> | void;
}) {
  const terms = useValueList('requested_payment_terms');
  const [rationale, setRationale] = useState('');
  const [errors, setErrors] = useState<ServerError[]>([]);
  const id = useId();
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.decideTermsException(quoteNumber, { decision, rationale: rationale.trim() }),
    onSuccess: async (next, decision) => {
      setErrors([]);
      setRationale('');
      await onSaved(next);
      toast.success({
        title: decision === 'approve' ? 'Exception approved' : 'Exception rejected',
        description: 'Whoever entered the terms and the KAM have been told.',
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  if (!exception) return null;
  const label =
    exception.paymentTermsDetail ??
    terms.find((t) => t.code === exception.paymentTermsCode)?.label ??
    exception.paymentTermsCode;
  const status = STATUS[exception.status];
  return (
    <section
      aria-label="Payment-terms exception"
      className="border-border grid gap-2 rounded-md border p-3 text-sm"
      data-testid="terms-exception"
    >
      <p className="flex flex-wrap items-center gap-2 font-medium">
        Payment-terms exception: {label}
        <span
          className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${status.tone}`}
          data-testid="terms-exception-status"
        >
          {status.text}
        </span>
      </p>
      <p className="text-muted-foreground text-xs">
        Requested by {exception.requestedByName ?? 'someone'} on{' '}
        {absoluteTime(exception.requestedAt)}.
        {exception.decidedAt &&
          ` Decided by ${exception.decidedByName ?? 'the pricing lead'} on ${absoluteTime(exception.decidedAt)}.`}
      </p>
      {exception.rationale && (
        <p data-testid="terms-exception-rationale">
          <span className="font-medium">Rationale:</span> {exception.rationale}
        </p>
      )}
      {exception.canDecide && (
        <div className="grid gap-2">
          <label htmlFor={id} className="text-sm font-medium">
            Rationale (required)
          </label>
          <Textarea
            id={id}
            maxLength={1000}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            aria-invalid={!!errorFor(errors, 'rationale')}
          />
          <FormErrors errors={errors} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={decide.isPending || !rationale.trim()}
              onClick={() => decide.mutate('approve')}
              data-testid="approve-terms-exception"
            >
              Approve the exception
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={decide.isPending || !rationale.trim()}
              onClick={() => decide.mutate('reject')}
              data-testid="reject-terms-exception"
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * FB-08 (F-082, off until A-035): the extra Final Review sign-offs a rule in `g4_additional_approvals`
 * asks for. Shown only when one applies; each is given in order by its role.
 */
export function AdditionalApprovals({
  quoteNumber,
  items,
  onSaved,
}: {
  quoteNumber: string;
  items: AdditionalApprovalView[];
  onSaved: (next: QuoteDetail) => Promise<void> | void;
}) {
  const [errors, setErrors] = useState<ServerError[]>([]);
  const sign = useMutation({
    mutationFn: (item: AdditionalApprovalView) =>
      api.signFinalReview(quoteNumber, { ruleKey: item.ruleKey, signoffKey: item.signoffKey }),
    onSuccess: async (next, item) => {
      setErrors([]);
      await onSaved(next);
      toast.success({ title: `${item.signoffLabel} signed off` });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Additional Final Review approvals"
      className="grid gap-2 text-sm"
      data-testid="additional-approvals"
    >
      <p className="font-medium">{items[0]!.ruleLabel}</p>
      <ol className="grid gap-1">
        {items.map((item) => (
          <li
            key={`${item.ruleKey}:${item.signoffKey}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="font-medium">{item.signoffLabel}:</span>
            {item.signedAt ? (
              <span>
                signed by {item.signedByName ?? 'someone'}, {absoluteTime(item.signedAt)}
              </span>
            ) : (
              <span className="text-muted-foreground">waiting</span>
            )}
            {item.canSign && (
              <Button
                type="button"
                size="sm"
                disabled={sign.isPending}
                onClick={() => sign.mutate(item)}
              >
                Sign off
              </Button>
            )}
          </li>
        ))}
      </ol>
      <FormErrors errors={errors} />
    </section>
  );
}
