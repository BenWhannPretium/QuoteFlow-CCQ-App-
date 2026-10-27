import type { CreateFeedbackBody } from '@ccq/contracts';
import {
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_SEVERITY_LABELS,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  quoteNumberFromPath,
  type FeedbackType,
} from '@ccq/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { CameraIcon, ImageIcon, MessageSquareWarningIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useCan } from '@/auth/hooks';
import { Field, FormErrors, problemErrors, type ServerError } from '@/components/forms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

/** The user menu opens the dialog through this event (the menu closes before a dialog can open). */
export const REPORT_ISSUE_EVENT = 'ccq:report-issue';
export const openReportIssue = () => window.dispatchEvent(new Event(REPORT_ISSUE_EVENT));

interface Screenshot {
  contentType: 'image/png' | 'image/jpeg';
  dataBase64: string;
  previewUrl: string;
}

/** Draw `source` on a canvas no wider than 1920 px; PNG if it fits in 2 MB, else JPEG. */
async function encode(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, 1920 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let out = await blob('image/png');
  let contentType: Screenshot['contentType'] = 'image/png';
  if (!out || out.size > FEEDBACK_SCREENSHOT_MAX_BYTES) {
    out = await blob('image/jpeg', 0.75);
    contentType = 'image/jpeg';
  }
  if (!out || out.size > FEEDBACK_SCREENSHOT_MAX_BYTES) throw new Error('too large');
  const bytes = new Uint8Array(await out.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { contentType, dataBase64: btoa(binary), previewUrl: URL.createObjectURL(out) };
}

/** One frame of a screen, window or tab the user picks (browser screen capture). */
async function captureScreen(): Promise<Screenshot> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => requestAnimationFrame(r));
    return await encode(video, video.videoWidth, video.videoHeight);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

async function fromFile(file: File): Promise<Screenshot> {
  const bitmap = await createImageBitmap(file);
  try {
    return await encode(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

const canCaptureScreen = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/**
 * B-23 "Report an issue": type, severity, description and an optional screenshot. The page, quote,
 * app version, viewport, roles and browser are added for the reporter (the last two by the API).
 * Mounted once in the app shell; opened from the user menu or the page footer.
 */
export function ReportIssueDialog() {
  const allowed = useCan('feedback.submit');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 300_000 });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('bug');
  const [severity, setSeverity] = useState(3);
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ServerError[]>([]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(REPORT_ISSUE_EVENT, onOpen);
    return () => window.removeEventListener(REPORT_ISSUE_EVENT, onOpen);
  }, []);

  const clearShot = () => {
    if (screenshot) URL.revokeObjectURL(screenshot.previewUrl);
    setScreenshot(null);
  };
  const reset = () => {
    clearShot();
    setType('bug');
    setSeverity(3);
    setDescription('');
    setShotError(null);
    setErrors([]);
  };

  const submit = useMutation({
    mutationFn: (body: CreateFeedbackBody) => api.reportIssue(body),
    onSuccess: () => {
      toast.success({
        title: 'Thanks, your report was sent',
        description: 'The QuoteFlow team reviews reports every working day during UAT.',
      });
      reset();
      setOpen(false);
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  const takeShot = async (make: () => Promise<Screenshot>) => {
    setShotError(null);
    try {
      const shot = await make();
      clearShot();
      setScreenshot(shot);
    } catch (err) {
      // The user cancelling the screen picker is not an error.
      if ((err as { name?: string }).name === 'NotAllowedError') return;
      setShotError('That image could not be attached (it may be over 2 MB). Try another.');
    }
  };

  if (!allowed) return null;
  const quoteNumber = quoteNumberFromPath(pathname);
  const tooShort = description.trim().length < 5;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submit.isPending) return;
        setOpen(next);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        data-testid="report-issue-dialog"
      >
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Tell us what went wrong or what would help. We add the page
            {quoteNumber ? ` (${quoteNumber})` : ''}, your role and your browser for you.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort) return;
            submit.mutate({
              type,
              severity,
              description: description.trim(),
              route: pathname,
              quoteNumber,
              appVersion: health.data?.version ?? null,
              viewport: `${window.innerWidth}x${window.innerHeight}`,
              screenshot: screenshot
                ? { contentType: screenshot.contentType, dataBase64: screenshot.dataBase64 }
                : null,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What kind of issue?">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={type}
                  onChange={(e) => setType(e.target.value as FeedbackType)}
                  data-testid="feedback-type"
                >
                  {FEEDBACK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FEEDBACK_TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="How bad is it?">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                  data-testid="feedback-severity"
                >
                  {([1, 2, 3, 4] as const).map((s) => (
                    <option key={s} value={s}>
                      {FEEDBACK_SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <Field
            label="What happened?"
            hint="What you did, what you expected and what you saw instead."
          >
            {(id) => (
              <Textarea
                id={id}
                rows={5}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="feedback-description"
                required
              />
            )}
          </Field>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Screenshot (optional)</span>
            {screenshot ? (
              <div className="flex items-start gap-3">
                <img
                  src={screenshot.previewUrl}
                  alt="Screenshot to send"
                  className="max-h-32 rounded-md border"
                />
                <Button type="button" variant="outline" size="sm" onClick={clearShot}>
                  <XIcon aria-hidden="true" /> Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {canCaptureScreen() && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void takeShot(captureScreen)}
                  >
                    <CameraIcon aria-hidden="true" /> Capture screen
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <ImageIcon aria-hidden="true" /> Upload image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      data-testid="feedback-file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void takeShot(() => fromFile(file));
                      }}
                    />
                  </label>
                </Button>
              </div>
            )}
            {shotError && (
              <span className="text-destructive text-xs" role="alert">
                {shotError}
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              Only the QuoteFlow admins see screenshots. Avoid capturing other apps.
            </span>
          </div>
          <FormErrors errors={errors} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submit.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="action"
              disabled={submit.isPending || tooShort}
              aria-busy={submit.isPending}
              data-testid="feedback-submit"
            >
              {submit.isPending ? 'Sending…' : 'Send report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The footer link on every page. */
export function ReportIssueFooter() {
  const allowed = useCan('feedback.submit');
  if (!allowed) return null;
  return (
    <footer className="text-muted-foreground mx-auto mt-12 flex max-w-6xl justify-end text-sm">
      <Button variant="ghost" size="sm" onClick={openReportIssue} data-testid="report-issue-footer">
        <MessageSquareWarningIcon aria-hidden="true" /> Report an issue
      </Button>
    </footer>
  );
}
