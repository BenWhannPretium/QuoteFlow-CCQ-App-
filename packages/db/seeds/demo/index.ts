import { parseScoringModel, parseWorkflowConfig } from '@ccq/domain';
import { inArray } from 'drizzle-orm';

import type { DbOrTx } from '../../src/client';
import {
  getScoringModel,
  getSetting,
  loadWorkflowConfigInput,
  scoringModelInputFromRow,
} from '../../src/repos/index';
import { customer, quote, sfOpportunitySnapshot } from '../../src/schema/index';
import {
  DEFAULT_ANCHOR,
  DEFAULT_SEED,
  KAM_BY_REGION,
  buildPersonas,
  generateQuotes,
  ownerAliasFor,
  upsertPersonas,
} from '../synthetic/index';
import type {
  QuoteCase,
  QuoteGenResult,
  SyntheticCustomer,
  SyntheticOpportunity,
} from '../synthetic/index';
import { DAY_MS, createRng } from '../synthetic/rng';

/**
 * Demo seed: one example quote at each stage of the workflow, for walkthroughs with each user group
 * on an environment that otherwise has only live Salesforce data. Everything here is fake (CLAUDE.md
 * rule 8): customers and opportunities are named "(demo)" and carry `006DEMO…` / `001DEMO…` ids that
 * Salesforce never returns, so the live sync never touches them. The quotes are walked through the
 * real stage/gate engine by the synthetic generator, acted on by the synthetic personas
 * (`@example.com`), which are created too.
 *
 * Idempotent: customers and opportunities have fixed ids, and the quotes are created once (a re-run
 * finds them and skips).
 */

/** The final stage of each demo quote and the scenario variant that shows that stage best. */
export const DEMO_CASES: QuoteCase[] = [
  { stage: 'INTAKE', i: 1 }, // complete intake, waiting on G1
  { stage: 'ENG_REVIEW', i: 7 }, // engineer assigned, analysis and capacity evidence in, waiting on G2
  { stage: 'QUOTING', i: 0 }, // feasible, waiting on Pricing (G3)
  { stage: 'FINAL_REVIEW', i: 0 }, // priced, waiting on the approver (G4)
  { stage: 'CUSTOMER_DECISION', i: 0 }, // proposal issued, waiting on the customer (G5)
  { stage: 'COMMIT_HANDOFF', i: 0 }, // awarded, CER pending (G6)
  { stage: 'AWARDED', i: 2 }, // closed Won on a PO
  { stage: 'CLOSED_LOST', i: 4 }, // lost, with a note
  { stage: 'DECLINED', i: 4 }, // declined at Final Review (margin)
  { stage: 'EXPIRED', i: 0 }, // customer went quiet
  { stage: 'REDIRECTED', i: 0 }, // redirected at G1
  { stage: 'NOT_AUTHORIZED', i: 0 }, // awarded, commitment not authorized at G6
];

const DEMO_SEED = DEFAULT_SEED + 1000;

const shipTo = (line1: string, city: string, state: string, postal: string) => ({
  line1,
  city,
  state,
  postal,
  country: 'US' as const,
});

const CUSTOMERS: Omit<SyntheticCustomer, 'id' | 'sfAccountId'>[] = [
  {
    name: 'Harborline Home Care (demo)',
    status: 'existing',
    region: 'Central',
    shipTo: shipTo('100 Demo Way', 'Springfield', 'IL', '62701'),
  },
  {
    name: 'Bluestem Beverage Co. (demo)',
    status: 'existing',
    region: 'Central',
    shipTo: shipTo('200 Demo Way', 'Columbus', 'OH', '43004'),
  },
  {
    name: 'Copperleaf Nutrition (demo)',
    status: 'existing',
    region: 'East',
    shipTo: shipTo('300 Demo Way', 'Allentown', 'PA', '18101'),
  },
  {
    name: 'Tidewater Pet Supply (demo)',
    status: 'existing',
    region: 'West',
    shipTo: shipTo('400 Demo Way', 'Tempe', 'AZ', '85281'),
  },
  {
    name: 'Granite Peak Chemical (demo)',
    status: 'existing',
    region: 'Central',
    shipTo: shipTo('500 Demo Way', 'Joplin', 'MO', '64801'),
  },
  {
    // Not yet established: G4 needs the Legal review recorded (the generator does it).
    name: 'Sundial Personal Care (demo)',
    status: 'not_yet_established',
    region: 'East',
    shipTo: shipTo('600 Demo Way', 'Raleigh', 'NC', '27601'),
  },
];

type Spec = SyntheticOpportunity['spec'];
const spec = (
  sizeOz: number,
  resin: string,
  shape: string,
  neck: string,
  productFamily: string,
  market: string,
): Spec => ({ sizeOz, resin, shape, neck, productFamily, market });

/**
 * One opportunity per demo quote, plus three open ones left free so a KAM session can start a new
 * intake live. The generator gives AWARDED / COMMIT_HANDOFF the won ones, CLOSED_LOST the lost one,
 * the active stages the first open ones and the other closed stages the rest.
 */
