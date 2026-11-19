import type { AvailableGateAction, GateDecisionBody, GateDecisionResponse } from '@ccq/contracts';
import {
  EXPIRED_OUTCOME,
  HOLD_OWNER_DEFAULTS,
  HOLD_OWNER_DEFAULT_SEED,
  LOST_OUTCOME,
  REQUIREMENT_LABELS,
  holdOwnerChoices,
  proposalCalendarDate,
  uniqueRequirements,
  validityUntil,
  type HoldOwnerChoice,
  type HoldOwnerDefault,
} from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleAlertIcon, InfoIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

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
import { BLOCKING_BOX, FlagKey } from '@/components/ui/flag-key';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { stageLabel, usePublicConfig } from '@/config/public-config';
import { api, isApiError } from '@/lib/api';
import {
  DECISION_GROUP_LABELS,
  groupDecisions,
  noteHelp,
  notePlaceholder,
  sendBackOptions,
  sendBackValue,
  showsDecisionGroups,
  type DecisionGroup,
  type SendBackOption,
} from '@/lib/decision-groups';
import { decisionLabel } from '@/lib/decision-label';
import { writeSfReminder } from '@/lib/sf-reminder';
import { calendarDate, toLocalInput, todayCentral } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { finalReviewQueueKey, reviewSummaryKey } from './final-review/keys';
import { GuardrailNote, QualificationWarnings, ScoreBreakdownTable } from './Priority';

/**
 * Plain words for the rules' field paths (B-11, B-26); other rules show their message. Shared with the
 * lead-review "Not ready to submit yet" list.
 */
// DR-* (plain-language messages): one map, in the domain, shared with the API's refusals.
export const MISSING_LABELS: Readonly<Record<string, string>> = REQUIREMENT_LABELS;

export const quoteQueryKey = (quoteNumber: string) => ['quote', quoteNumber] as const;

/**
 * FB-04 (F-076): set once a G5 outcome is saved; the value is the outcome key that was recorded. Client-only:
 * dismissing the reminder writes nothing, and a reload clears it.
 */
export const sfReminderKey = (quoteNumber: string) => ['sf-reminder', quoteNumber] as const;

interface ServerError {
  path: string;
  message: string;
}

type Action = AvailableGateAction;

/**
 * The generic gate-decision dialog (B-08). Its options are the domain's `availableActions` for this quote
 * and gate, so outcomes, reason codes, "note required", review dates and target stages all come from config.
 * The checks here only guide the user; the server (domain engine) decides and its errors are shown as-is.
 *
 * FB-17 (W13-23, W13-24): the outcomes are shown as four plain choices, Advance, Send back to…, Hold and
 * Stop, from each outcome's group (config). "Send back to…" is one choice with a "Send to" list of where
 * the quote can go. A gate whose outcomes are the customer's answer (G5) keeps its flat list.
 */
