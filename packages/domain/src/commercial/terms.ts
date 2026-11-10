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
 *
 * FB-08 (F-021, F-068, D-003 and D-029 provisional): payment terms are a value list and anything not
 * in `standard_payment_terms` is non-standard and opens an exception request for the PricingLead; MOQ
 * and tooling funding are Engineering's; the tooling payment follows a milestone option; and the
 * capital terms (funding, mold ownership, amortization, minimum supply, agreement) are confirmed by
 * the approver at Final Review.
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
  /** FB-08 (F-021): value_list `requested_payment_terms` code of the agreed payment terms. */
  termsPaymentTermsCode: string | null;
  /** The payment-terms detail: required for a free-text code ("Other"); legacy free text before FB-08. */
  termsPaymentTerms: string | null;
  termsNonstandard: boolean;
  /** FB-08 (D-029): value_list `tooling_payment_terms` code (upfront, 50/50, amortized per piece). */
  termsToolingPayment: string | null;
  /** FB-08 (D-029): a short milestone note (≤ 300). */
  termsMilestoneNote: string | null;
  termsNotes: string | null;
  termsCheckedAt: Date | null;
  termsCheckedBy: string | null;
  legalReviewedOn: string | null;
  legalReviewerName: string | null;
  legalReviewNote: string | null;
  legalRecordedBy: string | null;
  // FB-08 (F-068): the capital terms the approver confirms at Final Review.
  termsMoldOwnership: string | null;
  termsAmortized: boolean | null;
  termsAmortizationMonths: number | null;
  termsMinSupply: string | null;
  termsAgreementInPlace: boolean | null;
  termsAgreementMonths: number | null;
  termsFinalizedAt: Date | null;
  termsFinalizedBy: string | null;
}

/** A PUT body: only the keys sent change; `null` clears an optional field. */
export interface TermsInput {
  toolingFundingModel?: string | null | undefined;
  termsToolingCommitment?: boolean | null | undefined;
  termsMoq?: string | null | undefined;
  termsPaymentTermsCode?: string | null | undefined;
  termsPaymentTerms?: string | null | undefined;
  termsNonstandard?: boolean | undefined;
  termsToolingPayment?: string | null | undefined;
  termsMilestoneNote?: string | null | undefined;
  termsNotes?: string | null | undefined;
  /** true records the terms check (who and when); false clears it. */
  checked?: boolean | undefined;
  /** The Legal review: a date and who reviewed it; null clears it. */
  legal?: { reviewedOn: string; reviewerName: string; note?: string | null } | null | undefined;
  termsMoldOwnership?: string | null | undefined;
  termsAmortized?: boolean | null | undefined;
  termsAmortizationMonths?: number | null | undefined;
  termsMinSupply?: string | null | undefined;
  termsAgreementInPlace?: boolean | null | undefined;
  termsAgreementMonths?: number | null | undefined;
  /** FB-08 (F-068): true confirms the capital terms (who and when); false clears the confirmation. */
  finalized?: boolean | undefined;
}

/**
 * FB-08 (F-021, D-003 provisional): who edits which terms, by route.
 * - `sales` (`terms.edit`: KAM own, SalesLeader, Pricing, PricingLead): payment terms, tooling payment
 *   milestones, the tooling commitment, notes, the terms check, the Legal review, and the capital terms
 *   as a pre-fill (F-068: "KAM may pre-fill").
 * - `engineering` (`terms.engineering.edit`: EngLead, Engineer assigned): MOQ and tooling funding
 *   (D-003's recommendation: "MOQ and tooling funding to Engineering"). The KAM still answers funding
 *   at intake (FB-11).
 * - `finalize` (`terms.finalize`: Approver, in Final Review): the capital terms, funding included, and
 *   their confirmation (F-068: "approver finalizes").
 */
export const CAPITAL_PREFILL_FIELDS = [
  'termsMoldOwnership',
  'termsAmortized',
  'termsAmortizationMonths',
  'termsMinSupply',
  'termsAgreementInPlace',
  'termsAgreementMonths',
] as const;

