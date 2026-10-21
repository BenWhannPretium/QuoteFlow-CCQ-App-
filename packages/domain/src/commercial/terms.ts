import { z } from 'zod';

import { DomainError } from '../errors';
import { pastDateErrors } from '../outcome/handoff';

/**
 * B-26: the commercial terms on a quote and the Legal review (future-state deck slides 12-13).
 *
 * - The KAM supplies the tooling funding model (company-funded, customer-funded, $0 CER, amortized; a
 *   value list) at Stage 3.
 * - Before G4 releases the offer, the terms are checked (tooling commitment, MOQ, payment terms) and,
 *   when a Legal trigger applies, Legal's review is recorded. Legal is not a CCQ role: whoever holds
 *   `terms.edit` records who reviewed it and when.
 * - Changing a term after the check clears the check: no silent edits (slide 16).
 *
 * The triggers are config (`legal_review_triggers`, D-25): provisional.
 */

export interface LegalReviewTriggers {
  /** The customer is not yet established (DEC-27). */
  newCustomer: boolean;
  nonstandardTerms: boolean;
  toolingCommitment: boolean;
}

export const LEGAL_REVIEW_TRIGGERS_SEED: LegalReviewTriggers = {
  newCustomer: true,
  nonstandardTerms: true,
  toolingCommitment: true,
};

export const legalReviewTriggersSchema = z
  .object({
    newCustomer: z.boolean(),
    nonstandardTerms: z.boolean(),
    toolingCommitment: z.boolean(),
  })
  .strict();

export function parseLegalReviewTriggers(input: unknown): LegalReviewTriggers {
  if (input === undefined || input === null) return { ...LEGAL_REVIEW_TRIGGERS_SEED };
  const parsed = legalReviewTriggersSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      'INVALID_CONFIG',
      'legal_review_triggers must be { newCustomer, nonstandardTerms, toolingCommitment } booleans',
    );
  }
  return parsed.data;
}

export const LEGAL_TRIGGER_LABELS = {
  new_customer: 'New customer',
  nonstandard_terms: 'Nonstandard terms',
  tooling_commitment: 'Tooling commitment',
} as const;
export type LegalTrigger = keyof typeof LEGAL_TRIGGER_LABELS;

/** Which Legal triggers apply to a quote. Empty = no Legal review needed. */
export function legalReviewReasons(
  triggers: LegalReviewTriggers,
  quote: {
    customerStatus: string | null;
    termsNonstandard: boolean | null;
    termsToolingCommitment: boolean | null;
  },
): LegalTrigger[] {
  const out: LegalTrigger[] = [];
  if (triggers.newCustomer && quote.customerStatus === 'not_yet_established')
    out.push('new_customer');
  if (triggers.nonstandardTerms && quote.termsNonstandard === true) out.push('nonstandard_terms');
  if (triggers.toolingCommitment && quote.termsToolingCommitment === true)
    out.push('tooling_commitment');
  return out;
}

// ── Editing the terms ───────────────────────────────────────────────────────────────────────────

export interface TermsValues {
  toolingFundingModel: string | null;
  termsToolingCommitment: boolean | null;
  termsMoq: string | null;
  termsPaymentTerms: string | null;
  termsNonstandard: boolean;
  termsNotes: string | null;
  termsCheckedAt: Date | null;
  termsCheckedBy: string | null;
  legalReviewedOn: string | null;
  legalReviewerName: string | null;
  legalReviewNote: string | null;
  legalRecordedBy: string | null;
}

/** A PUT body: only the keys sent change; `null` clears an optional field. */
export interface TermsInput {
  toolingFundingModel?: string | null | undefined;
  termsToolingCommitment?: boolean | null | undefined;
  termsMoq?: string | null | undefined;
  termsPaymentTerms?: string | null | undefined;
  termsNonstandard?: boolean | undefined;
  termsNotes?: string | null | undefined;
  /** true records the terms check (who and when); false clears it. */
  checked?: boolean | undefined;
  /** The Legal review: a date and who reviewed it; null clears it. */
  legal?: { reviewedOn: string; reviewerName: string; note?: string | null } | null | undefined;
}

export type TermsPlan =
  | { ok: true; values: TermsValues; changed: (keyof TermsValues)[]; checkCleared: boolean }
  | { ok: false; errors: DomainError[] };

