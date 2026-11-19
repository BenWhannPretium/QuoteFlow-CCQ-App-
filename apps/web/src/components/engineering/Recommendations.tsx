import {
  BUDGETARY_CAPITAL_LABEL,
  type CapacitySignoff,
  type EngineeringDetail,
  type QuoteDetail,
} from '@ccq/contracts';
import { useId, type ReactNode } from 'react';

import { KeyValueGrid, type KeyValueItem } from '@/components/KeyValueGrid';
import { usePublicConfig } from '@/config/public-config';
import {
  CAPACITY_NOT_SIGNED_OFF,
  ENGINEERING_NOT_SUBMITTED,
  capacityHeadline,
  capacitySignoffText,
  partSubmittedText,
} from '@/lib/engineering-recommendation';
import { cn } from '@/lib/utils';

/**
 * FB-30 (N19-28; Sarah Brennan, 2026-11-19): "the engineering recommendation" and "the capacity
 * recommendation", apart. Read-only, from what is already recorded: the engineer's solution, and the
 * capacity sign-off with the capacity rows. Rows with no value are left out.
 */

const keep = (items: KeyValueItem[]): KeyValueItem[] =>
  items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '');

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? null : `$${n.toLocaleString('en-US')}`;

/** One item's solution, as the engineer recorded it (or one quote-level solution). */
export interface SolutionView {
  id: string;
  name: string;
  review: EngineeringDetail['review'];
  capacityEvidence: EngineeringDetail['capacityEvidence'];
  selectedLabels: EngineeringDetail['selectedLabels'];
}

/** The items of the engineering review: every item of a multi-item quote, or the one solution. */
export function solutionViews(e: EngineeringDetail): SolutionView[] {
  return e.items.length > 0
    ? e.items
    : [
        {
          id: 'quote',
          name: '',
          review: e.review,
          capacityEvidence: e.capacityEvidence,
          selectedLabels: e.selectedLabels,
        },
      ];
}

/**
 * The engineer's solution for one item: plant, process and machine, platform, cavitation, cycle time,
 * the budgetary capital and the engineer's notes. Shared by the Engineering tab's header and the
 * Overview's Engineering card.
 */
