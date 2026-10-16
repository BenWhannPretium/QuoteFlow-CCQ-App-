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
