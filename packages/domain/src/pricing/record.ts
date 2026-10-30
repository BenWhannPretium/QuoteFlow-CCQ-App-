import { z } from 'zod';

import { PRICING_QUEUE_STAGE_KEY } from './queue';
import { DomainError } from '../errors';
import { lockedFor } from '../lead-review';
import { can } from '../policy/can';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';

/**
 * The Quoting stage's pricing record (B-11, CR-25/26, DEC-19/20/23). CCQ records the price APPROVAL as
 * a decision: who approved, when, on what basis. It never holds or
 * edits a price figure (PRD §9): how Pricing derives prices is out of scope (DEC-23) and costing stays
 * in Excel and the pricing app (CLAUDE.md rule 5). One record per quote version: a Rework or Return
 * bumps the version and starts a new record, the prior one is kept as history (CR-38).
 *
 * B-26 (CCQ demo, 10/20): no BPR. A BPR is the price-implementation step after CCQ, never part of it.
 * ERF numbers stay only as a transition field ("Legacy ERF #") for requests that started in the ERF
 * application; they are optional and no gate needs them. The old `bpr` refs and "no pricing-app record
 * yet" note columns are kept for history and no longer written.
 */

export const CAPITAL_READINESS_VALUES = [
  'not_required',
  'pending',
  'pre_approved',
  'not_approved',
] as const;
export type CapitalReadiness = (typeof CAPITAL_READINESS_VALUES)[number];

export const CAPITAL_READINESS_LABELS: Record<CapitalReadiness, string> = {
  not_required: 'Not required',
  pending: 'Pending',
  pre_approved: 'Pre-approved',
  not_approved: 'Not approved',
};

// ── Pricing-app reference formats (config) ───────────────────────────────────────────────────────

const refFormat = z
  .object({
    label: z.string().min(1),
    /** A JavaScript regular expression, anchored by the author (e.g. `^\d{5}$`). */
    pattern: z.string().min(1),
    /** Shown in the field hint and the error message. */
    example: z.string().min(1),
  })
  .strict()
  .refine(
    (f) => {
      try {
        return new RegExp(f.pattern).test(f.example);
      } catch {
        return false;
      }
    },
    { message: 'pattern must be a valid regular expression that matches its example' },
  );

/**
 * app_setting `pricing_ref_formats`. Format check for the Legacy ERF #; the Quoting tab looks the number
 * up in the imported pricing history (B-15), but an unknown number is still allowed.
 * B-26: only the legacy ERF format is used; a stored `bpr` entry is accepted and ignored.
 */
export const pricingRefFormatsSchema = z
  .object({ erf: refFormat, bpr: refFormat.optional() })
  .strict()
  .transform(({ erf }) => ({ erf }));
export type PricingRefFormats = z.output<typeof pricingRefFormatsSchema>;
export type PricingRefKind = keyof PricingRefFormats;

/**
 * Provisional seed, taken from the pricing-app export (B-15 revised, 2026-10-22): every ERF number is
 * ERF<yy>-<n> (n of 2–4 digits) or, for the older records, EP<yy>-<n>. Pricing can change the setting.
 */
export const PRICING_REF_FORMATS_SEED: PricingRefFormats = {
  // The export's real formats (2026-10-22): ERF<yy>-<n> and, before FY2010, EP<yy>-<n>.
  erf: { label: 'Legacy ERF number', pattern: '^(ERF|EP)\\d{2}-\\d{2,5}$', example: 'ERF25-123' },
};

export function parsePricingRefFormats(input: unknown): PricingRefFormats {
  const parsed = pricingRefFormatsSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError(
      'INVALID_CONFIG',
      `Pricing reference formats failed validation: ${detail}`,
    );
  }
  return parsed.data;
}

/** At most this many references of each kind on one record. */
export const MAX_PRICING_REFS = 20;

// ── The record ──────────────────────────────────────────────────────────────────────────────────

/** A pricing record's editable values (the current version's row, or all empty). */
export interface PricingRecordValues {
  priceApprovedBy: string | null;
  priceApprovedAt: Date | null;
  pricingBasisNote: string | null;
  approvedRangeNote: string | null;
  /** B-26: legacy ERF numbers (transition only). */
  erfRefs: string[];
  /** CR-25 costing-before-pricing checkpoint: an attestation only (costing stays in Excel). */
  costingCompleted: boolean;
  costingAttestedBy: string | null;
  costingAttestedAt: Date | null;
  capitalReadiness: CapitalReadiness | null;
  cerReference: string | null;
  capitalNotes: string | null;
  capitalPendingJustification: string | null;
}

export const EMPTY_PRICING_RECORD: PricingRecordValues = {
  priceApprovedBy: null,
  priceApprovedAt: null,
  pricingBasisNote: null,
  approvedRangeNote: null,
  erfRefs: [],
  costingCompleted: false,
  costingAttestedBy: null,
  costingAttestedAt: null,
  capitalReadiness: null,
  cerReference: null,
  capitalNotes: null,
  capitalPendingJustification: null,
};

/**
 * What a new version's record starts from: the legacy ERF numbers and the CER reference (the same
 * deal in Apex). The approval, notes and capital status are recorded afresh.
 */
