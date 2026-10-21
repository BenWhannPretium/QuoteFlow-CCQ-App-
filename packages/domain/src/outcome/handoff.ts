import { DomainError } from '../errors';
import { AWARDED_STAGE_KEY, COMMIT_STAGE_KEY } from './report';
import { proposalCalendarDate } from '../final-review/release';

/**
 * The hand-off record (B-13, CR-41/42; B-26 Stage 6, Commit & Hand Off). An award (G5) opens it; G6
 * closes the quote Won only when the CER is approved (or not required) and the receiving team accepted
 * the hand-off. It records who the award was handed to and the CER as a reference only: the CER ID
 * (Apex), its status and approval date. No integration (CER integration is Scale, after the
 * capital-system redesign). B-26: no BPR ID; BPR is outside CCQ (the old column is kept for history).
 * Editable in Commit & Hand Off, and on Closed – Won quotes awarded before B-26, by `handoff.edit` (the
 * KAM on their own quotes, SalesLeader, Admin).
 */

/** B-26 (G6a): where the CER stands, per the official CER matrix (matrix TBD, D-26). */
export const CER_STATUSES = ['pending', 'approved', 'not_approved', 'not_required'] as const;
export type CerStatus = (typeof CER_STATUSES)[number];

/** The stages a hand-off can be edited in. */
export const HANDOFF_STAGE_KEYS: readonly string[] = [COMMIT_STAGE_KEY, AWARDED_STAGE_KEY];

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
  /** B-26: the CER's status and, when approved, the approval date (`YYYY-MM-DD`). */
  cerStatus: CerStatus;
  cerApprovedOn: string | null;
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
  cerStatus?: string | undefined;
  cerApprovedOn?: string | null | undefined;
  receivingRole?: string | null | undefined;
  receivingRoleOther?: string | null | undefined;
  receivingContactName?: string | null | undefined;
  acceptedOn?: string | null | undefined;
  notes?: string | null | undefined;
  /**
   * The "Hand-off accepted" checkbox (G6b): true records who confirmed the receiving team accepted it,
   * and when; false re-opens it.
   */
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
    cerStatus: 'pending',
    cerApprovedOn: null,
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
 * Apply a hand-off edit. Only in Commit & Hand Off (or on a Closed – Won quote). Marking it accepted
 * needs the evidence, the receiving role (and the team's name for "other"), the receiving contact and the
 * accepted-by date. B-26: a CER marked approved needs its ID and approval date; the ID may not exist yet
 * while the CER is pending.
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
  if (!HANDOFF_STAGE_KEYS.includes(input.stageKey)) {
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
  const next: Omit<
    HandoffValues,
    'acceptanceEvidence' | 'cerStatus' | 'completedAt' | 'completedBy'
  > = {
    acceptanceDate: pick('acceptanceDate', clean(edit.acceptanceDate)),
    acceptanceDocumentUrl: pick('acceptanceDocumentUrl', clean(edit.acceptanceDocumentUrl)),
    cerId: pick('cerId', clean(edit.cerId)),
    cerApprovedOn: pick('cerApprovedOn', clean(edit.cerApprovedOn)),
    receivingRole: pick('receivingRole', clean(edit.receivingRole)),
    receivingRoleOther: pick('receivingRoleOther', clean(edit.receivingRoleOther)),
    receivingContactName: pick('receivingContactName', clean(edit.receivingContactName)),
    acceptedOn: pick('acceptedOn', clean(edit.acceptedOn)),
    notes: pick('notes', clean(edit.notes)),
  };
  if (next.receivingRole !== OTHER_RECEIVING_ROLE) next.receivingRoleOther = null;

  if (next.cerId && !REFERENCE.test(next.cerId)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        'The CER ID may hold letters, digits and . _ / # - (up to 64 characters)',
        'cerId',
      ),
    );
  }
  const cerStatus =
    edit.cerStatus !== undefined
      ? CER_STATUSES.find((c) => c === edit.cerStatus)
      : (current?.cerStatus ?? 'pending');
  if (!cerStatus) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `CER status must be one of: ${CER_STATUSES.join(', ')}`,
        'cerStatus',
      ),
    );
  } else if (cerStatus === 'approved') {
    if (!next.cerId) {
      errors.push(new DomainError('MISSING_FIELD', 'An approved CER needs its CER ID', 'cerId'));
    }
    if (!next.cerApprovedOn) {
      errors.push(
        new DomainError(
          'MISSING_FIELD',
          'An approved CER needs its approval date',
          'cerApprovedOn',
        ),
      );
    }
  } else {
    next.cerApprovedOn = null;
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
    ...pastDateErrors(next.cerApprovedOn, now, 'cerApprovedOn', 'The CER approval date'),
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
          new DomainError('MISSING_FIELD', `Hand-off accepted needs ${what}`, String(field)),
        );
      }
    }
  }
  if (errors.length > 0 || !evidence || !cerStatus) return { ok: false, errors };

  const values: HandoffValues = {
    acceptanceEvidence: evidence,
    ...next,
    cerStatus,
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
