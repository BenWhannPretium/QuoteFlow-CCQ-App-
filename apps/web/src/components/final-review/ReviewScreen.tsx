import { BUDGETARY_CAPITAL_LABEL, type ReviewSummary } from '@ccq/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  EyeOffIcon,
  FileIcon,
  InfoIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { QuoteItemsList } from '@/components/QuoteItems';
import { Button, buttonVariants } from '@/components/ui/button';
import { BLOCKING_BOX, FlagKey, WARNING_BOX } from '@/components/ui/flag-key';
import { stageLabel, usePublicConfig, useValueList } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime, relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { marketText, valueListLabel } from '@/lib/value-label';

import { AttachmentDownloadLink } from '../attachments/Attachments';
import { CapitalTerms, capitalTermFieldId } from '../commercial/CapitalTerms';
import { AdditionalApprovals, TermsExceptionCard } from '../commercial/TermsException';
import { CostEstimateSummary } from '../engineering/EngineeringCostCards';
import { EquipmentBomLine, pricingInputItems } from '../engineering/EngineeringExtras';
import { formatDuration } from '../engineering/format';
import { ErrorState } from '../ErrorState';
import { RequiredKey, RequiredLabel } from '../forms';
import { GateDecisionDialog, quoteQueryKey } from '../GateDecisionDialog';
import {
  customerShareText,
  NonStandardTermsBadge,
  standardTermsFrom,
} from '../intake/CommercialInputs';
import { intakeFactItems } from '../intake/IntakeFacts';
import { KeyValueGrid, type KeyValueItem } from '../KeyValueGrid';
import { PageHeader } from '../PageHeader';
import { reviewSummaryKey } from './keys';
import { CapitalChip } from '../pricing/CapitalChip';
import { PricingContextPanel } from '../pricing/PricingContextPanel';
import { QuotingSteps } from '../pricing/QuotingSteps';
import { PriorityBadge, ScoreBreakdownTable } from '../Priority';
import { withValues } from '../quote/AtAGlance';
import { SalesforceLink } from '../SalesforceLink';
import { SkeletonCard } from '../Skeletons';
import { StageBadge } from '../StageBadge';
import { releaseBlockers, type ReleaseBlocker } from './blockers';

/** The Terms and Legal section's id (its heading is `${id}-heading`). */
const TERMS_LEGAL_ID = 'terms-legal';

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? null : `$${n.toLocaleString('en-US')}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? null : `${n}%`);
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1_048_576
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1_048_576).toFixed(1)} MB`;

function Section({
  id,
  title,
  children,
  aside,
}: {
  id: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      className="bg-card rounded-card grid gap-4 border p-4 sm:p-5"
      aria-labelledby={`${id}-heading`}
      data-testid={`review-${id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={`${id}-heading`}
          // UX-010: "Go to Terms and Legal on this page" moves focus here.
          tabIndex={-1}
          className="font-display text-[1.1875rem] font-[450] tracking-[-0.012em]"
        >
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The Final Review screen (B-12, F-16 as a P0 decision record, the PRD's "one-page snapshot"): intake,
 * score, engineering solution and capacity evidence, price approval with its basis and range note,
 * capital readiness, attachments, open warnings and the decisions so far, with a sticky decision bar.
 * Commercial parts arrive only for roles that may read them. Everything the bar offers comes from
 * the server's availableActions: the decision itself is the generic G4 gate route.
 */
/**
 * DR-approver-leadership-admin-05 (decided 2026-11-11: at minimum, show the hold here): a held quote
 * says so on the review screen, with its review date, and what a decision does to the hold. Taking a
 * decision resumes it (the hold ends); to keep it on hold, take none.
 */
function OnHoldBanner({ reviewDate }: { reviewDate: string | null }) {
  const date = reviewDate
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${reviewDate}T12:00:00Z`),
      )
    : null;
  return (
    <p
      role="status"
      className="bg-warning text-warning-foreground rounded-card px-4 py-3 text-sm"
      data-testid="review-on-hold"
    >
      <strong>On hold{date ? ` until ${date}` : ''}.</strong> A Final Review decision ends the hold:
      Advance releases the offer now. To keep it on hold, record no decision; the hold owner and the
      reason are on the full quote.
    </p>
  );
}

