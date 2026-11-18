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
  KeyValueGrid,
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
import { standardTermsFrom } from '@/components/intake/CommercialInputs';
import { intakeFactItems } from '@/components/intake/IntakeFacts';
import {
  ClosureCard,
  CustomerDecisionHeader,
  SfUpdateReminder,
  HandoffCard,
} from '@/components/outcome/CustomerDecision';
import { OfferLetterCard } from '@/components/outcome/OfferLetterCard';
import { QuotingTab } from '@/components/pricing/QuotingTab';
import { QuoteItemsList } from '@/components/QuoteItems';
import { QuoteNextStepLine } from '@/components/QuoteNextStepLine';
import { SalesforceLink } from '@/components/SalesforceLink';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { stageLabel, usePublicConfig } from '@/config/public-config';
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
  useOpenedTabs,
  type QuoteTab,
} from '@/lib/quote-tabs';
import { decisionReasonLabel } from '@/lib/reason-label';
import { absoluteTime } from '@/lib/time';
import { SAVE_FIRST_TEXT, useHasUnsavedChanges } from '@/lib/unsaved-changes';
import { cn } from '@/lib/utils';
import { marketText, valueListLabel } from '@/lib/value-label';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

const TAB_LABELS: Record<QuoteTab, string> = {
  overview: 'Overview',
  engineering: 'Engineering',
  quoting: 'Quoting',
  attachments: 'Attachments',
};

interface QuoteSearch {
  /**
   * `?tab=engineering` opens the Engineering tab (B-10), `?tab=quoting` the Quoting tab (B-11),
   * `?tab=attachments` the files (B-16), `?tab=overview` the Overview. A named tab is exact, for every
   * reader. With none, the quote opens on the reader's own work (UX-012, `useQuoteTab`).
   */
  tab?: QuoteTab;
}

export const Route = createFileRoute('/quotes/$quoteNumber')({
  validateSearch: (search: Record<string, unknown>): QuoteSearch =>
    isQuoteTab(search.tab) ? { tab: search.tab } : {},
  component: QuotePage,
});

/**
 * UX-012: the tab on screen, and how it is kept in the address.
 *
 * An address that names a tab (`?tab=`) always wins. One that names none opens on the tab of the
 * quote's current stage when the reader works that stage (by the permissions in `/me`), otherwise on
 * Overview. That tab is then written into the address, so a copied link opens on exactly the same tab
 * for whoever follows it.
 */
function useQuoteTab(quote: QuoteDetail | undefined): {
  tab: QuoteTab;
  selectTab: (next: QuoteTab) => void;
} {
  const { tab: named } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { permissions } = useCurrentUser();
  // A link to a place on the page (#offer-letter from My proposals, #commercial from Final Review) is a
  // link to the Overview, where those places are.
  const toAnchor = useLocation({ select: (l) => l.hash !== '' });
  const own: QuoteTab | undefined = !quote
    ? undefined
    : toAnchor
      ? 'overview'
      : defaultQuoteTab({
          inEngineering: quote.engineering.inQueue,
          inQuoting: quote.quoting.inQuoting,
          permissions,
        });
  useEffect(() => {
    if (!named && own) void navigate({ search: { tab: own }, hash: true, replace: true });
  }, [named, own, navigate]);
  return {
    tab: named ?? own ?? 'overview',
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
        <Tabs.List aria-label="Quote sections" className="flex gap-1 overflow-x-auto border-b">
          {QUOTE_TABS.map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className="text-foreground-2 data-[state=active]:border-action data-[state=active]:text-foreground hover:text-foreground -mb-px min-h-11 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium transition-colors sm:px-4"
            >
              {TAB_LABELS[t]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="grid gap-6">
          {/* FB-20 (F-070): the customer offer letter, made once Final Review approves the quote. */}
          {canReadOfferLetter && <OfferLetterCard quote={q} />}
          <HandoffCard quote={q} autoFocus={handoffFocus} />
          <ClosureCard closure={q.customerDecision.closure} />
          <CommercialPanel quote={q} />
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <IntakeCard quote={q} />
            <div className="grid content-start gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 className="text-base font-semibold">Why this priority?</h2>
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
          </div>

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

function IntakeCard({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) => valueListLabel(config, list, code);
  const ship = quote.shipTo;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Intake</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueGrid
          items={[
            { label: 'Customer', value: quote.customerName },
            {
              label: 'Customer status',
              value:
                quote.customerStatus === 'not_yet_established'
                  ? 'Not yet a Pretium customer (no ERP account)'
                  : 'Pretium customer',
            },
            { label: 'Opportunity', value: quote.opportunityName },
            // B-23: testers tie quotes out against Salesforce (U5) by this id.
            // FB-18 (W13-31): the id is the link once the Salesforce URL is set (the header says how).
            {
              label: 'SF opportunity ID',
              value: (
                <SalesforceLink
                  quote={quote}
                  hint={false}
                  label={
                    <span className="font-mono" data-testid="sf-opportunity-id">
                      {quote.sfOpportunityId}
                    </span>
                  }
                />
              ),
            },
            { label: 'KAM', value: quote.kamName },
            { label: 'Request class', value: label('request_class', quote.requestClass) },
            // FB-12 (F-073): the market and the sub-market that sets the strategic-fit score.
            { label: 'Market', value: marketText(config, quote.market, quote.subMarket) },
            { label: 'Product family', value: label('product_family', quote.productFamily) },
            { label: 'Resin', value: label('resin', quote.resin) },
            {
              label: 'Components',
              value: quote.components.map((c) => label('component', c)).join(', '),
            },
            // FB-02: the product facts (neck, resin grade, PCR, color, follow-ups, need-by dates…).
            ...intakeFactItems(
              config?.valueLists,
              quote.intakeFacts,
              quote.neckFinish,
              standardTermsFrom(config),
            ),
            {
              label: 'Annual volume',
              value: quote.estAnnualVolume?.toLocaleString('en-US'),
            },
            {
              label: 'Annual revenue',
              value:
                quote.estAnnualRevenue != null
                  ? `$${quote.estAnnualRevenue.toLocaleString('en-US')}`
                  : null,
            },
            // FB-02 (T-009): Salesforce's close date (latest sync), and the KAM's need-by dates.
            { label: 'Salesforce close date', value: quote.expectedCloseDate },
            { label: 'Drawing', value: label('drawing_status', quote.drawingStatus) },
            { label: 'Packaging', value: label('packaging_type', quote.packagingType) },
            {
              id: 'ship-to',
              label: 'Ship / fill destination',
              value: (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span data-testid="ship-to-value">
                    {ship
                      ? [ship.line1, ship.city, ship.state, ship.postal]
                          .filter(Boolean)
                          .join(', ') || '–'
                      : '–'}
                  </span>
                  <FieldOverride quote={quote} field="ship_to" />
                </span>
              ),
            },
            {
              id: 'desc',
              label: 'Description',
              value: quote.standardDescription ?? quote.description,
            },
            { label: 'Comments for Engineering', value: quote.commentsForEngineering },
            {
              label: 'Submitted',
              value: quote.submittedAt ? absoluteTime(quote.submittedAt) : 'Not submitted',
            },
            { label: 'Stage', value: stageLabel(config, quote.stageKey) },
            // The proposal dates and validity countdown are in the Customer decision header (B-13).
          ]}
        />
        {/* FB-19 (W13-32): every item, quoted together. */}
        {quote.items.length > 1 && (
          <div className="mt-4">
            <QuoteItemsList items={quote.items} />
          </div>
        )}
      </CardContent>
    </Card>
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
          <h2 className="text-base font-semibold">Gate decisions</h2>
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
