import { DomainError } from '../errors';
import { isValidityLapsed } from './validity';
import { CUSTOMER_DECISION_STAGE_KEY } from '../final-review/release';

/**
 * FB-26 (N17-30, Bailey Schmitt and Ben Whann): a **linked re-quote** of an expired quote. Once a
 * proposal has expired, the customer's late "yes" gets a new quote with its own record, linked to the old
 * one (`quote.requoted_from_quote_id`), pre-filled from what the KAM entered, and reviewed again by
 * Engineering, Pricing and Final Review. The old quote keeps what was quoted. Within the validity window
 * the G5 / G6 "Re-quote" outcome (a new version of the same quote) is unchanged.
 *
 * Pure: the caller passes the quote, the setting and the clock.
 */

/** The stage a quote closes in after G5 "No response / Expired". */
export const EXPIRED_STAGE_KEY = 'EXPIRED';

/**
 * Where a linked re-quote may start from (`app_setting.linked_requote_allowed_from`, provisional):
 * `closed_expired` (closed as "No response / Expired") and `open_lapsed` (open at Customer Decision with
 * its validity date passed: the action records G5 "No response / Expired" first).
 */
export const LINKED_REQUOTE_STATES = ['closed_expired', 'open_lapsed'] as const;
export type LinkedRequoteState = (typeof LINKED_REQUOTE_STATES)[number];

export const LINKED_REQUOTE_ALLOWED_FROM_SEED: readonly LinkedRequoteState[] = [
  'closed_expired',
  'open_lapsed',
];

/** The note the action needs (why the late "yes" is re-quoted): 1 to 1,000 characters. */
export const REQUOTE_NOTE_MAX_LENGTH = 1000;

/** `app_setting.linked_requote_allowed_from`: a list of states without repeats (empty = switched off). */
export function parseLinkedRequoteAllowedFrom(input: unknown): LinkedRequoteState[] {
  if (input === undefined || input === null) return [...LINKED_REQUOTE_ALLOWED_FROM_SEED];
  if (
    !Array.isArray(input) ||
    !input.every((s) => (LINKED_REQUOTE_STATES as readonly unknown[]).includes(s)) ||
    new Set(input).size !== input.length
  ) {
    throw new DomainError(
      'INVALID_CONFIG',
      `linked_requote_allowed_from must list some of: ${LINKED_REQUOTE_STATES.join(', ')} (each once)`,
    );
  }
  return input as LinkedRequoteState[];
}

/** The slice of the old quote the rule reads. */
export interface RequoteCandidate {
  stageKey: string;
  status: string;
  validityUntil: string | null;
  /** The quote's own linked re-quote (its number), when one was already created. */
  requotedAsNumber: string | null;
}

export type RequoteEligibility =
  | {
      ok: true;
      /** `closed_expired`: the draft only. `open_lapsed`: record G5 "No response / Expired" first. */
      from: LinkedRequoteState;
    }
  | {
      ok: false;
      code: 'already_requoted' | 'requote_not_allowed';
      message: string;
    };

/** Whether a linked re-quote may start from this quote now, and how. */
export function linkedRequoteEligibility(
  q: RequoteCandidate,
  allowedFrom: readonly LinkedRequoteState[],
  now: Date,
): RequoteEligibility {
  if (q.requotedAsNumber) {
    return {
      ok: false,
      code: 'already_requoted',
      message: `This quote was already re-quoted as ${q.requotedAsNumber}`,
    };
  }
  const closedExpired = q.status === 'closed' && q.stageKey === EXPIRED_STAGE_KEY;
  const openLapsed =
    q.stageKey === CUSTOMER_DECISION_STAGE_KEY &&
    q.status === 'active' &&
    isValidityLapsed(q.validityUntil, now);
  if (closedExpired && allowedFrom.includes('closed_expired')) {
    return { ok: true, from: 'closed_expired' };
  }
  if (openLapsed && allowedFrom.includes('open_lapsed')) {
    return { ok: true, from: 'open_lapsed' };
  }
  const why = closedExpired
    ? 'A linked re-quote from a closed expired quote is switched off'
    : openLapsed
      ? 'A linked re-quote from an open expired quote is switched off'
      : q.stageKey === CUSTOMER_DECISION_STAGE_KEY && q.status !== 'closed'
        ? q.status === 'active'
          ? 'The offer is still valid: use "Re-quote" in the customer decision instead'
          : 'Take the quote off hold first'
        : 'A linked re-quote starts only from a quote whose offer has expired';
  return { ok: false, code: 'requote_not_allowed', message: why };
}

/**
 * What a linked re-quote copies from the old quote's last submitted intake (request level). Everything
 * the intake asks the KAM, except the "quote needed by" date (a new request has a new date) and the
 * "separate quote" confirmation (a re-quote shows no one-active-quote warning). The items are copied
 * separately (product fields, drawings as links). Engineering, capacity, pricing, the models, the
 * commercial terms and every decision are never copied: they are reviewed again.
 */
export const REQUOTE_COPIED_FIELDS = [
  'sfOpportunityId',
  'sfOpportunityName',
  'sfProductSpecs',
  'sfProductSpecsStatus',
  'customer',
  'market',
  'subMarket',
  'description',
  'quoteVariantsNote',
  'rfpLink',
  'requestedPaymentTerms',
  'requestedPaymentTermsOther',
  'toolingFundingModel',
  'customerSharePct',
  'returnableDunnage',
  'toolingCommitment',
  'stockHoldRequested',
  'stockHoldWeeks',
  'stockHoldNote',
  'priceBasis',
  'freightType',
  'freightSpecialArrangements',
  'bidReference',
  'requestClass',
  'conceptAssumptions',
  'estAnnualRevenue',
  'estAnnualRevenueSf',
  'commentsForEngineering',
  'shipTo',
  'shipToDefault',
  'shipToOverrideReason',
] as const;

