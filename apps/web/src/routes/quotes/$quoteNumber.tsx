import type { QuoteDetail } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { RotateCcwIcon, SearchXIcon } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { useEffect, useId, useState } from 'react';

import { useCan, useCurrentUser } from '@/auth';
import {
  ErrorState,
  FieldOverride,
  GateDecisionDialog,
  GateRail,
  GuardrailNote,
  PageHeader,
  PriorityBadge,
  QualificationWarnings,
  QuoteTimeline,
  quoteQueryKey,
  ScoreBreakdownTable,
  SkeletonCard,
  StageBadge,
} from '@/components';
import { AttachmentsPanel } from '@/components/attachments/Attachments';
import { CommercialPanel } from '@/components/commercial/CommercialPanel';
import { EngineeringTab } from '@/components/engineering/EngineeringTab';
import { StageTimeBar } from '@/components/engineering/StageTimeBar';
import {
  ClosureCard,
  CustomerDecisionHeader,
  SfUpdateReminder,
  HandoffCard,
} from '@/components/outcome/CustomerDecision';
import { OfferLetterCard } from '@/components/outcome/OfferLetterCard';
import { QuotingTab } from '@/components/pricing/QuotingTab';
import {
  EngineeringGlance,
  IntakeCard,
  PricingGlance,
  TermsGlance,
} from '@/components/quote/AtAGlance';
import { QuoteNextStepLine } from '@/components/QuoteNextStepLine';
import { SalesforceLink } from '@/components/SalesforceLink';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { usePublicConfig } from '@/config/public-config';
import { api, isApiError, type ApiError } from '@/lib/api';
import { decisionLabel, forwardReadiness } from '@/lib/decision-label';
import { holdSummary } from '@/lib/hold-text';
import { blockedDecision } from '@/lib/next-step';
import {
  closedText,
  quoteNotFoundText,
  requestReference,
  reworkHeadline,
} from '@/lib/quote-header-text';
import { STALE_QUOTE_TEXT, quoteLoadFailure } from '@/lib/quote-page-error';
import {
  QUOTE_TABS,
  defaultQuoteTab,
  isQuoteTab,
  tabForHash,
  tabsWithWork,
  termsWorkWaiting,
  useOpenedTabs,
  type QuoteTab,
} from '@/lib/quote-tabs';
import { decisionReasonLabel } from '@/lib/reason-label';
import { absoluteTime } from '@/lib/time';
import { SAVE_FIRST_TEXT, useHasUnsavedChanges } from '@/lib/unsaved-changes';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

const TAB_LABELS: Record<QuoteTab, string> = {
  overview: 'Overview',
  engineering: 'Engineering',
  quoting: 'Quoting',
  commercial: 'Commercial terms',
  attachments: 'Attachments',
};

interface QuoteSearch {
  /**
   * `?tab=engineering` opens the Engineering tab (B-10), `?tab=quoting` the Quoting tab (B-11),
   * `?tab=attachments` the files (B-16), `?tab=commercial` the commercial terms (FB-25), `?tab=overview`
   * the Overview. A named tab is exact, for every reader. With none, the quote opens on the reader's own
   * work (UX-012, `useQuoteTab`).
   */
  tab?: QuoteTab;
}

export const Route = createFileRoute('/quotes/$quoteNumber')({
  validateSearch: (search: Record<string, unknown>): QuoteSearch =>
    isQuoteTab(search.tab) ? { tab: search.tab } : {},
  component: QuotePage,
});

/** FB-25: the terms wait on the reader (the dot on the tab, and the tab a quote opens on). */
function termsWorkFor(quote: QuoteDetail): boolean {
  const t = quote.commercial.terms;
  return termsWorkWaiting({
    stageKey: quote.stageKey,
    closed: quote.status === 'closed',
    canEditTerms: t.canEdit,
    exceptionCanDecide: t.exception?.canDecide === true,
    toolingCommitmentAnswered: t.termsToolingCommitment !== null,
  });
}

