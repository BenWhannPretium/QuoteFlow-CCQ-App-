import type {
  Attachment,
  ModelFileView,
  QuotingStepStatus,
  QuotingStepsView,
} from '@ccq/contracts';
import { ATTACHMENT_EXTENSIONS, ATTACHMENT_MAX_BYTES } from '@ccq/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleDashedIcon, CircleDotIcon, UploadIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { AttachmentDownloadLink, attachmentsQueryKey } from '@/components/attachments/Attachments';
import { Button } from '@/components/ui/button';
import { api, isApiError, uploadAttachment } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { quoteQueryKey } from '../GateDecisionDialog';
import { timelineQueryKey } from '../Overrides';

/**
 * FB-07 (D-001, decided Nov 9): costing, then ROI, then price approved, as steps inside Quoting.
 * 1. Costing: Pricing uploads the costing model (costs and the initial price assumptions) and attests it.
 * 2. ROI: Finance builds the ROI from it and uploads the ROI model, only when capital is required.
 * 3. Price approved: the pricing lead approves the price (G3), with an updated price table if it changed.
 * Each step shows who did it and when. QuoteFlow keeps the files and their versions; it never shows
 * or edits a figure from them (CLAUDE.md rule 5). The server decides who may upload (`canUpload`).
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
          Costing, ROI and price approval
        </h2>
        <p className="text-muted-foreground text-sm">
          In order: Pricing’s costing model, then Finance’s ROI when capital is required, then the
          pricing lead approves the price.
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
              {steps.costing.noModelOnFile && (
                <p className="text-sm" data-testid="no-model-on-file">
                  No model on file: costed before QuoteFlow kept the costing model (grandfathered).
                </p>
              )}
              <p className="text-muted-foreground text-xs" data-testid="costing-attested">
                {steps.costing.attested
                  ? `Costing attested${steps.costing.attestedByName ? ` by ${steps.costing.attestedByName}` : ''}${steps.costing.attestedAt ? ` on ${absoluteTime(steps.costing.attestedAt)}` : ''}`
                  : 'Costing not attested yet (tick “Costing completed” below once the model is on file).'}
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
          title="ROI"
          status={steps.roi.status}
          testId="step-roi"
          body={
            steps.roi.required ? (
              <>
                <p className="text-sm">
                  Needed: <span data-testid="roi-reasons">{steps.roi.reasons.join('; ')}</span>
                </p>
                <ModelLine model={steps.roi.model} label="ROI model" />
                {steps.roi.olderThanCostModel && (
                  <p
                    className="bg-warning text-warning-foreground rounded-md px-2 py-1 text-xs"
                    data-testid="roi-older"
                  >
                    The ROI was uploaded before the current costing model: check it still holds.
                  </p>
                )}
                {!compact && <History items={history('roi_model')} />}
                {!compact && steps.roi.canUpload && (
                  <ModelUpload
                    quoteNumber={quoteNumber}
                    kind="roi_model"
                    label={steps.roi.model ? 'Upload a new version' : 'Upload the ROI model'}
                  />
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-sm" data-testid="roi-not-required">
                {steps.roi.notRequiredText}
              </p>
            )
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
                  : 'The pricing lead approves the price (G3) once costing and, when needed, the ROI are on file.'}
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
  not_required: 'Not required',
};

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
    return <p className="text-muted-foreground text-sm">No {label.toLowerCase()} uploaded yet.</p>;
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

const ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');

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
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error({ title: 'The file is too large', description: 'The limit is 100 MB.' });
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
        accept={ACCEPT}
        className="sr-only"
        data-testid={`upload-${kind}`}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={progress !== null}
        onClick={() => input.current?.click()}
      >
        <UploadIcon />
        {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : label}
      </Button>
    </div>
  );
}