export function GateDecisionDialog({
  open,
  onOpenChange,
  gateKey,
  quoteNumber,
  onDecided,
  initialOutcomeKey = '',
  initialTargetStageKey = '',
  acknowledgedWarnings,
  outcomeKeys,
  title,
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
  /** FB-01 (F-069), G4: the warning codes the review screen showed; recorded on the decision. */
  acknowledgedWarnings?: string[];
  /**
   * DR-pricing-finance-11: the outcomes the button that opened the dialog stands for ("Hold or stop…"
   * offers Hold and Stop, not "Advance – price approved"). Omitted: every outcome the caller may take.
   */
  outcomeKeys?: readonly string[];
  /** DR-pricing-finance-11: the dialog's title (the action), instead of the gate's label. */
  title?: string;
}) {
  const queryClient = useQueryClient();
  const { data: config } = usePublicConfig();
  const quote = useQuery({
    queryKey: quoteQueryKey(quoteNumber),
    queryFn: () => api.quote(quoteNumber),
    enabled: open,
  });
  const actions: AvailableGateAction[] = (quote.data?.availableActions ?? []).filter(
    (a) => a.gateKey === gateKey && (!outcomeKeys || outcomeKeys.includes(a.outcomeKey)),
  );
  const gateLabel = actions[0]?.gateLabel ?? config?.gates.find((g) => g.key === gateKey)?.label;

  const bodyRef = useRef<HTMLDivElement>(null);
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
  /** FB-17: "Send back to…" is picked but where to is not chosen yet (no outcome is selected then). */
  const [sendBackPicked, setSendBackPicked] = useState(false);
  /** FB-16 (W13-18): the engineering lead signs capacity off with the G2 decision. */
  const [capacityApproved, setCapacityApproved] = useState(false);
  const me = useCurrentUser();
  /** B-26: every hold names an owner. FB-17 (W13-25): null = the default, the stage's assignee. */
  const [holdOwner, setHoldOwner] = useState<{ id: string; displayName: string } | null>(null);
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
    holdOwner: useId(),
    sendTo: useId(),
    capacity: useId(),
    errors: useId(),
    blocked: useId(),
    noteHint: useId(),
  };

  const action = actions.find((a) => a.outcomeKey === outcomeKey);
  // FB-17 (W13-23): the four choices, when every offered outcome sits under one of them.
  const grouped = showsDecisionGroups(actions);
  const sendTo = grouped ? sendBackOptions(actions, (key) => stageLabel(config, key)) : [];
  const sendingBack = grouped && (sendBackPicked || action?.outcomeGroup === 'send_back');
  const sendToValue =
    sendingBack && action
      ? action.targetStageKeys.length > 1
        ? target && sendBackValue(action.outcomeKey, target)
        : sendBackValue(action.outcomeKey)
      : '';
  // DR-kam-sales-leader-02: a reason an earlier gate already recorded (G5's acceptance evidence, when G6
  // closes Won) is offered as the default, not asked for again. The user can still change it.
  const inheritedReason =
    action?.requiresReasonCode && action.nextStatus === 'closed' && quote.data
      ? ([...quote.data.decisions]
          .filter((d) => d.gateKey !== gateKey && d.reasonCode)
          .sort((x, y) => y.decidedAt.localeCompare(x.decidedAt))
          .map((d) => d.reasonCode!)
          .find((code) => action.reasonCodes.some((r) => r.code === code)) ?? '')
      : '';
  const reasonValue = reasonCode || inheritedReason;
  const reason = action?.reasonCodes.find((r) => r.code === reasonValue);
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
  // FB-17 (W13-27): a closure the decider owns (Stop, Decline, G1 not CCQ work, G6 Stop) asks nothing:
  // the server records the decider. The picker stays for the KAM-owned customer outcomes (G5 Lost and
  // Expired, G6 Advance), where a sales leader holding outcome.assignOwner names the owner (B-13, CR-39).
  const canPickOwner =
    closes &&
    !!quote.data?.customerDecision.canAssignClosureOwner &&
    action?.closureOwnerDefault === 'kam';
  const defaultOwnerIsMe = quote.data?.kamUserId === me.user.id;
  const needsDate = !!action?.requiresReviewDate;
  const needsHoldOwner = !!action?.requiresHoldOwner;
  // FB-17 (W13-25): the hold owner is whoever will clear the hold, so the stage's assignees come first
  // and are the default when there is exactly one (app_setting `hold_owner_default`, provisional).
  const holdOwnerSetting = config?.settings.hold_owner_default;
  const holdOwners = holdOwnerChoices({
    stageKey: quote.data?.stageKey ?? '',
    me: { id: me.user.id, displayName: me.user.displayName },
    kam: quote.data?.kamUserId
      ? { id: quote.data.kamUserId, displayName: quote.data.kamName ?? 'The KAM' }
      : null,
    engineer: person(
      quote.data?.engineering.assignedEngineerId,
      quote.data?.engineering.assignedEngineerName,
    ),
    scheduler: person(
      quote.data?.engineering.assignedSchedulerId,
      quote.data?.engineering.assignedSchedulerName,
    ),
    pricer: person(quote.data?.quoting.assignedPricerId, quote.data?.quoting.assignedPricerName),
    defaultTo: (HOLD_OWNER_DEFAULTS as readonly unknown[]).includes(holdOwnerSetting)
      ? (holdOwnerSetting as HoldOwnerDefault)
      : HOLD_OWNER_DEFAULT_SEED,
  });
  const holdOwnerChoice = holdOwner ?? holdOwners.defaultChoice;
  const needsTarget = !!action && action.targetStageKeys.length > 1;
  /** Picks an outcome (and its target stage, from "Send to") and clears what the last one asked for. */
  const choose = (key: string, targetStageKey = '', viaSendBack = false) => {
    setOutcomeKey(key);
    setSendBackPicked(viaSendBack);
    setReasonCode('');
    setTarget(targetStageKey);
    setIssued('');
    setAcceptedAt('');
    setDocUrl('');
    setCompetitor('');
    setOwnerChoice('');
    setCapacityApproved(false);
    setServerErrors([]);
  };
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
  // FB-16 (W13-12): process type and machine type are one pick, so their shared label is listed once.
  const completeness = uniqueRequirements((action ?? forward)?.missing ?? []);
  // FB-16 (W13-18): capacity is not signed yet and the decider may sign it: this outcome asks for the
  // tick, and the sign-off is recorded with the decision. A block is never approved here.
  const needsCapacity = !!action?.capacityApproval;
  const capacity = quote.data?.engineering.capacitySignoff;
  const capacityBlocked =
    gateKey === 'G2' && quote.data?.stageKey === 'ENG_REVIEW' && capacity?.status === 'blocked';
  // DR-cross-cutting-07: the server will refuse this outcome until its missing items are done (they are
  // not entered in this dialog), so Record decision is off and says why instead of failing on click.
  const blockedBy = action?.missing ?? [];

  const problems = [
    !action && (sendingBack ? 'Choose who to send it back to.' : 'Choose a decision.'),
    needsReason && !reason && 'Choose a reason.',
    needsDate && !holdUntil && 'Choose a review date.',
    // DR-engineering-04 / DR-approver-leadership-admin-04: the server refuses a date already passed.
    needsDate &&
      !!holdUntil &&
      holdUntil < todayCentral() &&
      'Choose a review date today or later.',
    needsTarget && !target && 'Choose where it goes back to.',
    needsCapacity &&
      !capacityApproved &&
      'Tick “Capacity approved” to sign capacity off with this decision.',
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
    setSendBackPicked(false);
    setCapacityApproved(false);
    setHoldOwner(null);
    setSubmitted(false);
    setServerErrors([]);
  };

  const mutation = useMutation({
    mutationFn: (body: GateDecisionBody) => api.decideGate(quoteNumber, gateKey, body),
    onSuccess: async (result) => {
      queryClient.setQueryData(quoteQueryKey(quoteNumber), result.quote);
      // FB-04 (F-076): after a customer outcome (G5), remind the KAM to update the Salesforce opportunity.
      if (gateKey === 'G5' && action) {
        queryClient.setQueryData(sfReminderKey(quoteNumber), action.outcomeKey);
        writeSfReminder(quoteNumber, action.outcomeKey);
      }
      // DR-kam-sales-leader-01: the Salesforce stage to set is also in the toast, wherever the outcome
      // was recorded (My proposals has no quote page to show the reminder on).
      const sfStage =
        gateKey === 'G5' && action
          ? result.quote.customerDecision.sfStageByOutcome[action.outcomeKey]
          : undefined;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gate-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['eng-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-queue'] }),
        queryClient.invalidateQueries({ queryKey: finalReviewQueueKey }),
        queryClient.invalidateQueries({ queryKey: reviewSummaryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: ['stage-times', quoteNumber] }),
        queryClient.invalidateQueries({ queryKey: ['my-proposals'] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
        // The decision is also a timeline entry, moves the quote on every role's Command Center and
        // raises notifications; an override waiting on the old stage may no longer apply.
        queryClient.invalidateQueries({ queryKey: ['timeline', quoteNumber] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['overrides', 'inbox'] }),
      ]);
      toast.success({
        title: `${action?.outcomeLabel ?? 'Decision'} recorded`,
        description: `${quoteNumber} is now in ${stageLabel(config, result.quote.stageKey)}.${
          sfStage ? ` Update the Salesforce opportunity to match: ${sfStage}.` : ''
        }`,
      });
      reset();
      onOpenChange(false);
      onDecided?.(result);
    },
    onError: (err) => {
      // DR-cross-cutting-01: someone else (or another tab) decided first. Refresh what the page shows.
      if (isApiError(err, 409)) {
        void queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) });
        void queryClient.invalidateQueries({ queryKey: reviewSummaryKey(quoteNumber) });
      }
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

  /** One outcome as a radio: its label, its definition behind the ⓘ and, once picked, in full. */
  const outcomeRadio = (a: Action) => (
    <label
      key={a.outcomeKey}
      className={cn(
        'flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 rounded-md border px-3 py-1',
        outcomeKey === a.outcomeKey && 'border-primary bg-secondary',
      )}
    >
      <input
        type="radio"
        name="outcome"
        value={a.outcomeKey}
        // The label also holds the ⓘ definition; the radio's name is the outcome alone.
        aria-label={a.outcomeLabel}
        checked={outcomeKey === a.outcomeKey}
        onChange={() => choose(a.outcomeKey)}
        className="size-4 accent-[var(--primary)]"
      />
      <span className="text-sm">{a.outcomeLabel}</span>
      {a.helpText && <OutcomeDefinition label={a.outcomeLabel} text={a.helpText} />}
      {a.nextStatus === 'closed' && (
        <span className="text-foreground-2 ml-auto text-xs">Closes the quote</span>
      )}
      {a.helpText && outcomeKey === a.outcomeKey && (
        <span
          className="text-muted-foreground basis-full pb-1 pl-7 text-xs"
          data-testid="outcome-definition"
        >
          {a.helpText}
        </span>
      )}
    </label>
  );

  /** FB-17 (W13-23): one of the four choices, with the outcomes under it. */
  const decisionGroup = (g: { group: DecisionGroup; label: string; actions: Action[] }) => (
    <div
      key={g.group}
      role="group"
      aria-label={g.label}
      className="grid gap-2"
      data-testid={`decision-group-${g.group}`}
    >
      {g.group === 'send_back' && (
        <SendBackChoice
          id={ids.sendTo}
          picked={sendingBack}
          options={sendTo}
          value={sendToValue}
          helpText={sendingBack ? (action?.helpText ?? null) : null}
          invalid={submitted && !sendToValue}
          onPick={(to) => choose(to?.outcomeKey ?? '', to?.targetStageKey ?? '', true)}
        />
      )}
      {g.group !== 'send_back' && g.actions.map(outcomeRadio)}
    </div>
  );
  const choices = grouped ? groupDecisions(actions).map(decisionGroup) : actions.map(outcomeRadio);

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
          <DialogTitle>{title ?? decisionLabel(gateKey, gateLabel)}</DialogTitle>
          <DialogDescription>
            Record the decision for {quoteNumber}
            {quote.data?.customerName ? ` (${quote.data.customerName})` : ''}.
          </DialogDescription>
        </DialogHeader>

        {quote.isPending && <p className="text-muted-foreground text-sm">Loading the quote…</p>}
        {quote.isError && !quote.data && (
          <p role="alert" className="text-destructive text-sm">
            This quote could not be loaded, so no decision can be recorded here. Close this and try
            again.
          </p>
        )}
        {quote.data && (
          <div className="grid gap-4" ref={bodyRef}>
            <QualificationWarnings warnings={quote.data.warnings} />
            <GuardrailNote text={quote.data.intakeFacts.guardrailWarning} />

            {/* Closed at every gate, so the choices are on the screen on a laptop: the summary line
                keeps the score in view, and one click or key press (Enter or Space on the summary)
                opens the evidence. The whole row is the target. */}
            <details className="rounded-md border" data-testid="decision-priority">
              <summary className="cursor-pointer rounded-md px-3 py-3 text-sm font-medium">
                Priority {quote.data.priority.score ?? '–'}
                {quote.data.priority.tierLabel ? ` · ${quote.data.priority.tierLabel}` : ''}{' '}
                (advisory)
              </summary>
              <div className="px-3 pb-2">
                <ScoreBreakdownTable
                  priority={quote.data.priority}
                  market={{ market: quote.data.market, subMarket: quote.data.subMarket }}
                />
              </div>
            </details>

            <div
              className={cn(
                'px-3 py-2 text-sm',
                completeness.length === 0 ? 'rounded-md border' : BLOCKING_BOX,
              )}
              data-testid="completeness"
              data-tone={completeness.length === 0 ? undefined : 'blocking'}
            >
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
                    <CircleAlertIcon className="text-destructive size-4" aria-hidden="true" />
                    Missing before it can move on:
                  </p>
                  <ul className="mt-1 list-disc pl-6">
                    {completeness.map((m) => (
                      <li key={m.field + m.message}>{MISSING_LABELS[m.field] ?? m.message}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {capacityBlocked && (
              <div
                role="status"
                className={cn('grid gap-1 px-3 py-2 text-sm', BLOCKING_BOX)}
                data-tone="blocking"
                data-testid="capacity-blocked-note"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <CircleAlertIcon className="text-destructive size-4" aria-hidden="true" />
                  Capacity is blocked{capacity.byName ? ` by ${capacity.byName}` : ''}
                </p>
                {capacity.note && <p className="whitespace-pre-wrap">{capacity.note}</p>}
                <p>
                  The quote cannot advance until capacity is approved again on the Engineering tab.{' '}
                  {/* UX-004: a quote already on hold is not offered Hold. */}
                  {quote.data.status === 'on_hold'
                    ? 'Send back and stop are still available.'
                    : 'Send back, hold or stop are still available.'}
                </p>
              </div>
            )}

            {/* FB-27 (N17-09): the key shows only while a red or yellow flag is on screen here. */}
            <FlagKey scope={bodyRef} />

            {actions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You can’t make this decision on this quote right now.
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
                    ...(needsHoldOwner ? { holdOwnerId: holdOwnerChoice.id } : {}),
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
                    ...(needsCapacity && capacityApproved ? { capacityApproved: true } : {}),
                    ...(acknowledgedWarnings ? { acknowledgedWarnings } : {}),
                  });
                }}
              >
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Decision</legend>
                  {choices}
                </fieldset>

                {needsCapacity && (
                  <div className="grid gap-1" data-testid="capacity-approval">
                    <label
                      htmlFor={ids.capacity}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-1 text-sm font-medium"
                    >
                      <input
                        id={ids.capacity}
                        type="checkbox"
                        className="size-5 accent-[var(--primary)]"
                        checked={capacityApproved}
                        onChange={(e) => setCapacityApproved(e.target.checked)}
                        aria-required="true"
                        aria-invalid={submitted && !capacityApproved}
                      />
                      Capacity approved (I’m signing it off) (required)
                    </label>
                    <p className="text-muted-foreground text-xs">
                      Capacity has not been signed off yet. Ticking this records your capacity
                      approval together with the decision.
                    </p>
                  </div>
                )}

                {showReason && (
                  <div className="grid gap-1.5">
                    <label htmlFor={ids.reason} className="text-sm font-medium">
                      {needsAcceptance ? 'Acceptance evidence' : 'Reason'}{' '}
                      {needsReason ? '(required)' : '(optional)'}
                    </label>
                    <NativeSelect
                      id={ids.reason}
                      value={reasonValue}
                      onChange={(e) => setReasonCode(e.target.value)}
                      aria-invalid={submitted && needsReason && !reason}
                    >
                      <option value="">
                        {needsAcceptance ? 'Choose the evidence…' : 'Choose a reason…'}
                      </option>
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
                      min={todayCentral()}
                      value={holdUntil}
                      onChange={(e) => setHoldUntil(e.target.value)}
                      aria-invalid={submitted && (!holdUntil || holdUntil < todayCentral())}
                    />
                  </div>
                )}

                {needsHoldOwner && (
                  <HoldOwnerPicker
                    id={ids.holdOwner}
                    value={holdOwnerChoice}
                    meId={me.user.id}
                    choices={holdOwners.choices}
                    onChange={setHoldOwner}
                  />
                )}

                {needsTarget && !sendingBack && (
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
                        Valid until{' '}
                        {calendarDate(validityUntil(issuedAt ?? new Date(), validityDays))} (
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
                      The reason above is the acceptance evidence. Acceptance is not spend
                      authority: the quote moves to Commit &amp; Hand Off (the CER and who receives
                      it) before it closes Won.
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
                        {`The KAM${quote.data?.kamName ? ` (${quote.data.kamName})` : ''}`}
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
                  {/* DR-engineering-10, DR-kam-sales-leader-16: say what to write for this outcome. */}
                  {action?.requiresNote && (
                    <p id={ids.noteHint} className="text-muted-foreground text-xs">
                      {noteHelp(action)}
                    </p>
                  )}
                  <Textarea
                    id={ids.note}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-invalid={submitted && needsNote && note.trim() === ''}
                    aria-required={needsNote}
                    {...(action?.requiresNote ? { 'aria-describedby': ids.noteHint } : {})}
                    placeholder={notePlaceholder(action)}
                  />
                </div>

                {blockedBy.length > 0 && (
                  <p
                    id={ids.blocked}
                    className="text-muted-foreground text-sm"
                    data-testid="decision-blocked"
                  >
                    “{action?.outcomeLabel}” can’t be recorded yet: first complete what is listed
                    under “Missing before it can move on”.
                  </p>
                )}
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
            <Button
              type="submit"
              form="gate-decision-form"
              disabled={busy || blockedBy.length > 0}
              aria-busy={busy}
              aria-describedby={blockedBy.length > 0 ? ids.blocked : undefined}
            >
              {busy ? 'Saving…' : 'Record decision'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An assignee for the hold-owner list; null when nobody is assigned. */
const person = (id: string | null | undefined, displayName: string | null | undefined) =>
  id ? { id, displayName: displayName ?? 'name not shown' } : null;

/**
 * FB-17 (W13-23): "Send back to…" is one choice. Picked, it asks where the quote goes: the "Send to" list
 * names each send-back outcome by its destination, and the chosen one's definition is shown under it.
 */
function SendBackChoice({
  id,
  picked,
  options,
  value,
  helpText,
  invalid,
  onPick,
}: {
  id: string;
  picked: boolean;
  options: readonly SendBackOption[];
  value: string;
  helpText: string | null;
  invalid: boolean;
  onPick: (to: SendBackOption | undefined) => void;
}) {
  return (
    <>
      <label
        className={cn(
          'flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 rounded-md border px-3 py-1',
          picked && 'border-primary bg-secondary',
        )}
      >
        <input
          type="radio"
          name="outcome"
          value="send_back"
          aria-label={DECISION_GROUP_LABELS.send_back}
          checked={picked}
          // One place it can go: it is chosen already, and still shown.
          onChange={() => onPick(options.length === 1 ? options[0] : undefined)}
          className="size-4 accent-[var(--primary)]"
        />
        <span className="text-sm">{DECISION_GROUP_LABELS.send_back}</span>
        {picked && (
          <span className="text-muted-foreground basis-full pb-1 pl-7 text-xs">
            To get something fixed. Choose who it goes to, and say what needs to change.
          </span>
        )}
      </label>
      {picked && (
        <div className="grid gap-1.5 pl-7" data-testid="send-to">
          <label htmlFor={id} className="text-sm font-medium">
            Send to (required)
          </label>
          <NativeSelect
            id={id}
            value={value}
            onChange={(e) => onPick(options.find((o) => o.value === e.target.value))}
            aria-required="true"
            aria-invalid={invalid}
          >
            <option value="">Choose who it goes to…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          {helpText && (
            <p className="text-muted-foreground text-xs" data-testid="outcome-definition">
              {helpText}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** B-26 (A3): the outcome's definition (config help text) behind an ⓘ, on hover and on focus. */
function OutcomeDefinition({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`What “${label}” means`}
        aria-describedby={id}
        onClick={(e) => e.preventDefault()}
      >
        <InfoIcon className="size-4" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="bg-popover text-popover-foreground pointer-events-none invisible absolute top-full left-0 z-50 mt-1 w-72 rounded-md border p-2 text-xs shadow-md group-focus-within:visible group-hover:visible"
      >
        {text}
      </span>
    </span>
  );
}

/**
 * B-26 (deck slide 16): who owns the hold. FB-17 (W13-25): the person who will clear it. The stage's
 * assignees come first (the default when there is exactly one), then "Me", the KAM, and anyone found by
 * name. The owner is told about the hold unless the owner is the decider.
 */
function HoldOwnerPicker({
  id,
  value,
  meId,
  choices,
  onChange,
}: {
  id: string;
  value: { id: string; displayName: string };
  meId: string;
  choices: readonly HoldOwnerChoice[];
  onChange: (owner: { id: string; displayName: string }) => void;
}) {
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api.searchUsers(q),
    enabled: q.trim().length >= 2,
  });
  // Someone found by name joins the list, so the choice made is always one of the options shown.
  const options = choices.some((c) => c.id === value.id)
    ? choices
    : [...choices, { id: value.id, displayName: value.displayName, label: value.displayName }];
  return (
    <fieldset className="grid gap-1.5" data-testid="hold-owner">
      <legend className="text-sm font-medium">Hold owner (required)</legend>
      <p className="text-muted-foreground text-xs">
        The person who will clear the hold and get the quote moving again by the review date. They
        are told about it.{' '}
        <span data-testid="hold-owner-choice">
          Now: {value.displayName}
          {value.id === meId ? ' (me)' : ''}
        </span>
      </p>
      <div className="grid gap-1">
        {options.map((c) => (
          <label
            key={c.id}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-1 text-sm',
              value.id === c.id && 'border-primary bg-secondary',
            )}
          >
            <input
              type="radio"
              name={`${id}-owner`}
              checked={value.id === c.id}
              onChange={() => onChange({ id: c.id, displayName: c.displayName })}
              className="size-4 accent-[var(--primary)]"
            />
            {c.label}
          </label>
        ))}
      </div>
      <Input
        id={id}
        type="search"
        aria-label="Find someone else by name"
        placeholder="Find someone else by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {(search.data?.items.length ?? 0) > 0 && (
        <ul className="grid gap-1" aria-label="People">
          {search.data!.items.map((u) => (
            <li key={u.id}>
              <Button
                type="button"
                size="sm"
                variant={u.id === value.id ? 'secondary' : 'ghost'}
                onClick={() => {
                  onChange({ id: u.id, displayName: u.displayName });
                  setQ('');
                }}
              >
                {u.displayName} <span className="text-muted-foreground">{u.upn}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