export function ReviewScreen({ quoteNumber }: { quoteNumber: string }) {
  const summary = useQuery({
    queryKey: reviewSummaryKey(quoteNumber),
    queryFn: () => api.reviewSummary(quoteNumber),
  });
  // FB-25 (N17-25): one "Decide final review"; the dialog's groups offer the outcomes.
  const [deciding, setDeciding] = useState(false);
  const navigate = useNavigate();
  const fundingNotAnswered = useFundingNotAnswered();
  // FB-27 (N17-09): the red / yellow key watches the whole review.
  const pageRef = useRef<HTMLDivElement>(null);

  if (summary.isPending) {
    return (
      <div className="grid gap-4">
        <PageHeader title={quoteNumber} eyebrow="Final Review" />
        <SkeletonCard />
      </div>
    );
  }
  if (summary.error) {
    return (
      <div>
        <PageHeader title={quoteNumber} eyebrow="Final Review" />
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      </div>
    );
  }
  const s = summary.data;
  const q = s.quote;

  return (
    <div
      className="grid gap-4 pb-4"
      data-testid="review-screen"
      data-stage={q.stageKey}
      ref={pageRef}
    >
      <PageHeader
        className="mb-0"
        title={q.quoteNumber}
        eyebrow="Final Review"
        description={[q.customerName, q.opportunityName].filter(Boolean).join(' · ') || undefined}
        actions={
          <Link
            to="/quotes/$quoteNumber"
            params={{ quoteNumber }}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            data-testid="full-timeline-link"
          >
            Full quote &amp; timeline
          </Link>
        }
      />

      <Header s={s} now={summary.dataUpdatedAt} />
      {q.status === 'on_hold' && <OnHoldBanner reviewDate={q.reviewDate} />}
      {!s.inFinalReview && <NotInFinalReview s={s} />}
      <FlagKey scope={pageRef} />
      <Warnings s={s} quoteNumber={quoteNumber} fundingNotAnswered={fundingNotAnswered} />
      <RequestSection s={s} />
      <PrioritySection s={s} />
      <EngineeringSection s={s} />
      <PricingSection s={s} />
      <TermsLegalSection s={s} quoteNumber={quoteNumber} />
      {/* FB-25 (N17-25; Ben Whann, Bailey Schmitt): the same button under the terms, so the approver who
          has just confirmed them need not scroll back up. */}
      <DecideButton s={s} onDecide={() => setDeciding(true)} placement="terms" />
      {/* B-15: read-only pricing history (imported export); renders nothing for roles without commercial access. */}
      <PricingContextPanel quoteNumber={quoteNumber} />
      <AttachmentsSection s={s} />
      <DecisionsSection s={s} />

      <DecisionBar
        s={s}
        onDecide={() => setDeciding(true)}
        blockers={releaseBlockers(s, fundingNotAnswered)}
      />
      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(false);
          }}
          gateKey="G4"
          quoteNumber={quoteNumber}
          // FB-01 (F-069): the decision records the warnings this screen showed.
          acknowledgedWarnings={s.warnings.filter((w) => w.link).map((w) => w.code)}
          onDecided={() => void navigate({ to: '/approvals', search: { tab: 'final-review' } })}
        />
      )}
    </div>
  );
}

function Header({ s, now }: { s: ReviewSummary; now: number }) {
  const q = s.quote;
  const g3 = s.decisions.find((d) => d.gateKey === 'G3' && d.outcomeKey === 'submit');
  const record = s.quoting.pricingRecord;
  return (
    <div
      className="reg-marks bg-card rounded-card flex flex-wrap items-center gap-x-3 gap-y-2 border px-5 py-4"
      data-testid="review-header"
    >
      <StageBadge stageKey={q.stageKey} />
      <span className="spec-label text-muted-foreground">Version {q.version}</span>
      <PriorityBadge priority={q.priority} quoteNumber={q.quoteNumber} showWhy={false} />
      <span className="inline-flex items-center gap-1 text-sm" data-testid="review-price-status">
        {s.quoting.approval.approved ? (
          <>
            <CheckCircle2Icon className="text-emphasis size-4" aria-hidden="true" />
            Price approved
            {s.quoting.approval.approvedAt ? ` ${absoluteTime(s.quoting.approval.approvedAt)}` : ''}
            {s.quoting.approval.approvedByName ? ` by ${s.quoting.approval.approvedByName}` : ''}
          </>
        ) : (
          <>
            <CircleAlertIcon className="size-4" aria-hidden="true" />
            Price not approved
          </>
        )}
      </span>
      {record && <CapitalChip value={record.capitalReadiness} />}
      {s.inFinalReview && g3 && (
        <span className="text-muted-foreground text-xs">
          Waiting {formatDuration(Math.max(0, now - new Date(g3.decidedAt).getTime()))}
        </span>
      )}
    </div>
  );
}

