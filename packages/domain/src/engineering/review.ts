import {
  allocationCheck,
  computeUtilization,
  storedUtilizationPct,
  type AllocationCheck,
  type CapacityBasis,
} from './capacity';
import { DomainError } from '../errors';
import { ENG_QUEUE_STAGE_KEY, type EngQueueSettings } from './queue';
import { evaluateIntake, type IntakeConfig, type IntakeIssue } from '../intake/intake';
import { lockedFor } from '../lead-review';
import { can, canSeeCommercialFields, type PolicyResource } from '../policy/can';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';
import type { Role } from '../types/roles';
import type { FieldValues } from '../workflow/rules';

/** Roles an engineering review can be assigned to (the picker offers users holding one of them). */
export const ASSIGNABLE_ROLES: readonly Role[] = ['Engineer', 'EngLead'];

export type EngQuote = Pick<
  QuoteState,
  | 'stageKey'
  | 'status'
  | 'kamUserId'
  | 'assignedEngineerId'
  | 'engSubmittedAt'
  | 'region'
  | 'accountId'
>;

const inEngReview = (quote: EngQuote) =>
  quote.stageKey === ENG_QUEUE_STAGE_KEY && quote.status !== 'closed';

/**
 * Who may assign / reassign: `queue.assign` (EngLead, Admin), or a configured backup assigner who can
 * read the quote (R-04: someone acts as EngLead for assignment while Jim is out).
 */
export function canAssignEngQueue(
  actor: Actor,
  settings: Pick<EngQueueSettings, 'backupAssignerUserIds'>,
  quote?: PolicyResource,
): boolean {
  if (can(actor, 'queue.assign', quote)) return true;
  return settings.backupAssignerUserIds.includes(actor.userId) && can(actor, 'quote.read', quote);
}

/**
 * Edit the Engineering Review and capacity evidence: EngLead, or the Engineer assigned, while in
 * ENG_REVIEW. Lead review: once the engineer submits it to the lead, only the lead edits.
 */
export function canEditEngReview(actor: Actor, quote: EngQuote): boolean {
  return (
    inEngReview(quote) &&
    can(actor, 'engReview.edit', quote) &&
    !lockedFor('engineering', actor, quote)
  );
}

function stageErrors(quote: EngQuote): DomainError[] {
  if (quote.status === 'closed') return [new DomainError('QUOTE_CLOSED', 'The quote is closed')];
  if (quote.stageKey !== ENG_QUEUE_STAGE_KEY) {
    return [
      new DomainError(
        'WRONG_STAGE',
        `The quote is in ${quote.stageKey}, not in Engineering Review`,
      ),
    ];
  }
  return [];
}

export interface Assignee {
  id: string;
  roles: readonly Role[];
  active: boolean;
}

export type AssignmentPlan =
  | { ok: true; changed: boolean; from: string | null; to: string }
  | { ok: false; errors: DomainError[] };

/**
 * Assign or reassign the quote's engineer. The quote must be in Engineering Review (on hold is fine);
 * the assignee must be an active user holding an assignable role. Assigning the same engineer again
 * is a no-op (`changed: false`), so a bulk assign can include already-assigned quotes.
 */