export function carryForwardPricingRecord(prior: PricingRecordValues | null): PricingRecordValues {
  return {
    ...EMPTY_PRICING_RECORD,
    erfRefs: [...(prior?.erfRefs ?? [])],
    cerReference: prior?.cerReference ?? null,
  };
}

export type PricingQuote = Pick<
  QuoteState,
  | 'stageKey'
  | 'status'
  | 'kamUserId'
  | 'assignedEngineerId'
  | 'assignedPricerId'
  | 'pricingSubmittedAt'
  | 'region'
  | 'accountId'
>;

const inQuoting = (quote: PricingQuote) =>
  quote.stageKey === PRICING_QUEUE_STAGE_KEY && quote.status !== 'closed';

/**
 * Pricing edits the Quoting tab while the quote is in Quoting (on hold included). Lead review: once
 * the pricer submits it to the pricing lead, only the lead edits.
 */
export function canEditQuoting(actor: Actor, quote: PricingQuote): boolean {
  return (
    inQuoting(quote) && can(actor, 'quoting.edit', quote) && !lockedFor('pricing', actor, quote)
  );
}

function guard(actor: Actor, quote: PricingQuote): DomainError[] {
  if (!can(actor, 'quoting.edit', quote)) {
    return [new DomainError('NOT_PERMITTED', 'Only Pricing records the price approval')];
  }
  if (lockedFor('pricing', actor, quote)) {
    return [
      new DomainError(
        'LOCKED_FOR_REVIEW',
        'Submitted to the pricing lead: only the lead edits until it is sent back',
      ),
    ];
  }
  if (quote.status === 'closed') return [new DomainError('QUOTE_CLOSED', 'The quote is closed')];
  if (quote.stageKey !== PRICING_QUEUE_STAGE_KEY) {
    return [new DomainError('WRONG_STAGE', `The quote is in ${quote.stageKey}, not in Quoting`)];
  }
  return [];
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export interface PricingRecordInput {
  approvedBy?: string | null | undefined;
  approvedAt?: Date | null | undefined;
  pricingBasisNote?: string | null | undefined;
  approvedRangeNote?: string | null | undefined;
  erfRefs?: readonly string[] | undefined;
  costingCompleted?: boolean | undefined;
}

export interface PricingRecordContext {
  formats: PricingRefFormats;
  /** Active users who may be named as the price approver (the Pricing team). */
  pricingUserIds: ReadonlySet<string>;
  now: Date;
}

export type PricingRecordPlan =
  | { ok: true; next: PricingRecordValues; changed: (keyof PricingRecordValues)[] }
  | { ok: false; errors: DomainError[] };

/** An approval time may run ahead of the server clock by this much (clock skew), no more. */
const FUTURE_SKEW_MS = 5 * 60_000;

function normalizeRefs(
  kind: PricingRefKind,
  refs: readonly string[],
  formats: PricingRefFormats,
  errors: DomainError[],
): string[] {
  const field = `${kind}Refs`;
  const format = formats[kind];
  const re = new RegExp(format.pattern);
  const out: string[] = [];
  refs.forEach((raw, i) => {
    const ref = raw.trim().toUpperCase();
    if (!ref) return;
    if (!re.test(ref)) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `"${raw.trim()}" is not a valid ${format.label} (e.g. ${format.example})`,
          `${field}/${i}`,
        ),
      );
      return;
    }
    if (!out.includes(ref)) out.push(ref);
  });
  if (out.length > MAX_PRICING_REFS) {
    errors.push(
      new DomainError('INVALID_VALUE', `At most ${MAX_PRICING_REFS} ${format.label}s`, field),
    );
  }
  return out;
}

function changedKeys(a: PricingRecordValues, b: PricingRecordValues) {
  return (Object.keys(a) as (keyof PricingRecordValues)[]).filter((k) => {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x) && Array.isArray(y)) return x.join('\u0000') !== y.join('\u0000');
    if (x instanceof Date || y instanceof Date) {
      return (x as Date | null)?.getTime() !== (y as Date | null)?.getTime();
    }
    return x !== y;
  });
}

/**
 * The price approval record after a PUT: only the keys sent change. Naming an approver without a time
 * records it now; clearing the approver clears the time. The approver must be on the Pricing team, the
 * time cannot be in the future, references are checked against the configured formats (normalised to
 * upper case, duplicates dropped). Ticking "Costing completed" records who attested it and when.
 */