function NotInFinalReview({ s }: { s: ReviewSummary }) {
  const { data: config } = usePublicConfig();
  return (
    <p
      className="bg-secondary flex items-start gap-2 rounded-md px-3 py-2 text-sm"
      data-testid="not-in-final-review"
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      This quote is no longer waiting for Final Review: it is in{' '}
      {stageLabel(config, s.quote.stageKey)}
      {s.quote.status === 'closed' ? ' (closed)' : ''}.
    </p>
  );
}

/** FB-25: funding codes that are not an answer (list meta `defaultAtIntake`, "Not discussed"). */
function useFundingNotAnswered(): string[] {
  const funding = useValueList('tooling_funding_model');
  return funding.filter((f) => f.meta.defaultAtIntake === true).map((f) => f.code);
}

function Warnings({
  s,
  quoteNumber,
  fundingNotAnswered,
}: {
  s: ReviewSummary;
  quoteNumber: string;
  fundingNotAnswered: readonly string[];
}) {
  // UX-010: the footer said "none of them blocks it" even when the release was blocked.
  const blockers = releaseBlockers(s, fundingNotAnswered);
  // FB-25: a missing required term blocks without a warning of its own, so the list shows for it too.
  if (s.warnings.length === 0 && blockers.length === 0) return null;
  const hasWarnings = s.warnings.length > 0;
  return (
    <section
      id="review-warnings"
      className="grid gap-3"
      aria-labelledby="open-warnings-heading"
      data-testid="review-warnings"
    >
      {/* Yellow: worth checking, none of them stops the decision (FB-27, N17-09). */}
      {hasWarnings && (
        <div
          className={cn('border-warning bg-warning/20 grid gap-2 border px-4 py-3', WARNING_BOX)}
          data-tone="warning"
        >
          <h2
            // The decision bar's "See what blocks it" lands on the blockers when there are any.
            id={blockers.length === 0 ? 'open-warnings-heading' : undefined}
            tabIndex={blockers.length === 0 ? -1 : undefined}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <TriangleAlertIcon className="size-4" aria-hidden="true" />
            Open warnings ({s.warnings.length})
          </h2>
          <ul className="grid gap-1 text-sm">
            {s.warnings.map((w) => (
              <li key={w.code + w.message} data-severity={w.severity} data-code={w.code}>
                {w.message}
                {w.link === 'commercial' && (
                  <>
                    {' · '}
                    <CommercialLink quoteNumber={quoteNumber} />
                  </>
                )}
              </li>
            ))}
          </ul>
          {blockers.length === 0 && (
            <p className="text-muted-foreground text-xs" data-testid="review-warnings-footer">
              Warnings inform the decision; none of them blocks it.
            </p>
          )}
        </div>
      )}
      {/* Red: these stop the release until they are fixed (FB-27, N17-09). */}
      {blockers.length > 0 && (
        <div
          className={cn('grid gap-2 px-4 py-3 text-sm', BLOCKING_BOX)}
          data-tone="blocking"
          data-testid="review-blockers"
        >
          <h2
            id="open-warnings-heading"
            tabIndex={-1}
            className="flex items-center gap-2 font-semibold"
          >
            <CircleAlertIcon className="text-destructive size-4" aria-hidden="true" />
            What blocks the release
          </h2>
          <p className="font-semibold">The offer cannot be released yet. This blocks it:</p>
          <ul className="grid list-disc gap-1 pl-5">
            {blockers.map((b) => (
              <BlockerItem key={b.key} b={b} quoteNumber={quoteNumber} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One release blocker, with the way to where it is fixed (UX-010, FB-25). */
function BlockerItem({ b, quoteNumber }: { b: ReleaseBlocker; quoteNumber: string }) {
  return (
    <li data-fix-at={b.fixAt} data-blocker={b.key}>
      {b.message}
      {b.fixAt !== 'none' && ' · '}
      {b.fixAt === 'commercial' && <CommercialLink quoteNumber={quoteNumber} />}
      {b.fixAt === 'tooling-commitment' && (
        <CommercialLink quoteNumber={quoteNumber} hash="terms-tooling-commitment">
          Answer it on the Commercial terms tab
        </CommercialLink>
      )}
      {b.fixAt === 'terms-legal' && <TermsLegalJump />}
      {b.fixAt === 'capital-term' && b.field && <TermsLegalJump field={b.field} />}
      {b.fixAt === 'quote' && (
        <Link to="/quotes/$quoteNumber" params={{ quoteNumber }} className={FIX_LINK}>
          Open the full quote
        </Link>
      )}
    </li>
  );
}

// Inherits the surrounding text colour (contrast on the warning background), underlined.
const FIX_LINK =
  'inline-flex min-h-11 items-center font-medium underline underline-offset-2 sm:min-h-0';

/** FB-01 (F-069): Sales or Pricing records these on the quote's Commercial terms tab (FB-25). */
function CommercialLink({
  quoteNumber,
  hash = 'commercial',
  children = 'Open the Commercial terms tab',
}: {
  quoteNumber: string;
  hash?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to="/quotes/$quoteNumber"
      params={{ quoteNumber }}
      search={{ tab: 'commercial' }}
      hash={hash}
      className={FIX_LINK}
    >
      {children}
    </Link>
  );
}

/**
 * UX-010: the approver confirms the capital terms further down this page; this goes there. FB-25: with
 * `field`, to that capital term's field (focused), when the approver may edit it.
 */
function TermsLegalJump({ field }: { field?: string }) {
  return (
    <button
      type="button"
      className={cn(FIX_LINK, 'cursor-pointer')}
      onClick={() => {
        const target = field ? document.getElementById(capitalTermFieldId(field)) : null;
        const control = target?.querySelector<HTMLElement>('select, input, textarea');
        const heading = document.getElementById(`${TERMS_LEGAL_ID}-heading`);
        const to = control ?? heading;
        to?.scrollIntoView({ block: 'center' });
        to?.focus({ preventScroll: true });
      }}
    >
      {field ? 'Go to the field' : 'Go to Terms and Legal on this page'}
    </button>
  );
}

/**
 * FB-01 (F-069): the terms and the Legal review, read-only. Sales and Pricing own them; the approver
 * sees them here, and an open one is a warning (it blocks only if `g4_required_checks` names it).
 * FB-08 (F-068, T-031): the approver edits and confirms the capital terms here; the payment-terms
 * exception (T-007) and any extra sign-offs (F-082, off) show their status.
 */
function TermsLegalSection({ s, quoteNumber }: { s: ReviewSummary; quoteNumber: string }) {
  const t = s.termsAndLegal;
  const { data: config } = usePublicConfig();
  const queryClient = useQueryClient();
  const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');
  const required = (check: string) => t.requiredChecks.includes(check);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reviewSummaryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
    ]);
  };
  const payment =
    t.termsPaymentTermsCode === null
      ? t.termsPaymentTerms
      : t.termsPaymentTerms && t.termsPaymentTermsCode === 'OTHER'
        ? t.termsPaymentTerms
        : t.termsPaymentTermsLabel;
  return (
    <Section
      id={TERMS_LEGAL_ID}
      title="Terms and Legal"
      aside={<CommercialLink quoteNumber={quoteNumber} />}
    >
      {/* FB-25 (N17-26, N17-27): what releasing the offer needs, marked as FB-15 marks required fields. */}
      <RequiredKey className="-mt-2" />
      <KeyValueGrid
        items={[
          {
            id: 'funding',
            label: 'Funding model',
            // FB-15 (W13-09): with the customer's share from intake while funding is Shared.
            value: [
              t.toolingFundingModelLabel ?? t.toolingFundingModel,
              customerShareText(
                config?.valueLists,
                t.toolingFundingModel,
                s.intake.facts.customerSharePct,
              ),
            ]
              .filter(Boolean)
              .join(' · '),
          },
          // FB-25 (N17-26, N18-02): required to release the offer (the KAM may answer it at intake).
          {
            id: 'tooling',
            label: (
              <RequiredLabel required={required('tooling_commitment_answered')}>
                Customer tooling commitment
              </RequiredLabel>
            ),
            value: yesNo(t.termsToolingCommitment) ?? (
              <span data-testid="review-tooling-unanswered">
                Not answered ·{' '}
                <CommercialLink quoteNumber={quoteNumber} hash="terms-tooling-commitment">
                  Answer it on the Commercial terms tab
                </CommercialLink>
              </span>
            ),
          },
          { id: 'moq', label: 'MOQ', value: t.termsMoq },
          {
            id: 'payment',
            label: 'Payment terms',
            value: payment ? (
              <>
                {payment}
                <NonStandardTermsBadge show={!!t.exception || t.termsNonstandard} />
              </>
            ) : null,
          },
          {
            id: 'tooling-payment',
            label: 'Tooling payment',
            value: t.termsToolingPaymentLabel ?? t.termsToolingPayment,
          },
          { id: 'milestone-note', label: 'Milestone note', value: t.termsMilestoneNote },
          { id: 'nonstandard', label: 'Non-standard terms', value: yesNo(t.termsNonstandard) },
          {
            id: 'checked',
            label: `Terms checked${required('terms_checked') ? ' (required)' : ''}`,
            value: t.checkedAt
              ? `${t.checkedByName ?? 'Someone'}, ${absoluteTime(t.checkedAt)}`
              : 'Not checked',
          },
        ]}
      />
      <div className="grid gap-1 text-sm" data-testid="review-legal">
        <p className="font-medium">
          Legal review{required('legal_review') ? ' (required when triggered)' : ' (optional)'}
        </p>
        {t.legal.reasons.length > 0 ? (
          <p>Triggered by: {t.legal.reasons.map((r) => r.label).join(', ')}</p>
        ) : (
          <p className="text-muted-foreground">No Legal trigger applies.</p>
        )}
        {t.legal.reviewedOn ? (
          <p>
            Reviewed {t.legal.reviewedOn}
            {t.legal.reviewerName ? ` by ${t.legal.reviewerName}` : ''}
            {t.legal.note ? `: ${t.legal.note}` : ''}
          </p>
        ) : (
          t.legal.required && <p>No review recorded.</p>
        )}
      </div>
      <p className="text-sm font-medium" data-testid="review-terms-exception-required">
        Payment-terms exception
        {required('terms_exception') ? ' (must be approved to release)' : ' (a warning only)'}
      </p>
      {t.exception ? (
        <TermsExceptionCard quoteNumber={quoteNumber} exception={t.exception} onSaved={refresh} />
      ) : (
        <p className="text-muted-foreground -mt-2 text-sm">
          None: the payment terms are standard or not set.
        </p>
      )}
      <div data-testid="review-capital-terms" className="grid gap-1">
        {required('terms_finalized') && !t.capital.finalizedAt && (
          <p className="text-sm">Confirm the capital terms before you release the offer.</p>
        )}
        <CapitalTerms
          quoteNumber={quoteNumber}
          view={t.capital}
          mode={t.capital.canFinalize ? 'finalize' : 'readonly'}
          onSaved={refresh}
          termsCheckedAt={t.checkedAt}
          markRequired={required('terms_finalized')}
        />
      </div>
      <AdditionalApprovals
        quoteNumber={quoteNumber}
        items={t.additionalApprovals}
        onSaved={refresh}
      />
    </Section>
  );
}

function RequestSection({ s }: { s: ReviewSummary }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) => valueListLabel(config, list, code);
  const q = s.quote;
  const i = s.intake;
  const shipTo = i.shipTo
    ? [i.shipTo.line1, i.shipTo.city, i.shipTo.state, i.shipTo.postal, i.shipTo.country]
        .filter(Boolean)
        .join(', ')
    : null;
  const items: KeyValueItem[] = [
    { label: 'Customer', value: q.customerName },
    // FB-18 (W13-31): the opportunity opens in Salesforce (an Admin is shown where to set the URL).
    { label: 'Opportunity', value: <SalesforceLink quote={q} label={q.opportunityName} /> },
    { label: 'Product', value: i.standardDescription ?? i.description },
    { label: 'Product family', value: label('product_family', q.productFamily) },
    { label: 'Resin', value: label('resin', q.resin) },
    // FB-12 (F-073): the market and the sub-market that sets the strategic-fit score.
    { label: 'Market', value: marketText(config, q.market, q.subMarket) },
    {
      label: 'Estimated volume',
      value:
        q.estAnnualVolume != null ? `${q.estAnnualVolume.toLocaleString('en-US')} units/yr` : null,
    },
    {
      label: 'Estimated revenue',
      value: q.estAnnualRevenue != null ? `${money(q.estAnnualRevenue)}/yr` : null,
    },
    // FB-02: the intake's product facts (neck, resin grade, PCR, color, variants, need-by dates…).
    ...intakeFactItems(config?.valueLists, i.facts, i.neckFinish, standardTermsFrom(config)),
    {
      label: 'Packaging',
      value: [label('packaging_type', i.packagingType), i.packagingNotes]
        .filter(Boolean)
        .join(': '),
    },
    { label: 'Drawing', value: label('drawing_status', i.drawingStatus) },
    { label: 'Salesforce close date', value: q.expectedCloseDate },
    { label: 'Ship / fill destination', value: shipTo },
    { label: 'KAM', value: q.kamName },
  ];
  return (
    <Section id="request" title="The request">
      <KeyValueGrid items={items} />
      {/* FB-19 (W13-32): every item, with its plant and machine, volume and need-by. */}
      {s.items.length > 1 && <QuoteItemsList items={s.items} testId="review-items" />}
      {i.commentsForEngineering && (
        <p className="text-foreground-2 text-sm whitespace-pre-line">{i.commentsForEngineering}</p>
      )}
    </Section>
  );
}

function PrioritySection({ s }: { s: ReviewSummary }) {
  const p = s.quote.priority;
  return (
    <Section
      id="priority"
      title="Priority (advisory)"
      aside={<PriorityBadge priority={p} quoteNumber={s.quote.quoteNumber} showWhy={false} />}
    >
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
          Score breakdown
          {p.modelVersion ? ` (model v${p.modelVersion})` : ''}
        </summary>
        <ScoreBreakdownTable
          priority={p}
          market={{ market: s.quote.market, subMarket: s.quote.subMarket }}
          className="mt-2"
        />
      </details>
    </Section>
  );
}

function Restricted({ what }: { what: string }) {
  return (
    <p
      className="bg-secondary flex items-start gap-2 rounded-md px-3 py-2 text-sm"
      data-testid="review-redacted"
    >
      <EyeOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {what} is commercial: your role does not read it.
    </p>
  );
}

function EngineeringSection({ s }: { s: ReviewSummary }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) => valueListLabel(config, list, code);
  const e = s.engineering;
  const r = e.review;
  const g2 = s.quoting.g2;
  return (
    <Section
      id="engineering"
      title="Engineering solution and capacity evidence"
      aside={
        g2 ? (
          <span className="text-muted-foreground text-xs" data-testid="review-g2">
            Engineering’s decision: {g2.outcomeLabel}
            {g2.decidedByName ? ` · ${g2.decidedByName}` : ''}
          </span>
        ) : undefined
      }
    >
      {/* FB-25: rows with no value are left out (Technical concept is no longer asked, FB-22). */}
      <KeyValueGrid
        items={withValues([
          { label: 'Process', value: label('process_type', r.processType) },
          { label: 'Machine', value: label('machine_type', r.machineType) },
          // FB-22 (N17-16): the machine the quote is on (its model or line); left out when empty.
          { label: 'Machine platform', value: r.machinePlatform },
          { label: 'Plant / site', value: label('plant', r.plantCode) },
          { label: 'Cavitation', value: r.cavitation },
          { label: 'Cycle time', value: r.cycleTimeS != null ? `${r.cycleTimeS} s` : null },
          { label: 'Engineer', value: e.assignedEngineerName },
          ...(e.commercialRedacted
            ? []
            : [{ label: BUDGETARY_CAPITAL_LABEL, value: money(r.prelimCapitalUsd) }]),
          { label: 'Technical concept', value: r.technicalConceptNotes },
          // FB-06 (F-058): the equipment BOM upload (file, version, uploader, date), no figures.
          {
            id: 'equipment-bom',
            label: 'Equipment BOM',
            value: <EquipmentBomLine bom={e.equipmentBom} />,
          },
          ...pricingInputItems(r, (code) => label('plant', code)),
          // The pre-FB-06 free-text notes, read-only.
          { label: 'Downstream equipment (legacy note)', value: r.downstreamEquipmentNotes },
          { label: 'Equipment BOM (legacy note)', value: r.equipmentBomNotes },
        ])}
      />
      {g2?.note && <p className="text-foreground-2 text-sm whitespace-pre-line">{g2.note}</p>}
      {/* FB-23 (N18-03, N18-06): each item's mold lead time and cost totals. */}
      <CostEstimateSummary engineering={e} />

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Capacity evidence</h3>
        {e.capacityEvidence.length === 0 ? (
          <p className="text-muted-foreground text-sm">No capacity evidence is recorded.</p>
        ) : (
          <ul className="grid gap-2" data-testid="review-capacity">
            {e.capacityEvidence.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  {label('plant', row.site) ?? row.site}
                  {row.lineAsset ? ` · ${row.lineAsset}` : ''}
                </p>
                <KeyValueGrid
                  columns={3}
                  items={[
                    { label: 'Assumed effectiveness', value: pct(row.assumedEffectivenessPct) },
                    {
                      label: 'Cycle time',
                      value: row.cycleTimeS != null ? `${row.cycleTimeS} s` : null,
                    },
                    { label: 'Utilization before', value: pct(row.utilizationBeforePct) },
                    {
                      label: 'Allocated volume (units / yr)',
                      value: row.allocatedAnnualVolume?.toLocaleString('en-US') ?? null,
                    },
                    {
                      label: 'Utilization after (calculated)',
                      value:
                        row.utilizationAfterPct != null
                          ? `${pct(row.utilizationAfterPct)}${row.utilizationLevel === 'over' ? ' · exceeds line capacity' : ''}`
                          : null,
                    },
                    { label: 'Analysis date', value: row.analysisDate },
                    { label: 'Analyst', value: row.analystName },
                  ]}
                />
                {row.notes && <p className="text-muted-foreground text-xs">{row.notes}</p>}
              </li>
            ))}
          </ul>
        )}
        {e.commercialRedacted && e.capacityEvidence.length > 0 && (
          <Restricted what="The capacity figures" />
        )}
      </div>
    </Section>
  );
}

