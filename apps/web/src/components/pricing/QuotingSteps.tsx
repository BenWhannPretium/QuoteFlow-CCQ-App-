import type {
  Attachment,
  ModelFileView,
  QuotingStepStatus,
  QuotingStepsView,
} from '@ccq/contracts';
import { ATTACHMENT_MAX_BYTES, acceptedFormats } from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  SendIcon,
  UndoIcon,
  UploadIcon,
} from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { AttachmentDownloadLink, attachmentsQueryKey } from '@/components/attachments/Attachments';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { api, isApiError, uploadAttachment } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { quoteQueryKey } from '../GateDecisionDialog';
import { timelineQueryKey } from '../Overrides';
import { ModelSummaryPanel } from './ModelSummary';

/**
 * FB-07 (D-001, decided Nov 9): costing, then payback, then price approved, as steps inside Quoting.
 * 1. Costing: Pricing uploads the costing model (costs and the initial price assumptions) and attests it.
 * 2. Payback (`roi_model`; "Payback" since FB-14, Stacy Slocum): FB-21 (N17-21, Ben 2026-11-18), only
 *    when the pricer or the pricing lead asks Finance for one; Finance builds it from the costing model.
 * 3. Price approved: the pricing lead approves the price (G3), with an updated price table if it changed.
 * Each step shows who did it and when. QuoteFlow keeps the files and their versions, and (FB-14) shows
 * a read-only summary of figures read from the workbook; it never edits or recomputes a figure
 * (CLAUDE.md rule 5). The server decides who may upload (`canUpload`).
 */
export function QuotingSteps({
  quoteNumber,
  steps,
  compact = false,
}: {
  quoteNumber: string;
  steps: QuotingStepsView;
  /** Read-only (Final Review): the current files, who and when; no history, no uploads. */
  compact?: boolean;
}) {
  const files = useQuery({
    queryKey: attachmentsQueryKey({ quoteNumber }),
    queryFn: () => api.quoteAttachments(quoteNumber),
    enabled: !compact,
  });
  const history = (kind: ModelFileView['kind']) =>
    (files.data?.items ?? [])
      .filter((f) => f.kind === kind && !f.current)
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  return (
    <section
      aria-labelledby="quoting-steps-h"
      className="bg-card rounded-card grid gap-4 border p-4"
      data-testid="quoting-steps"
      data-current={steps.current}
    >
      <div className="grid gap-1">
        <h2 id="quoting-steps-h" className="text-base font-semibold">
          Costing, payback and price approval
        </h2>
        <p className="text-muted-foreground text-sm">
          In order: Pricing’s costing model, then Finance’s payback model if someone asks for one,
          then the pricing lead approves the price.
        </p>
      </div>
      <ol className="grid gap-3 lg:grid-cols-3">
        <Step
          n={1}
          title="Costing"
          status={steps.costing.status}
          testId="step-costing"
          body={
            <>
              <ModelLine model={steps.costing.model} label="Costing model" />
              {steps.costing.model && (
                <ModelSummaryPanel
                  quoteNumber={quoteNumber}
                  kind="cost_model"
                  label="Costing model"
                />
              )}
              {steps.costing.noModelOnFile && (
                <p className="text-sm" data-testid="no-model-on-file">
                  No model on file: costed before QuoteFlow kept the costing model (grandfathered).
                </p>
              )}
              <p className="text-muted-foreground text-xs" data-testid="costing-attested">
                {steps.costing.attested
                  ? `Costing attested${steps.costing.attestedByName ? ` by ${steps.costing.attestedByName}` : ''}${steps.costing.attestedAt ? ` on ${absoluteTime(steps.costing.attestedAt)}` : ''}`
                  : 'Costing is not marked completed yet. It is ticked for you when the costing model is uploaded.'}
              </p>
              {!compact && <History items={history('cost_model')} />}
              {!compact && steps.costing.canUpload && (
                <ModelUpload
                  quoteNumber={quoteNumber}
                  kind="cost_model"
                  label={steps.costing.model ? 'Upload a new version' : 'Upload the costing model'}
                />
              )}
            </>
          }
        />
        <Step
          n={2}
          title="Payback"
          status={steps.roi.status}
          testId="step-roi"
          body={
            <>
              <PaybackRequestPanel quoteNumber={quoteNumber} roi={steps.roi} compact={compact} />
              {(steps.roi.required || steps.roi.model) && (
                <ModelLine model={steps.roi.model} label="Payback model" />
              )}
              {steps.roi.model && (
                <ModelSummaryPanel
                  quoteNumber={quoteNumber}
                  kind="roi_model"
                  label="Payback model"
                />
              )}
              {steps.roi.olderThanCostModel && (
                <p
                  className="bg-warning text-warning-foreground rounded-md px-2 py-1 text-xs"
                  data-testid="roi-older"
                >
                  The payback model was uploaded before the current costing model: check it still
                  holds.
                </p>
              )}
              {!compact && <History items={history('roi_model')} />}
              {!compact && steps.roi.canUpload && (
                <ModelUpload
                  quoteNumber={quoteNumber}
                  kind="roi_model"
                  label={steps.roi.model ? 'Upload a new version' : 'Upload the payback model'}
                />
              )}
            </>
          }
        />
        <Step
          n={3}
          title="Price approved"
          status={steps.price.status}
          testId="step-price"
          body={
            <>
              <p className="text-sm" data-testid="price-confirmed">
                {steps.price.status === 'done'
                  ? `Approved${steps.price.confirmedByName ? ` by ${steps.price.confirmedByName}` : ''}${steps.price.confirmedAt ? ` on ${absoluteTime(steps.price.confirmedAt)}` : ''}`
                  : 'The pricing lead approves the price once the costing model is uploaded and, if someone asked Finance for one, the payback model.'}
              </p>
              {steps.price.priceTable ? (
                <ModelLine model={steps.price.priceTable} label="Updated price table" />
              ) : (
                <p className="text-muted-foreground text-xs">
                  No updated price table: the price in the models stands.
                </p>
              )}
              {!compact && <History items={history('price_table')} />}
              {!compact && steps.price.canUploadPriceTable && (
                <ModelUpload
                  quoteNumber={quoteNumber}
                  kind="price_table"
                  label={
                    steps.price.priceTable
                      ? 'Upload a new version'
                      : 'Upload an updated price table (optional)'
                  }
                />
              )}
            </>
          }
        />
      </ol>
    </section>
  );
}