/** The fields whose change invalidates an earlier terms check. */
const TERM_FIELDS = [
  'toolingFundingModel',
  'termsToolingCommitment',
  'termsMoq',
  'termsPaymentTerms',
  'termsNonstandard',
] as const;

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

export function planTerms(input: {
  current: TermsValues;
  edit: TermsInput;
  /** Active codes of value list `tooling_funding_model`. */
  fundingModelCodes: readonly string[];
  actorId: string;
  now: Date;
  closed: boolean;
}): TermsPlan {
  const { current, edit, now } = input;
  if (input.closed) {
    return { ok: false, errors: [new DomainError('QUOTE_CLOSED', 'The quote is closed')] };
  }
  const errors: DomainError[] = [];
  const pick = <K extends keyof TermsValues>(key: K, value: TermsValues[K] | undefined) =>
    value === undefined ? current[key] : value;

  const next: TermsValues = {
    ...current,
    toolingFundingModel: pick('toolingFundingModel', clean(edit.toolingFundingModel)),
    termsToolingCommitment: pick('termsToolingCommitment', edit.termsToolingCommitment),
    termsMoq: pick('termsMoq', clean(edit.termsMoq)),
    termsPaymentTerms: pick('termsPaymentTerms', clean(edit.termsPaymentTerms)),
    termsNonstandard: pick('termsNonstandard', edit.termsNonstandard),
    termsNotes: pick('termsNotes', clean(edit.termsNotes)),
  };
  if (next.toolingFundingModel && !input.fundingModelCodes.includes(next.toolingFundingModel)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Tooling funding model must be one of: ${input.fundingModelCodes.join(', ')}`,
        'toolingFundingModel',
      ),
    );
  }
  for (const [field, max] of [
    ['termsMoq', 200],
    ['termsPaymentTerms', 200],
    ['termsNotes', 2000],
  ] as const) {
    if ((next[field]?.length ?? 0) > max) {
      errors.push(new DomainError('INVALID_VALUE', `Keep it to ${max} characters`, field));
    }
  }

  const termsChanged = TERM_FIELDS.some((f) => next[f] !== current[f]);
  let checkCleared = false;
  if (edit.checked === true) {
    if (!next.termsPaymentTerms) {
      errors.push(
        new DomainError(
          'MISSING_FIELD',
          'The terms check needs the payment terms',
          'termsPaymentTerms',
        ),
      );
    }
    if (next.termsToolingCommitment === null) {
      errors.push(
        new DomainError(
          'MISSING_FIELD',
          'The terms check needs to say whether there is a tooling commitment',
          'termsToolingCommitment',
        ),
      );
    }
    if (!current.termsCheckedAt || termsChanged) {
      next.termsCheckedAt = now;
      next.termsCheckedBy = input.actorId;
    }
  } else if (edit.checked === false || (termsChanged && current.termsCheckedAt)) {
    checkCleared = !!current.termsCheckedAt;
    next.termsCheckedAt = null;
    next.termsCheckedBy = null;
  }

  if (edit.legal === null) {
    next.legalReviewedOn = null;
    next.legalReviewerName = null;
    next.legalReviewNote = null;
    next.legalRecordedBy = null;
  } else if (edit.legal !== undefined) {
    const reviewer = edit.legal.reviewerName.trim();
    if (!reviewer) {
      errors.push(
        new DomainError('MISSING_FIELD', 'Say who in Legal reviewed it', 'legal.reviewerName'),
      );
    }
    errors.push(
      ...pastDateErrors(edit.legal.reviewedOn, now, 'legal.reviewedOn', 'The Legal review date'),
    );
    next.legalReviewedOn = edit.legal.reviewedOn;
    next.legalReviewerName = reviewer || null;
    next.legalReviewNote = edit.legal.note?.trim() || null;
    next.legalRecordedBy = input.actorId;
  }

  if (errors.length > 0) return { ok: false, errors };
  const changed = (Object.keys(next) as (keyof TermsValues)[]).filter((k) => {
    const a = next[k];
    const b = current[k];
    return a instanceof Date || b instanceof Date
      ? (a as Date | null)?.getTime() !== (b as Date | null)?.getTime()
      : a !== b;
  });
  return { ok: true, values: next, changed, checkCleared };
}