export function solutionItems(
  item: Pick<SolutionView, 'review' | 'selectedLabels'>,
): KeyValueItem[] {
  const r = item.review;
  return keep([
    { id: 'plant', label: 'Plant', value: item.selectedLabels.plantCode ?? r.plantCode },
    {
      id: 'process',
      label: 'Process and machine',
      value: [
        item.selectedLabels.processType ?? r.processType,
        item.selectedLabels.machineType ?? r.machineType,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    { id: 'platform', label: 'Machine platform', value: r.machinePlatform },
    { id: 'cavitation', label: 'Cavitation', value: r.cavitation },
    { id: 'cycle', label: 'Cycle time', value: r.cycleTimeS != null ? `${r.cycleTimeS} s` : null },
    { id: 'capital', label: BUDGETARY_CAPITAL_LABEL, value: money(r.prelimCapitalUsd) },
    { id: 'tooling-notes', label: 'Engineer’s notes (tooling)', value: r.toolingNotes },
    // Kept for older quotes (FB-22 stops collecting it).
    { id: 'concept', label: 'Technical concept', value: r.technicalConceptNotes },
  ]);
}

/** The capacity rows' own notes, one line. */
export function capacityNotesText(rows: EngineeringDetail['capacityEvidence']): string {
  return rows
    .map((row) => row.notes?.trim())
    .filter(Boolean)
    .join(' · ');
}

/**
 * Each capacity row of each item in one line ("Aurora · Line 3: 78.5% loaded with this business,
 * practical capacity 1,234,000 parts a year"), with the item's name on a multi-item quote.
 */
export function useCapacityHeadlines(e: EngineeringDetail): { id: string; text: string }[] {
  const { data: config } = usePublicConfig();
  const siteLabel = (code: string) =>
    config?.valueLists.plant?.find((v) => v.code === code)?.label ??
    config?.retiredValues?.plant?.[code] ??
    code;
  const views = solutionViews(e);
  const multi = views.length > 1;
  return views.flatMap((item) =>
    item.capacityEvidence.map((row) => {
      const line = capacityHeadline(row, {
        siteLabel: siteLabel(row.site),
        cavitation: item.review.cavitation,
        scheduledRunDaysPerYear: e.capacityBasis.scheduledRunDaysPerYear,
        warnAbovePct: e.capacityBasis.warnAbovePct,
      });
      return { id: row.id, text: multi ? `${item.name}: ${line}` : line };
    }),
  );
}

/**
 * The capacity sign-off in words: "Capacity is signed off by … on …" or "Capacity is blocked …", then the
 * note; "Not signed off yet" until there is one. Used on the Capacity tab, the Overview, the Quoting tab
 * and Final Review.
 */
export function CapacitySignoffSummary({
  signoff,
  className,
}: {
  signoff: CapacitySignoff;
  className?: string;
}) {
  const text = capacitySignoffText(signoff);
  return (
    <div className={cn('grid gap-1 text-sm', className)} data-testid="capacity-signoff-summary">
      <p
        data-status={signoff.status ?? 'none'}
        className={
          signoff.status === 'blocked'
            ? 'text-destructive font-semibold'
            : signoff.status
              ? 'font-medium'
              : 'text-muted-foreground'
        }
      >
        {text ?? CAPACITY_NOT_SIGNED_OFF}
      </p>
      {signoff.note && (
        <p className="text-foreground-2 whitespace-pre-line">Note: {signoff.note}</p>
      )}
    </div>
  );
}

function RecommendationBox({
  title,
  status,
  testId,
  children,
}: {
  title: string;
  status: string;
  testId: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="bg-card rounded-card grid gap-3 border p-4"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        {status && (
          <p className="text-muted-foreground text-sm" data-testid={`${testId}-status`}>
            {status}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * FB-30: the top of the Engineering tab. The engineer's solution for every item, read-only, with who
 * submitted it to the engineering lead and when ("Not submitted yet" until then).
 */
export function EngineeringRecommendation({ quote }: { quote: QuoteDetail }) {
  const e = quote.engineering;
  const review = e.leadReview;
  const views = solutionViews(e);
  const multi = views.length > 1;
  const status =
    partSubmittedText(review.parts?.engineer) ??
    partSubmittedText(
      review.status === 'submitted'
        ? {
            ownerName: null,
            submittedAt: review.submittedAt,
            submittedByName: review.submittedByName,
            ownerIsLead: false,
            in: true,
          }
        : null,
    ) ??
    ENGINEERING_NOT_SUBMITTED;
  const shown = views.map((v) => ({ view: v, items: solutionItems(v) }));
  return (
    <RecommendationBox
      title="Engineering recommendation"
      status={status}
      testId="engineering-recommendation"
    >
      {shown.every((s) => s.items.length === 0) ? (
        <p className="text-muted-foreground text-sm">
          The engineer has not recorded a solution yet.
        </p>
      ) : (
        shown.map(({ view, items }) =>
          items.length === 0 ? null : (
            <div key={view.id} className="grid gap-2">
              {multi && <h3 className="text-sm font-semibold">{view.name}</h3>}
              <KeyValueGrid columns={3} items={items} />
            </div>
          ),
        )
      )}
    </RecommendationBox>
  );
}

/**
 * FB-30: the top of the Capacity tab. The capacity sign-off (approved or blocked, by whom, when, and the
 * note) and each capacity row in a line, read-only. The status says whether the scheduler's part is with
 * the engineering lead.
 */
export function CapacityRecommendation({ quote }: { quote: QuoteDetail }) {
  const e = quote.engineering;
  const headlines = useCapacityHeadlines(e);
  const scheduler = e.leadReview.parts?.scheduler;
  return (
    <RecommendationBox
      title="Capacity recommendation"
      status={scheduler ? (partSubmittedText(scheduler) ?? ENGINEERING_NOT_SUBMITTED) : ''}
      testId="capacity-recommendation"
    >
      <CapacitySignoffSummary signoff={e.capacitySignoff} />
      {headlines.length > 0 ? (
        <ul className="text-foreground-2 grid gap-1 text-sm" data-testid="capacity-headline">
          {headlines.map((h) => (
            <li key={h.id}>{h.text}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No capacity evidence yet.</p>
      )}
    </RecommendationBox>
  );
}