const STATUS_TEXT: Record<QuotingStepStatus, string> = {
  done: 'Done',
  waiting: 'Next',
  blocked: 'Waiting on an earlier step',
  not_requested: 'Not requested',
};

/**
 * FB-21 (N17-21, N17-22; Ben, 2026-11-18): who asked Finance for a payback model and whether it is in;
 * "Ask Finance for a payback model" (optional note) and "Withdraw request" (a short reason) for the
 * assigned pricer and the pricing lead. The server decides who may (`canRequest`, `canWithdraw`).
 */
function PaybackRequestPanel({
  quoteNumber,
  roi,
  compact,
}: {
  quoteNumber: string;
  roi: QuotingStepsView['roi'];
  compact: boolean;
}) {
  const qc = useQueryClient();
  const noteId = useId();
  const reasonId = useId();
  const [asking, setAsking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = async (title: string) => {
    toast.success({ title });
    setAsking(false);
    setWithdrawing(false);
    setNote('');
    setReason('');
    setError(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
      qc.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
    ]);
  };
  const fail = (err: unknown) =>
    setError((isApiError(err) && err.problem.detail) || 'Please try again.');
  const ask = useMutation({
    mutationFn: () => api.requestPayback(quoteNumber, note.trim() || null),
    onSuccess: () => done('Finance has been asked for a payback model'),
    onError: fail,
  });
  const withdraw = useMutation({
    mutationFn: () => api.withdrawPayback(quoteNumber, reason.trim()),
    onSuccess: () => done('Payback request withdrawn'),
    onError: fail,
  });
  const r = roi.request;
  const noFinance = roi.financeUsers === 0;
  return (
    <div className="grid gap-2 text-sm" data-testid="payback-request" data-status={r.status}>
      {r.status === 'none' && (
        <p className="text-muted-foreground" data-testid="roi-not-required">
          {roi.notRequiredText}
        </p>
      )}
      {(r.status === 'open' || r.status === 'received') && (
        <p data-testid="payback-requested">
          Requested from Finance{r.requestedByName ? ` by ${r.requestedByName}` : ''}
          {r.requestedAt ? ` on ${absoluteTime(r.requestedAt)}` : ''}.{' '}
          {r.status === 'received'
            ? 'Finance has uploaded the payback model.'
            : 'Waiting on Finance to upload it.'}
        </p>
      )}
      {r.note && r.status !== 'withdrawn' && (
        <p className="text-muted-foreground whitespace-pre-wrap">Note to Finance: {r.note}</p>
      )}
      {r.status === 'withdrawn' && (
        <p className="text-muted-foreground" data-testid="payback-withdrawn">
          {roi.notRequiredText} The last request was withdrawn
          {r.withdrawnByName ? ` by ${r.withdrawnByName}` : ''}
          {r.withdrawnAt ? ` on ${absoluteTime(r.withdrawnAt)}` : ''}
          {r.withdrawReason ? `: ${r.withdrawReason}` : '.'}
        </p>
      )}
      {r.status === 'open' && noFinance && (
        <p
          className="bg-warning text-warning-foreground rounded-md px-2 py-1 text-xs"
          data-testid="payback-no-finance"
        >
          No one holds the Finance role, so no one was told. Ask an Admin to give someone the
          Finance role.
        </p>
      )}
      {roi.hint && r.status !== 'open' && r.status !== 'received' && (
        <p className="text-xs" data-testid="payback-hint">
          {roi.hint}
        </p>
      )}
      {!compact && roi.canRequest && !asking && (
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => setAsking(true)}
          data-testid="payback-ask"
        >
          <SendIcon aria-hidden="true" />
          Ask Finance for a payback model
        </Button>
      )}
      {!compact && asking && (
        <form
          className="grid gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            ask.mutate();
          }}
        >
          <label htmlFor={noteId} className="font-medium">
            Note to Finance (optional)
          </label>
          <Textarea
            id={noteId}
            value={note}
            maxLength={500}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
          />
          {noFinance && (
            <p className="text-xs" data-testid="payback-no-finance-before">
              No one holds the Finance role yet, so no one will be told.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={ask.isPending}>
              {ask.isPending ? 'Sending…' : 'Ask Finance'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAsking(false)}
              disabled={ask.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!compact && roi.canWithdraw && !withdrawing && (
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => setWithdrawing(true)}
          data-testid="payback-withdraw"
        >
          <UndoIcon aria-hidden="true" />
          Withdraw request
        </Button>
      )}
      {!compact && withdrawing && (
        <form
          className="grid gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) {
              setError('Say why Finance can stop.');
              return;
            }
            withdraw.mutate();
          }}
        >
          <label htmlFor={reasonId} className="font-medium">
            Why withdraw it?
          </label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={200}
            rows={2}
            aria-invalid={!!error}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={withdraw.isPending}>
              {withdraw.isPending ? 'Withdrawing…' : 'Withdraw request'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setWithdrawing(false)}
              disabled={withdraw.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  status,
  body,
  testId,
}: {
  n: number;
  title: string;
  status: QuotingStepStatus;
  body: ReactNode;
  testId: string;
}) {
  const Icon =
    status === 'done' ? CheckCircle2Icon : status === 'waiting' ? CircleDotIcon : CircleDashedIcon;
  return (
    <li
      className={cn(
        'grid content-start gap-2 rounded-md border p-3',
        status === 'waiting' && 'border-line-strong',
      )}
      data-testid={testId}
      data-status={status}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Icon
          className={cn('size-4', status === 'done' ? 'text-emphasis' : 'text-muted-foreground')}
          aria-hidden="true"
        />
        {n}. {title}
        <span className="bg-secondary text-foreground rounded-pill px-2 py-0.5 text-xs font-medium">
          {STATUS_TEXT[status]}
        </span>
      </p>
      {body}
    </li>
  );
}

