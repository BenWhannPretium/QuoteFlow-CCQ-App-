import type { IntakeDraft, SfOpportunitySummary, SubmitIntakeResponse } from '@ccq/contracts';
import { DRAWING_ATTACHMENT_KINDS } from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  FileClockIcon,
  Trash2Icon,
  RotateCcwIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { RequirePermission } from '@/auth';
import { attachmentsQueryKey } from '@/components/attachments/Attachments';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/ErrorState';
import { quoteQueryKey } from '@/components/GateDecisionDialog';
import { notificationsQueryKey } from '@/components/notifications/useNotifications';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { publicConfigQueryKey, stageLabel, usePublicConfig } from '@/config/public-config';
import {
  evaluateDraft,
  FIELD_META,
  issueLabel,
  issueStep,
  issueText,
  prefillFromOpportunity,
  requiredFieldsNow,
  submitProblemIssues,
  wizardConfig,
  type WizardConfig,
} from '@/intake/model';
import { OpportunityPicker } from '@/intake/OpportunityPicker';
import { CustomerStep, focusIntakeField, ProductStep, ReviewStep } from '@/intake/Steps';
import { Notice, Section, Stepper } from '@/intake/ui';
import { DraftNotSavedError, useIntakeDraft, type SaveState } from '@/intake/useIntakeDraft';
import { isApiError, api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

interface IntakeSearch {
  /** The draft being edited; absent on the start screen. */
  draft?: string;
  /** FB-15 (W13-05): open the draft at the review step, at the first thing to fix. */
  at?: 'review';
  /**
   * FB-15 (W13-05): a send-back notification's link. Starts (or reopens) the rework draft of this quote,
   * then opens it at the review step. The server decides who may rework (the quote's KAM).
   */
  rework?: string;
}

export const Route = createFileRoute('/intake/new')({
  validateSearch: (search: Record<string, unknown>): IntakeSearch => ({
    ...(typeof search.draft === 'string' && search.draft ? { draft: search.draft } : {}),
    ...(search.at === 'review' ? { at: 'review' as const } : {}),
    ...(typeof search.rework === 'string' && /^CCQ-\d{4}-\d{5}$/.test(search.rework)
      ? { rework: search.rework }
      : {}),
  }),
  component: () => (
    <RequirePermission permission="quote.create">
      <IntakePage />
    </RequirePermission>
  ),
});

const draftsKey = ['intake', 'drafts'] as const;

function IntakePage() {
  useDocumentTitle('New intake');
  const { draft: draftId, at, rework } = Route.useSearch();
  const { data: config, error, refetch } = usePublicConfig();
  const cfg = useMemo(() => wizardConfig(config), [config]);

  return (
    <div data-testid="page" data-page-title="New intake" className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Intake"
        title="New intake"
        description="Start from the Salesforce opportunity. Tell us what Sales knows; Engineering decides the rest."
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !config ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading…
        </p>
      ) : !cfg ? (
        <Notice tone="blocking">
          Intake settings are missing. Ask an admin to load the configuration.
        </Notice>
      ) : draftId ? (
        <DraftLoader key={draftId} id={draftId} cfg={cfg} atReview={at === 'review'} />
      ) : rework ? (
        <ReworkOpener quoteNumber={rework} />
      ) : (
        <StartScreen cfg={cfg} />
      )}
    </div>
  );
}

