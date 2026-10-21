import {
  ATTACHMENT_KIND_LABELS,
  ATTACHMENT_KIND_VALUES,
  type Attachment,
  type AttachmentKindValue,
} from '@ccq/contracts';
import { ATTACHMENT_EXTENSIONS, ATTACHMENT_MAX_BYTES, checkUploadRequest } from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CameraIcon,
  DownloadIcon,
  FileIcon,
  PaperclipIcon,
  RotateCwIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { quoteQueryKey } from '@/components/GateDecisionDialog';
import { timelineQueryKey } from '@/components/Overrides';
import { SkeletonRows } from '@/components/Skeletons';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import {
  api,
  isApiError,
  uploadAttachment,
  type AttachmentTarget,
  type UploadHandle,
} from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');
const MAX_MB = ATTACHMENT_MAX_BYTES / (1024 * 1024);

export const attachmentsQueryKey = (target: AttachmentTarget) =>
  'quoteNumber' in target
    ? (['attachments', 'quote', target.quoteNumber] as const)
    : (['attachments', 'draft', target.draftId] as const);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface QueueItem {
  key: number;
  file: File;
  kind: AttachmentKindValue;
  note: string;
  progress: number;
  status: 'uploading' | 'error';
  error: string | null;
  /** Server or network failures can be retried; a refused type or size cannot. */
  retryable: boolean;
  handle: UploadHandle | null;
}

let nextKey = 1;

function errorText(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { message: 'Cancelled', retryable: true };
  }
  if (isApiError(err)) {
    const status = err.status;
    return {
      message: err.problem.detail ?? err.problem.title,
      retryable: status >= 500 || status === 401 || status === 409,
    };
  }
  return { message: err instanceof Error ? err.message : 'Upload failed', retryable: true };
}

/**
 * Files on a quote or an intake draft (F-13, B-16): a drop zone (plus "Add photo" on phones),
 * per-file progress with retry, clear type/size errors, and the list with download and remove.
 * The server is the control: it re-checks type, size, content and permission on every upload.
 */
