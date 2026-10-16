import type { AvailableGateAction, GateDecisionBody, GateDecisionResponse } from '@ccq/contracts';
import { EXPIRED_OUTCOME, LOST_OUTCOME, proposalCalendarDate, validityUntil } from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { useCurrentUser } from '@/auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { stageLabel, usePublicConfig } from '@/config/public-config';
import { api, isApiError } from '@/lib/api';
import { toLocalInput } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { finalReviewQueueKey, reviewSummaryKey } from './final-review/keys';
import { QualificationWarnings, ScoreBreakdownTable } from './Priority';

/** Plain words for the G3 (Quoting) rules' field paths (B-11); other gates show the rule's message. */
const MISSING_LABELS: Record<string, string> = {
  'pricing_record.price_approved_by': 'Price approver',
  'pricing_record.price_approved_at': 'Price approval date',
  'pricing_record.pricing_refs.erf,pricing_record.pricing_refs.bpr,pricing_record.no_pricing_app_record_note':
    'An ERF or BPR reference, or a "no pricing-app record yet" note',
  'pricing_record.capital_readiness': 'Capital readiness',
  'pricing_record.capital_readiness,pricing_record.capital_pending_justification':
    'Capital readiness other than pending, or a pending-capital justification (D-11)',
};

export const quoteQueryKey = (quoteNumber: string) => ['quote', quoteNumber] as const;

interface ServerError {
  path: string;
  message: string;
}

/**
 * The generic gate-decision dialog (B-08). Its options are the domain's `availableActions` for this quote
 * and gate, so outcomes, reason codes, "note required", review dates and target stages all come from config.
 * The checks here only guide the user; the server (domain engine) decides and its errors are shown as-is.
 */
