import {
  ACCOUNT_FIELDS,
  OPPORTUNITY_FIELDS,
  PRODUCT_SPEC_FIELDS,
  type SfFixture,
} from '@ccq/integrations';

import { buildCustomers, buildOpportunities } from './opportunities';
import type { SyntheticCustomer } from './opportunities';
import { buildPersonas, type Persona } from './personas';
import { KAM_BY_REGION } from './quotes';
import { DAY_MS, DEFAULT_ANCHOR, DEFAULT_SEED, createRng } from './rng';

type Raw = Record<string, unknown>;

/**
 * The FakeSalesforceReader fixture (`packages/integrations/src/salesforce/fixtures/synthetic.json`),
 * derived from the same synthetic data as `db:seed --synthetic`: the 102 opportunities keep their
 * ids, names, accounts and owners, so a sync over a seeded database updates the seeded snapshots
 * and the quotes stay linked. Regenerate with `pnpm db:sf-fixture`; a unit test fails when stale.
 *
 * It adds what real SF data looks like after the migration backfill (discovery, B-06):
 * - ERF number and quote source filled inconsistently, in mixed formats
 * - placeholder amounts (one is $0.31) and blank amounts
 * - opportunities with no account (the not-yet-established customers)
 * - one opportunity deleted in SF
 * Synthetic only: no real customer, person or SF record (CLAUDE.md rule 8).
 */

/** Set a dotted SOQL path (`Owner.Email`) on a raw record, creating nested objects. */
function setPath(record: Raw, path: string, value: unknown): void {
  const parts = path.split('.');
  let target = record;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part] as Raw;
  }
  target[parts.at(-1)!] = value;
}

/** Owner alias as stored in the seeded snapshot (`owner_alias`). */
export function ownerAliasFor(displayName: string): string {
  return displayName
    .split(' ')
    .map((w) => w.slice(0, 4))
    .join('')
    .toLowerCase()
    .slice(0, 8);
}

const sfTimestamp = (at: Date) => at.toISOString().replace('Z', '+0000');

