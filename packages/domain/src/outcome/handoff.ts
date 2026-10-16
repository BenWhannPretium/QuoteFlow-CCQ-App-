import { DomainError } from '../errors';
import { AWARDED_STAGE_KEY } from './report';
import { proposalCalendarDate } from '../final-review/release';

/**
 * The minimal Awarded hand-off record (B-13, Stage 6, CR-41/42). It records who the award was handed
 * to and the system references they need, as links only: the CER ID (Apex) and the BPR ID (price
 * implementation). No integration (CER/BPR integration is Scale, after the capital-system redesign).
 * Shown on AWARDED quotes; editable by `handoff.edit` (the KAM on their own quotes, SalesLeader, Admin).
 */

/** Acceptance evidence (also the G5 Awarded reason codes, context `awarded`; DB CHECK on handoff_record). */
export const ACCEPTANCE_EVIDENCE_TYPES = ['verbal', 'po', 'loi', 'contract'] as const;
export type AcceptanceEvidence = (typeof ACCEPTANCE_EVIDENCE_TYPES)[number];

export interface ReceivingRoleOption {
  code: string;
  label: string;
}

/**
 * `app_setting.handoff_receiving_roles` seed (provisional: confirm with Amanda Cronkhite, who owns
 * Commercial Activation from 10/26, at R3). `other` asks for the team's name.
 */
export const HANDOFF_RECEIVING_ROLES_SEED: readonly ReceivingRoleOption[] = [
  { code: 'commercial_activation', label: 'Commercial Activation' },
  { code: 'npi_post_award_pm', label: 'NPI post-award technical PM' },
  { code: 'other', label: 'Other' },
];
export const OTHER_RECEIVING_ROLE = 'other';

export function parseReceivingRoles(input: unknown): ReceivingRoleOption[] {
  if (input === undefined || input === null) return [...HANDOFF_RECEIVING_ROLES_SEED];
  const ok =
    Array.isArray(input) &&
    input.length > 0 &&
    input.every(
      (r: unknown) =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as ReceivingRoleOption).code === 'string' &&
        (r as ReceivingRoleOption).code.length > 0 &&
        typeof (r as ReceivingRoleOption).label === 'string',
    );
  if (!ok) {
    throw new DomainError(
      'INVALID_CONFIG',
      'handoff_receiving_roles must be a non-empty list of { code, label }',
    );
  }
  return (input as ReceivingRoleOption[]).map((r) => ({ code: r.code, label: r.label }));
}

export interface HandoffValues {
  acceptanceEvidence: AcceptanceEvidence;
  /** When the customer accepted (`YYYY-MM-DD`), from the Awarded decision. */
  acceptanceDate: string | null;
  acceptanceDocumentUrl: string | null;
  cerId: string | null;
  bprId: string | null;
  receivingRole: string | null;
  receivingRoleOther: string | null;
  receivingContactName: string | null;
  /** The date the receiving team accepted the hand-off (`YYYY-MM-DD`). */
  acceptedOn: string | null;
  notes: string | null;
  completedAt: Date | null;
  completedBy: string | null;
}

/** A PUT body: only the keys sent change; `null` clears an optional field. */
export interface HandoffInput {
  acceptanceEvidence?: string | undefined;
  acceptanceDate?: string | null | undefined;
  acceptanceDocumentUrl?: string | null | undefined;
  cerId?: string | null | undefined;
  bprId?: string | null | undefined;
  receivingRole?: string | null | undefined;
  receivingRoleOther?: string | null | undefined;
  receivingContactName?: string | null | undefined;
  acceptedOn?: string | null | undefined;
  notes?: string | null | undefined;
  /** The "Hand-off complete" checkbox: true records who confirmed it and when; false re-opens it. */
  complete?: boolean | undefined;
}

export type HandoffPlan =
  | {
      ok: true;
      values: HandoffValues;
      /** Field names that changed (for the timeline; never values). */
      changed: string[];
      completion: 'completed' | 'reopened' | null;
    }
  | { ok: false; errors: DomainError[] };

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

/** An http(s) link, or the errors for it. */
export function documentUrlErrors(url: string | null, field: string): DomainError[] {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return [];
  } catch {
    // fall through
  }
  return [new DomainError('INVALID_VALUE', 'The document link must be an http(s) URL', field)];
}

/** A calendar date that is not after today (US Central). */
export function pastDateErrors(
  date: string | null | undefined,
  now: Date,
  field: string,
  what: string,
): DomainError[] {
  if (!date) return [];
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return [new DomainError('INVALID_VALUE', `${what} is not a valid date`, field)];
  }
  if (date > proposalCalendarDate(now)) {
    return [new DomainError('INVALID_VALUE', `${what} cannot be in the future`, field)];
  }
  return [];
}

/**
 * The checks on a G5 Awarded decision's own fields (the engine checks the evidence type, as the
 * reason code, and that an acceptance date is present): the date is real and not in the future, and the
 * optional document link is an http(s) URL.
 */
export function awardDetailErrors(
  input: { acceptedAt?: string | null; acceptanceDocumentUrl?: string | null },
  now: Date,
): DomainError[] {
  return [
    ...pastDateErrors(input.acceptedAt, now, 'acceptedAt', 'The acceptance date'),
    ...documentUrlErrors(input.acceptanceDocumentUrl ?? null, 'acceptanceDocumentUrl'),
  ];
}