function PricingSection({ s }: { s: ReviewSummary }) {
  const a = s.quoting.approval;
  const r = s.quoting.pricingRecord;
  return (
    <>
      <Section id="pricing" title="Price approval">
        <p className="text-sm" data-testid="review-approval">
          {a.approved ? (
            <>
              <span className="font-medium">Price approved ✓</span>
              {a.approvedAt ? ` on ${absoluteTime(a.approvedAt)}` : ''}
              {a.approvedByName ? ` by ${a.approvedByName}` : ''} (version {a.quoteVersion})
            </>
          ) : (
            'The price is not approved for this version.'
          )}
        </p>
        {r ? (
          <KeyValueGrid
            items={[
              { label: 'Pricing basis', value: r.pricingBasisNote },
              { label: 'Approved range', value: r.approvedRangeNote },
              { label: 'Legacy ERF #', value: r.erfRefs.join(', ') },
              {
                label: 'Costing completed',
                value: r.costingCompleted
                  ? `Yes${r.costingAttestedByName ? `, attested by ${r.costingAttestedByName}` : ''}`
                  : 'Not attested',
              },
            ]}
          />
        ) : (
          s.quoting.commercialRedacted && <Restricted what="The pricing basis and range" />
        )}
      </Section>
      {/* FB-07 (F-031, D-001): the costing model, the ROI model and the price approval, read-only. */}
      <QuotingSteps quoteNumber={s.quote.quoteNumber} steps={s.quoting.steps} compact />
      <Section
        id="capital"
        title="Capital readiness"
        aside={r ? <CapitalChip value={r.capitalReadiness} /> : undefined}
      >
        {r ? (
          <KeyValueGrid
            items={[
              ...(r.cerReference ? [{ label: 'Legacy CER reference', value: r.cerReference }] : []),
              { label: 'Capital notes', value: r.capitalNotes },
              { label: 'Note on pending capital', value: r.capitalPendingJustification },
              ...(s.engineering.commercialRedacted
                ? []
                : [
                    {
                      label: BUDGETARY_CAPITAL_LABEL,
                      value: money(s.engineering.review.prelimCapitalUsd),
                    },
                  ]),
            ]}
          />
        ) : (
          <Restricted what="Capital readiness" />
        )}
      </Section>
    </>
  );
}