function ModelLine({ model, label }: { model: ModelFileView | null; label: string }) {
  if (!model) {
    // DR-pricing-finance-13: "No ROI model uploaded yet." (lower-casing the label made it "roi").
    return (
      <p className="text-muted-foreground text-sm">
        No {/^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)}{' '}
        uploaded yet.
      </p>
    );
  }
  return (
    <div className="grid gap-0.5 text-sm" data-testid={`model-${model.kind}`}>
      <p className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{label}</span>
        <span className="bg-secondary text-foreground rounded-pill px-2 py-0.5 text-xs font-semibold">
          v{model.version} · current
        </span>
      </p>
      <p className="min-w-0 break-all">
        {model.available ? (
          <AttachmentDownloadLink id={model.id} fileName={model.fileName} />
        ) : (
          model.fileName
        )}
      </p>
      <p className="text-muted-foreground text-xs">
        {model.uploadedByName ?? 'Someone'} · {absoluteTime(model.uploadedAt)}
        {model.versions > 1 ? ` · ${model.versions} versions` : ''}
      </p>
    </div>
  );
}

/** Earlier versions, newest first (kept and downloadable, F-074). */
function History({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <details className="text-xs" data-testid="model-history">
      <summary className="text-muted-foreground cursor-pointer">
        Earlier versions ({items.length})
      </summary>
      <ul className="mt-1 grid gap-1">
        {items.map((f) => (
          <li key={f.id}>
            v{f.version} ·{' '}
            {f.available ? <AttachmentDownloadLink id={f.id} fileName={f.fileName} /> : f.fileName}{' '}
            · {f.uploadedByName ?? 'Someone'} · {absoluteTime(f.uploadedAt)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ModelUpload({
  quoteNumber,
  kind,
  label,
}: {
  quoteNumber: string;
  kind: ModelFileView['kind'];
  label: string;
}) {
  const id = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  // FB-21 Part E (N17-24): the formats and size limit the server checks, said beside the button.
  const formats = acceptedFormats(kind);
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
    uploadAttachment({ quoteNumber }, file, { kind }, setProgress)
      .promise.then((res) => {
        toast.success({
          title: `Version ${res.item.version ?? 1} uploaded`,
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
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={-1}
        data-testid={`upload-${kind}`}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={progress !== null}
        aria-describedby={hintId}
        onClick={() => input.current?.click()}
      >
        <UploadIcon />
        {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : label}
      </Button>
      <p id={hintId} className="text-muted-foreground text-xs" data-testid={`formats-${kind}`}>
        {formats.text}
      </p>
    </div>
  );
}
