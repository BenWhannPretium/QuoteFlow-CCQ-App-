import type { DbOrTx } from '@ccq/db';
import { listUsersByIds, resetEngReviewAcceptance } from '@ccq/db/repos';
import { asUserId, type PlannedNotification } from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { loadEngQueueSettings } from './engineering-view';
import { persistNotifications } from './notifications';

/**
 * The EngLead's arrival alert (P0 per the 10/14 sync, X-91): a quote entering Engineering Review
 * notifies every active EngLead and every backup assigner, in-app (email is B-18). It waits for
 * acceptance again: the review fields are kept, the acceptance is cleared. Runs in the transition's
 * transaction. Called by the gate service (G1 Advance, G3 Rework, G4 Return, G5 Re-quote) and by
 * intake submit when G1 is off.
 */
export async function onEngQueueArrival(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string },
  actorId: string,
  log?: FastifyBaseLogger,
  /** B-12: set when Final Review returned the quote here, so the alert says why. */
  returnedFrom?: 'final_review',
): Promise<number> {
  await resetEngReviewAcceptance(tx, quote.id);
  const settings = await loadEngQueueSettings(tx);
  const backups = (await listUsersByIds(tx, [...settings.backupAssignerUserIds])).filter(
    (u) => u.active,
  );
  const planned: PlannedNotification[] = [
    { type: 'quote.ready_for_eng_review', recipient: { kind: 'role', role: 'EngLead' } },
    ...backups.map((u): PlannedNotification => ({
      type: 'quote.ready_for_eng_review',
      recipient: { kind: 'user', userId: asUserId(u.id) },
    })),
  ];
  return persistNotifications(
    tx,
    planned,
    {
      quoteId: quote.id,
      title: returnedFrom
        ? `${quote.quoteNumber} was returned to Engineering`
        : `${quote.quoteNumber} is in the engineering queue`,
      body: returnedFrom
        ? 'Final Review returned it for another look. Open the engineering queue to assign it.'
        : 'A quote is waiting for an engineer. Open the engineering queue to assign it.',
      excludeUserId: actorId,
    },
    log,
  );
}
