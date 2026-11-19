import type { QuoteDetail } from '@ccq/contracts';
import { ATTACHMENT_MAX_BYTES, acceptedFormats } from '@ccq/domain';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLinkIcon, UploadIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { AttachmentDownloadLink, attachmentsQueryKey } from '@/components/attachments/Attachments';
import { Button } from '@/components/ui/button';
import { isApiError, uploadAttachment } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { quoteQueryKey } from '../GateDecisionDialog';
import { timelineQueryKey } from '../Overrides';

/**
 * FB-26 (N17-32, Bailey Schmitt): the CER at hand-off. Links out to the CER tool and the CER template
 * (`cer_tool_url`, `cer_template_url`: Admin settings, empty until Oleg Yarovinski gives them), and the CER
 * proof: a screenshot or PDF of the CER tool, uploaded here (versioned). When
 * `handoff_cer_proof_required` is on, an Approved CER needs it before Commit & Hand Off can advance.
 */
export function HandoffCer({ quote }: { quote: QuoteDetail }) {
  const cer = quote.customerDecision.cer;
  if (!cer) return null;
  const links = [
    cer.toolUrl && { href: cer.toolUrl, label: 'Open the CER tool' },
    cer.templateUrl && { href: cer.templateUrl, label: 'CER template' },
  ].filter((l): l is { href: string; label: string } => Boolean(l));
  return (
    <div className="grid gap-2" data-testid="handoff-cer">
      {links.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emphasis inline-flex min-h-6 items-center gap-1 font-medium hover:underline"
            >
              {l.label}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </p>
      )}
      {cer.setLinksHint && (
        <p className="text-muted-foreground text-xs" data-testid="cer-links-hint">
          Set the CER links in Admin → Settings.
        </p>
      )}
      <div className="grid gap-1 text-sm">
        <span className="font-medium">
          CER proof
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {cer.proofRequired
              ? 'Needed before closing won when the CER is approved'
              : 'Optional'}
          </span>
        </span>
        {cer.proof ? (
          <span data-testid="cer-proof">
            {cer.proof.version !== null && <>v{cer.proof.version} · </>}
            <AttachmentDownloadLink id={cer.proof.id} fileName={cer.proof.fileName} /> ·{' '}
            {cer.proof.uploadedByName ?? 'Someone'} · {absoluteTime(cer.proof.uploadedAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">No CER proof uploaded yet.</span>
        )}
        {cer.canUploadProof && <CerProofUpload quoteNumber={quote.quoteNumber} />}
      </div>
    </div>
  );
}

function CerProofUpload({ quoteNumber }: { quoteNumber: string }) {
  const id = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const formats = acceptedFormats('cer_proof');
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error({ title: 'The file is too large', description: `The limit is ${formats.maxMb} MB.` });
      return;
    }
    setProgress(0);
    uploadAttachment({ quoteNumber }, file, { kind: 'cer_proof' }, setProgress)
      .promise.then((res) => {
        toast.success({
          title: `CER proof uploaded (version ${res.item.version ?? 1})`,
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
        aria-label="Upload the CER proof"
        aria-describedby={hintId}
        tabIndex={-1}
        data-testid="upload-cer_proof"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={progress !== null}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          <UploadIcon aria-hidden="true" />
          {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload the CER proof'}
        </Button>
      </div>
      <span id={hintId} className="text-muted-foreground text-xs">
        A screenshot or PDF of the CER tool. {formats.text}.
      </span>
    </div>
  );
}