function AttachmentsSection({ s }: { s: ReviewSummary }) {
  return (
    <Section id="attachments" title={`Attachments (${s.attachments.length})`}>
      {s.attachments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No files are attached to this quote.</p>
      ) : (
        <ul className="grid gap-2">
          {s.attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              <FileIcon className="size-4 shrink-0" aria-hidden="true" />
              {/* B-16: through the audited download route, not a direct SharePoint link. */}
              {a.available ? (
                <AttachmentDownloadLink id={a.id} fileName={a.fileName} />
              ) : (
                <span>{a.fileName}</span>
              )}
              <span className="text-muted-foreground text-xs">
                {bytes(a.size)}
                {a.uploadedByName ? ` · ${a.uploadedByName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DecisionsSection({ s }: { s: ReviewSummary }) {
  const { data: config } = usePublicConfig();
  const outcome = (gate: string, key: string) =>
    config?.outcomes.find((o) => o.gateKey === gate && o.key === key)?.label ?? key;
  const gateLabel = (gate: string) => config?.gates.find((g) => g.key === gate)?.label ?? gate;
  return (
    <Section id="decisions" title="Decisions so far">
      {s.decisions.length === 0 ? (
        <p className="text-muted-foreground text-sm">No gate decisions yet.</p>
      ) : (
        <ol className="grid gap-3">
          {s.decisions.map((d) => (
            <li key={d.id} className="grid gap-0.5 text-sm" data-testid="review-decision">
              <p>
                <span className="font-medium">
                  {d.gateKey} {gateLabel(d.gateKey)} → {outcome(d.gateKey, d.outcomeKey)}
                </span>{' '}
                <span className="text-muted-foreground text-xs">
                  v{d.quoteVersion} · {d.decidedByName ?? 'Someone'} ·{' '}
                  <time dateTime={d.decidedAt} title={absoluteTime(d.decidedAt)}>
                    {relativeTime(d.decidedAt)}
                  </time>
                </span>
              </p>
              {d.note && <p className="text-foreground-2 whitespace-pre-line">{d.note}</p>}
            </li>
          ))}
        </ol>
      )}
      <Link
        to="/quotes/$quoteNumber"
        params={{ quoteNumber: s.quote.quoteNumber }}
        className="text-emphasis text-sm underline-offset-4 hover:underline"
      >
        Open the full timeline
      </Link>
    </Section>
  );
}

/** FB-25 (N17-25): "Decide final review", the one way into the G4 decision; shown twice. */
function DecideButton({
  s,
  onDecide,
  placement,
}: {
  s: ReviewSummary;
  onDecide: () => void;
  placement: 'bar' | 'terms';
}) {
  if (!s.canDecide || s.availableActions.length === 0) return null;
  const button = (
    <Button
      size="lg"
      onClick={onDecide}
      data-testid={placement === 'bar' ? 'decide-final-review' : 'decide-final-review-terms'}
      className="max-sm:w-full"
    >
      Decide final review
    </Button>
  );
  if (placement === 'bar') return button;
  return (
    <div
      className="bg-card rounded-card flex flex-wrap items-center justify-between gap-3 border p-4 sm:p-5"
      data-testid="decide-below-terms"
    >
      <p className="text-muted-foreground text-sm">
        Terms checked? Record the decision: release the offer, send it back, hold or stop.
      </p>
      {button}
    </div>
  );
}

/**
 * The sticky decision bar, pinned above the mobile tab bar. FB-25 (N17-25): one "Decide final review"
 * opens the decision dialog, whose groups offer the outcomes the server allows (Advance, Send back to…,
 * Hold, Stop: `availableActions`, so segregation and the approver tier are already applied). Beside it,
 * what still blocks the release (UX-010), with a way to the full list. With no decision to take it says
 * why.
 */
function DecisionBar({
  s,
  onDecide,
  blockers,
}: {
  s: ReviewSummary;
  onDecide: () => void;
  blockers: ReleaseBlocker[];
}) {
  const has = (key: string) => s.availableActions.some((a) => a.outcomeKey === key);
  return (
    <div
      className="bg-card sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t px-4 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.08)] sm:bottom-0 sm:mx-0 sm:rounded-card sm:border"
      role="region"
      aria-label="Decision"
      data-testid="decision-bar"
      // UX-018: index.css keeps keyboard focus clear of a bar stuck to the bottom of the page.
      data-sticky-bottom=""
    >
      {s.canDecide && s.availableActions.length > 0 ? (
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="grid min-w-0 gap-1">
            {s.requirement && !has('approve') && (
              <p className="text-muted-foreground text-xs" data-testid="tier-note">
                Approving this quote needs the “{s.requirement.tierLabel}” approver tier. You can
                still decline or return it.
              </p>
            )}
            {/* UX-010: what blocks the release, next to the decision. */}
            {blockers.length > 0 ? (
              // Unboxed on purpose: a padded box made the sticky bar taller than the scroll padding that
              // keeps keyboard focus clear of it (UX-018). The red box is "What blocks the release".
              <p className="text-sm" data-testid="decision-bar-blockers" data-tone="blocking">
                <CircleAlertIcon
                  className="text-destructive mr-1 inline size-4 align-text-bottom"
                  aria-hidden="true"
                />
                The offer cannot be released yet: {blockers[0]!.message}
                {blockers.length > 1 ? ` and ${blockers.length - 1} more` : ''}.{' '}
                <button
                  type="button"
                  className={cn(FIX_LINK, 'cursor-pointer')}
                  onClick={() => {
                    const heading = document.getElementById('open-warnings-heading');
                    heading?.scrollIntoView({ block: 'start' });
                    heading?.focus({ preventScroll: true });
                  }}
                >
                  See what blocks it
                </button>
              </p>
            ) : (
              <p className="text-muted-foreground text-sm" data-testid="decision-bar-ready">
                Nothing blocks the release.
              </p>
            )}
          </div>
          <DecideButton s={s} onDecide={onDecide} placement="bar" />
        </div>
      ) : (
        <p className="text-sm" data-testid="decision-unavailable">
          {s.blockedBy.length > 0
            ? s.blockedBy.join(' ')
            : s.inFinalReview
              ? 'You are reading this review. Final Review decisions are taken by an approver.'
              : 'No decision is waiting on this quote.'}
        </p>
      )}
    </div>
  );
}
