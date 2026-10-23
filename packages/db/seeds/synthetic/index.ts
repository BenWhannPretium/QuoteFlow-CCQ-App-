import { parseScoringModel, parseWorkflowConfig } from '@ccq/domain';
import { eq, inArray } from 'drizzle-orm';

import { buildCustomers, buildOpportunities } from './opportunities';
import { buildPersonas } from './personas';
import { seedPricingHistory } from './pricingHistory';
import { KAM_BY_REGION, generateQuotes } from './quotes';
import type { QuoteGenResult } from './quotes';
import { DEFAULT_ANCHOR, DEFAULT_SEED, createRng } from './rng';
import { ownerAliasFor } from './sfFixture';
import type { DbOrTx } from '../../src/client';
import {
  getScoringModel,
  getSetting,
  scoringModelInputFromRow,
  loadWorkflowConfigInput,
  setUserScope,
  syncUserRoles,
} from '../../src/repos/index';
import { appUser, customer, quote, sfOpportunitySnapshot } from '../../src/schema/index';

export { PERSONA_DEFS, buildPersonas, personaOid } from './personas';
export type { Persona, PersonaKey } from './personas';
export { SF_STAGE_COUNTS } from './opportunities';
export { buildSfFixture, ownerAliasFor, renderSfFixture, SF_FIXTURE_PATH } from './sfFixture';
export { QUOTE_STAGE_TARGETS } from './quotes';
export { DEFAULT_ANCHOR, DEFAULT_SEED } from './rng';

export interface SyntheticOptions {
  seed?: number;
  /** The generated data's "now". Fixed by default so runs are identical. */
  anchor?: Date;
}

export interface SyntheticResult {
  users: number;
  customers: number;
  opportunities: number;
  quotes: QuoteGenResult | 'already-present';
  /** B-15: synthetic pricing-app history records (ERF, BPR, SPR). */
  pricingHistory: number;
}

/**
 * Synthetic data only: no real names, customers or Salesforce records (CLAUDE.md rule 8).
 * Requires the config seed. Idempotent: users, customers and opportunities are keyed by
 * deterministic ids; quotes are generated once (a re-run finds them and skips).
 */
export async function seedSynthetic(
  db: DbOrTx,
  { seed = DEFAULT_SEED, anchor = DEFAULT_ANCHOR }: SyntheticOptions = {},
): Promise<SyntheticResult> {
  const rng = createRng(seed);
  const personas = buildPersonas(rng, anchor);
  const customers = buildCustomers(rng, anchor);
  const opportunities = buildOpportunities(rng, anchor, customers);

  const created = new Date(anchor.getTime() - 400 * 86_400_000);
  await db
    .insert(appUser)
    .values(
      personas.map((p) => ({
        id: p.id,
        entraOid: p.entraOid,
        upn: p.upn,
        displayName: p.displayName,
        email: p.email,
        region: p.region,
        createdAt: created,
        updatedAt: created,
      })),
    )
    .onConflictDoNothing();
  // A persona may already exist under another id: AUTH_MODE=dev provisions it by oid on first use.
  // Adopt that row so roles, scope and quotes attach to it, and give it the seeded profile.
  const personaRows = await db
    .select({ id: appUser.id, entraOid: appUser.entraOid })
    .from(appUser)
    .where(
      inArray(
        appUser.entraOid,
        personas.map((p) => p.entraOid),
      ),
    );
  const idByOid = new Map(personaRows.map((u) => [u.entraOid, u.id]));
  for (const p of personas) {
    const id = idByOid.get(p.entraOid);
    if (id && id !== p.id) {
      p.id = id;
      await db
        .update(appUser)
        .set({ upn: p.upn, displayName: p.displayName, email: p.email, region: p.region })
        .where(eq(appUser.id, id));
    }
  }
  for (const p of personas) {
    await syncUserRoles(db, p.id, p.roles);
    await setUserScope(db, p.id, p.scope);
  }

  await db
    .insert(customer)
    .values(
      customers.map((c) => ({
        id: c.id,
        sfAccountId: c.sfAccountId,
        name: c.name,
        status: c.status,
        defaultShipTo: c.shipTo,
        source: 'synthetic',
        lastSyncedAt: c.sfAccountId ? anchor : null,
        createdAt: created,
        updatedAt: created,
      })),
    )
    .onConflictDoNothing();

  const byKey = new Map(personas.map((p) => [p.key, p]));
  await db
    .insert(sfOpportunitySnapshot)
    .values(
      opportunities.map((o) => {
        const owner = byKey.get(KAM_BY_REGION[o.customer.region])!;
        const row = {
          Id: o.sfOpportunityId,
          Name: o.name,
          AccountId: o.customer.sfAccountId,
          Account: { Name: o.customer.name },
          Amount: o.amount,
          CloseDate: o.closeDate,
          StageName: o.sfStage,
          Owner: { Alias: ownerAliasFor(owner.displayName) },
        };
        return {
          id: o.id,
          sfOpportunityId: o.sfOpportunityId,
          name: o.name,
          accountId: o.customer.sfAccountId,
          accountName: o.customer.name,
          ownerAlias: row.Owner.Alias,
          ownerEmail: owner.email,
          amount: o.amount,
          closeDate: o.closeDate,
          sfStage: o.sfStage,
          erfNumberSf: null,
          quoteSourceSf: 'CCQ',
          raw: { ...row, synthetic: true },
          syncedAt: anchor,
          createdAt: anchor,
          updatedAt: anchor,
        };
      }),
    )
    .onConflictDoNothing();

  const existing = await db
    .select({ id: quote.id })
    .from(quote)
    .where(
      inArray(
        quote.sfOpportunityId,
        opportunities.map((o) => o.sfOpportunityId),
      ),
    )
    .limit(1);
  let quotes: SyntheticResult['quotes'] = 'already-present';
  if (existing.length === 0) {
    const config = parseWorkflowConfig(await loadWorkflowConfigInput(db));
    const validityDays = (await getSetting<number>(db, 'validity_days_default')) ?? 30;
    const scoringRow = await getScoringModel(db, anchor);
    if (!scoringRow) throw new Error('synthetic seed: no scoring model (seed config first)');
    const scoring = parseScoringModel(scoringModelInputFromRow(scoringRow));
    quotes = await generateQuotes({
      db,
      rng,
      anchor,
      config,
      scoring,
      personas: new Map(personas.map((p) => [p.key, p])),
      opportunities,
      validityDays,
    });
  }

  const pricingHistory = await seedPricingHistory(db);
  return {
    users: personas.length,
    customers: customers.length,
    opportunities: opportunities.length,
    quotes,
    pricingHistory,
  };
}