export function AttachmentsPanel({
  target,
  defaultKind = 'bottle_drawing',
  onDrawingStatus,
  heading = 'Attachments',
  headingLevel = 2,
}: {
  target: AttachmentTarget;
  defaultKind?: AttachmentKindValue;
  /** A bottle drawing set the drawing status (the intake wizard mirrors it in its form). */
  onDrawingStatus?: (code: string) => void;
  heading?: string;
  headingLevel?: 2 | 3;
}) {
  const qc = useQueryClient();
  const key = attachmentsQueryKey(target);
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      'quoteNumber' in target
        ? api.quoteAttachments(target.quoteNumber)
        : api.draftAttachments(target.draftId),
  });
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [kind, setKind] = useState<AttachmentKindValue>(defaultKind);
  const [note, setNote] = useState('');
  const handles = useRef(new Set<UploadHandle>());
  const ids = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  // Leaving the page cancels uploads still in flight.
  useEffect(() => {
    const current = handles.current;
    return () => current.forEach((h) => h.abort());
  }, []);

  const patch = (k: number, p: Partial<QueueItem>) =>
    setQueue((q) => q.map((i) => (i.key === k ? { ...i, ...p } : i)));

  const start = (item: QueueItem) => {
    const handle = uploadAttachment(
      target,
      item.file,
      { kind: item.kind, ...(item.note ? { note: item.note } : {}) },
      (fraction) => patch(item.key, { progress: fraction }),
    );
    handles.current.add(handle);
    patch(item.key, { status: 'uploading', progress: 0, error: null, handle });
    handle.promise
      .then(
        (res) => {
          setQueue((q) => q.filter((i) => i.key !== item.key));
          void qc.invalidateQueries({ queryKey: key });
          if ('quoteNumber' in target) {
            void qc.invalidateQueries({ queryKey: timelineQueryKey(target.quoteNumber) });
            if (res.drawingStatus) {
              void qc.invalidateQueries({ queryKey: quoteQueryKey(target.quoteNumber) });
            }
          }
          if (res.drawingStatus) {
            onDrawingStatus?.(res.drawingStatus.to);
            toast.success({
              title: 'Drawing attached',
              description: 'Drawing status: have drawing',
            });
          } else {
            toast.success({ title: `${res.item.fileName} uploaded`, key: 'attachment-uploaded' });
          }
        },
        (err: unknown) => {
          const { message, retryable } = errorText(err);
          patch(item.key, { status: 'error', error: message, retryable, handle: null });
        },
      )
      .finally(() => handles.current.delete(handle));
  };

  const addFiles = (files: FileList | File[] | null, forceKind?: AttachmentKindValue) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const itemKind = forceKind ?? kind;
      // Instant feedback on type and size; the server checks again (and the content).
      const checked = checkUploadRequest({ fileName: file.name, size: file.size, kind: itemKind });
      const item: QueueItem = {
        key: nextKey++,
        file,
        kind: itemKind,
        note: note.trim(),
        progress: 0,
        status: 'error',
        error: checked.errors[0]?.message ?? null,
        retryable: false,
        handle: null,
      };
      setQueue((q) => [...q, item]);
      if (checked.errors.length === 0) start(item);
    }
    setNote('');
  };

  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const canUpload = list.data?.canUpload ?? false;

  return (
    <section aria-labelledby={`${ids}-h`} className="grid gap-4" data-testid="attachments">
      <Heading id={`${ids}-h`} className="text-base font-semibold">
        {heading}
        {list.data ? ` (${list.data.items.length})` : ''}
      </Heading>

      {canUpload && (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <label className="grid gap-1 text-sm font-medium" htmlFor={`${ids}-kind`}>
              Kind
              <NativeSelect
                id={`${ids}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as AttachmentKindValue)}
              >
                {ATTACHMENT_KIND_VALUES.map((k) => (
                  <option key={k} value={k}>
                    {ATTACHMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm font-medium" htmlFor={`${ids}-note`}>
              Note (optional)
              <Input
                id={`${ids}-note`}
                value={note}
                maxLength={500}
                placeholder="e.g. Rev C from the customer"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          <div
            data-testid="drop-zone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'rounded-card flex flex-col items-center gap-2 border-2 border-dashed px-4 py-6 text-center',
              dragging ? 'border-primary bg-accent' : 'border-line-strong',
            )}
          >
            <UploadCloudIcon className="text-muted-foreground size-8" aria-hidden="true" />
            <p className="text-sm">
              Drag files here, or{' '}
              <label
                htmlFor={`${ids}-file`}
                className="text-emphasis cursor-pointer font-semibold underline underline-offset-4"
              >
                choose files
              </label>
            </p>
            <input
              id={`${ids}-file`}
              data-testid="attachment-input"
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              aria-describedby={`${ids}-rules`}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <p id={`${ids}-rules`} className="text-muted-foreground text-xs">
              PDF, images (PNG, JPG, HEIC), CAD (DWG, DXF, STEP, IGS), Excel, Word or email (MSG,
              EML). Up to {MAX_MB} MB each.
            </p>
            {/* Phones: straight to the camera for a photo of the sample. */}
            <label
              htmlFor={`${ids}-camera`}
              className="border-line-strong bg-card hover:bg-accent rounded-pill inline-flex min-h-11 cursor-pointer items-center gap-2 border px-4 text-sm font-medium sm:min-h-10"
            >
              <CameraIcon className="size-4" aria-hidden="true" /> Add photo
            </label>
            <input
              id={`${ids}-camera`}
              data-testid="attachment-camera"
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files, 'sample_photo');
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}

      {queue.length > 0 && (
        <ul className="grid gap-2" aria-label="Uploads" data-testid="upload-queue">
          {queue.map((item) => (
            <li
              key={item.key}
              className={cn(
                'rounded-card grid gap-2 border p-3',
                item.status === 'error' && 'border-destructive',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileIcon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.file.name}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatBytes(item.file.size)}
                </span>
              </div>
              {item.status === 'uploading' ? (
                <div className="flex items-center gap-2">
                  <progress
                    className="h-2 w-full"
                    max={1}
                    value={item.progress}
                    aria-label={`Uploading ${item.file.name}`}
                  />
                  <span className="w-10 text-right text-xs tabular-nums">
                    {Math.round(item.progress * 100)}%
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Cancel ${item.file.name}`}
                    onClick={() => item.handle?.abort()}
                  >
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2" role="alert">
                  <p className="text-destructive min-w-0 flex-1 text-sm" data-testid="upload-error">
                    {item.error}
                  </p>
                  {item.retryable && (
                    <Button size="sm" variant="outline" onClick={() => start(item)}>
                      <RotateCwIcon /> Retry
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setQueue((q) => q.filter((i) => i.key !== item.key))}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.isPending ? (
        <SkeletonRows rows={2} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={PaperclipIcon}
          title="No files yet"
          description={
            canUpload
              ? 'A bottle drawing gets the quote to Engineering fastest. Drawings are requested, never required.'
              : undefined
          }
        />
      ) : (
        <AttachmentList items={list.data.items} target={target} />
      )}
    </section>
  );
}

function AttachmentList({ items, target }: { items: Attachment[]; target: AttachmentTarget }) {
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const download = useMutation({
    mutationFn: (id: string) => api.attachmentLink(id),
    onSuccess: (link) => window.location.assign(link.url),
    onError: (err) =>
      toast.error({
        title: 'Could not download the file',
        description: (isApiError(err) && err.problem.detail) || 'Please try again.',
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeAttachment(id),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: attachmentsQueryKey(target) });
      if ('quoteNumber' in target) {
        void qc.invalidateQueries({ queryKey: timelineQueryKey(target.quoteNumber) });
      }
      toast.success({ title: 'File removed' });
    },
    onError: (err) =>
      toast.error({
        title: 'Could not remove the file',
        description: (isApiError(err) && err.problem.detail) || 'Please try again.',
      }),
  });

  return (
    <>
      <ul className="divide-y rounded-card border" data-testid="attachment-list">
        {items.map((a) => (
          <li
            key={a.id}
            data-testid="attachment-row"
            className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
          >
            <div className="grid min-w-0 gap-0.5">
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                <span className="bg-secondary text-secondary-foreground rounded-pill px-2 py-0.5 text-xs font-medium">
                  {ATTACHMENT_KIND_LABELS[a.kind]}
                </span>
                <span className="min-w-0 font-medium break-all">{a.fileName}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {formatBytes(a.size)} · {a.uploadedByName ?? 'Someone'} ·{' '}
                {absoluteTime(a.uploadedAt)}
              </p>
              {a.note && <p className="text-sm">{a.note}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {a.available ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Download ${a.fileName}`}
                  disabled={download.isPending && download.variables === a.id}
                  onClick={() => download.mutate(a.id)}
                >
                  <DownloadIcon /> Download
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">No stored copy</span>
              )}
              {a.canRemove && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${a.fileName}`}
                  onClick={() => setRemoving(a)}
                >
                  <Trash2Icon /> Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.fileName ?? 'this file'}?`}
        description="It moves to the removed-files folder (an admin can restore it) and leaves the quote's list."
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </>
  );
}

/** A file name that downloads through the audited route (Final Review and other read-only lists). */
export function AttachmentDownloadLink({ id, fileName }: { id: string; fileName: string }) {
  const download = useMutation({
    mutationFn: () => api.attachmentLink(id),
    onSuccess: (link) => window.location.assign(link.url),
    onError: (err) =>
      toast.error({
        title: 'Could not download the file',
        description: (isApiError(err) && err.problem.detail) || 'Please try again.',
      }),
  });
  return (
    <button
      type="button"
      className="text-emphasis min-h-11 text-left underline underline-offset-4 sm:min-h-0"
      disabled={download.isPending}
      onClick={() => download.mutate()}
    >
      {fileName}
    </button>
  );
}
