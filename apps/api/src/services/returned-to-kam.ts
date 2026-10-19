import type { DbOrTx } from '@ccq/db';
import type { TransitionEffects, WorkflowConfig } from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { persistNotifications } from './notificationService';

/**
 * A quote sent back to its KAM for rework (G1 "Rework", G2 "Return to KAM") tells the KAM, in-app and
 * by email (B-18), with the reason. The workflow config plans it (`quote.reworked`, to the stage owner);
 * a rework that lands on a group (G3 → Engineering) is announced by that stage's arrival alert instead,
 * so only a notification addressed to a person is written here. Runs in the decision's transaction.
 * The decider's note (what to fix) stays on the quote: it is free text and never goes by email.
 */
export async function onReturnedToKam(
  tx: DbOrTx,
  input: {
    quote: { id: string; quoteNumber: string };
    actorId: string;
    effects: TransitionEffects;
    workflow: WorkflowConfig;
  },
  log?: FastifyBaseLogger,
): Promise<number> {
  const planned = input.effects.notifications.filter(
    (n) => n.type === 'quote.reworked' && n.recipient.kind === 'user',
  );
  if (planned.length === 0) return 0;
  const record = input.effects.gateDecisionRecord;
  const outcome = input.workflow.outcomes.find(
    (o) => o.gateKey === record.gateKey && o.key === record.outcomeKey,
  );
  const reason = input.workflow.reasonCodes.find(
    (r) => r.code === record.reasonCode && r.context === outcome?.reasonContext,
  )?.label;
  return persistNotifications(
    tx,
    planned,
    {
      quoteId: input.quote.id,
      title: `${input.quote.quoteNumber} was returned to you for rework`,
      body: `${reason ? `Reason: ${reason}. ` : ''}Open the quote to see what to fix, then resubmit it.`,
      excludeUserId: input.actorId,
      ...(reason ? { payload: { reason } } : {}),
    },
    log,
  );
}