export function planPricingRecord(
  actor: Actor,
  quote: PricingQuote,
  current: PricingRecordValues,
  input: PricingRecordInput,
  ctx: PricingRecordContext,
): PricingRecordPlan {
  const errors = guard(actor, quote);
  if (errors.length > 0) return { ok: false, errors };

  const next: PricingRecordValues = { ...current };
  if (input.approvedBy !== undefined) {
    if (input.approvedBy !== null && !ctx.pricingUserIds.has(input.approvedBy)) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          'The price approver must be an active member of the Pricing team',
          'approvedBy',
        ),
      );
    }
    next.priceApprovedBy = input.approvedBy;
  }
  if (input.approvedAt !== undefined) {
    if (input.approvedAt && input.approvedAt.getTime() > ctx.now.getTime() + FUTURE_SKEW_MS) {
      errors.push(
        new DomainError('INVALID_VALUE', 'The approval time cannot be in the future', 'approvedAt'),
      );
    }
    next.priceApprovedAt = input.approvedAt;
  }
  if (next.priceApprovedBy === null) next.priceApprovedAt = null;
  else if (next.priceApprovedAt === null) next.priceApprovedAt = ctx.now;

  if (input.pricingBasisNote !== undefined) next.pricingBasisNote = clean(input.pricingBasisNote);
  if (input.approvedRangeNote !== undefined)
    next.approvedRangeNote = clean(input.approvedRangeNote);
  if (input.erfRefs !== undefined)
    next.erfRefs = normalizeRefs('erf', input.erfRefs, ctx.formats, errors);

  if (input.costingCompleted !== undefined && input.costingCompleted !== current.costingCompleted) {
    next.costingCompleted = input.costingCompleted;
    next.costingAttestedBy = input.costingCompleted ? actor.userId : null;
    next.costingAttestedAt = input.costingCompleted ? ctx.now : null;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, next, changed: changedKeys(current, next) };
}

export interface CapitalReadinessInput {
  capitalReadiness: string;
  cerReference?: string | null | undefined;
  capitalNotes?: string | null | undefined;
  capitalPendingJustification?: string | null | undefined;
}

/**
 * Capital readiness (CR-26): `not_required | pending | pre_approved | not_approved`, an optional CER
 * reference and notes. When Engineering's latest G2 outcome was "Capital required" it cannot be
 * `not_required`. The "pending capital" justification only means something while pending, so it is
 * cleared otherwise.
 */
export function planCapitalReadiness(
  actor: Actor,
  quote: PricingQuote,
  current: PricingRecordValues,
  input: CapitalReadinessInput,
  g2Outcome: string | null,
): PricingRecordPlan {
  const errors = guard(actor, quote);
  if (errors.length > 0) return { ok: false, errors };

  const value = input.capitalReadiness as CapitalReadiness;
  if (!CAPITAL_READINESS_VALUES.includes(value)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Capital readiness must be one of: ${CAPITAL_READINESS_VALUES.join(', ')}`,
        'capitalReadiness',
      ),
    );
  } else if (value === 'not_required' && g2Outcome === 'capital_required') {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        'Engineering said capital is required (G2), so capital readiness cannot be "Not required"',
        'capitalReadiness',
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const next: PricingRecordValues = { ...current, capitalReadiness: value };
  if (input.cerReference !== undefined) next.cerReference = clean(input.cerReference);
  if (input.capitalNotes !== undefined) next.capitalNotes = clean(input.capitalNotes);
  if (input.capitalPendingJustification !== undefined) {
    next.capitalPendingJustification = clean(input.capitalPendingJustification);
  }
  if (value !== 'pending') next.capitalPendingJustification = null;
  return { ok: true, next, changed: changedKeys(current, next) };
}

// ── What other roles see, and what the G3 decider is warned about ──────────────────────────────────

/**
 * The non-commercial part of the record: whether the price is approved, when and by whom. KAMs and
 * Engineers see this ("Price approved ✓ on <date> by <name>") and nothing else from the Quoting tab.
 */
export function priceApprovalStatus(
  record: Pick<PricingRecordValues, 'priceApprovedBy' | 'priceApprovedAt'> | null,
): { approved: boolean; approvedAt: Date | null; approvedById: string | null } {
  const approved = !!record?.priceApprovedBy && !!record.priceApprovedAt;
  return {
    approved,
    approvedAt: approved ? record.priceApprovedAt : null,
    approvedById: approved ? record.priceApprovedBy : null,
  };
}

export interface QuotingWarning {
  code: 'CAPITAL_PENDING' | 'CAPITAL_NOT_APPROVED' | 'COSTING_NOT_ATTESTED';
  message: string;
}

/**
 * Things the G3 decider and the Final Review approver should see: capital still pending (with its
 * justification; D-11 is open, so it does not block), capital not approved, and costing not attested
 * (CR-25; B-26 made it a G3 rule, cost before price, so this warning now explains the block).
 */
export function quotingWarnings(record: PricingRecordValues | null): QuotingWarning[] {
  if (!record) return [];
  const out: QuotingWarning[] = [];
  if (record.capitalReadiness === 'pending') {
    out.push({
      code: 'CAPITAL_PENDING',
      message: record.capitalPendingJustification
        ? `Capital is still pending: ${record.capitalPendingJustification}`
        : 'Capital is still pending: give a justification to submit (D-11)',
    });
  }
  if (record.capitalReadiness === 'not_approved') {
    out.push({ code: 'CAPITAL_NOT_APPROVED', message: 'Capital is not approved' });
  }
  if (!record.costingCompleted) {
    out.push({
      code: 'COSTING_NOT_ATTESTED',
      message:
        'Costing (Cost-to-Serve) is not marked as completed: cost comes before price (CR-25)',
    });
  }
  return out;
}
