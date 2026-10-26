import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import { appUser, feedback } from '../schema/index';

// B-23 in-app feedback. RLS: a user inserts their own report; only Admin reads or triages.

export type NewFeedback = typeof feedback.$inferInsert;

/** Insert a report. No RETURNING: the reporter can't read the row back (RLS); pass `id`. */
export async function insertFeedback(db: DbOrTx, values: NewFeedback & { id: string }) {
  await db.insert(feedback).values(values);
}

const reporter = alias(appUser, 'reporter');
const owner = alias(appUser, 'owner');

/** Everything but the screenshot bytes. */
const listColumns = {
  id: feedback.id,
  createdAt: feedback.createdAt,
  updatedAt: feedback.updatedAt,
  reporterId: feedback.reporterId,
  reporterName: reporter.displayName,
  reporterRoles: feedback.reporterRoles,
  type: feedback.type,
  severity: feedback.severity,
  description: feedback.description,
  route: feedback.route,
  quoteNumber: feedback.quoteNumber,
  appVersion: feedback.appVersion,
  userAgent: feedback.userAgent,
  viewport: feedback.viewport,
  hasScreenshot: sql<boolean>`${feedback.screenshot} is not null`,
  status: feedback.status,
  ownerId: feedback.ownerId,
  ownerName: owner.displayName,
  githubIssueUrl: feedback.githubIssueUrl,
  triageNote: feedback.triageNote,
};

export type FeedbackListRow = Awaited<ReturnType<typeof listFeedback>>[number];

/** Reports, newest first (Admin). `status` narrows; `limit` caps (default 500). */
export function listFeedback(
  db: DbOrTx,
  opts: { status?: string | undefined; limit?: number } = {},
) {
  return db
    .select(listColumns)
    .from(feedback)
    .innerJoin(reporter, eq(reporter.id, feedback.reporterId))
    .leftJoin(owner, eq(owner.id, feedback.ownerId))
    .where(opts.status ? eq(feedback.status, opts.status) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(opts.limit ?? 500);
}

export async function findFeedback(db: DbOrTx, id: string) {
  const [row] = await db
    .select(listColumns)
    .from(feedback)
    .innerJoin(reporter, eq(reporter.id, feedback.reporterId))
    .leftJoin(owner, eq(owner.id, feedback.ownerId))
    .where(eq(feedback.id, id));
  return row ?? null;
}

export async function findFeedbackScreenshot(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ bytes: feedback.screenshot, contentType: feedback.screenshotType })
    .from(feedback)
    .where(and(eq(feedback.id, id), sql`${feedback.screenshot} is not null`));
  return row?.bytes && row.contentType ? { bytes: row.bytes, contentType: row.contentType } : null;
}

export async function updateFeedback(
  db: DbOrTx,
  id: string,
  values: Partial<
    Pick<
      NewFeedback,
      'status' | 'severity' | 'ownerId' | 'githubIssueUrl' | 'triageNote' | 'updatedAt'
    >
  >,
): Promise<boolean> {
  const rows = await db
    .update(feedback)
    .set(values)
    .where(eq(feedback.id, id))
    .returning({ id: feedback.id });
  return rows.length > 0;
}
