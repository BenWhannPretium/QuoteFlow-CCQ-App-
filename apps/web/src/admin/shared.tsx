import { ADMIN_CONFIG_PROBLEM_CODES, type Approval } from '@ccq/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, BadgeCheckIcon, HourglassIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { useCan } from '@/auth';
import { FormErrors, problemErrors, type ServerError } from '@/components/forms';
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
import { publicConfigQueryKey } from '@/config/public-config';
import { isApiError } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

// B-19 admin configuration console: pieces every screen shares.

/** Leadership reads the console; only config.manage (Admin) sees the edit controls. */
export const useCanEditConfig = () => useCan('config.manage');

/** Admin queries all start with this key, so one invalidation refreshes every screen. */
export const adminKey = (...parts: string[]) => ['admin', 'config', ...parts] as const;

/** After a change (or a 409): refetch the admin screens and the app-wide `config/public`. */
export function useInvalidateConfig() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] }),
      queryClient.invalidateQueries({ queryKey: publicConfigQueryKey }),
    ]);
}

export function BackToAdmin() {
  return (
    <Link
      to="/admin"
      className="text-muted-foreground hover:text-foreground mb-2 inline-flex min-h-11 items-center gap-1 text-sm sm:min-h-0"
    >
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      Admin
    </Link>
  );
}

/** Provisional (a seed awaiting its owner) or approved, by whom and when. */
export function ApprovalBadge({ approval, className }: { approval: Approval; className?: string }) {
  if (approval.provisional) {
    return (
      <span
        className={cn(
          'bg-warning text-warning-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
          className,
        )}
      >
        <HourglassIcon className="size-3" aria-hidden="true" />
        Provisional
      </span>
    );
  }
  return (
    <span
      className={cn(
        'bg-success/15 text-success inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        className,
      )}
      title={
        approval.approvedAt
          ? `Approved by ${approval.approvedByName ?? 'unknown'} on ${absoluteTime(approval.approvedAt)}`
          : undefined
      }
    >
      <BadgeCheckIcon className="size-3" aria-hidden="true" />
      Approved{approval.approvedByName ? ` · ${approval.approvedByName}` : ''}
    </span>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-semibold',
        active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export interface ChangeSubmit {
  changeReason: string;
  /** undefined = leave the approval as it is. */
  approved?: boolean;
  /** Set on the second submit after the server asked for confirmation (value in use, G1 off). */
  confirm: boolean;
}

const CONFIRM_CODES: readonly string[] = [
  ADMIN_CONFIG_PROBLEM_CODES.inUse,
  ADMIN_CONFIG_PROBLEM_CODES.confirmRequired,
];
const MIN_REASON = 5;

/**
 * Every config change goes through this dialog: the fields (children), a required change reason
 * (the decision log's "why"), and optionally the approval. It handles the server's answers:
 * 409 stale (someone else saved first: reload), 409 needs-confirmation (confirm and resubmit) and
 * 422 validation errors.
 */
export function ChangeDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  approval,
  submitLabel = 'Save change',
  canSubmit = true,
  destructive = false,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  onSubmit: (s: ChangeSubmit) => Promise<unknown>;
  /** Show the approval choice (the row's current approval). */
  approval?: Approval | undefined;
  submitLabel?: string;
  /** False while the fields are invalid. */
  canSubmit?: boolean;
  destructive?: boolean;
  wide?: boolean;
}) {
  const ids = { reason: useId(), approval: useId() };
  const invalidate = useInvalidateConfig();
  const [reason, setReason] = useState('');
  const [approvalChoice, setApprovalChoice] = useState<'keep' | 'approve' | 'provisional'>('keep');
  const [errors, setErrors] = useState<ServerError[]>([]);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start clean each time the dialog opens (state adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason('');
      setApprovalChoice('keep');
      setErrors([]);
      setConfirmMessage(null);
    }
  }

  const reasonOk = reason.trim().length >= MIN_REASON;

  async function submit() {
    if (!reasonOk) {
      setErrors([{ path: '/changeReason', message: 'Say why: it is the decision log entry.' }]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await onSubmit({
        changeReason: reason.trim(),
        ...(approvalChoice === 'keep' ? {} : { approved: approvalChoice === 'approve' }),
        confirm: confirmMessage !== null,
      });
      await invalidate();
      toast.success({ title: 'Saved', description: 'The change is in the decision log.' });
      onOpenChange(false);
    } catch (err) {
      const code = isApiError(err) ? (err.problem as { code?: string }).code : undefined;
      if (isApiError(err, 409) && code && CONFIRM_CODES.includes(code)) {
        setConfirmMessage(err.problem.detail ?? 'Please confirm.');
      } else if (isApiError(err, 409) && code === ADMIN_CONFIG_PROBLEM_CODES.stale) {
        await invalidate();
        setErrors([
          {
            path: '/',
            message: `${err.problem.detail ?? 'Someone else changed this.'} The screen has been refreshed.`,
          },
        ]);
      } else {
        setErrors(problemErrors(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={cn(wide && 'sm:max-w-3xl')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {children}
          {approval && (
            <div className="grid gap-1.5">
              <label htmlFor={ids.approval} className="text-sm font-medium">
                Approval
              </label>
              <NativeSelect
                id={ids.approval}
                value={approvalChoice}
                onChange={(e) => setApprovalChoice(e.target.value as typeof approvalChoice)}
              >
                <option value="keep">
                  Keep as is ({approval.provisional ? 'provisional' : 'approved'})
                </option>
                <option value="approve">Mark approved by me</option>
                <option value="provisional">Mark provisional (awaiting the owner)</option>
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor={ids.reason} className="text-sm font-medium">
              Why are you making this change?
            </label>
            <Textarea
              id={ids.reason}
              value={reason}
              required
              minLength={MIN_REASON}
              maxLength={2000}
              aria-invalid={errors.some((e) => e.path === '/changeReason')}
              placeholder="e.g. Agreed with Bailey at the M4 config review"
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">
              Required. Shown in the decision log with your name and the time.
            </span>
          </div>
          {confirmMessage && (
            <p
              role="alert"
              className="bg-warning text-warning-foreground rounded-md p-3 text-sm"
              data-testid="confirm-message"
            >
              {confirmMessage}
            </p>
          )}
          <FormErrors errors={errors} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive || confirmMessage ? 'destructive' : 'action'}
              disabled={busy || !canSubmit}
              aria-busy={busy}
            >
              {busy ? 'Saving…' : confirmMessage ? 'Confirm and save' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled read-only notice for Leadership (and anyone else without config.manage). */
export function ReadOnlyNotice() {
  return (
    <p className="bg-muted text-muted-foreground mb-4 rounded-md p-3 text-sm" role="note">
      Read-only: only Admin can change configuration. Every change is listed in the decision log.
    </p>
  );
}