/** No draft yet: resume one, or pick the opportunity (which creates the draft, pre-filled). */
function StartScreen({ cfg }: { cfg: WizardConfig }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drafts = useQuery({ queryKey: draftsKey, queryFn: api.listDrafts });
  const [picking, setPicking] = useState<string | null>(null);

  const pick = async (o: SfOpportunitySummary) => {
    setPicking(o.id);
    try {
      const detail = await api.opportunity(o.id);
      const draft = await api.createDraft({ data: prefillFromOpportunity(detail, cfg), step: 2 });
      qc.setQueryData(['intake', 'draft', draft.id], draft);
      void qc.invalidateQueries({ queryKey: draftsKey });
      await navigate({ to: '/intake/new', search: { draft: draft.id }, replace: true });
    } catch (err) {
      toast.error({
        title: 'Could not start the intake',
        description: isApiError(err) ? err.message : 'Please try again.',
      });
      setPicking(null);
    }
  };

  const reopen = async (quoteNumber: string) => {
    try {
      const draft = await api.startRework(quoteNumber);
      qc.setQueryData(['intake', 'draft', draft.id], draft);
      await navigate({ to: '/intake/new', search: { draft: draft.id, at: 'review' } });
    } catch (err) {
      toast.error({
        title: 'Could not open the rework draft',
        description: isApiError(err) ? err.message : 'Please try again.',
      });
    }
  };

  return (
    <div className="grid gap-6">
      {(drafts.data?.returned.length ?? 0) > 0 && (
        <Section title="Returned for rework">
          <ul className="grid gap-3" aria-label="Quotes returned for rework" data-testid="returned">
            {drafts.data!.returned.map((r) => (
              <li key={r.quoteNumber} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-start gap-2 text-sm">
                  <RotateCcwIcon
                    aria-hidden
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0 break-words">
                    <strong>{r.quoteNumber}</strong> · {r.customerName ?? r.opportunityName ?? ''}
                    <span className="text-muted-foreground block text-xs">
                      {r.gateKey}
                      {r.reasonLabel ? `: ${r.reasonLabel}` : ''}
                      {r.note ? ` · ${r.note}` : ''}
                    </span>
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => void reopen(r.quoteNumber)}>
                  {r.draftId ? 'Continue fixing' : 'Fix and resubmit'}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(drafts.data?.items.length ?? 0) > 0 && (
        <Section title="Continue a draft">
          <ul className="grid gap-2" aria-label="Your drafts">
            {drafts.data!.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileClockIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 break-words">
                    {d.sfOpportunityName ?? 'Untitled draft'}
                    <span className="text-muted-foreground block text-xs">
                      Step {d.step} · saved {new Date(d.updatedAt).toLocaleString()}
                    </span>
                  </span>
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link to="/intake/new" search={{ draft: d.id }}>
                    Continue
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Stepper current={1} onSelect={() => undefined} canSelect={() => false} />
      <OpportunityPicker
        onPick={(o) => void pick(o)}
        picking={picking}
        newOpportunityUrl={cfg.newOpportunityUrl}
      />
    </div>
  );
}

/**
 * FB-15 (W13-05): a send-back's link lands here. It starts or reopens the rework draft (the server checks
 * the caller is the quote's KAM and the quote is back with them) and opens it at the review step.
 */
function ReworkOpener({ quoteNumber }: { quoteNumber: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .startRework(quoteNumber)
      .then(async (draft) => {
        qc.setQueryData(['intake', 'draft', draft.id], draft);
        await navigate({
          to: '/intake/new',
          search: { draft: draft.id, at: 'review' },
          replace: true,
        });
      })
      .catch((err: unknown) => {
        setError(isApiError(err) ? err.message : 'Could not open the rework draft. Try again.');
      });
  }, [quoteNumber, navigate, qc]);
  if (error) {
    return (
      <Notice tone="blocking" testId="rework-open-error">
        {error}{' '}
        <Link className="underline" to="/quotes/$quoteNumber" params={{ quoteNumber }}>
          Open {quoteNumber}
        </Link>
      </Notice>
    );
  }
  return (
    <p role="status" className="text-muted-foreground text-sm">
      Opening the rework of {quoteNumber}…
    </p>
  );
}

function DraftLoader({
  id,
  cfg,
  atReview = false,
}: {
  id: string;
  cfg: WizardConfig;
  atReview?: boolean;
}) {
  const draft = useQuery({
    queryKey: ['intake', 'draft', id],
    queryFn: () => api.getDraft(id),
    staleTime: Infinity,
    gcTime: 0,
  });
  if (draft.isError) return <ErrorState error={draft.error} onRetry={() => void draft.refetch()} />;
  if (!draft.data)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Loading your draft…
      </p>
    );
  return <Wizard initial={draft.data} cfg={cfg} atReview={atReview} />;
}

function SaveStatus({
  state,
  savedAt,
  error,
}: {
  state: SaveState;
  savedAt: Date | null;
  error?: string | null;
}) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'conflict'
        ? 'This draft was changed in another tab or window. Reload to see the latest; your latest change here is not saved.'
        : state === 'error'
          ? `Couldn’t save${error ? `: ${error}` : ''}; will retry`
          : state === 'dirty'
            ? 'Unsaved changes'
            : savedAt
              ? `Draft saved ${savedAt.toLocaleTimeString(undefined, { timeStyle: 'short' })}`
              : 'Draft saved';
  return (
    <p
      className="text-muted-foreground text-xs"
      role="status"
      data-testid="save-status"
      data-state={state}
    >
      {text}
    </p>
  );
}

/** FB-15 (W13-01): what a refused submit says: a save that did not go through, or the server's list. */
type SubmitError =
  | { kind: 'not_saved'; message: string }
  | { kind: 'refused'; message: string; issues: ReturnType<typeof submitProblemIssues> }
  | { kind: 'other'; message: string; quoteNumber?: string };

/** FB-15 (W13-05): the step and field a send-back note names ("check the Quote needed by date"), if any. */
function fieldNamedIn(note: string | null | undefined): string | null {
  if (!note) return null;
  const text = note.toLowerCase();
  let best: { field: string; length: number } | null = null;
  for (const [field, m] of Object.entries(FIELD_META)) {
    const label = m.label.toLowerCase();
    if (label.length >= 4 && text.includes(label) && (!best || label.length > best.length)) {
      best = { field, length: label.length };
    }
  }
  return best?.field ?? null;
}

function Wizard({
  initial,
  cfg: baseCfg,
  atReview = false,
}: {
  initial: IntakeDraft;
  cfg: WizardConfig;
  atReview?: boolean;
}) {
  const draft = useIntakeDraft(initial);
  const { data, step, update } = draft;
  // F-016: is a bottle or competitor drawing attached (to the draft, or already on a reworked quote)?
  const draftFiles = useQuery({
    queryKey: attachmentsQueryKey({ draftId: draft.id }),
    queryFn: () => api.draftAttachments(draft.id),
  });
  const reworkNumber = initial.rework?.quoteNumber ?? '';
  const quoteFiles = useQuery({
    queryKey: attachmentsQueryKey({ quoteNumber: reworkNumber }),
    queryFn: () => api.quoteAttachments(reworkNumber),
    enabled: Boolean(reworkNumber),
  });
  const hasDrawing = [...(draftFiles.data?.items ?? []), ...(quoteFiles.data?.items ?? [])].some(
    (f) => (DRAWING_ATTACHMENT_KINDS as readonly string[]).includes(f.kind),
  );
  // FB-15 (W13-02): the red asterisk also marks the minimum-spec fields while no drawing is attached.
  const cfg = useMemo(
    () => ({ ...baseCfg, requiredFields: requiredFieldsNow(baseCfg, hasDrawing) }),
    [baseCfg, hasDrawing],
  );
  // FB-15 (W13-01): the same inputs as the server: the active list codes (in cfg) and the quote's own codes.
  const evaluation = useMemo(
    () => evaluateDraft(data, cfg, hasDrawing, initial.keptListValues),
    [data, cfg, hasDrawing, initial.keptListValues],
  );
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: config } = usePublicConfig();
  const [picking, setPicking] = useState<string | null>(null);
  const [changingOpp, setChangingOpp] = useState(!data.sfOpportunityId);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [submitted, setSubmitted] = useState<SubmitIntakeResponse | null>(null);

  const goTo = (n: number, field?: string) => {
    setSubmitError(null);
    void draft.setStep(n);
    window.scrollTo({ top: 0 });
    // DR-kam-sales-leader-18: "Fix" lands on the field, not on the page body.
    if (field) requestAnimationFrame(() => focusIntakeField(field));
  };

  // FB-15 (W13-01): config can be cached for minutes; refetch it when the review step opens, so a list
  // value retired meanwhile is named here rather than by the server after Submit.
  useEffect(() => {
    if (step === 4) void qc.invalidateQueries({ queryKey: publicConfigQueryKey });
  }, [step, qc]);

  // FB-15 (W13-05): a send-back opens at the review step with the first thing to fix focused; with
  // nothing blocking, at the step the note names, or step 1.
  const landed = useRef(false);
  useEffect(() => {
    if (!atReview || landed.current) return;
    landed.current = true;
    if (evaluation.blocking.length > 0) {
      if (step !== 4) void draft.setStep(4);
      const focusFirst = (tries = 20) => {
        const fix = document.querySelector<HTMLElement>('[data-testid="blocking-list"] button');
        if (fix) {
          fix.focus();
          fix.scrollIntoView({ block: 'center' });
        } else if (tries > 0) requestAnimationFrame(() => focusFirst(tries - 1));
      };
      requestAnimationFrame(() => focusFirst());
      return;
    }
    const named = fieldNamedIn(initial.rework?.note);
    requestAnimationFrame(() => (named ? goTo(FIELD_META[named]!.step, named) : goTo(1)));
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (o: SfOpportunitySummary) => {
    setPicking(o.id);
    try {
      const detail = await api.opportunity(o.id);
      update(prefillFromOpportunity(detail, cfg, data));
      setChangingOpp(false);
      goTo(2);
    } catch (err) {
      toast.error({
        title: 'Could not load the opportunity',
        description: isApiError(err) ? err.message : 'Please try again.',
      });
    } finally {
      setPicking(null);
    }
  };

  const discard = useMutation({
    mutationFn: () => api.deleteDraft(draft.id),
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: draftsKey });
      toast.success({ title: 'Draft discarded' });
      await navigate({ to: '/intake/new', search: {}, replace: true });
    },
  });

  // FB-01 (F-030): a quote Pricing sent back asks whether the scope changed before it is resubmitted.
  const askScope = Boolean(initial.rework?.askScopeChange);
  const [scopeChanged, setScopeChanged] = useState<boolean | null>(null);
  const scopeIds = { legend: useId(), help: useId() };

  const submit = useMutation({
    // FB-15 (W13-01): a second click starts clean (the old message no longer applies).
    onMutate: () => setSubmitError(null),
    mutationFn: async () => {
      // Rejects when the latest change is not on the server: never submit an older copy.
      await draft.flush();
      return api.submitDraft(
        draft.id,
        askScope && scopeChanged !== null ? { scopeChanged } : undefined,
      );
    },
    onSuccess: (res) => {
      setSubmitted(res);
      // FB-15 (W13-01): no stale screens. The quote, its timeline, the dashboards, the queues and the
      // notifications all changed; a resubmitted quote must not keep its "returned for rework" banner.
      for (const key of [
        draftsKey,
        quoteQueryKey(res.quoteNumber),
        ['timeline', res.quoteNumber],
        ['stage-times', res.quoteNumber],
        ['dashboard'],
        ['pipeline'],
        ['gate-queue'],
        ['eng-queue'],
        ['pricing-queue'],
        notificationsQueryKey,
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      window.scrollTo({ top: 0 });
    },
    onError: (err) => {
      if (err instanceof DraftNotSavedError) {
        setSubmitError({
          kind: 'not_saved',
          message: err.conflict
            ? err.message
            : `Your last change was not saved: ${err.message} Nothing was submitted.`,
        });
      } else if (isApiError(err, 422)) {
        setSubmitError({
          kind: 'refused',
          message: err.message,
          issues: submitProblemIssues(err.problem),
        });
      } else if (isApiError(err)) {
        const qn = err.problem.quoteNumber;
        setSubmitError({
          kind: 'other',
          message: err.message,
          ...(typeof qn === 'string' ? { quoteNumber: qn } : {}),
        });
      } else {
        setSubmitError({
          kind: 'other',
          message: 'Submit failed. Your draft is saved; please try again.',
        });
      }
    },
  });

  if (submitted) {
    return (
      <Section title="Submitted">
        <div className="grid gap-3" data-testid="submitted">
          <p className="flex items-center gap-2 text-lg">
            <CheckCircle2Icon aria-hidden className="text-primary size-6" />
            <span>
              Quote <strong data-testid="quote-number">{submitted.quoteNumber}</strong>{' '}
              {submitted.resubmitted ? 'resubmitted' : 'created'}
            </span>
          </p>
          <p className="text-sm">
            {submitted.routedTo === submitted.stageKey
              ? `It is now in ${stageLabel(config, submitted.stageKey)}.`
              : 'It is waiting for qualification by a sales leader, then goes to Engineering.'}
          </p>
          {submitted.warnings.length > 0 && (
            <Notice tone="warning">
              Engineering may ask about {submitted.warnings.length} item
              {submitted.warnings.length === 1 ? '' : 's'} you left open.
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/quotes/$quoteNumber" params={{ quoteNumber: submitted.quoteNumber }}>
                Open the quote
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/intake/new" search={{}}>
                Start another intake
              </Link>
            </Button>
          </div>
        </div>
      </Section>
    );
  }

  const stepProps = {
    data,
    update,
    cfg,
    evaluation,
    sfCloseDate: draft.sfCloseDate,
    hasDrawing,
  };

  return (
    <div className="grid gap-4" data-testid="intake-wizard" data-step={step}>
      <Stepper
        current={step}
        onSelect={goTo}
        canSelect={(n) => n !== step && Boolean(data.sfOpportunityId)}
      />

      {initial.rework && (
        <Notice tone="warning" testId="rework-notice">
          <strong>Rework of {initial.rework.quoteNumber}.</strong>{' '}
          {/* FB-15 (W13-05): who sent it back and why, pinned at the top of every step. */}
          <span data-testid="rework-sent-back">
            Sent back by {initial.rework.decidedByName ?? 'a reviewer'}
            {initial.rework.reasonLabel ? `: ${initial.rework.reasonLabel}` : ''}.
          </span>{' '}
          {/* DR-kam-sales-leader-12, DR-pricing-finance-14: one full stop after the note. */}
          {initial.rework.note
            ? `What to fix: ${initial.rework.note.trim()}${/[.!?…]$/.test(initial.rework.note.trim()) ? '' : '.'} `
            : ''}
          {askScope
            ? 'Submitting updates the same quote. If the scope did not change, it goes straight back to Pricing.'
            : 'Submitting updates the same quote and sends it back for qualification.'}
        </Notice>
      )}

      {draft.activeQuote && (
        <Notice tone="blocking" testId="active-quote">
          This opportunity already has an active CCQ quote ({draft.activeQuote.quoteNumber}). There
          is one quote per opportunity.{' '}
          <Link
            className="underline"
            to="/quotes/$quoteNumber"
            params={{ quoteNumber: draft.activeQuote.quoteNumber }}
          >
            Open existing
          </Link>
        </Notice>
      )}

      {step === 1 &&
        (changingOpp ? (
          <OpportunityPicker
            onPick={(o) => void pick(o)}
            picking={picking}
            selectedId={data.sfOpportunityId}
            newOpportunityUrl={cfg.newOpportunityUrl}
          />
        ) : (
          <Section
            title="Opportunity"
            action={
              // A reworked quote stays on its opportunity.
              initial.rework ? undefined : (
                <Button variant="outline" size="sm" onClick={() => setChangingOpp(true)}>
                  Change
                </Button>
              )
            }
          >
            <p className="font-semibold">{data.sfOpportunityName}</p>
            <p className="text-muted-foreground text-sm">{data.customer?.name}</p>
          </Section>
        ))}
      {step === 2 && <CustomerStep {...stepProps} />}
      {step === 3 && <ProductStep {...stepProps} />}
      {step === 4 && <ReviewStep {...stepProps} goTo={goTo} draftId={draft.id} />}
      {step === 4 && askScope && (
        <fieldset
          className="grid gap-2 rounded-md border p-4"
          aria-describedby={scopeIds.help}
          data-testid="scope-change"
        >
          <legend id={scopeIds.legend} className="px-1 text-sm font-medium">
            Did the scope change? (required)
          </legend>
          <p id={scopeIds.help} className="text-muted-foreground text-xs">
            A scope change is a different product, volume, resin, drawing or plant. No: the quote
            goes straight back to Pricing. Yes: it is qualified and goes through Engineering again.
          </p>
          <div className="flex flex-wrap gap-4">
            {(
              [
                [false, 'No, same scope'],
                [true, 'Yes, the scope changed'],
              ] as const
            ).map(([value, label]) => (
              <label key={label} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="scope-changed"
                  className="size-4 accent-[var(--primary)]"
                  checked={scopeChanged === value}
                  onChange={() => setScopeChanged(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {submitError && (
        <div role="alert">
          <Notice tone="blocking" testId="submit-error">
            <p>
              {submitError.message}{' '}
              {submitError.kind === 'other' && submitError.quoteNumber && (
                <Link
                  className="underline"
                  to="/quotes/$quoteNumber"
                  params={{ quoteNumber: submitError.quoteNumber }}
                >
                  Open existing
                </Link>
              )}
            </p>
            {/* FB-15 (W13-01): every field the server named, by its label, with a Fix link. */}
            {submitError.kind === 'refused' && submitError.issues.length > 0 && (
              <ul className="mt-1 grid gap-1" data-testid="submit-error-list">
                {submitError.issues.map((issue) => (
                  <li
                    key={`${issue.code}:${issue.field}`}
                    className="flex flex-wrap items-center gap-x-2"
                  >
                    <span>
                      {issue.field && issue.code !== 'MISSING_FIELD' && FIELD_META[issue.field]
                        ? `${issueLabel(issue)}: ${issue.message}`
                        : issueText(issue)}
                    </span>
                    {issue.field && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto min-h-0 px-0"
                        onClick={() => {
                          const target = issue.missing?.[0] ?? issue.field;
                          goTo(FIELD_META[target]?.step ?? issueStep(issue), target);
                        }}
                      >
                        Fix
                      </Button>
                    )}
                    {issue.missing && issue.missing.length > 0 && (
                      <span className="text-muted-foreground w-full text-xs">
                        Missing: {issue.missing.map((f) => FIELD_META[f]?.label ?? f).join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex items-center gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => goTo(step - 1)}>
              <ArrowLeftIcon aria-hidden /> Back
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setConfirmDiscard(true)}
            aria-label="Discard draft"
          >
            <Trash2Icon aria-hidden />
            <span className="hidden sm:inline">Discard</span>
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <SaveStatus state={draft.saveState} savedAt={draft.savedAt} error={draft.saveError} />
          {step < 4 ? (
            <Button onClick={() => goTo(step + 1)} disabled={!data.sfOpportunityId}>
              Next <ArrowRightIcon aria-hidden />
            </Button>
          ) : (
            <Button
              onClick={() => submit.mutate()}
              disabled={
                !evaluation.ready ||
                submit.isPending ||
                Boolean(draft.activeQuote) ||
                (askScope && scopeChanged === null)
              }
            >
              {submit.isPending ? 'Submitting…' : 'Submit to CCQ'}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this draft?"
        description="Everything entered for this intake is deleted. Salesforce is not changed."
        confirmLabel="Discard draft"
        destructive
        busy={discard.isPending}
        onConfirm={() => discard.mutate()}
      />
    </div>
  );
}