/**
 * UX-012: the tab on screen, and how it is kept in the address.
 *
 * An address that names a tab (`?tab=`) always wins. One that names none opens on the tab of the
 * quote's current stage when the reader works that stage (by the permissions in `/me`), otherwise on
 * Overview. That tab is then written into the address, so a copied link opens on exactly the same tab
 * for whoever follows it.
 *
 * FB-25: a link to a place on the page opens the tab that place is on (`tabForHash`): `#commercial`
 * from Final Review, a notice or an older email (`?tab=overview#commercial`) opens Commercial terms, and
 * `#offer-letter` the Overview. Such a hash wins over `?tab=`, so links made before the tab existed keep
 * working.
 */
function useQuoteTab(quote: QuoteDetail | undefined): {
  tab: QuoteTab;
  selectTab: (next: QuoteTab) => void;
} {
  const { tab: named } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { permissions } = useCurrentUser();
  const hash = useLocation({ select: (l) => l.hash });
  const anchored = tabForHash(hash);
  const own: QuoteTab | undefined = !quote
    ? undefined
    : (anchored ??
      defaultQuoteTab({
        inEngineering: quote.engineering.inQueue,
        inQuoting: quote.quoting.inQuoting,
        inIntake: quote.stageKey === 'INTAKE' && quote.status !== 'closed',
        termsWork: termsWorkFor(quote),
        permissions,
      }));
  const wanted = anchored ?? named;
  const loaded = quote !== undefined;
  useEffect(() => {
    if (own && (!named || (anchored && named !== anchored))) {
      void navigate({ search: { tab: anchored ?? own }, hash: true, replace: true });
    }
  }, [named, own, anchored, navigate]);
  const tab = wanted ?? own ?? 'overview';
  // The place a hash names is on a tab that mounts with this render: bring it into view once it is there.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!id || !anchored || tab !== anchored) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash, anchored, tab, loaded]);
  return {
    tab,
    selectTab: (next) => void navigate({ search: { tab: next }, replace: true }),
  };
}

