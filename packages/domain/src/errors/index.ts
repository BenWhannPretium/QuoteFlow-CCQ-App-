export const DOMAIN_ERROR_CODES = [
  'WRONG_STAGE',
  'NOT_PERMITTED',
  'SEGREGATION',
  'MISSING_FIELD',
  'NOTE_REQUIRED',
  'REASON_REQUIRED',
  'INVALID_REASON',
  'TARGET_REQUIRED',
  'INVALID_TARGET',
  'UNKNOWN_GATE',
  'UNKNOWN_OUTCOME',
  'GATE_DISABLED',
  'QUOTE_CLOSED',
  'INVALID_QUOTE_NUMBER',
  'INVALID_CONFIG',
  // B-09 governed overrides
  'NOT_OVERRIDABLE',
  'JUSTIFICATION_REQUIRED',
  'INVALID_VALUE',
  'NO_CHANGE',
  'OVERRIDE_PENDING',
  'INVALID_STATE',
  'STALE_VALUE',
  // B-10 engineering queue
  'INVALID_ASSIGNEE',
  'ALREADY_ACCEPTED',
  // B-12 Final Review
  'TIER_APPROVER_REQUIRED',
  'INVALID_PROPOSAL_DATE',
  // B-13 customer decision and closure
  'CLOSURE_INCOMPLETE',
  'INVALID_CLOSURE_OWNER',
  'NOT_AWARDED',
  // B-26: an escalation type with nobody configured to receive it.
  'NO_RECIPIENTS',
  // Lead review (2026-10-30): the assignee submits their part to the lead, who may send it back.
  'ALREADY_SUBMITTED',
  'NOT_SUBMITTED',
  'LOCKED_FOR_REVIEW',
  // FB-01 (F-001): the section's gate was decided; only a send-back reopens it.
  'SECTION_LOCKED',
  // FB-01 (F-030): the KAM must say whether the scope changed before a rework goes back to its origin.
  'SCOPE_CHANGE_REQUIRED',
  // FB-01 (F-069): the warnings the approver acknowledged are not the ones on the quote now.
  'STALE_WARNINGS',
  // FB-07 (D-001): costing, then ROI, then price confirmation inside Quoting.
  'COST_MODEL_REQUIRED',
  'COSTING_FIRST',
  'ROI_NOT_REQUIRED',
  // FB-08 (T-007): the PricingLead decides only a pending payment-terms exception.
  'NO_PENDING_EXCEPTION',
  // FB-08 (F-082, off): extra Final Review sign-offs, given in order, once per quote version.
  'ADDITIONAL_APPROVAL_REQUIRED',
  'ALREADY_SIGNED',
  'OUT_OF_ORDER',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** A business-rule failure. Rule evaluation returns these as values; policy assertions throw them. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly field: string | undefined;

  constructor(code: DomainErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.field = field;
  }
}

/** Thrown by `assertCan`. The API maps it to HTTP 403. */
export class ForbiddenError extends DomainError {
  readonly permission: string;

  constructor(permission: string, message?: string) {
    super('NOT_PERMITTED', message ?? `Not permitted: ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}
