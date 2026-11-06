import type { DbOrTx } from '@ccq/db';
import { resetEngReviewAcceptance } from '@ccq/db/repos';
import type { FastifyBaseLogger } from 'fastify';

import { onMarketDevCheck } from './commercial';

/**
 * A quote entering Engineering Review (P0 per the 10/14 sync, X-91; called by the gate service for G1
 * Advance, G3 Rework, G4 Return and G5 Re-quote, and by intake submit when G1 is off): it waits for
 * acceptance again (the review fields are kept, the acceptance and the capacity sign-off are cleared)
 * and a qualified quote above the Market Development threshold tells Market Development (once).
 * Runs in the transition's transaction. The alert to the EngLead, the backup assigners and the assigned
 * engineer is FB-05's (`handoff-notifications.ts`), together with the KAM's.
 */
export async function onEngQueueArrival(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string },
  actorId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  await resetEngReviewAcceptance(tx, quote.id);
  await onMarketDevCheck(tx, quote, actorId, new Date(), log);
}
