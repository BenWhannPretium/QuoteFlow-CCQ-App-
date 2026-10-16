import type { DbOrTx } from '@ccq/db';
import { insertNotifications, listActiveUserIdsWithRoles } from '@ccq/db/repos';
import type { PlannedNotification, Role } from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

export interface NotificationContent {
  quoteId: string | null;
  title: string;
  body: string;
  /** Never notify the person who caused the event. */
  excludeUserId?: string;
}

/**
 * In-app notifications (B-09 writes the rows; B-18 adds email and the bell's read/unread flow).
 * Role recipients are resolved to the active users holding the role. Written in the caller's
 * transaction, so a failed action leaves no notification behind.
 */
export async function persistNotifications(
  db: DbOrTx,
  planned: readonly PlannedNotification[],
  content: NotificationContent,
  log?: FastifyBaseLogger,
): Promise<number> {
  const roles = planned
    .filter((p) => p.recipient.kind === 'role')
    .map((p) => (p.recipient as { role: Role }).role);
  const byRole = await listActiveUserIdsWithRoles(db, roles);
  const recipients = new Map<string, string>();
  for (const p of planned) {
    if (p.recipient.kind === 'user') recipients.set(p.recipient.userId, p.type);
  }
  const roleType = planned.find((p) => p.recipient.kind === 'role')?.type;
  if (roleType) for (const id of byRole) if (!recipients.has(id)) recipients.set(id, roleType);
  if (content.excludeUserId) recipients.delete(content.excludeUserId);

  await insertNotifications(
    db,
    [...recipients].map(([userId, type]) => ({
      userId,
      type,
      quoteId: content.quoteId,
      title: content.title,
      body: content.body,
      channel: 'in_app',
    })),
  );
  // TODO(B-18): email delivery for the types that need it.
  if (recipients.size > 0) {
    log?.info({ quoteId: content.quoteId, count: recipients.size }, 'notifications queued');
  }
  return recipients.size;
}
