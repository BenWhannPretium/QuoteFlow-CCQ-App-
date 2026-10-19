import type { IntakeDraft, SfOpportunitySummary, SubmitIntakeResponse } from '@ccq/contracts';
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
import { useMemo, useState } from 'react';

import { RequirePermission } from '@/auth';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { stageLabel, usePublicConfig } from '@/config/public-config';
import {
  evaluateDraft,
  prefillFromOpportunity,
  wizardConfig,
  type WizardConfig,
} from '@/intake/model';
import { OpportunityPicker } from '@/intake/OpportunityPicker';
import { CustomerStep, ProductStep, ReviewStep } from '@/intake/Steps';
import { Notice, Section, Stepper } from '@/intake/ui';
import { useIntakeDraft, type SaveState } from '@/intake/useIntakeDraft';
import { isApiError, api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

interface IntakeSearch {
  /** The draft being edited; absent on the start screen. */
  draft?: string;
}

export const Route = createFileRoute('/intake/new')({
  validateSearch: (search: Record<string, unknown>): IntakeSearch =>
    typeof search.draft === 'string' && search.draft ? { draft: search.draft } : {},
  component: () => (
    <RequirePermission permission="quote.create">
      <IntakePage />
    </RequirePermission>
  ),
});

const draftsKey = ['intake', 'drafts'] as const;

function IntakePage() {
  useDocumentTitle('New intake');
  const { draft: draftId } = Route.useSearch();
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
        <DraftLoader key={draftId} id={draftId} cfg={cfg} />
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
      await navigate({ to: '/intake/new', search: { draft: draft.id } });
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

function DraftLoader({ id, cfg }: { id: string; cfg: WizardConfig }) {
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
  return <Wizard initial={draft.data} cfg={cfg} />;
}

function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: Date | null }) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'error'
        ? 'Couldn’t save; will retry'
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

function Wizard({ initial, cfg }: { initial: IntakeDraft; cfg: WizardConfig }) {
  const draft = useIntakeDraft(initial);
  const { data, step, update } = draft;
  const evaluation = useMemo(() => evaluateDraft(data, cfg), [data, cfg]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: config } = usePublicConfig();
  const [picking, setPicking] = useState<string | null>(null);
  const [changingOpp, setChangingOpp] = useState(!data.sfOpportunityId);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; quoteNumber?: string } | null>(
    null,
  );
  const [submitted, setSubmitted] = useState<SubmitIntakeResponse | null>(null);

  const goTo = (n: number) => {
    setSubmitError(null);
    void draft.setStep(n);
    window.scrollTo({ top: 0 });
  };

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

  const submit = useMutation({
    mutationFn: async () => {
      await draft.flush();
      return api.submitDraft(draft.id);
    },
    onSuccess: (res) => {
      setSubmitted(res);
      void qc.invalidateQueries({ queryKey: draftsKey });
      window.scrollTo({ top: 0 });
    },
    onError: (err) => {
      if (isApiError(err)) {
        const qn = err.problem.quoteNumber;
        setSubmitError({
          message: err.message,
          ...(typeof qn === 'string' ? { quoteNumber: qn } : {}),
        });
      } else {
        setSubmitError({ message: 'Submit failed. Your draft is saved; please try again.' });
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

  const stepProps = { data, update, cfg, evaluation };

  return (
    <div className="grid gap-4" data-testid="intake-wizard" data-step={step}>
      <Stepper
        current={step}
        onSelect={goTo}
        canSelect={(n) => n !== step && Boolean(data.sfOpportunityId)}
      />

      {initial.rework && (
        <Notice tone="warning" testId="rework-notice">
          <strong>
            Rework of {initial.rework.quoteNumber}
            {initial.rework.reasonLabel ? ` (${initial.rework.reasonLabel})` : ''}.
          </strong>{' '}
          {initial.rework.note ? `What to fix: ${initial.rework.note}. ` : ''}
          Submitting updates the same quote and sends it back for qualification.
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

      {submitError && (
        <Notice tone="blocking" testId="submit-error">
          {submitError.message}{' '}
          {submitError.quoteNumber && (
            <Link
              className="underline"
              to="/quotes/$quoteNumber"
              params={{ quoteNumber: submitError.quoteNumber }}
            >
              Open existing
            </Link>
          )}
        </Notice>
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
          <SaveStatus state={draft.saveState} savedAt={draft.savedAt} />
          {step < 4 ? (
            <Button onClick={() => goTo(step + 1)} disabled={!data.sfOpportunityId}>
              Next <ArrowRightIcon aria-hidden />
            </Button>
          ) : (
            <Button
              onClick={() => submit.mutate()}
              disabled={!evaluation.ready || submit.isPending || Boolean(draft.activeQuote)}
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