/** Request-level fields a linked re-quote leaves empty. */
export const REQUOTE_NOT_COPIED_FIELDS = ['quoteNeededBy', 'separateQuoteConfirmed'] as const;

/**
 * The request-level part of the new draft: only `REQUOTE_COPIED_FIELDS`, and only the ones the old
 * intake holds. Anything else in the old draft (a field added later, a stale key) is left behind.
 */
export function requoteRequestFields(old: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REQUOTE_COPIED_FIELDS) {
    if (old[key] !== undefined) out[key] = old[key];
  }
  return out;
}

/** An old item as the copy plan reads it: its key (the old quote item id), fields and drawings. */
export interface RequoteSourceItem {
  key: string;
  /** The drawings the old item held (`attachment.quote_item_id` = its id, or none for item 1). */
  ownDrawingIds: readonly string[];
  /** The drawings it linked to (FB-19 Duplicate). */
  linkedDrawingIds: readonly string[];
  fields: Record<string, unknown>;
}

/**
 * The new draft's items: each old item's product fields under a new key (from `newKey`), linking to every
 * drawing the old item held or linked to (FB-19's way, nothing copied). Keys from the old quote never
 * reach the new draft, so the new quote's items are new rows.
 */
export function requoteItems(
  items: readonly RequoteSourceItem[],
  newKey: () => string,
): Record<string, unknown>[] {
  return items.map((item) => {
    const {
      key: _old,
      linkedDrawingIds: _l,
      duplicatedFrom: _d,
      ...fields
    } = item.fields as Record<string, unknown> & {
      key?: unknown;
      linkedDrawingIds?: unknown;
      duplicatedFrom?: unknown;
    };
    const drawings = [...new Set([...item.ownDrawingIds, ...item.linkedDrawingIds])];
    return {
      ...fields,
      key: newKey(),
      ...(drawings.length > 0 ? { linkedDrawingIds: drawings } : {}),
    };
  });
}

/** What the new draft says at the top. */
export function requoteBanner(oldQuoteNumber: string, expiredOn: string | null): string {
  return `Re-quote of ${oldQuoteNumber}${expiredOn ? ` (expired ${expiredOn})` : ''}. Check every value; Engineering and Pricing will review it again.`;
}

// ── N17-31: who hears about an expiring or expired proposal ─────────────────────────────────────

/** `kam`: the quote's KAM. `g1_decider`: the person who made its latest G1 Advance (the sales leader). */
export const VALIDITY_NOTICE_RECIPIENTS = ['kam', 'g1_decider'] as const;
export type ValidityNoticeRecipient = (typeof VALIDITY_NOTICE_RECIPIENTS)[number];

export const VALIDITY_NOTICE_RECIPIENTS_SEED: readonly ValidityNoticeRecipient[] = [
  'kam',
  'g1_decider',
];

/** `app_setting.validity_notice_recipients`: some of `kam`, `g1_decider`, each once (empty = no one). */
export function parseValidityNoticeRecipients(input: unknown): ValidityNoticeRecipient[] {
  if (input === undefined || input === null) return [...VALIDITY_NOTICE_RECIPIENTS_SEED];
  if (
    !Array.isArray(input) ||
    !input.every((s) => (VALIDITY_NOTICE_RECIPIENTS as readonly unknown[]).includes(s)) ||
    new Set(input).size !== input.length
  ) {
    throw new DomainError(
      'INVALID_CONFIG',
      `validity_notice_recipients must list some of: ${VALIDITY_NOTICE_RECIPIENTS.join(', ')} (each once)`,
    );
  }
  return input as ValidityNoticeRecipient[];
}

/** The user ids to tell, without repeats (a KAM who also qualified it is told once). */
export function validityNoticeUserIds(
  people: { kamUserId: string; g1DeciderId: string | null },
  recipients: readonly ValidityNoticeRecipient[],
): string[] {
  const ids: string[] = [];
  if (recipients.includes('kam')) ids.push(people.kamUserId);
  if (recipients.includes('g1_decider') && people.g1DeciderId) ids.push(people.g1DeciderId);
  return [...new Set(ids)];
}

// ── N17-32: the CER at hand-off ─────────────────────────────────────────────────────────────────

/** `cer_tool_url` / `cer_template_url`: `''` (not set) or an https URL. Returns the trimmed value. */
export function parseCerLinkUrl(input: unknown, key = 'cer_tool_url'): string {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string') {
    throw new DomainError('INVALID_CONFIG', `${key} must be empty or an https URL`);
  }
  const value = input.trim();
  if (value === '') return '';
  try {
    if (new URL(value).protocol === 'https:') return value;
  } catch {
    // fall through
  }
  throw new DomainError('INVALID_CONFIG', `${key} must be empty or an https URL`);
}

/**
 * Whether G6 Advance may go ahead as far as the CER proof goes (`cer_proof_ok`): with
 * `handoff_cer_proof_required` on, a CER marked Approved needs a current `cer_proof` file. Off (the seed),
 * or a CER that is not Approved: always true.
 */
export function cerProofOk(input: {
  required: boolean;
  cerStatus: string | null | undefined;
  proofOnFile: boolean;
}): boolean {
  return !(input.required && input.cerStatus === 'approved' && !input.proofOnFile);
}
