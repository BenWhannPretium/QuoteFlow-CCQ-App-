import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import {
  appUser,
  customer,
  engReview,
  gateDecision,
  pricingRecord,
  quote,
  sfOpportunitySnapshot,
  stageHistory,
  userRole,
} from '../schema/index';

// B-11 pricing queue and Quoting tab: reads only. Who may do what is the domain's.

const engineer = alias(appUser, 'engineer');

/**
 * Open quotes in the Quoting stage (on hold included), with what the pricing queue shows: the summary
 * columns `summaryDto` needs, when the quote entered the stage, the assigned engineer, the latest G2
 * outcome and the current version's pricing record. RLS applies.
 */
export function listPricingQueueRows(db: DbOrTx, stageKey: string) {
  return db
    .select({
      quote,
      opportunityName: sfOpportunitySnapshot.name,
      customerName: customer.name,
      customerStatus: customer.status,
      accountId: customer.sfAccountId,
      kamName: appUser.displayName,
      processType: engReview.processType,
      /** Commercial: the approver-tier hook (B-12) reads it; never put it in a DTO unredacted. */
      prelimCapitalUsd: engReview.prelimCapitalUsd,
      assignedEngineerName: engineer.displayName,
      pricing: pricingRecord,
      enteredStageAt: sql<Date | null>`(
        select max(sh.entered_at) from ${stageHistory} sh
        where sh.quote_id = ${quote.id} and sh.stage_key = ${stageKey} and sh.exited_at is null
      )`.mapWith((v: string | Date | null) => (v ? new Date(v) : null)),
      g2Outcome: sql<string | null>`(
        select gd.outcome_key from ${gateDecision} gd
        where gd.quote_id = ${quote.id} and gd.gate_key = 'G2'
        order by gd.decided_at desc, gd.id desc limit 1
      )`,
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
    .leftJoin(
      pricingRecord,
      and(eq(pricingRecord.quoteId, quote.id), eq(pricingRecord.quoteVersion, quote.version)),
    )
    .where(and(eq(quote.stageKey, stageKey), ne(quote.status, 'closed')))
    .limit(500);
}

export type PricingQueueRow = Awaited<ReturnType<typeof listPricingQueueRows>>[number];

/** Active users holding any of `roles` (the price-approver picker). Identity tables have no RLS. */
export async function listActiveUsersWithRoles(db: DbOrTx, roles: readonly string[]) {
  if (roles.length === 0) return [];
  return db
    .selectDistinct({ id: appUser.id, displayName: appUser.displayName })
    .from(appUser)
    .innerJoin(userRole, eq(userRole.userId, appUser.id))
    .where(and(eq(appUser.active, true), inArray(userRole.role, [...roles])))
    .orderBy(asc(appUser.displayName));
}

/**
 * Who decided `gateKey` on each quote, with the quote version they decided it on (the Final Review
 * queue's segregation check: whoever decided G3 on the current version cannot decide G4).
 */
export function listGateDecidersForQuotes(db: DbOrTx, quoteIds: string[], gateKey: string) {
  if (quoteIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      quoteId: gateDecision.quoteId,
      decidedBy: gateDecision.decidedBy,
      quoteVersion: gateDecision.quoteVersion,
    })
    .from(gateDecision)
    .where(and(inArray(gateDecision.quoteId, quoteIds), eq(gateDecision.gateKey, gateKey)));
}