export function planAssignment(
  actor: Actor,
  settings: Pick<EngQueueSettings, 'backupAssignerUserIds'>,
  quote: EngQuote,
  assignee: Assignee | undefined,
): AssignmentPlan {
  if (!canAssignEngQueue(actor, settings, quote)) {
    return {
      ok: false,
      errors: [
        new DomainError('NOT_PERMITTED', 'Requires queue.assign (or the backup assigner setting)'),
      ],
    };
  }
  const errors = stageErrors(quote);
  if (!assignee || !assignee.active || !assignee.roles.some((r) => ASSIGNABLE_ROLES.includes(r))) {
    errors.push(
      new DomainError(
        'INVALID_ASSIGNEE',
        'Assign an active user with the Engineer or EngLead role',
        'engineerId',
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  const from = quote.assignedEngineerId ?? null;
  return { ok: true, changed: from !== assignee!.id, from, to: assignee!.id };
}

/** Accept (start the review). EngLead, or the assigned Engineer; only once per stay in the queue. */
export function planAccept(
  actor: Actor,
  quote: EngQuote,
  acceptedAt: Date | null,
): { ok: true } | { ok: false; errors: DomainError[] } {
  if (!can(actor, 'engReview.edit', quote)) {
    return {
      ok: false,
      errors: [
        new DomainError('NOT_PERMITTED', 'Only the EngLead or the assigned engineer can accept'),
      ],
    };
  }
  const errors = stageErrors(quote);
  if (acceptedAt)
    errors.push(new DomainError('ALREADY_ACCEPTED', 'The review was already accepted'));
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ── Capacity evidence (CR-19; FB-03 F-059) ───────────────────────────────────────────────────────

/** The numbers architecture §3.3 tags commercial on a capacity row (all roles read them: CLAUDE.md rule 2). */
export const CAPACITY_COMMERCIAL_FIELDS = [
  'assumedEffectivenessPct',
  'cycleTimeS',
  'utilizationBeforePct',
] as const;
type CommercialField = (typeof CAPACITY_COMMERCIAL_FIELDS)[number];

/** Which commercial numbers must be stated. No OEE default, ever (D-08, DF-22). */
const REQUIRED_NUMBERS: readonly CommercialField[] = [
  'assumedEffectivenessPct',
  'cycleTimeS',
  'utilizationBeforePct',
];

export interface CapacityRowInput {
  id?: string | undefined;
  site: string;
  lineAsset?: string | null | undefined;
  assumedEffectivenessPct?: number | null | undefined;
  cycleTimeS?: number | null | undefined;
  /** The line's current load (entered). Replaces the typed "Utilization %" (F-059). */
  utilizationBeforePct?: number | null | undefined;
  /** Units a year allocated to this line; blank = the quote's estimated annual volume. */
  allocatedAnnualVolume?: number | null | undefined;
  /** Scheduled run days a year; blank = the `capacity_basis` default. */
  scheduledRunDaysPerYear?: number | null | undefined;
  analysisDate: string;
  analystId: string;
  notes?: string | null | undefined;
}

export interface CapacityRowStored {
  id: string;
  assumedEffectivenessPct: number;
  cycleTimeS: number;
  utilizationBeforePct: number;
  allocatedAnnualVolume: number | null;
  scheduledRunDaysPerYear: number | null;
}

export interface CapacityRowResolved {
  id: string | null;
  site: string;
  lineAsset: string | null;
  assumedEffectivenessPct: number;
  cycleTimeS: number;
  utilizationBeforePct: number;
  allocatedAnnualVolume: number | null;
  scheduledRunDaysPerYear: number;
  /** Calculated (capacity.ts), two decimals; null when the review has no cavitation yet. */
  utilizationAfterPct: number | null;
  analysisDate: string;
  analystId: string;
  notes: string | null;
}

/** What the plan needs besides the rows: the review's cavitation, the quote's volume and the basis. */
export interface CapacityContext {
  cavitation: number | null;
  quoteAnnualVolume: number | null;
  basis: Pick<CapacityBasis, 'scheduledRunDaysPerYear'>;
}

export type CapacityPlan =
  | {
      ok: true;
      upsert: CapacityRowResolved[];
      deleteIds: string[];
      /** T-030: the rows do not add up to the quote's volume (a warning, never a block). */
      allocationWarning: AllocationCheck | null;
    }
  | { ok: false; errors: DomainError[] };

const LABELS: Record<CommercialField, string> = {
  assumedEffectivenessPct: 'Assumed effectiveness %',
  cycleTimeS: 'Cycle time (s)',
  utilizationBeforePct: 'Utilization before %',
};

/**
 * The capacity evidence set as submitted, replacing what is stored: rows with an `id` update that row,
 * rows without one are new, stored rows not sent are deleted.
 *
 * Utilization after is never accepted from the caller: it is calculated here (`computeUtilization`) from
 * the row, the review's cavitation and the allocated volume, and stored for reporting. A blank allocated
 * volume or run-days value defaults (the quote's volume; the `capacity_basis` setting) so the engineer
 * only types what differs. Rows that do not add up to the quote's volume raise `allocationWarning`.
 *
 * Commercial numbers are WRITE-ONLY for roles without `quote.read.commercialFields` (none today, rule 2):
 * an omitted number on an existing row keeps its stored value. Everyone must state effectiveness, cycle
 * time and utilization before on a new row.
 */
export function planCapacityEvidence(
  actor: Actor,
  incoming: readonly CapacityRowInput[],
  stored: readonly CapacityRowStored[],
  context: CapacityContext,
): CapacityPlan {
  const errors: DomainError[] = [];
  const byId = new Map(stored.map((r) => [r.id, r]));
  const keepHidden = !canSeeCommercialFields(actor);
  const seen = new Set<string>();
  const upsert: CapacityRowResolved[] = [];

  incoming.forEach((row, i) => {
    const existing = row.id ? byId.get(row.id) : undefined;
    if (row.id && !existing) {
      errors.push(
        new DomainError('INVALID_VALUE', `Row ${i + 1} is not on this quote`, `rows/${i}/id`),
      );
      return;
    }
    if (row.id) {
      if (seen.has(row.id))
        errors.push(
          new DomainError('INVALID_VALUE', `Row ${i + 1} is listed twice`, `rows/${i}/id`),
        );
      seen.add(row.id);
    }
    const value = (field: CommercialField): number | null => {
      const given = row[field];
      if (given !== undefined) return given;
      return keepHidden && existing ? existing[field] : null;
    };
    for (const field of REQUIRED_NUMBERS) {
      if (value(field) === null) {
        errors.push(
          new DomainError(
            'MISSING_FIELD',
            field === 'assumedEffectivenessPct'
              ? `Row ${i + 1}: state the assumed effectiveness % (there is no default)`
              : `Row ${i + 1}: ${LABELS[field]} is required`,
            `rows/${i}/${field}`,
          ),
        );
      }
    }
    // Not commercial: omitted keeps the stored value, blank (null) falls back to the default.
    const allocated =
      row.allocatedAnnualVolume ??
      (row.allocatedAnnualVolume === undefined ? existing?.allocatedAnnualVolume : null) ??
      context.quoteAnnualVolume;
    const runDays =
      row.scheduledRunDaysPerYear ??
      (row.scheduledRunDaysPerYear === undefined ? existing?.scheduledRunDaysPerYear : null) ??
      context.basis.scheduledRunDaysPerYear;

    const effectiveness = value('assumedEffectivenessPct') ?? 0;
    const cycle = value('cycleTimeS') ?? 0;
    const before = value('utilizationBeforePct') ?? 0;
    const calc = computeUtilization({
      cycleTimeS: cycle,
      cavitation: context.cavitation,
      effectivenessPct: effectiveness,
      scheduledRunDaysPerYear: runDays,
      allocatedAnnualVolume: allocated,
      utilizationBeforePct: before,
    });
    upsert.push({
      id: row.id ?? null,
      site: row.site,
      lineAsset: row.lineAsset?.trim() || null,
      assumedEffectivenessPct: effectiveness,
      cycleTimeS: cycle,
      utilizationBeforePct: before,
      allocatedAnnualVolume: allocated,
      scheduledRunDaysPerYear: runDays,
      utilizationAfterPct: calc.ok ? storedUtilizationPct(calc.utilizationAfterPct) : null,
      analysisDate: row.analysisDate,
      analystId: row.analystId,
      notes: row.notes?.trim() || null,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    upsert,
    deleteIds: stored.filter((r) => !seen.has(r.id)).map((r) => r.id),
    allocationWarning: allocationCheck(upsert, context.quoteAnnualVolume),
  };
}

// ── Completeness (queue warnings) ────────────────────────────────────────────────────────────────

/**
 * What Engineering may have to chase on a quote: the intake's own warnings (no drawing, round
 * placeholder volume, empty fields), without the request-class note (that is G1's concern).
 */
export function engineeringCompleteness(values: FieldValues, config: IntakeConfig): IntakeIssue[] {
  const { blocking, warnings } = evaluateIntake(values, config);
  return [...blocking, ...warnings].filter((w) => w.code !== 'REQUEST_CLASS_REDIRECT');
}

// ── B-26: the capacity owner's G2 sign-off (deck slide 11) ────────────────────────────────────────

export const CAPACITY_SIGNOFF_STATUSES = ['approved', 'blocked'] as const;
export type CapacitySignoffStatus = (typeof CAPACITY_SIGNOFF_STATUSES)[number];

export type CapacitySignoffPlan =
  | { ok: true; status: CapacitySignoffStatus | null; note: string | null }
  | { ok: false; errors: DomainError[] };

/**
 * Record (or clear, `status: null`) the capacity owner's sign-off while the quote is in Engineering
 * Review. Needs `capacity.signoff` (seeded to the EngLead; the capacity owner is D-07). Blocking needs a
 * note saying why; a block stops every G2 Advance until it is changed or escalated.
 */
export function planCapacitySignoff(
  actor: Actor,
  quote: EngQuote,
  input: { status: string | null; note?: string | null | undefined },
): CapacitySignoffPlan {
  if (!can(actor, 'capacity.signoff', quote)) {
    return {
      ok: false,
      errors: [new DomainError('NOT_PERMITTED', 'Only the capacity owner signs off capacity')],
    };
  }
  const errors = stageErrors(quote);
  const status =
    input.status === null ? null : CAPACITY_SIGNOFF_STATUSES.find((s) => s === input.status);
  if (status === undefined) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Sign-off must be one of: ${CAPACITY_SIGNOFF_STATUSES.join(', ')}`,
        'status',
      ),
    );
  }
  const note = input.note?.trim() || null;
  if (status === 'blocked' && !note) {
    errors.push(new DomainError('NOTE_REQUIRED', 'Say why capacity is blocked', 'note'));
  }
  if (note && note.length > 2000) {
    errors.push(new DomainError('INVALID_VALUE', 'Keep the note to 2000 characters', 'note'));
  }
  if (errors.length > 0 || status === undefined) return { ok: false, errors };
  return { ok: true, status, note };
}
