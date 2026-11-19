import type { QuoteRequoteLinks } from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  getOpenRequoteDraft,
  getQuoteLinkInfo,
  getRequoteOf,
  getSetting,
  loadQuoteState,
  type Quote,
} from '@ccq/db/repos';
import {
  can,
  linkedRequoteEligibility,
  parseLinkedRequoteAllowedFrom,
  type Actor,
  type LinkedRequoteState,
} from '@ccq/domain';

/** FB-26 (N17-30): the linked re-quote as the quote detail reads it (no service dependencies). */

type SystemTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export async function allowedFrom(db: DbOrTx): Promise<LinkedRequoteState[]> {
  try {
    return parseLinkedRequoteAllowedFrom(await getSetting(db, 'linked_requote_allowed_from'));
  } catch {
    // A malformed setting switches the action off rather than guessing.
    return [];
  }
}

/**
 * `QuoteDetail.requote`: both ends of the link and whether the caller may start one. The other quote's
 * number is read in system context (number and date only) when RLS hides it; `readable` says which.
 */
export async function requoteLinks(
  db: DbOrTx,
  systemTx: SystemTx | undefined,
  actor: Actor,
  q: Quote,
  now: Date,
): Promise<QuoteRequoteLinks> {
  const sys = <T>(read: (d: DbOrTx) => Promise<T>) => (systemTx ? systemTx(read) : read(db));
  let requoteOf: QuoteRequoteLinks['requoteOf'] = null;
  if (q.requotedFromQuoteId) {
    const id = q.requotedFromQuoteId;
    const mine = await getQuoteLinkInfo(db, id);
    const old = mine ?? (await sys((d) => getQuoteLinkInfo(d, id)));
    if (old) {
      requoteOf = { quoteNumber: old.quoteNumber, readable: Boolean(mine), at: old.validityUntil };
    }
  }
  // Only a quote that can have been re-quoted is looked up (an expired one, or one at Customer Decision).
  const mayHaveRequote = q.stageKey === 'EXPIRED' || q.stageKey === 'CUSTOMER_DECISION';
  let requotedAs: QuoteRequoteLinks['requotedAs'] = null;
  let draft: QuoteRequoteLinks['draft'] = null;
  if (mayHaveRequote) {
    const visible = await getRequoteOf(db, q.id);
    const child = visible ?? (await sys((d) => getRequoteOf(d, q.id)));
    if (child) {
      requotedAs = {
        quoteNumber: child.quoteNumber,
        readable: Boolean(visible),
        at: child.createdAt.toISOString(),
      };
    } else {
      const open = await sys((d) => getOpenRequoteDraft(d, q.id));
      if (open) {
        draft = {
          startedAt: open.createdAt.toISOString(),
          ownerName: open.ownerName ?? null,
          draftId: open.ownerUserId === actor.userId ? open.id : null,
        };
      }
    }
  }
  const state = await loadQuoteState(db, q.id);
  const eligibility = linkedRequoteEligibility(
    {
      stageKey: q.stageKey,
      status: q.status,
      validityUntil: q.validityUntil,
      requotedAsNumber: requotedAs?.quoteNumber ?? null,
    },
    mayHaveRequote ? await allowedFrom(db) : [],
    now,
  );
  return {
    requoteOf,
    requotedAs,
    draft,
    canStart:
      eligibility.ok && draft === null && state !== undefined && can(actor, 'quote.requote', state),
    startFrom: eligibility.ok ? eligibility.from : null,
  };
}
