import type { AdditionalApprovalView, QuoteDetail, TermsExceptionView } from '@ccq/contracts';
import { ATTACHMENT_MAX_BYTES, acceptedFormats, termsExceptionWaitingText } from '@ccq/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UploadIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { AttachmentDownloadLink, attachmentsQueryKey } from '@/components/attachments/Attachments';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useValueList } from '@/config/public-config';
import { api, isApiError, uploadAttachment } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { FormErrors, errorFor, problemErrors, type ServerError } from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { timelineQueryKey } from '../Overrides';

/**
 * FB-08 (F-021, T-007): non-standard payment terms open an exception request, approved or rejected with
 * a rationale; a pending or rejected one keeps Final Review from releasing the offer
 * (`g4_required_checks` terms_exception, provisional). FB-31 (N19-07): who decides is the request's tier
 * of `terms_exception_routes` (the pricing lead for Net 45, Leadership for Net 60 and above in the
 * provisional seed), and a tier may need a supporting document (Payment-terms approval) as well.
 */
const STATUS: Record<'approved' | 'rejected', { text: string; tone: string }> = {
  approved: { text: 'Approved', tone: 'bg-success text-success-foreground' },
  rejected: { text: 'Rejected', tone: 'bg-destructive text-destructive-foreground' },
};
const PENDING_TONE = 'bg-warning text-warning-foreground';

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
  const status =
    exception.status === 'pending'
      ? { text: termsExceptionWaitingText(exception), tone: PENDING_TONE }
      : STATUS[exception.status];
  const missingDocument = exception.documentRequired && !exception.document;
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
        {exception.status === 'pending' && ` Decided by ${exception.approverLabel}.`}
        {exception.decidedAt &&
          ` Decided by ${exception.decidedByName ?? exception.approverLabel} on ${absoluteTime(exception.decidedAt)}.`}
      </p>
      {(exception.documentRequired || exception.document) && (
        <div className="grid content-start gap-1" data-testid="terms-exception-document">
          <span className="font-medium">
            Supporting document (Payment-terms approval)
            {exception.documentRequired && (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                Needed before it can be approved
              </span>
            )}
          </span>
          {exception.document ? (
            <span data-testid="terms-exception-document-file">
              {exception.document.version !== null && <>v{exception.document.version} · </>}
              <AttachmentDownloadLink
                id={exception.document.id}
                fileName={exception.document.fileName}
              />{' '}
              · {exception.document.uploadedByName ?? 'Someone'} ·{' '}
              {absoluteTime(exception.document.uploadedAt)}
            </span>
          ) : (
            <span className="text-muted-foreground">No document attached yet.</span>
          )}
          {exception.canUploadDocument && <TermsDocumentUpload quoteNumber={quoteNumber} />}
        </div>
      )}
      {exception.rationale && (
        <p data-testid="terms-exception-rationale">
          <span className="font-medium">Rationale:</span> {exception.rationale}
        </p>
      )}
      {exception.decideNote && (
        <p className="text-muted-foreground text-xs" data-testid="terms-exception-decide-note">
          {exception.decideNote}
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
              disabled={decide.isPending || !rationale.trim() || missingDocument}
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
 * FB-31 (N19-07): the formal documentation behind the exception, uploaded here as a versioned
 * `payment_terms_approval` file (a memo, a signed form or the approval e-mail).
 */
function TermsDocumentUpload({ quoteNumber }: { quoteNumber: string }) {
  const id = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const formats = acceptedFormats('payment_terms_approval');
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error({
        title: 'The file is too large',
        description: `The limit is ${formats.maxMb} MB.`,
      });
      return;
    }
    setProgress(0);
    uploadAttachment({ quoteNumber }, file, { kind: 'payment_terms_approval' }, setProgress)
      .promise.then((res) => {
        toast.success({
          title: `Supporting document uploaded (version ${res.item.version ?? 1})`,
          description: res.item.fileName,
        });
        return Promise.all([
          qc.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
          qc.invalidateQueries({ queryKey: attachmentsQueryKey({ quoteNumber }) }),
          qc.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
        ]);
      })
      .catch((err: unknown) =>
        toast.error({
          title: 'The upload was not accepted',
          description: (isApiError(err) && err.problem.detail) || 'Please try again.',
        }),
      )
      .finally(() => {
        setProgress(null);
        if (input.current) input.current.value = '';
      });
  };
  return (
    <div className="grid gap-1">
      <input
        ref={input}
        id={id}
        type="file"
        accept={formats.accept}
        className="sr-only"
        aria-label="Upload the supporting document"
        aria-describedby={hintId}
        tabIndex={-1}
        data-testid="upload-payment_terms_approval"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={progress !== null}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          <UploadIcon aria-hidden="true" />
          {progress !== null
            ? `Uploading… ${Math.round(progress * 100)}%`
            : 'Upload the supporting document'}
        </Button>
      </div>
      <span id={hintId} className="text-muted-foreground text-xs">
        The approval memo, signed form or e-mail. {formats.text}.
      </span>
    </div>
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