function QuotePage() {
  const { quoteNumber } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  useDocumentTitle(quoteNumber);
  const quote = useQuery({
    queryKey: quoteQueryKey(quoteNumber),
    queryFn: () => api.quote(quoteNumber),
  });
  const { tab, selectTab } = useQuoteTab(quote.data);
  // UX-001: once opened, the Engineering and Quoting tabs stay on the page (hidden) while another tab
  // is shown, so values typed and not yet saved are still there on the way back.
  const openedTabs = useOpenedTabs(quoteNumber, tab);
  const kept = (t: QuoteTab) => ({
    ...(openedTabs.includes(t) ? { forceMount: true as const } : {}),
    hidden: tab !== t,
  });
  const [deciding, setDeciding] = useState<{
    gate: string;
    outcome?: string;
    scope?: { outcomes: string[]; title: string };
  } | null>(null);
  /** B-13/B-26: right after recording Awarded (into Commit & Hand Off), the hand-off form opens with focus. */
  const [handoffFocus, setHandoffFocus] = useState(false);
  const canReadFinalReview = useCan('finalReview.read');
  const canReadOfferLetter = useCan('offer.read');
  // UX-001: a decision is recorded on what is saved, so the header's decision buttons wait for a save.
  const unsaved = useHasUnsavedChanges(quoteNumber);
  const saveFirstId = useId();

  if (quote.isPending) {
    return (
      <div className="grid gap-4">
        <PageHeader title={quoteNumber} eyebrow="Quote" />
        <SkeletonCard />
      </div>
    );
  }
  // A refresh that fails in the background keeps the page (and what is typed on it): see
  // `quoteLoadFailure`.
  const failure = quoteLoadFailure(quote.error, quote.data !== undefined);
  const q = quote.data;
  if (failure === 'replace' || !q) {
    return (
      <div>
        <PageHeader title={quoteNumber} eyebrow="Quote" />
        {isApiError(quote.error, 404) ? (
          <QuoteNotFound quoteNumber={quoteNumber} error={quote.error} />
        ) : (
          <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />
        )}
      </div>
    );
  }
  // Final Review is decided on its own screen (the full summary, then the decision), so the header
  // offers that one way in rather than a second button that decides the same thing.
  const onFinalReviewScreen =
    q.stageKey === 'FINAL_REVIEW' && q.status !== 'closed' && canReadFinalReview;
  // The header's decision button appears once the quote can move forward (the Engineering and Quoting
  // tabs say what is still needed, and hold the other decisions until then).
  const offeredGates = [...new Set(q.availableActions.map((a) => a.gateKey))].filter(
    (g) => !(onFinalReviewScreen && g === 'G4'),
  );
  // UX-003: a gate where the server would refuse every outcome it offers (a quote back with the KAM,
  // not resubmitted yet) has nothing to decide: no button, and the next-step line says so.
  const nothingToDecide = offeredGates
    .map((g) => blockedDecision(q.availableActions, g))
    .find((b) => b.blocked);
  const gates = offeredGates.filter(
    (g) =>
      forwardReadiness(q.availableActions, g).ready &&
      !blockedDecision(q.availableActions, g).blocked,
  );
  const canDecideFinalReview = q.availableActions.some((a) => a.gateKey === 'G4');
  const tierOverride = q.overridableFields.find((f) => f.field === 'priority_tier')?.applied;
  // FB-25 (N17-18): a dot on a tab where the reader has work waiting.
  const working = tabsWithWork({ nextStep: q.nextStep, termsWork: termsWorkFor(q) });

  return (
    <div className="grid gap-6" data-testid="quote-detail" data-stage={q.stageKey}>
      <PageHeader
        className="mb-0"
        title={q.quoteNumber}
        eyebrow="Quote"
        description={
          // FB-19 (W13-32): "16 oz bottle + 2 more" for a multi-item quote.
          [q.customerName, q.opportunityName, q.itemCount > 1 ? q.itemsSummary : null]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <>
            {/* UX-013: the opportunity is named, as a link once the Salesforce URL is set; until
                then the ID is shown with the same label (and, to Admins, where to set the URL). */}
            {q.sfOpportunityUrl ? (
              <SalesforceLink quote={q} label="Salesforce opportunity" />
            ) : (
              <span
                className="text-muted-foreground inline-flex flex-wrap items-center gap-x-2 text-sm"
                data-testid="sf-opportunity-labelled"
              >
                Salesforce opportunity
                <SalesforceLink quote={q} />
              </span>
            )}
            {onFinalReviewScreen && (
              <Link
                to="/quotes/$quoteNumber/review"
                params={{ quoteNumber: q.quoteNumber }}
                className={cn(
                  buttonVariants({ variant: canDecideFinalReview ? 'action' : 'outline' }),
                )}
                data-testid="open-final-review"
              >
                {canDecideFinalReview ? 'Review and decide' : 'Open Final Review'}
              </Link>
            )}
            {gates.map((g) => (
              <Button
                key={g}
                onClick={() => setDeciding({ gate: g })}
                disabled={unsaved}
                aria-describedby={unsaved ? saveFirstId : undefined}
                data-testid="header-decide"
              >
                {decisionLabel(g, q.availableActions.find((a) => a.gateKey === g)?.gateLabel)}
              </Button>
            ))}
          </>
        }
      />
      {unsaved && gates.length > 0 && (
        <p
          id={saveFirstId}
          className="text-muted-foreground -mt-3 text-sm sm:text-right"
          data-testid="header-save-first"
        >
          {SAVE_FIRST_TEXT}
        </p>
      )}
      {failure === 'keep' && (
        <div
          role="status"
          className="bg-muted rounded-card flex flex-wrap items-center justify-between gap-3 border p-3 text-sm"
          data-testid="quote-stale"
        >
          <p>{STALE_QUOTE_TEXT}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void quote.refetch()}
            disabled={quote.isFetching}
          >
            {quote.isFetching ? 'Refreshing…' : 'Try again'}
          </Button>
        </div>
      )}
      {/* FB-16 (W13-15): both assignees of the Engineering stage, for everyone who opens the quote. */}
      {(q.engineering.assignedEngineerName || q.engineering.assignedSchedulerName) && (
        <p className="text-muted-foreground -mt-3 text-sm" data-testid="quote-assignees">
          Engineer: {q.engineering.assignedEngineerName ?? 'unassigned'}
          {' · '}
          Production scheduler: {q.engineering.assignedSchedulerName ?? 'none assigned'}
        </p>
      )}
      <section
        aria-label="Stage and priority"
        className="reg-marks bg-card rounded-card rise grid gap-5 border px-5 pt-4 pb-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <StageBadge stageKey={q.stageKey} />
          {/* UX-002: on hold, the hold sentence is the next-step line under the tracker. */}
          {q.status === 'on_hold' && q.nextStep && (
            <span className="text-muted-foreground text-sm">On hold</span>
          )}
          {q.status !== 'active' && !(q.status === 'on_hold' && q.nextStep) && (
            <span className="text-muted-foreground text-sm" data-testid="quote-status">
              {q.status === 'on_hold'
                ? holdSummary({ ...q.commercial.hold, reviewDate: q.reviewDate })
                : closedText(q.outcome, q.customerDecision.closure?.outcomeLabel)}
            </span>
          )}
          <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="quote-priority">
            {/* UX-013: say what the number and the tier beside it are. */}
            {q.priority.visible && <span className="text-foreground-2 text-sm">Priority</span>}
            <PriorityBadge priority={q.priority} quoteNumber={q.quoteNumber} />
            <FieldOverride quote={q} field="priority_tier" />
          </span>
        </div>
        <GateRail stageKey={q.stageKey} />
        <QuoteNextStepLine quote={q} nothingToDecide={nothingToDecide?.missing ?? null} />
      </section>

      <SfUpdateReminder quote={q} />
      <CustomerDecisionHeader quote={q} />
      <ReworkBanner quote={q} />
      <QualificationWarnings warnings={q.warnings} />
      {/* DR-kam-sales-leader-09 (decided 2026-11-11): the platform-minimum warning on the quote too. */}
      <GuardrailNote text={q.intakeFacts.guardrailWarning} />
      <StageTimeBar quoteNumber={q.quoteNumber} />

      <Tabs.Root
        value={tab}
        onValueChange={(next) => selectTab(next as QuoteTab)}
        className="grid gap-6"
      >
        <UnsavedChangesGuard quoteNumber={q.quoteNumber} />
        {/* FB-25 (N17-18, N18-18): the tab bar is hard to miss. Larger labels, a filled selected tab, and
            it stays under the page header while the page scrolls (index.css keeps focus clear of it). */}
        <Tabs.List
          aria-label="Quote sections"
          className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-16 z-20 -mx-4 flex gap-1 overflow-x-auto border-b px-4 backdrop-blur sm:mx-0 sm:px-0"
          data-sticky-top=""
          data-testid="quote-tabs"
        >
          {QUOTE_TABS.map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              data-testid={`quote-tab-${t}`}
              data-work={working.includes(t) || undefined}
              className="text-foreground-2 data-[state=active]:border-action data-[state=active]:text-foreground data-[state=active]:bg-accent hover:text-foreground hover:bg-accent/60 -mb-px inline-flex min-h-12 shrink-0 items-center gap-2 rounded-t-md border-b-[3px] border-transparent px-3 text-base font-medium transition-colors data-[state=active]:font-semibold sm:px-4"
            >
              {TAB_LABELS[t]}
              {working.includes(t) && (
                <>
                  <span
                    aria-hidden="true"
                    className="bg-destructive size-2 shrink-0 rounded-full"
                    data-testid="tab-work-dot"
                  />
                  <span className="sr-only"> (work waiting for you)</span>
                </>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="grid gap-6" data-testid="overview">
          {/* FB-20 (F-070): the customer offer letter, made once Final Review approves the quote. */}
          {canReadOfferLetter && <OfferLetterCard quote={q} />}
          <HandoffCard quote={q} autoFocus={handoffFocus} />
          <ClosureCard closure={q.customerDecision.closure} />
          {/* FB-25 (N18-18): the read-only summary of everything filled in so far. */}
          <section
            id="at-a-glance"
            aria-labelledby="at-a-glance-heading"
            className="grid gap-6"
            data-testid="at-a-glance"
          >
            <h2 id="at-a-glance-heading" className="font-display text-lg font-semibold">
              At a glance
            </h2>
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <IntakeCard quote={q} />
              <div className="grid content-start gap-6">
                <EngineeringGlance quote={q} />
                <PricingGlance quote={q} />
              </div>
            </div>
            <TermsGlance quote={q} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h3 className="text-base font-semibold">Why this priority?</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScoreBreakdownTable
                    priority={q.priority}
                    market={{ market: q.market, subMarket: q.subMarket }}
                  />
                  {/* FB-04 (F-065, T-024): the sales leader's justification, visible to Engineering. */}
                  {tierOverride && (
                    <p className="mt-3 text-xs" data-testid="priority-override-note">
                      <span className="font-semibold">Tier overridden by </span>
                      {tierOverride.requestedByName ?? 'a sales leader'}:{' '}
                      {tierOverride.justification}
                    </p>
                  )}
                </CardContent>
              </Card>
              <DecisionsCard quote={q} />
            </div>
          </section>

          <Card>
            <CardContent className="pt-6">
              <QuoteTimeline quoteNumber={q.quoteNumber} />
            </CardContent>
          </Card>
        </Tabs.Content>
        <Tabs.Content value="engineering" {...kept('engineering')}>
          <EngineeringTab
            quote={q}
            onDecide={(outcome, scope) =>
              setDeciding({
                gate: 'G2',
                ...(outcome ? { outcome } : {}),
                ...(scope ? { scope } : {}),
              })
            }
          />
        </Tabs.Content>
        {/* FB-25 (N18-18): the Commercial terms panel, unchanged in behaviour, on its own tab. */}
        <Tabs.Content value="commercial" {...kept('commercial')}>
          <CommercialPanel quote={q} />
        </Tabs.Content>
        <Tabs.Content value="attachments">
          <Card>
            <CardContent className="pt-6">
              <AttachmentsPanel target={{ quoteNumber: q.quoteNumber }} />
            </CardContent>
          </Card>
        </Tabs.Content>
        <Tabs.Content value="quoting" {...kept('quoting')}>
          <QuotingTab
            quote={q}
            onDecide={(outcome, scope) =>
              setDeciding({
                gate: 'G3',
                ...(outcome ? { outcome } : {}),
                ...(scope ? { scope } : {}),
              })
            }
          />
        </Tabs.Content>
      </Tabs.Root>

      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          gateKey={deciding.gate}
          quoteNumber={q.quoteNumber}
          {...(deciding.outcome ? { initialOutcomeKey: deciding.outcome } : {})}
          {...(deciding.scope
            ? { outcomeKeys: deciding.scope.outcomes, title: deciding.scope.title }
            : {})}
          onDecided={(result) => {
            if (result.quote.stageKey === 'COMMIT_HANDOFF' && q.stageKey === 'CUSTOMER_DECISION') {
              setHandoffFocus(true);
              void navigate({ search: {}, replace: true });
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * UX-014: a quote that could not be loaded (404). The server answers the same for a number that does
 * not exist and for a quote outside the reader's scope, and so does this: it never says which. It
 * offers the way back (the Pipeline) and, in small print, the request reference for support.
 */
function QuoteNotFound({ quoteNumber, error }: { quoteNumber: string; error: ApiError }) {
  const reference = requestReference(error.problem);
  return (
    <div
      role="alert"
      data-status={404}
      data-testid="quote-not-found"
      className="bg-card rounded-card flex gap-3 border p-4 sm:p-5"
    >
      <SearchXIcon className="text-emphasis mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="grid min-w-0 gap-1.5">
        <p className="font-semibold">{quoteNotFoundText(quoteNumber).title}</p>
        <p className="text-muted-foreground text-sm">{quoteNotFoundText(quoteNumber).message}</p>
        <div>
          <Link to="/quotes" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Go to the Pipeline
          </Link>
        </div>
        {reference && (
          <p className="text-muted-foreground text-xs">
            Reference for support: <span className="font-mono break-all">{reference}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A quote returned for rework: what to fix. UX-002: the KAM's way back into the wizard ("Fix and
 * resubmit") is on the next-step line under the stage tracker, just above.
 */
function ReworkBanner({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  if (!quote.rework) return null;
  // UX-013: the gate by its configured label ("Qualify & prioritize"), not its number ("G1").
  const gateLabel =
    config?.gates.find((g) => g.key === quote.rework?.gateKey)?.label ?? quote.rework.gateKey;
  return (
    <section
      role="status"
      data-testid="rework-banner"
      className="bg-warning text-warning-foreground rounded-card grid gap-2 p-4"
    >
      <p className="flex items-center gap-2 font-semibold">
        <RotateCcwIcon className="size-4 shrink-0" aria-hidden="true" />
        {reworkHeadline(quote.rework.decidedByName, gateLabel)}
      </p>
      {quote.rework.reasonLabel && <p className="text-sm">Reason: {quote.rework.reasonLabel}</p>}
      {quote.rework.note && <p className="text-sm">What to fix: {quote.rework.note}</p>}
      <p className="text-xs">{absoluteTime(quote.rework.decidedAt)}</p>
    </section>
  );
}

function DecisionsCard({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  const outcomeLabel = (gate: string, key: string) =>
    config?.outcomes.find((o) => o.gateKey === gate && o.key === key)?.label ?? key;
  // UX-013: the gate by its configured label ("Qualify & prioritize"), not its number ("G1").
  const gateName = (gate: string) => config?.gates.find((g) => g.key === gate)?.label ?? gate;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="text-base font-semibold">Gate decisions</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {quote.decisions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No decisions yet.</p>
        ) : (
          <ol className="grid gap-3" data-testid="decisions">
            {quote.decisions.map((d) => (
              <li
                key={d.id}
                className="grid gap-0.5 text-sm"
                data-superseded={d.superseded || undefined}
              >
                <span className="font-medium">
                  {gateName(d.gateKey)} · {outcomeLabel(d.gateKey, d.outcomeKey)}
                  {d.superseded && (
                    <span
                      className="bg-muted text-muted-foreground rounded-pill ml-2 px-2 py-0.5 text-xs font-normal"
                      title="Made on an earlier version of this quote, before it was re-quoted or sent back."
                    >
                      Superseded
                    </span>
                  )}
                </span>
                {/* UX-006: the reason code's label (it was the stored key, in brackets). */}
                {d.reasonCode && (
                  <span className="text-foreground-2" data-testid="decision-reason">
                    Reason: {decisionReasonLabel(config, d, quote)}
                  </span>
                )}
                {d.note && <span className="text-foreground-2">{d.note}</span>}
                <span className="text-muted-foreground text-xs">
                  {d.decidedByName ?? 'Unknown'} · {absoluteTime(d.decidedAt)} · v{d.quoteVersion}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
