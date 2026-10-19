import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import { first } from './_util';
import {
  appUser,
  capacityEvidence,
  customer,
  engReview,
  quote,
  quoteHold,
  sfOpportunitySnapshot,
  stageHistory,
  userRole,
} from '../schema/index';

// B-10 engineering queue and review: reads and writes only. Who may do what is the domain's.

const engineer = alias(appUser, 'engineer');

/**
 * Open quotes in the engineering stage (on hold included), with what the queue shows next to them:
 * the summary columns `summaryDto` needs, when the quote entered the stage (the open stage_history
 * row), the assigned engineer's name, acceptance and the SF close date. RLS applies: an owner-scoped
 * Engineer sees only their assignments.
 */
export function listEngQueueRows(db: DbOrTx, stageKey: string) {
  return db
    .select({
      quote,
      opportunityName: sfOpportunitySnapshot.name,
      sfCloseDate: sfOpportunitySnapshot.closeDate,
      customerName: customer.name,
      customerStatus: customer.status,
      kamName: appUser.displayName,
      processType: engReview.processType,
      acceptedAt: engReview.acceptedAt,
      assignedEngineerName: engineer.displayName,
      enteredQueueAt: sql<Date | null>`(
        select max(sh.entered_at) from ${stageHistory} sh
        where sh.quote_id = ${quote.id} and sh.stage_key = ${stageKey} and sh.exited_at is null
      )`.mapWith((v: string | Date | null) => (v ? new Date(v) : null)),
    })
    .from(quote)
    .leftJoin(
      sfOpportunitySnapshot,
      eq(sfOpportunitySnapshot.sfOpportunityId, quote.sfOpportunityId),
    )
    .leftJoin(customer, eq(customer.id, quote.customerId))
    .leftJoin(appUser, eq(appUser.id, quote.kamUserId))
    .leftJoin(engReview, eq(engReview.quoteId, quote.id))
    .leftJoin(engineer, eq(engineer.id, quote.assignedEngineerId))
    .where(and(eq(quote.stageKey, stageKey), ne(quote.status, 'closed')))
    .limit(500);
}

export type EngQueueRow = Awaited<ReturnType<typeof listEngQueueRows>>[number];

/**
 * Active users holding any of `roles`, with their roles and how many open quotes in `stageKey` are
 * assigned to them (the picker's workload hint). The count runs under RLS, so it is what the caller sees.
 */
export async function listAssignableEngineers(
  db: DbOrTx,
  roles: readonly string[],
  stageKey: string,
) {
  const users = await db
    .select({ id: appUser.id, displayName: appUser.displayName, role: userRole.role })
    .from(appUser)
    .innerJoin(userRole, eq(userRole.userId, appUser.id))
    .where(and(eq(appUser.active, true), inArray(userRole.role, [...roles])))
    .orderBy(asc(appUser.displayName));
  const counts = await db
    .select({ id: quote.assignedEngineerId, open: count() })
    .from(quote)
    .where(and(eq(quote.stageKey, stageKey), ne(quote.status, 'closed')))
    .groupBy(quote.assignedEngineerId);
  const open = new Map(counts.map((c) => [c.id, c.open]));
  const byId = new Map<
    string,
    { id: string; displayName: string; roles: string[]; openCount: number }
  >();
  for (const u of users) {
    const entry = byId.get(u.id) ?? {
      id: u.id,
      displayName: u.displayName,
      roles: [],
      openCount: open.get(u.id) ?? 0,
    };
    entry.roles.push(u.role);
    byId.set(u.id, entry);
  }
  return [...byId.values()];
}

/** A user with their roles (the assignee check). Identity tables have no RLS. */
export async function getUserWithRoles(db: DbOrTx, id: string) {
  const user = first(await db.select().from(appUser).where(eq(appUser.id, id)));
  if (!user) return undefined;
  const roles = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, id));
  return { ...user, roles: roles.map((r) => r.role) };
}

export async function updateCapacityEvidence(
  db: DbOrTx,
  id: string,
  patch: Partial<Omit<typeof capacityEvidence.$inferInsert, 'id' | 'quoteId'>>,
) {
  return first(
    await db
      .update(capacityEvidence)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(capacityEvidence.id, id))
      .returning(),
  );
}

export async function deleteCapacityEvidence(db: DbOrTx, quoteId: string, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .delete(capacityEvidence)
    .where(and(eq(capacityEvidence.quoteId, quoteId), inArray(capacityEvidence.id, ids)));
}

/** Capacity rows with the analyst's name, oldest analysis first. */
export function listCapacityEvidenceWithNames(db: DbOrTx, quoteId: string) {
  return db
    .select({ row: capacityEvidence, analystName: appUser.displayName })
    .from(capacityEvidence)
    .leftJoin(appUser, eq(appUser.id, capacityEvidence.analystId))
    .where(eq(capacityEvidence.quoteId, quoteId))
    .orderBy(asc(capacityEvidence.analysisDate), asc(capacityEvidence.createdAt));
}

/** Hold intervals for many quotes at once (the queue's time-in-stage). */
export function listHoldsForQuotes(db: DbOrTx, quoteIds: string[]) {
  if (quoteIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      quoteId: quoteHold.quoteId,
      startedAt: quoteHold.startedAt,
      endedAt: quoteHold.endedAt,
    })
    .from(quoteHold)
    .where(inArray(quoteHold.quoteId, quoteIds));
}

/** A quote (re-)entering Engineering Review waits for acceptance again; the review fields are kept. */
export async function resetEngReviewAcceptance(db: DbOrTx, quoteId: string) {
  await db
    .update(engReview)
    .set({ acceptedAt: null, acceptedBy: null, updatedAt: new Date() })
    .where(eq(engReview.quoteId, quoteId));
}