export const TERMS_SCOPE_FIELDS = {
  sales: [
    'termsPaymentTermsCode',
    'termsPaymentTerms',
    'termsNonstandard',
    'termsToolingPayment',
    'termsMilestoneNote',
    'termsToolingCommitment',
    'termsNotes',
    'checked',
    'legal',
    ...CAPITAL_PREFILL_FIELDS,
  ],
  engineering: ['toolingFundingModel', 'termsMoq'],
  finalize: ['toolingFundingModel', ...CAPITAL_PREFILL_FIELDS, 'finalized'],
} as const satisfies Record<string, readonly (keyof TermsInput)[]>;
export type TermsScope = keyof typeof TERMS_SCOPE_FIELDS;

/** The permission behind each scope (the route declares it; the plan refuses fields outside it). */
export const TERMS_SCOPE_PERMISSION = {
  sales: 'terms.edit',
  engineering: 'terms.engineering.edit',
  finalize: 'terms.finalize',
} as const;

/** The F-068 capital terms the approver confirms (`capital_terms_required` names which are required). */
export const CAPITAL_TERMS = [
  'funding_model',
  'mold_ownership',
  'amortization',
  'min_supply',
  'agreement',
] as const;
export type CapitalTerm = (typeof CAPITAL_TERMS)[number];

/** Seed (provisional, D-003): all five are required before the approver can confirm. */
export const CAPITAL_TERMS_REQUIRED_SEED: CapitalTerm[] = [...CAPITAL_TERMS];

/** `app_setting.capital_terms_required`. Unset = the seed; malformed = INVALID_CONFIG. */
export function parseCapitalTermsRequired(input: unknown): CapitalTerm[] {
  if (input === undefined || input === null) return [...CAPITAL_TERMS_REQUIRED_SEED];
  const parsed = z.array(z.enum(CAPITAL_TERMS)).safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      'INVALID_CONFIG',
      `capital_terms_required must be a list of: ${CAPITAL_TERMS.join(', ')}`,
    );
  }
  return [...new Set(parsed.data)];
}

export const CAPITAL_TERM_LABELS: Record<CapitalTerm, string> = {
  funding_model: 'the funding model',
  mold_ownership: 'mold ownership',
  amortization: 'whether it is amortized',
  min_supply: 'the minimum supply / shortfall terms',
  agreement: 'whether an agreement is in place',
};

const CAPITAL_TERM_FIELD: Record<CapitalTerm, keyof TermsValues> = {
  funding_model: 'toolingFundingModel',
  mold_ownership: 'termsMoldOwnership',
  amortization: 'termsAmortized',
  min_supply: 'termsMinSupply',
  agreement: 'termsAgreementInPlace',
};

/** The capital terms still missing for the approver's confirmation, as field errors. */
export function capitalTermsMissing(
  v: TermsValues,
  required: readonly CapitalTerm[],
  /** Funding codes that are not an answer (FB-11's intake default "Not discussed"). */
  fundingNotAnswered: readonly string[] = [],
): DomainError[] {
  const out: DomainError[] = [];
  const need = (field: keyof TermsValues, message: string) =>
    out.push(new DomainError('MISSING_FIELD', message, field));
  for (const term of required) {
    const field = CAPITAL_TERM_FIELD[term];
    const value = v[field];
    const unanswered =
      term === 'funding_model' && typeof value === 'string' && fundingNotAnswered.includes(value);
    if (value === null || value === '' || unanswered) {
      need(field, `Confirming the capital terms needs ${CAPITAL_TERM_LABELS[term]}`);
    }
  }
  if (required.includes('amortization') && v.termsAmortized && v.termsAmortizationMonths === null) {
    need('termsAmortizationMonths', 'Say over how many months it is amortized');
  }
  if (
    required.includes('agreement') &&
    v.termsAgreementInPlace &&
    v.termsAgreementMonths === null
  ) {
    need('termsAgreementMonths', 'Give the agreement duration in months');
  }
  return out;
}

/**
 * FB-08 (D-029): a tooling-payment option's milestones, from its value-list meta `milestones`
 * ([{ percent, trigger }], percents summing to 100). Empty when the option has none (amortized per
 * piece); null when the meta is malformed, so the screen shows no schedule rather than a wrong one.
 */
const milestonesSchema = z
  .array(
    z
      .object({
        percent: z.number().int().min(1).max(100),
        trigger: z.string().trim().min(1).max(80),
      })
      .strict(),
  )
  .refine((list) => list.length === 0 || list.reduce((s, m) => s + m.percent, 0) === 100, {
    message: 'milestone percents must add up to 100',
  });
