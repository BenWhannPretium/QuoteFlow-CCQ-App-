import type { DbOrTx } from '@ccq/db';
import { rolesWithPermission, type Permission, type PlannedNotification } from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { persistNotifications } from './notificationService';

/**
 * A submitted intake waiting at the qualification gate (G1) tells the people who decide it (B-18): every
 * active holder of the gate's decider permission (the SalesLeader in the seed; config says who), in-app
 * now and in the 7:00 AM Central digest by email. Runs in the submit's transaction. A KAM's resubmit of a
 * reworked intake lands here too.
 */
export async function onQualifyArrival(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string },
  gate: { deciderPermission: Permission },
  actorId: string,
  resubmitted: boolean,
  log?: FastifyBaseLogger,
): Promise<number> {
  const planned: PlannedNotification[] = rolesWithPermission(gate.deciderPermission).map(
    (role) => ({
      type: 'quote.to_qualify',
      recipient: { kind: 'role', role },
    }),
  );
  return persistNotifications(
    tx,
    planned,
    {
      quoteId: quote.id,
      title: resubmitted
        ? `${quote.quoteNumber} was resubmitted and is waiting to qualify`
        : `${quote.quoteNumber} is waiting to qualify`,
      body: 'Open To qualify to advance, hold, return or stop it.',
      excludeUserId: actorId,
    },
    log,
  );
}