export function GateDecisionDialog({
  open,
  onOpenChange,
  gateKey,
  quoteNumber,
  onDecided,
  initialOutcomeKey = '',
  initialTargetStageKey = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateKey: string;
  quoteNumber: string;
  onDecided?: (result: GateDecisionResponse) => void;
  /** Preselect an outcome (the engineering queue's "Return to KAM" opens G2 on Rework). */
  initialOutcomeKey?: string;
  /** Preselect the target stage of an outcome with several (B-14: the board column it was dropped on). */
  initialTargetStageKey?: string;
}) {
  const queryClient = useQueryClient();
  const { data: config } = usePublicConfig();
  const quote = useQuery({
    queryKey: quoteQueryKey(quoteNumber),
    queryFn: () => api.quote(quoteNumber),
    enabled: open,
  });
  const actions: AvailableGateAction[] = (quote.data?.availableActions ?? []).filter(
    (a) => a.gateKey === gateKey,
  );
  const gateLabel = actions[0]?.gateLabel ?? config?.gates.find((g) => g.key === gateKey)?.label;

  const [outcomeKey, setOutcomeKey] = useState(initialOutcomeKey);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [holdUntil, setHoldUntil] = useState('');
  const [target, setTarget] = useState(initialTargetStageKey);
  /** B-12: the actual send date of the proposal (`datetime-local`); untouched = now, set by the server. */
  const [issued, setIssued] = useState('');
  /** B-13 (G5): the customer's acceptance date and document link, a competitor on a loss, the closure owner. */
  const [acceptedAt, setAcceptedAt] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [ownerChoice, setOwnerChoice] = useState<'' | 'me'>('');
  const me = useCurrentUser();
  const [openedAt] = useState(() => Date.now());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerError[]>([]);
  const ids = {
    reason: useId(),
    note: useId(),
    date: useId(),
    target: useId(),
    issued: useId(),
    accepted: useId(),
    doc: useId(),
    competitor: useId(),
    owner: useId(),
    errors: useId(),
  };

  const action = actions.find((a) => a.outcomeKey === outcomeKey);
  const reason = action?.reasonCodes.find((r) => r.code === reasonCode);
  const showReason = !!action && action.reasonCodes.length > 0;
  const needsReason = !!action?.requiresReasonCode;
  const needsNote =
    !!action &&
    (action.requiresNote ||
      !!reason?.requiresNote ||
      action.requiresExceptionNote ||
      action.requiresNoteBeforeValidity);
  // B-13: the customer's outcome (G5).
  const needsAcceptance = !!action?.requiresAcceptanceDate;
  const acceptedInFuture = !!acceptedAt && acceptedAt > proposalCalendarDate(new Date(openedAt));
  const closes = !!action?.closesAs;
  const canPickOwner =
    closes && !!quote.data?.customerDecision.canAssignClosureOwner && !!action?.closureOwnerDefault;
  const defaultOwnerIsMe =
    action?.closureOwnerDefault === 'decider' || quote.data?.kamUserId === me.user.id;
  const needsDate = !!action?.requiresReviewDate;
  const needsTarget = !!action && action.targetStageKeys.length > 1;
  // B-12: an outcome that releases the proposition asks for the actual send date and shows the validity.
  const releases = !!action?.releasesProposal;
  const issuedAt = issued ? new Date(issued) : null;
  const issuedInFuture = !!issuedAt && issuedAt.getTime() > openedAt + 5 * 60_000;
  const validityDays = action?.validityDays ?? null;
  // The forward outcome (e.g. Advance): its missing fields are the completeness summary until one is picked.
  const forward = actions.find(
    (a) =>
      a.nextStatus === 'active' &&
      a.targetStageKeys.length === 1 &&
      a.targetStageKeys[0] !== quote.data?.stageKey,
  );
  const completeness = (action ?? forward)?.missing ?? [];

  const problems = [
    !action && 'Choose a decision.',
    needsReason && !reason && 'Choose a reason.',
    needsDate && !holdUntil && 'Choose a review date.',
    needsTarget && !target && 'Choose where it goes back to.',
    releases &&
      issuedInFuture &&
      'The proposal issue date can’t be in the future: enter the date it was actually sent.',
    needsAcceptance && !acceptedAt && 'Enter the date the customer accepted.',
    needsAcceptance && acceptedInFuture && 'The acceptance date can’t be in the future.',
    needsNote &&
      note.trim() === '' &&
      (action?.requiresExceptionNote && !action.requiresNote
        ? 'Add a strategic exception note (the quote is below a qualification minimum).'
        : action?.requiresNoteBeforeValidity && !action.requiresNote
          ? 'The proposal is still valid: add a note saying why it is expired now.'
          : 'Add a note.'),
  ].filter((p): p is string => !!p);

  const reset = () => {
    setOutcomeKey('');
    setReasonCode('');
    setNote('');
    setHoldUntil('');
    setTarget('');
    setIssued('');
    setAcceptedAt('');
    setDocUrl('');
    setCompetitor('');
    setOwnerChoice('');
    setSubmitted(false);
    setServerErrors([]);
  };

  const mutation = useMutation({
    mutationFn: (body: GateDecisionBody) => api.decideGate(quoteNumber, gateKey, body),
    onSuccess: async (result) => {
      queryClient.setQueryData(quoteQueryKey(quoteNumber), result.quote);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gate-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['eng-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-queue'] }),
        queryClient.invalidateQueries({ queryKey: finalReviewQueueKey }),
        queryClient.invalidateQueries({ queryKey: reviewSummaryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: ['stage-times', quoteNumber] }),
        queryClient.invalidateQueries({ queryKey: ['my-proposals'] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
      ]);
      toast.success({
        title: `${action?.outcomeLabel ?? 'Decision'} recorded`,
        description: `${quoteNumber} is now in ${stageLabel(config, result.quote.stageKey)}.`,
      });
      reset();
      onOpenChange(false);
      onDecided?.(result);
    },
    onError: (err) => {
      if (isApiError(err)) {
        const errors = (err.problem as { errors?: ServerError[] }).errors;
        setServerErrors(
          errors?.length
            ? errors
            : [{ path: '/', message: err.problem.detail ?? err.problem.title }],
        );
      }
    },
  });
  const busy = mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{gateLabel ?? gateKey}</DialogTitle>
          <DialogDescription>
            Record the decision for {quoteNumber}
            {quote.data?.customerName ? ` (${quote.data.customerName})` : ''}.
          </DialogDescription>
        </DialogHeader>

        {quote.isPending && <p className="text-muted-foreground text-sm">Loading the quote…</p>}
        {quote.data && (
          <div className="grid gap-4">
            <QualificationWarnings warnings={quote.data.warnings} />

            <details
              className="rounded-md border px-3 py-2"
              open={quote.data.stageKey === 'INTAKE'}
            >
              <summary className="cursor-pointer text-sm font-medium">
                Priority {quote.data.priority.score ?? '–'}
                {quote.data.priority.tierLabel ? ` · ${quote.data.priority.tierLabel}` : ''}{' '}
                (advisory)
              </summary>
              <ScoreBreakdownTable priority={quote.data.priority} className="mt-2" />
            </details>

            <div className="rounded-md border px-3 py-2 text-sm" data-testid="completeness">
              {completeness.length === 0 ? (
                <p className="flex items-center gap-2">
                  <CheckCircle2Icon className="text-emphasis size-4" aria-hidden="true" />
                  {quote.data.stageKey === 'INTAKE'
                    ? 'Intake complete for this decision.'
                    : 'Nothing missing for this decision.'}
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-2 font-medium">
                    <CircleAlertIcon className="size-4" aria-hidden="true" />
                    Missing before it can move on:
                  </p>
                  <ul className="text-muted-foreground mt-1 list-disc pl-6">
                    {completeness.map((m) => (
                      <li key={m.field + m.message}>{MISSING_LABELS[m.field] ?? m.message}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {actions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You can’t record a {gateLabel ?? gateKey} decision on this quote right now.
              </p>
            ) : (
              <form
                id="gate-decision-form"
                className="grid gap-4"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmitted(true);
                  setServerErrors([]);
                  if (problems.length > 0 || !action) return;
                  mutation.mutate({
                    outcomeKey: action.outcomeKey,
                    ...(reason ? { reasonCode: reason.code } : {}),
                    ...(note.trim() ? { note: note.trim() } : {}),
                    ...(needsDate && holdUntil ? { holdUntil } : {}),
                    ...(needsTarget && target ? { targetStageKey: target } : {}),
                    ...(releases && issuedAt ? { proposalIssuedAt: issuedAt.toISOString() } : {}),
                    ...(needsAcceptance && acceptedAt ? { acceptedAt } : {}),
                    ...(needsAcceptance && docUrl.trim()
                      ? { acceptanceDocumentUrl: docUrl.trim() }
                      : {}),
                    ...(action.closesAs === LOST_OUTCOME && competitor.trim()
                      ? { competitor: competitor.trim() }
                      : {}),
                    ...(canPickOwner && ownerChoice === 'me' ? { closureOwnerId: me.user.id } : {}),
                  });
                }}
              >
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Decision</legend>
                  {actions.map((a) => (
                    <label
                      key={a.outcomeKey}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3',
                        outcomeKey === a.outcomeKey && 'border-primary bg-secondary',
                      )}
                    >
                      <input
                        type="radio"
                        name="outcome"
                        value={a.outcomeKey}
                        checked={outcomeKey === a.outcomeKey}
                        onChange={() => {
                          setOutcomeKey(a.outcomeKey);
                          setReasonCode('');
                          setTarget('');
                          setIssued('');
                          setAcceptedAt('');
                          setDocUrl('');
                          setCompetitor('');
                          setOwnerChoice('');
                          setServerErrors([]);
                        }}
                        className="size-4 accent-[var(--primary)]"
                      />
                      <span className="text-sm">{a.outcomeLabel}</span>
                      {a.nextStatus === 'closed' && (
                        <span className="text-foreground-2 ml-auto text-xs">Closes the quote</span>
                      )}
                    </label>
                  ))}
                </fieldset>

                {showReason && (
                  <div className="grid gap-1.5">
                    <label htmlFor={ids.reason} className="text-sm font-medium">
                      {needsAcceptance ? 'Acceptance evidence' : 'Reason'}{' '}
                      {needsReason ? '(required)' : '(optional)'}
                    </label>
                    <NativeSelect
                      id={ids.reason}
                      value={reasonCode}
                      onChange={(e) => setReasonCode(e.target.value)}
                      aria-invalid={submitted && needsReason && !reason}
                    >
                      <option value="">Choose a reason…</option>
                      {action.reasonCodes.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}

                {needsDate && (
                  <div className="grid gap-1.5">
                    <label htmlFor={ids.date} className="text-sm font-medium">
                      Review date (required)
                    </label>
                    <Input
                      id={ids.date}
                      type="date"
                      value={holdUntil}
                      onChange={(e) => setHoldUntil(e.target.value)}
                      aria-invalid={submitted && !holdUntil}
                    />
                  </div>
                )}

                {needsTarget && (
                  <div className="grid gap-1.5">
                    <label htmlFor={ids.target} className="text-sm font-medium">
                      Send back to (required)
                    </label>
                    <NativeSelect
                      id={ids.target}
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Choose a stage…</option>
                      {action.targetStageKeys.map((k) => (
                        <option key={k} value={k}>
                          {stageLabel(config, k)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}

                {releases && (
                  <div className="grid gap-1.5" data-testid="release-dates">
                    <p className="text-muted-foreground text-sm">
                      Approving is an internal decision: it releases the proposition to Customer
                      Decision and tells the KAM to issue the proposal. It does not award the quote.
                    </p>
                    <label htmlFor={ids.issued} className="text-sm font-medium">
                      Proposal issued (defaults to now)
                    </label>
                    <Input
                      id={ids.issued}
                      type="datetime-local"
                      value={issued || toLocalInput()}
                      onChange={(e) => setIssued(e.target.value)}
                      aria-invalid={submitted && issuedInFuture}
                    />
                    {validityDays !== null && (
                      <p className="text-muted-foreground text-xs" data-testid="validity-preview">
                        Valid until {validityUntil(issuedAt ?? new Date(), validityDays)} (
                        {validityDays} days from the issue date, provisional).
                      </p>
                    )}
                  </div>
                )}

                {needsAcceptance && (
                  <div className="grid gap-4 sm:grid-cols-2" data-testid="acceptance-fields">
                    <div className="grid gap-1.5">
                      <label htmlFor={ids.accepted} className="text-sm font-medium">
                        Customer accepted on (required)
                      </label>
                      <Input
                        id={ids.accepted}
                        type="date"
                        value={acceptedAt}
                        max={proposalCalendarDate(new Date(openedAt))}
                        onChange={(e) => setAcceptedAt(e.target.value)}
                        aria-invalid={submitted && (!acceptedAt || acceptedInFuture)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <label htmlFor={ids.doc} className="text-sm font-medium">
                        Document link (optional)
                      </label>
                      <Input
                        id={ids.doc}
                        type="url"
                        inputMode="url"
                        placeholder="https://…"
                        value={docUrl}
                        onChange={(e) => setDocUrl(e.target.value)}
                      />
                    </div>
                    <p className="text-muted-foreground text-xs sm:col-span-2">
                      The reason above is the acceptance evidence. Next: the hand-off record (CER
                      and BPR IDs, who receives it).
                    </p>
                  </div>
                )}

                {action?.closesAs === LOST_OUTCOME && (
                  <div className="grid gap-1.5">
                    <label htmlFor={ids.competitor} className="text-sm font-medium">
                      Competitor (optional)
                    </label>
                    <Input
                      id={ids.competitor}
                      value={competitor}
                      onChange={(e) => setCompetitor(e.target.value)}
                    />
                  </div>
                )}

                {action?.closesAs === EXPIRED_OUTCOME && (
                  <p className="text-muted-foreground text-sm" data-testid="expired-explainer">
                    Silence is not a loss: “No response / Expired” is recorded separately from Lost.
                    {action.requiresNoteBeforeValidity
                      ? ' The proposal is still within its validity date, so add a note.'
                      : ''}
                  </p>
                )}

                {canPickOwner && (
                  <div className="grid gap-1.5">
                    <label htmlFor={ids.owner} className="text-sm font-medium">
                      Closure owner
                    </label>
                    <NativeSelect
                      id={ids.owner}
                      value={ownerChoice}
                      onChange={(e) => setOwnerChoice(e.target.value as '' | 'me')}
                    >
                      <option value="">
                        {action?.closureOwnerDefault === 'kam'
                          ? `The KAM${quote.data?.kamName ? ` (${quote.data.kamName})` : ''}`
                          : 'Me (the decider)'}
                      </option>
                      {!defaultOwnerIsMe && <option value="me">Me ({me.user.displayName})</option>}
                    </NativeSelect>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <label htmlFor={ids.note} className="text-sm font-medium">
                    {action?.requiresExceptionNote && !action.requiresNote
                      ? 'Strategic exception note (required)'
                      : `Note ${needsNote ? '(required)' : '(optional)'}`}
                  </label>
                  <Textarea
                    id={ids.note}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-invalid={submitted && needsNote && note.trim() === ''}
                    placeholder={
                      action?.outcomeKey === 'rework' ? 'What should the KAM fix?' : undefined
                    }
                  />
                </div>

                {((submitted && problems.length > 0) || serverErrors.length > 0) && (
                  <div id={ids.errors} role="alert">
                    <ul className="text-destructive grid gap-1 text-sm">
                      {(serverErrors.length > 0
                        ? serverErrors.map((e) => e.message)
                        : problems
                      ).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </form>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {actions.length > 0 && (
            <Button type="submit" form="gate-decision-form" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : 'Record decision'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