export type PaymentMilestone = z.infer<typeof milestonesSchema>[number];

export function parseMilestones(meta: unknown): PaymentMilestone[] | null {
  const raw = (meta as { milestones?: unknown } | null | undefined)?.milestones;
  if (raw === undefined) return [];
  const parsed = milestonesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A payment-terms list entry, as the plan needs it. */
export interface PaymentTermsOption {
  code: string;
  /** "Other": the detail field says what was agreed. */
  freeText: boolean;
}

export interface TermsLists {
  /** Active codes of value list `tooling_funding_model`. */
  fundingModelCodes: readonly string[];
  /**
   * Funding codes that do not answer the question (list meta `defaultAtIntake`: "Not discussed").
   * The approver cannot confirm the capital terms on one.
   */
  fundingNotAnswered?: readonly string[];
  /** Active entries of value list `requested_payment_terms` (the same list intake asks from). */
  paymentTerms: readonly PaymentTermsOption[];
  /** `app_setting.standard_payment_terms`: anything else is non-standard and needs an exception. */
  standardPaymentTerms: readonly string[];
  /** Active codes of value list `tooling_payment_terms` (D-029). */
  toolingPaymentCodes: readonly string[];
  /** Active codes of value list `mold_ownership`. */
  moldOwnershipCodes: readonly string[];
  /** `app_setting.capital_terms_required`. */
  capitalTermsRequired: readonly CapitalTerm[];
}

/** What the exception request should do after the edit (the service writes it). */
export type TermsExceptionAction = 'open' | 'withdraw' | null;

export type TermsPlan =
  | {
      ok: true;
      values: TermsValues;
      changed: (keyof TermsValues)[];
      checkCleared: boolean;
      /** FB-08: a capital term changed after the approver confirmed them: the confirmation is cleared. */
      finalizeCleared: boolean;
      /** FB-08 (T-007): non-standard payment terms open a new exception request; standard ones withdraw it. */
      exception: TermsExceptionAction;
    }
  | { ok: false; errors: DomainError[] };

/** The fields whose change invalidates an earlier terms check. */
const TERM_FIELDS = [
  'toolingFundingModel',
  'termsToolingCommitment',
  'termsMoq',
  'termsPaymentTermsCode',
  'termsPaymentTerms',
  'termsNonstandard',
  'termsToolingPayment',
] as const;

/** FB-08 (F-068): the fields whose change invalidates the approver's confirmation. */
const CAPITAL_FIELDS = ['toolingFundingModel', ...CAPITAL_PREFILL_FIELDS] as const;

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

/** Non-standard: a payment-terms code that is not in `standard_payment_terms`. A blank one is not. */
export const isNonStandardTerms = (code: string | null, standard: readonly string[]) =>
  code !== null && !standard.includes(code);

const paymentKey = (v: TermsValues) =>
  v.termsPaymentTermsCode === null
    ? null
    : `${v.termsPaymentTermsCode}|${v.termsPaymentTerms ?? ''}`;

export function planTerms(input: {
  current: TermsValues;
  edit: TermsInput;
  /** Which route's fields this edit may touch (FB-08). Default: every field (domain tests). */
  scope?: TermsScope;
  lists: TermsLists;
  /** The quote's current exception request status, if any (FB-08). */
  exceptionStatus?: string | null;
  actorId: string;
  now: Date;
  closed: boolean;
}): TermsPlan {
  const { current, edit, now, lists } = input;
  if (input.closed) {
    return { ok: false, errors: [new DomainError('QUOTE_CLOSED', 'The quote is closed')] };
  }
  if (input.scope) {
    const allowed = new Set<string>(TERMS_SCOPE_FIELDS[input.scope]);
    const outside = Object.keys(edit).filter(
      (k) => edit[k as keyof TermsInput] !== undefined && !allowed.has(k),
    );
    if (outside.length > 0) {
      return {
        ok: false,
        errors: [
          new DomainError(
            'NOT_PERMITTED',
            `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not edited with ${TERMS_SCOPE_PERMISSION[input.scope]}`,
          ),
        ],
      };
    }
  }
  const errors: DomainError[] = [];
  const invalid = (field: string, message: string) =>
    errors.push(new DomainError('INVALID_VALUE', message, field));
  const pick = <K extends keyof TermsValues>(key: K, value: TermsValues[K] | undefined) =>
    value === undefined ? current[key] : value;

  const next: TermsValues = {
    ...current,
    toolingFundingModel: pick('toolingFundingModel', clean(edit.toolingFundingModel)),
    termsToolingCommitment: pick('termsToolingCommitment', edit.termsToolingCommitment),
    termsMoq: pick('termsMoq', clean(edit.termsMoq)),
    termsPaymentTermsCode: pick('termsPaymentTermsCode', clean(edit.termsPaymentTermsCode)),
    termsPaymentTerms: pick('termsPaymentTerms', clean(edit.termsPaymentTerms)),
    termsNonstandard: pick('termsNonstandard', edit.termsNonstandard),
    termsToolingPayment: pick('termsToolingPayment', clean(edit.termsToolingPayment)),
    termsMilestoneNote: pick('termsMilestoneNote', clean(edit.termsMilestoneNote)),
    termsNotes: pick('termsNotes', clean(edit.termsNotes)),
    termsMoldOwnership: pick('termsMoldOwnership', clean(edit.termsMoldOwnership)),
    termsAmortized: pick('termsAmortized', edit.termsAmortized),
    termsAmortizationMonths: pick('termsAmortizationMonths', edit.termsAmortizationMonths),
    termsMinSupply: pick('termsMinSupply', clean(edit.termsMinSupply)),
    termsAgreementInPlace: pick('termsAgreementInPlace', edit.termsAgreementInPlace),
    termsAgreementMonths: pick('termsAgreementMonths', edit.termsAgreementMonths),
  };

  // A code is checked against the active list only when it changes, so a value retired since it was
  // picked does not block saving another field.
  const codeOk = (field: keyof TermsValues, codes: readonly string[], label: string) => {
    const value = next[field];
    if (value !== current[field] && typeof value === 'string' && !codes.includes(value)) {
      invalid(field, `${label} must be one of: ${codes.join(', ')}`);
    }
  };
  codeOk('toolingFundingModel', lists.fundingModelCodes, 'Tooling funding model');
  codeOk(
    'termsPaymentTermsCode',
    lists.paymentTerms.map((p) => p.code),
    'Payment terms',
  );
  codeOk('termsToolingPayment', lists.toolingPaymentCodes, 'Tooling payment');
  codeOk('termsMoldOwnership', lists.moldOwnershipCodes, 'Mold ownership');

  // F-021: payment terms are a list; "Other" says what was agreed in the detail, any other code needs none.
  const option = lists.paymentTerms.find((p) => p.code === next.termsPaymentTermsCode);
  if (next.termsPaymentTermsCode !== current.termsPaymentTermsCode && option && !option.freeText) {
    next.termsPaymentTerms = null;
  }
  if (option?.freeText && !next.termsPaymentTerms) {
    errors.push(
      new DomainError('MISSING_FIELD', 'Say what payment terms were agreed', 'termsPaymentTerms'),
    );
  }

  // F-021: anything other than a standard term is non-standard (a Legal trigger, D-25) and stays so.
  const nonstandardNow = isNonStandardTerms(next.termsPaymentTermsCode, lists.standardPaymentTerms);
  const nonstandardBefore = isNonStandardTerms(
    current.termsPaymentTermsCode,
    lists.standardPaymentTerms,
  );
  if (nonstandardNow) {
    if (edit.termsNonstandard === false) {
      invalid('termsNonstandard', 'Non-standard payment terms keep the terms marked non-standard');
    }
    next.termsNonstandard = true;
  } else if (nonstandardBefore && edit.termsNonstandard === undefined) {
    next.termsNonstandard = false;
  }

  // F-068: months only go with a "yes"; a "no" clears them.
  if (next.termsAmortized !== true) next.termsAmortizationMonths = null;
  if (next.termsAgreementInPlace !== true) next.termsAgreementMonths = null;
  for (const [field, max] of [
    ['termsAmortizationMonths', 120],
    ['termsAgreementMonths', 240],
  ] as const) {
    const months = next[field];
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > max)) {
      invalid(field, `Give whole months from 1 to ${max}`);
    }
  }
  for (const [field, max] of [
    ['termsMoq', 200],
    ['termsPaymentTerms', 200],
    ['termsMilestoneNote', 300],
    ['termsMinSupply', 300],
    ['termsNotes', 2000],
  ] as const) {
    if ((next[field]?.length ?? 0) > max) invalid(field, `Keep it to ${max} characters`);
  }

  const termsChanged = TERM_FIELDS.some((f) => next[f] !== current[f]);
  let checkCleared = false;
  if (edit.checked === true) {
    if (!next.termsPaymentTermsCode) {
      errors.push(
        new DomainError(
          'MISSING_FIELD',
          'The terms check needs the payment terms',
          'termsPaymentTermsCode',
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

  // F-068: the approver confirms the capital terms; changing one afterwards clears the confirmation.
  const capitalChanged = CAPITAL_FIELDS.some((f) => next[f] !== current[f]);
  let finalizeCleared = false;
  if (edit.finalized === true) {
    errors.push(...capitalTermsMissing(next, lists.capitalTermsRequired, lists.fundingNotAnswered));
    if (!current.termsFinalizedAt || capitalChanged) {
      next.termsFinalizedAt = now;
      next.termsFinalizedBy = input.actorId;
    }
  } else if (edit.finalized === false || (capitalChanged && current.termsFinalizedAt)) {
    finalizeCleared = !!current.termsFinalizedAt;
    next.termsFinalizedAt = null;
    next.termsFinalizedBy = null;
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

  // T-007: a change to the payment terms opens a new exception request when they are non-standard
  // (the PricingLead approves or rejects it) and withdraws the current one when they are standard.
  let exception: TermsExceptionAction = null;
  if (paymentKey(next) !== paymentKey(current)) {
    if (nonstandardNow) exception = 'open';
    else if (input.exceptionStatus) exception = 'withdraw';
  }

  const changed = (Object.keys(next) as (keyof TermsValues)[]).filter((k) => {
    const a = next[k];
    const b = current[k];
    return a instanceof Date || b instanceof Date
      ? (a as Date | null)?.getTime() !== (b as Date | null)?.getTime()
      : a !== b;
  });
  return { ok: true, values: next, changed, checkCleared, finalizeCleared, exception };
}

// ── The payment-terms exception (T-007) ─────────────────────────────────────────────────────────

/**
 * FB-08 (F-021, T-007, D-003 provisional): non-standard payment terms need the PricingLead's (or the
 * designee's) approval, with a rationale either way. `quote.terms_exception_status` holds the current
 * request's status; `terms_exception_request` keeps every request.
 * - `pending`: waiting for the decision. `approved` / `rejected`: decided.
 * - `withdrawn`: the terms went back to standard. `superseded`: the terms changed again (a new request).
 * Only `pending` and `rejected` keep the exception open (G4 cannot approve: `terms_exception`).
 */
export const TERMS_EXCEPTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'superseded',
] as const;
export type TermsExceptionStatus = (typeof TERMS_EXCEPTION_STATUSES)[number];

/** The statuses a quote's current request can have (closed ones leave the quote's column null). */
export const QUOTE_TERMS_EXCEPTION_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const termsExceptionOpen = (status: string | null | undefined): boolean =>
  status === 'pending' || status === 'rejected';

export const TERMS_EXCEPTION_RATIONALE_MAX = 1000;

export type TermsExceptionDecisionPlan =
  | { ok: true; status: 'approved' | 'rejected'; rationale: string }
  | { ok: false; errors: DomainError[] };

/** The PricingLead's decision on the pending request: approve or reject, always with a rationale. */
export function planTermsExceptionDecision(input: {
  status: string | null;
  decision: 'approve' | 'reject';
  rationale: string;
  closed: boolean;
}): TermsExceptionDecisionPlan {
  if (input.closed) {
    return { ok: false, errors: [new DomainError('QUOTE_CLOSED', 'The quote is closed')] };
  }
  const errors: DomainError[] = [];
  if (input.status !== 'pending') {
    errors.push(
      new DomainError('NO_PENDING_EXCEPTION', 'There is no pending payment-terms exception'),
    );
  }
  const rationale = input.rationale.trim();
  if (!rationale) {
    errors.push(
      new DomainError('MISSING_FIELD', 'Give the rationale for the decision', 'rationale'),
    );
  } else if (rationale.length > TERMS_EXCEPTION_RATIONALE_MAX) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Keep it to ${TERMS_EXCEPTION_RATIONALE_MAX} characters`,
        'rationale',
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    status: input.decision === 'approve' ? 'approved' : 'rejected',
    rationale,
  };
}
