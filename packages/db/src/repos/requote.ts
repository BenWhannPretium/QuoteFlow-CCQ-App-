import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { appUser, gateDecision, quote, quoteDraft } from '../schema/index';

/**
 * FB-26 (N17-30, N17-31): the linked re-quote (`quote.requoted_from_quote_id`,
 * `quote_draft.requote_of_quote_id`) and the sales leader who qualified a quote. Row-level security
 * applies as for every repo: a caller who cannot read a quote gets nothing back. The API reads the
 * link's quote NUMBER in system context so a reader of one quote still sees the other's number.
 */

/** The linked re-quote created from this quote (its number and when), if any. */
export async function getRequoteOf(db: DbOrTx, oldQuoteId: string) {
  const [row] = await db
    .select({ id: quote.id, quoteNumber: quote.quoteNumber, createdAt: quote.createdAt })
    .from(quote)
    .where(eq(quote.requotedFromQuoteId, oldQuoteId))
    .limit(1);
  return row;
}

/** The open (not submitted) linked re-quote draft of this quote, with its owner's name. */
export async function getOpenRequoteDraft(db: DbOrTx, oldQuoteId: string) {
  const [row] = await db
    .select({
      id: quoteDraft.id,
      ownerUserId: quoteDraft.ownerUserId,
      ownerName: appUser.displayName,
      createdAt: quoteDraft.createdAt,
    })
    .from(quoteDraft)
    .leftJoin(appUser, eq(appUser.id, quoteDraft.ownerUserId))
    .where(and(eq(quoteDraft.requoteOfQuoteId, oldQuoteId), isNull(quoteDraft.submittedQuoteId)))
    .limit(1);
  return row;
}

/** Quote numbers (and the dates a link reads) by id. */
export async function getQuoteLinkInfo(db: DbOrTx, quoteId: string) {
  const [row] = await db
    .select({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      kamUserId: quote.kamUserId,
      createdAt: quote.createdAt,
      closedAt: quote.closedAt,
      validityUntil: quote.validityUntil,
    })
    .from(quote)
    .where(eq(quote.id, quoteId))
    .limit(1);
  return row;
}

/**
 * N17-31: the person who made each quote's latest G1 Advance (the sales leader who qualified it). A quote
 * whose G1 was skipped or routed automatically has none.
 */
export async function latestG1AdvanceDeciders(
  db: DbOrTx,
  quoteIds: readonly string[],
): Promise<Map<string, string>> {
  if (quoteIds.length === 0) return new Map();
  const rows = await db
    .select({ quoteId: gateDecision.quoteId, decidedBy: gateDecision.decidedBy })
    .from(gateDecision)
    .where(
      and(
        inArray(gateDecision.quoteId, [...quoteIds]),
        eq(gateDecision.gateKey, 'G1'),
        eq(gateDecision.outcomeKey, 'advance'),
      ),
    )
    .orderBy(desc(gateDecision.decidedAt));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.quoteId)) out.set(r.quoteId, r.decidedBy);
  return out;
}

/** N17-31: whether this user has ever decided G1 (a sales leader with none sees every expiring quote). */
export async function hasDecidedG1(db: DbOrTx, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: gateDecision.id })
    .from(gateDecision)
    .where(and(eq(gateDecision.gateKey, 'G1'), eq(gateDecision.decidedBy, userId)))
    .limit(1);
  return row !== undefined;
}
