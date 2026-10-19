import type { ReviewSummary } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  EyeOffIcon,
  FileIcon,
  InfoIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { stageLabel, usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime, relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

import { AttachmentDownloadLink } from '../attachments/Attachments';
import { formatDuration } from '../engineering/format';
import { ErrorState } from '../ErrorState';
import { GateDecisionDialog } from '../GateDecisionDialog';
import { KeyValueGrid, type KeyValueItem } from '../KeyValueGrid';
import { PageHeader } from '../PageHeader';
import { CapitalChip } from '../pricing/CapitalChip';
import { PricingContextPanel } from '../pricing/PricingContextPanel';
import { PriorityBadge, ScoreBreakdownTable } from '../Priority';
import { SkeletonCard } from '../Skeletons';
import { StageBadge } from '../StageBadge';
import { reviewSummaryKey } from './keys';

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
        <h2 id={`${id}-heading`} className="text-base font-semibold">
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
export function ReviewScreen({ quoteNumber }: { quoteNumber: string }) {
  const summary = useQuery({
    queryKey: reviewSummaryKey(quoteNumber),
    queryFn: () => api.reviewSummary(quoteNumber),
  });
  const [deciding, setDeciding] = useState<string | null>(null);
  const navigate = useNavigate();

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
    <div className="grid gap-4 pb-4" data-testid="review-screen" data-stage={q.stageKey}>
      <PageHeader
        className="mb-0"
        title={q.quoteNumber}
        eyebrow="Final Review · G4"
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
      {!s.inFinalReview && <NotInFinalReview s={s} />}
      <Warnings s={s} />
      <RequestSection s={s} />
      <PrioritySection s={s} />
      <EngineeringSection s={s} />
      <PricingSection s={s} />
      {/* B-15: read-only pricing-app context; renders nothing for roles without commercial access. */}
      <PricingContextPanel quoteNumber={quoteNumber} />
      <AttachmentsSection s={s} />
      <DecisionsSection s={s} />

      <DecisionBar s={s} onDecide={setDeciding} />
      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          gateKey="G4"
          quoteNumber={quoteNumber}
          initialOutcomeKey={deciding}
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="review-header">
      <StageBadge stageKey={q.stageKey} />
      <span className="text-muted-foreground text-sm">Version {q.version}</span>
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

function Warnings({ s }: { s: ReviewSummary }) {
  if (s.warnings.length === 0) return null;
  return (
    <section
      className="border-warning bg-warning/20 grid gap-2 rounded-md border px-4 py-3"
      aria-labelledby="open-warnings-heading"
      data-testid="review-warnings"
    >
      <h2 id="open-warnings-heading" className="flex items-center gap-2 text-sm font-semibold">
        <TriangleAlertIcon className="size-4" aria-hidden="true" />
        Open warnings ({s.warnings.length})
      </h2>
      <ul className="grid gap-1 text-sm">
        {s.warnings.map((w) => (
          <li key={w.code + w.message} data-severity={w.severity}>
            {w.message}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Warnings inform the decision; none of them blocks it.
      </p>
    </section>
  );
}

function RequestSection({ s }: { s: ReviewSummary }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  const q = s.quote;
  const i = s.intake;
  const shipTo = i.shipTo
    ? [i.shipTo.line1, i.shipTo.city, i.shipTo.state, i.shipTo.postal, i.shipTo.country]
        .filter(Boolean)
        .join(', ')
    : null;
  const items: KeyValueItem[] = [
    { label: 'Customer', value: q.customerName },
    { label: 'Opportunity', value: q.opportunityName },
    { label: 'Product', value: i.standardDescription ?? i.description },
    { label: 'Product family', value: label('product_family', q.productFamily) },
    { label: 'Resin', value: label('resin', q.resin) },
    { label: 'Market', value: label('market', q.market) },
    {
      label: 'Estimated volume',
      value:
        q.estAnnualVolume != null ? `${q.estAnnualVolume.toLocaleString('en-US')} units/yr` : null,
    },
    {
      label: 'Estimated revenue',
      value: q.estAnnualRevenue != null ? `${money(q.estAnnualRevenue)}/yr` : null,
    },
    { label: 'Neck finish', value: label('neck_finish', i.neckFinish) },
    {
      label: 'Packaging',
      value: [label('packaging_type', i.packagingType), i.packagingNotes]
        .filter(Boolean)
        .join(': '),
    },
    { label: 'Drawing', value: label('drawing_status', i.drawingStatus) },
    { label: 'Expected close', value: q.expectedCloseDate },
    { label: 'Ship-to', value: shipTo },
    { label: 'KAM', value: q.kamName },
  ];
  return (
    <Section id="request" title="The request">
      <KeyValueGrid items={items} />
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
        <ScoreBreakdownTable priority={p} className="mt-2" />
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
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
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
            G2: {g2.outcomeLabel}
            {g2.decidedByName ? ` · ${g2.decidedByName}` : ''}
          </span>
        ) : undefined
      }
    >
      <KeyValueGrid
        items={[
          { label: 'Process', value: label('process_type', r.processType) },
          { label: 'Machine', value: label('machine_type', r.machineType) },
          { label: 'Plant / site', value: label('plant', r.plantCode) },
          { label: 'Cavitation', value: r.cavitation },
          { label: 'Cycle time', value: r.cycleTimeS != null ? `${r.cycleTimeS} s` : null },
          { label: 'Engineer', value: e.assignedEngineerName },
          ...(e.commercialRedacted
            ? []
            : [{ label: 'Preliminary capital', value: money(r.prelimCapitalUsd) }]),
          { label: 'Downstream equipment', value: r.downstreamEquipmentNotes },
          { label: 'Technical concept', value: r.technicalConceptNotes },
        ]}
      />
      {g2?.note && <p className="text-foreground-2 text-sm whitespace-pre-line">{g2.note}</p>}

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
                    { label: 'Utilization', value: pct(row.utilizationPct) },
                    { label: 'Buffer', value: pct(row.bufferPct) },
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
              { label: 'ERF', value: r.erfRefs.join(', ') },
              { label: 'BPR', value: r.bprRefs.join(', ') },
              { label: 'No pricing-app record', value: r.noPricingAppRecordNote },
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
      <Section
        id="capital"
        title="Capital readiness"
        aside={r ? <CapitalChip value={r.capitalReadiness} /> : undefined}
      >
        {r ? (
          <KeyValueGrid
            items={[
              { label: 'CER reference', value: r.cerReference },
              { label: 'Capital notes', value: r.capitalNotes },
              { label: 'Pending justification', value: r.capitalPendingJustification },
              ...(s.engineering.commercialRedacted
                ? []
                : [
                    {
                      label: 'Preliminary capital',
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

/**
 * The sticky decision bar: Decline, Return and Approve as large touch targets, pinned above the
 * mobile tab bar. The buttons are the server's availableActions for G4 (so segregation and the
 * approver tier have already been applied); when there are none it says why.
 */
function DecisionBar({
  s,
  onDecide,
}: {
  s: ReviewSummary;
  onDecide: (outcomeKey: string) => void;
}) {
  const has = (key: string) => s.availableActions.some((a) => a.outcomeKey === key);
  const label = (key: string, fallback: string) =>
    s.availableActions.find((a) => a.outcomeKey === key)?.outcomeLabel ?? fallback;
  return (
    <div
      className="bg-card sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t px-4 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.08)] sm:bottom-0 sm:mx-0 sm:rounded-card sm:border"
      role="region"
      aria-label="Decision"
      data-testid="decision-bar"
    >
      {s.canDecide && s.availableActions.length > 0 ? (
        <div className="grid gap-2">
          {s.requirement && !has('approve') && (
            <p className="text-muted-foreground text-xs" data-testid="tier-note">
              Approving this quote needs the “{s.requirement.tierLabel}” approver tier. You can
              still decline or return it.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:justify-end">
            {has('decline') && (
              <Button variant="outline" size="lg" onClick={() => onDecide('decline')}>
                {label('decline', 'Decline')}
              </Button>
            )}
            {has('return') && (
              <Button variant="outline" size="lg" onClick={() => onDecide('return')}>
                {label('return', 'Return')}
              </Button>
            )}
            {has('approve') && (
              <Button size="lg" onClick={() => onDecide('approve')}>
                {label('approve', 'Approve')}
              </Button>
            )}
          </div>
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
