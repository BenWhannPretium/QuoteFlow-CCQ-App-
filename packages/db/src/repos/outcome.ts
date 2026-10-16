import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { quote } from '../schema/index';

/**
 * B-13 reads for the customer decision: the expiry job's candidates and the outcomes report rows.
 * Rows only; the domain decides what is lapsed, captured or complete.
 */

/** Open quotes in `stageKey` with a validity date that the expiry job has not flagged yet. */
export function listUnflaggedValidityQuotes(db: DbOrTx, stageKey: string) {
  return db
    .select({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      stageKey: quote.stageKey,
      status: quote.status,
      kamUserId: quote.kamUserId,
      validityUntil: quote.validityUntil,
      validityExpiredFlaggedAt: quote.validityExpiredFlaggedAt,
    })
    .from(quote)
    .where(
      and(
        eq(quote.stageKey, stageKey),
        ne(quote.status, 'closed'),
        isNotNull(quote.validityUntil),
        isNull(quote.validityExpiredFlaggedAt),
      ),
    );
}

/** Every quote's closure and proposal columns (RLS applies: the caller's scope). */
export function listOutcomeReportRows(db: DbOrTx) {
  return db
    .select({
      stageKey: quote.stageKey,
      status: quote.status,
      outcome: quote.outcome,
      outcomeReasonCode: quote.outcomeReasonCode,
      closureOwnerId: quote.closureOwnerId,
      closedAt: quote.closedAt,
      proposalIssuedAt: quote.proposalIssuedAt,
      validityUntil: quote.validityUntil,
    })
    .from(quote);
}