/** The record an Awarded decision opens with: the evidence type (its reason code), date and link. */
export function handoffFromAward(input: {
  reasonCode: string | null;
  acceptedAt: string | null;
  acceptanceDocumentUrl: string | null;
}): HandoffValues | null {
  const evidence = ACCEPTANCE_EVIDENCE_TYPES.find((t) => t === input.reasonCode);
  if (!evidence) return null;
  return {
    acceptanceEvidence: evidence,
    acceptanceDate: input.acceptedAt,
    acceptanceDocumentUrl: input.acceptanceDocumentUrl,
    cerId: null,
    bprId: null,
    receivingRole: null,
    receivingRoleOther: null,
    receivingContactName: null,
    acceptedOn: null,
    notes: null,
    completedAt: null,
    completedBy: null,
  };
}

/**
 * Apply a hand-off edit. Only on an AWARDED quote. Marking it complete needs the evidence, the
 * receiving role (and the team's name for "other"), the receiving contact and the accepted-by date; the
 * CER and BPR IDs may not exist yet, so they are optional.
 */
export function planHandoff(input: {
  stageKey: string;
  current: HandoffValues | null;
  edit: HandoffInput;
  actorId: string;
  now: Date;
  receivingRoles: readonly ReceivingRoleOption[];
}): HandoffPlan {
  const { current, edit, now } = input;
  const errors: DomainError[] = [];
  if (input.stageKey !== AWARDED_STAGE_KEY) {
    return {
      ok: false,
      errors: [new DomainError('NOT_AWARDED', 'A hand-off is recorded only on an awarded quote')],
    };
  }

  const evidence =
    edit.acceptanceEvidence !== undefined
      ? ACCEPTANCE_EVIDENCE_TYPES.find((t) => t === edit.acceptanceEvidence)
      : current?.acceptanceEvidence;
  if (!evidence) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Acceptance evidence must be one of: ${ACCEPTANCE_EVIDENCE_TYPES.join(', ')}`,
        'acceptanceEvidence',
      ),
    );
  }

  const pick = <K extends keyof HandoffValues>(key: K, value: HandoffValues[K] | undefined) =>
    value === undefined ? (current?.[key] ?? null) : value;
  const next: Omit<HandoffValues, 'acceptanceEvidence' | 'completedAt' | 'completedBy'> = {
    acceptanceDate: pick('acceptanceDate', clean(edit.acceptanceDate)),
    acceptanceDocumentUrl: pick('acceptanceDocumentUrl', clean(edit.acceptanceDocumentUrl)),
    cerId: pick('cerId', clean(edit.cerId)),
    bprId: pick('bprId', clean(edit.bprId)),
    receivingRole: pick('receivingRole', clean(edit.receivingRole)),
    receivingRoleOther: pick('receivingRoleOther', clean(edit.receivingRoleOther)),
    receivingContactName: pick('receivingContactName', clean(edit.receivingContactName)),
    acceptedOn: pick('acceptedOn', clean(edit.acceptedOn)),
    notes: pick('notes', clean(edit.notes)),
  };
  if (next.receivingRole !== OTHER_RECEIVING_ROLE) next.receivingRoleOther = null;

  for (const [field, label] of [
    ['cerId', 'The CER ID'],
    ['bprId', 'The BPR ID'],
  ] as const) {
    const v = next[field];
    if (v && !REFERENCE.test(v)) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `${label} may hold letters, digits and . _ / # - (up to 64 characters)`,
          field,
        ),
      );
    }
  }
  if (next.receivingRole && !input.receivingRoles.some((r) => r.code === next.receivingRole)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Receiving role must be one of: ${input.receivingRoles.map((r) => r.code).join(', ')}`,
        'receivingRole',
      ),
    );
  }
  errors.push(
    ...pastDateErrors(next.acceptanceDate, now, 'acceptanceDate', 'The acceptance date'),
    ...pastDateErrors(next.acceptedOn, now, 'acceptedOn', 'The accepted-by date'),
    ...documentUrlErrors(next.acceptanceDocumentUrl, 'acceptanceDocumentUrl'),
  );

  const wasComplete = !!current?.completedAt;
  const complete = edit.complete ?? wasComplete;
  if (complete) {
    const missing: [keyof typeof next, string][] = [
      ['receivingRole', 'the receiving role'],
      ['receivingContactName', 'the receiving contact'],
      ['acceptedOn', 'the accepted-by date'],
    ];
    if (next.receivingRole === OTHER_RECEIVING_ROLE)
      missing.push(['receivingRoleOther', 'the receiving team']);
    for (const [field, what] of missing) {
      if (!next[field]) {
        errors.push(
          new DomainError('MISSING_FIELD', `Hand-off complete needs ${what}`, String(field)),
        );
      }
    }
  }
  if (errors.length > 0 || !evidence) return { ok: false, errors };

  const values: HandoffValues = {
    acceptanceEvidence: evidence,
    ...next,
    completedAt: complete ? (wasComplete ? current.completedAt : now) : null,
    completedBy: complete ? (wasComplete ? current.completedBy : input.actorId) : null,
  };
  const changed = (Object.keys(values) as (keyof HandoffValues)[]).filter((k) => {
    if (k === 'completedAt' || k === 'completedBy') return false;
    const before = current?.[k] ?? null;
    return before !== values[k];
  });
  const completion =
    complete && !wasComplete ? 'completed' : !complete && wasComplete ? 'reopened' : null;
  return { ok: true, values, changed, completion };
}