export function buildSfFixture({
  seed = DEFAULT_SEED,
  anchor = DEFAULT_ANCHOR,
}: { seed?: number; anchor?: Date } = {}): SfFixture {
  // Same call order as seedSynthetic, so ids and names match the seeded rows exactly.
  const rng = createRng(seed);
  const personas = buildPersonas(rng, anchor);
  const customers = buildCustomers(rng, anchor);
  const opportunities = buildOpportunities(rng, anchor, customers);
  // Everything SF-only comes from a second stream, so the seed's own stream is untouched.
  const extra = createRng(seed + 6);
  const sfId = (prefix: string) =>
    prefix + 'SYN' + extra.faker.string.alphanumeric({ length: 12, casing: 'mixed' });

  const byKey = new Map<string, Persona>(personas.map((p) => [p.key, p]));
  // B-26 personas (after the first 12) get their SF user ids from their own stream, so the rest of
  // the fixture stays identical.
  const later = createRng(seed + 626);
  const laterId = () => '005SYN' + later.faker.string.alphanumeric({ length: 12, casing: 'mixed' });
  const ownerIds = new Map(
    personas.map((p, i) => [p.key, i < 12 ? sfId('005') : laterId()] as const),
  );

  const accountRaw = (c: SyntheticCustomer): Raw => {
    const raw: Raw = {};
    const f = ACCOUNT_FIELDS;
    setPath(raw, f.id.path, c.sfAccountId);
    setPath(raw, f.name.path, c.name);
    setPath(raw, f.shipToStreet.path, c.shipTo.line1);
    setPath(raw, f.shipToCity.path, c.shipTo.city);
    setPath(raw, f.shipToState.path, c.shipTo.state);
    setPath(raw, f.shipToPostal.path, c.shipTo.postal);
    setPath(raw, f.shipToCountry.path, extra.pick(['US', 'USA', 'United States']));
    return raw;
  };
  const accounts = customers.filter((c) => c.sfAccountId).map(accountRaw);
  const accountById = new Map(accounts.map((a) => [a.Id as string, a]));

  const erfFormats = [
    (n: number) => `ERF-2026-${String(n).padStart(5, '0')}`,
    (n: number) => `ERF ${n}`,
    (n: number) => String(n),
    (n: number) => `erf#${n}`,
  ];
  const f = OPPORTUNITY_FIELDS;
  const rows = opportunities.map((o, i) => {
    const ownerKey = KAM_BY_REGION[o.customer.region];
    const owner = byKey.get(ownerKey)!;
    const raw: Raw = {};
    setPath(raw, f.id.path, o.sfOpportunityId);
    setPath(raw, f.name.path, o.name);
    setPath(raw, f.accountId.path, o.customer.sfAccountId);
    if (o.customer.sfAccountId) {
      // The opportunity query reads the account's name and ship-to through the relationship.
      const account = accountById.get(o.customer.sfAccountId)!;
      for (const [key, value] of Object.entries(account)) {
        if (key !== 'Id') setPath(raw, `Account.${key}`, value);
      }
    } else {
      raw.Account = null;
    }
    setPath(raw, f.ownerId.path, ownerIds.get(ownerKey));
    setPath(raw, f.ownerName.path, owner.displayName);
    setPath(raw, f.ownerAlias.path, ownerAliasFor(owner.displayName));
    setPath(raw, f.ownerEmail.path, owner.email);
    // Messy amounts: #3 is the $0.31 placeholder, every 17th is blank, every 29th is $1.
    const amount = i === 3 ? 0.31 : i % 17 === 5 ? null : i % 29 === 7 ? 1 : o.amount;
    setPath(raw, f.amount.path, amount);
    setPath(raw, f.closeDate.path, i % 41 === 11 ? null : o.closeDate);
    setPath(raw, f.stage.path, o.sfStage);
    const closed = o.sfStage.startsWith('Closed');
    setPath(raw, f.isClosed.path, closed);
    setPath(raw, f.isWon.path, o.sfStage.startsWith('Closed Won'));
    // ERF number on ~40 %, in four formats; quote source on some, from the org's picklist
    // (Quote_Type__c, read 2026-10-24; filled on ~17 % in production).
    setPath(
      raw,
      f.erfNumber.path,
      extra.chance(0.4) ? extra.pick(erfFormats)(extra.int(10_000, 99_999)) : null,
    );
    setPath(
      raw,
      f.quoteSource.path,
      extra.chance(0.6)
        ? extra.pick(['SPR', 'ERF', 'Stock Bottle Price List', 'Price List'])
        : null,
    );
    const modified = new Date(anchor.getTime() - extra.int(1, 60 * 24 * 21) * 60_000);
    setPath(raw, f.systemModstamp.path, sfTimestamp(modified));
    return { raw, o };
  });

  const s = PRODUCT_SPEC_FIELDS;
  const productSpecs: Raw[] = [];
  let specNo = 1;
  for (const { o } of rows) {
    const count = extra.int(0, 2);
    for (let n = 0; n < count; n++) {
      const raw: Raw = {};
      setPath(raw, s.id.path, sfId('a0P'));
      setPath(raw, s.name.path, `PS-${String(specNo++).padStart(6, '0')}`);
      setPath(raw, s.opportunityId.path, o.sfOpportunityId);
      setPath(raw, s.productType.path, o.spec.productFamily);
      setPath(raw, s.resin.path, n === 0 ? o.spec.resin : extra.pick(['HDPE', 'PET', 'PP']));
      setPath(raw, s.capacity.path, `${o.spec.sizeOz} oz`);
      setPath(raw, s.neckFinish.path, o.spec.neck);
      setPath(raw, s.color.path, extra.pick(['Natural', 'White', 'Amber', 'Clear', null]));
      setPath(raw, s.annualVolume.path, extra.chance(0.7) ? extra.int(50, 4_000) * 1_000 : null);
      productSpecs.push(raw);
    }
  }

  return {
    generatedFrom: {
      generator: 'packages/db/seeds/synthetic/sfFixture.ts',
      seed,
      anchor: anchor.toISOString(),
      note: 'Synthetic data only. Regenerate with `pnpm db:sf-fixture`.',
    },
    opportunities: rows.map((r) => r.raw),
    accounts,
    productSpecs,
    deleted: [
      { id: sfId('006'), deletedDate: new Date(anchor.getTime() - 2 * DAY_MS).toISOString() },
    ],
  };
}

export const SF_FIXTURE_PATH = new URL(
  '../../../integrations/src/salesforce/fixtures/synthetic.json',
  import.meta.url,
);

/** Stable, diff-friendly JSON (what the file holds). */
export const renderSfFixture = (fixture: SfFixture) => `${JSON.stringify(fixture, null, 2)}\n`;