const OPPORTUNITIES: [customer: number, sfStage: string, amount: number, spec: Spec][] = [
  [
    0,
    'Quoting',
    84_000,
    spec(32, 'HDPE', 'Handleware Jug', '38-400', 'HANDLEWARE', 'HOUSEHOLD_CHEMICAL'),
  ],
  [1, 'Quoting', 126_500, spec(16, 'PET', 'Cylinder', '28-410', 'BOTTLE', 'BEVERAGE')],
  [2, 'Negotiating', 58_200, spec(24, 'PCR-HDPE', 'Wide Mouth Jar', '89-400', 'JAR', 'NUTRITION')],
  [3, 'Negotiating', 212_000, spec(128, 'HDPE', 'Handleware Jug', '38-400', 'HANDLEWARE', 'PET')],
  [4, 'Negotiating', 97_300, spec(64, 'HDPE', 'Oval', '38-400', 'BOTTLE', 'INDUSTRIAL_CHEMICAL')],
  [
    5,
    'Final Review',
    143_800,
    spec(8, 'PETG', 'Boston Round', '28-410', 'BOTTLE', 'PERSONAL_CARE'),
  ],
  [0, 'Quoting', 71_400, spec(12, 'PP', 'Tub', '89-400', 'CANISTER_TUB', 'FOOD')],
  [1, 'Qualifying', 64_900, spec(2, 'PET', 'Preform', '28-410', 'PREFORM', 'BEVERAGE')],
  [2, 'Quoting', 39_500, spec(4, 'HDPE', 'Boston Round', '28-410', 'BOTTLE', 'PHARMA_HEALTH')],
  [
    4,
    'Negotiating',
    182_000,
    spec(128, 'PCR-HDPE', 'Handleware Jug', '38-400', 'HANDLEWARE', 'INDUSTRIAL_CHEMICAL'),
  ],
  [3, 'Qualifying', 45_000, spec(32, 'PET', 'Square', '38-400', 'BOTTLE', 'PET')],
  [5, 'Quoting', 52_700, spec(16, 'PCR-PET', 'Oval', '28-410', 'BOTTLE', 'PERSONAL_CARE')],
  [1, 'PO(s) in hand', 238_000, spec(24, 'PET', 'Cylinder', '38-400', 'BOTTLE', 'BEVERAGE')],
  [2, 'PO(s) in hand', 167_500, spec(64, 'HDPE', 'Square', '120 DC', 'BOTTLE', 'FOOD')],
  [
    0,
    'Closed Lost',
    88_800,
    spec(32, 'HDPE', 'Cylinder', '38-400', 'BOTTLE', 'HOUSEHOLD_CHEMICAL'),
  ],
];

/** 18 characters, like a Salesforce id. `DEMO` in the id: never a real record. */
const demoSfId = (prefix: '001' | '006', n: number) =>
  `${prefix}DEMO${String(n + 1).padStart(11, '0')}`;

export function buildDemoData() {
  // Ids are stamped at fixed times, so every run produces the same customer and opportunity rows.
  const rng = createRng(DEMO_SEED);
  const customers: SyntheticCustomer[] = CUSTOMERS.map((c, i) => ({
    ...c,
    id: rng.uuid(new Date(DEFAULT_ANCHOR.getTime() - 300 * DAY_MS + i * 1000)),
    sfAccountId: c.status === 'existing' ? demoSfId('001', i) : null,
  }));
  const opportunities: SyntheticOpportunity[] = OPPORTUNITIES.map(([c, sfStage, amount, s], i) => {
    const customer = customers[c]!;
    return {
      id: rng.uuid(new Date(DEFAULT_ANCHOR.getTime() - 200 * DAY_MS + i * 1000)),
      sfOpportunityId: demoSfId('006', i),
      name: `${customer.name.replace(' (demo)', '')} / ${s.sizeOz}oz ${s.resin} ${s.shape} ${s.neck} (demo)`,
      customer,
      amount,
      closeDate: '', // set from the anchor in seedDemo
      sfStage,
      spec: s,
    };
  });
  return { customers, opportunities };
}

export interface DemoOptions {
  /**
   * The demo's "now". Defaults to the real clock (unlike the synthetic seed), so the timelines end
   * just before the seed runs and proposal validity dates are still in the future.
   */
  anchor?: Date;
}

export interface DemoResult {
  customers: number;
  opportunities: number;
  quotes: QuoteGenResult | 'already-present';
}

/** Requires the config seed. */
export async function seedDemo(
  db: DbOrTx,
  { anchor = new Date() }: DemoOptions = {},
): Promise<DemoResult> {
  // The same personas (same ids) as the synthetic seed, so the two can coexist.
  const personas = buildPersonas(createRng(DEFAULT_SEED), DEFAULT_ANCHOR);
  await upsertPersonas(db, personas, new Date(DEFAULT_ANCHOR.getTime() - 400 * DAY_MS));

  const { customers, opportunities } = buildDemoData();
  for (const o of opportunities) {
    o.closeDate = new Date(anchor.getTime() + 90 * DAY_MS).toISOString().slice(0, 10);
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
        lastSyncedAt: null,
        createdAt: anchor,
        updatedAt: anchor,
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
          raw: { ...row, synthetic: true, demo: true },
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
  let quotes: DemoResult['quotes'] = 'already-present';
  if (existing.length === 0) {
    const config = parseWorkflowConfig(await loadWorkflowConfigInput(db));
    const validityDays = (await getSetting<number>(db, 'validity_days_default')) ?? 30;
    const scoringRow = await getScoringModel(db, anchor);
    if (!scoringRow) throw new Error('demo seed: no scoring model (seed config first)');
    quotes = await generateQuotes({
      db,
      rng: createRng(DEMO_SEED + 1),
      anchor,
      config,
      scoring: parseScoringModel(scoringModelInputFromRow(scoringRow)),
      personas: new Map(personas.map((p) => [p.key, p])),
      opportunities,
      validityDays,
      cases: DEMO_CASES,
    });
  }

  return { customers: customers.length, opportunities: opportunities.length, quotes };
}
