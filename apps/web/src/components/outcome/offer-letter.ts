import type { OfferBlockerView, OfferLetterResponse, OfferWarningView } from '@ccq/contracts';
import { offerWarnings, type OfferItemFacts } from '@ccq/domain';

/**
 * FB-20 (F-070): the offer letter card's logic, kept apart from the markup so it is unit-tested. The
 * server re-checks everything on generate; these only decide what the screen shows.
 */

export interface OfferLetterForm {
  attention: string;
  /** Part # by item number. */
  partNumbers: Record<number, string>;
}

/** The quote page tab where a blocker is fixed (null: on the quote page as it is, or by an Admin). */
export function blockerTab(fixAt: OfferBlockerView['fixAt']): 'quoting' | 'engineering' | null {
  if (fixAt === 'quoting') return 'quoting';
  if (fixAt === 'engineering') return 'engineering';
  return null;
}

/** The link text for a blocker's fix, in plain words. */
export function blockerFixText(fixAt: OfferBlockerView['fixAt']): string | null {
  switch (fixAt) {
    case 'quoting':
      return 'Open the Quoting tab';
    case 'engineering':
      return 'Open the Engineering tab';
    default:
      return null;
  }
}

/**
 * The warnings to acknowledge before generating, worded as the server words them: the wording warning
 * (from the server's settings) plus Attention and Part # (from what is typed).
 */
export function formWarnings(
  data: Pick<OfferLetterResponse, 'wordingApproved' | 'preview'>,
  form: OfferLetterForm,
): OfferWarningView[] {
  const items: OfferItemFacts[] = (data.preview?.items ?? []).map((i) => ({
    id: i.itemId,
    itemNo: i.itemNo,
    label: null,
    containerSize: null,
    standardDescription: null,
    plantLabel: i.placeOfManufacture,
    annualVolume: i.annualVolume,
    specs: {},
  }));
  return offerWarnings(
    { items },
    { wordingApproved: data.wordingApproved },
    {
      attention: form.attention,
      partNumbers: form.partNumbers,
    },
  );
}

/** Every warning is ticked. */
export const allAcknowledged = (
  warnings: readonly OfferWarningView[],
  ticked: ReadonlySet<string>,
): boolean => warnings.every((w) => ticked.has(w.code));

const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** "1,200,000 pcs", or a dash when the volume is not known. */
export const volumeText = (n: number | null) => (n === null ? '–' : `${COUNT.format(n)} pcs`);

/** Problem extensions a 409 carries (blockers or unacknowledged warnings). */
export function problemLists(problem: Record<string, unknown> | undefined): {
  blockers: OfferBlockerView[];
  warnings: OfferWarningView[];
} {
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    blockers: list<OfferBlockerView>(problem?.blockers),
    warnings: list<OfferWarningView>(problem?.warnings),
  };
}
