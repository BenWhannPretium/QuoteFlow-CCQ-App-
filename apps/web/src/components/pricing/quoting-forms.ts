/**
 * The two Quoting cards compare their form with what is stored to decide "nothing to save" and, since
 * UX-001, "unsaved changes" (which holds back Submit and asks before leaving). Both must be measured on
 * what the server would store, or a difference the server ignores can never be saved away:
 * surrounding spaces are trimmed, and a pending justification is kept only while the status is Pending.
 */

export interface CapitalForm {
  capitalReadiness: string;
  capitalNotes: string;
  capitalPendingJustification: string;
}

export const capitalForm = (
  record:
    | {
        capitalReadiness?: string | null | undefined;
        capitalNotes?: string | null | undefined;
        capitalPendingJustification?: string | null | undefined;
      }
    | null
    | undefined,
): CapitalForm => ({
  capitalReadiness: record?.capitalReadiness ?? '',
  capitalNotes: record?.capitalNotes ?? '',
  capitalPendingJustification: record?.capitalPendingJustification ?? '',
});

/** The capital form as the server would store it. */
export const capitalComparable = (form: CapitalForm): CapitalForm => ({
  capitalReadiness: form.capitalReadiness,
  capitalNotes: form.capitalNotes.trim(),
  capitalPendingJustification:
    form.capitalReadiness === 'pending' ? form.capitalPendingJustification.trim() : '',
});

/** "ERF-1, ERF-2" as a list: split on spaces, commas and semicolons, blanks dropped. */
export const splitRefs = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((r) => r.trim())
    .filter(Boolean);

export interface PricingRecordForm {
  approvedBy: string;
  approvedAt: string;
  pricingBasisNote: string;
  approvedRangeNote: string;
  erfRefs: string;
  costingCompleted: boolean;
}

/** The pricing record form as the server would store it. */
export const recordComparable = (form: PricingRecordForm): PricingRecordForm => ({
  ...form,
  pricingBasisNote: form.pricingBasisNote.trim(),
  approvedRangeNote: form.approvedRangeNote.trim(),
  erfRefs: splitRefs(form.erfRefs).join(', '),
});
