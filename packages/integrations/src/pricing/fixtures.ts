import { BPR_COLUMNS, ERF_COLUMNS, SPR_COLUMNS } from './columnMap';
import { loadSyntheticFixture } from '../salesforce/fixtures/index';

/**
 * Synthetic pricing-app rows for `PRICING_MODE=fake` (local dev, CI, tests). Rows are keyed by the
 * column names in columnMap.ts, exactly as the views return them, so the fake goes through the same
 * mapper as the SQL readers. Built from the Salesforce synthetic fixture: every SF opportunity with an
 * ERF number gets that ERF, so the seeded quotes resolve. Synthetic only (CLAUDE.md rule 8).
 *
 * The shape mimics the legacy data's quirks: ERFs from FY26 on have blank revenue / volume / capital
 * (unknown, not zero), BPRs per ERF vary from none to several, a few BPRs have no ERF, and SPRs stop
 * before Nov 2025 (retired).
 */

export type PricingRow = Record<string, unknown>;

export interface PricingFixture {
  erf: PricingRow[];
  bpr: PricingRow[];
  spr: PricingRow[];
}

/** mulberry32: small deterministic PRNG so the fixture is identical on every run. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

/** A stable 32-bit hash of a string (FNV-1a). */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type Rng = ReturnType<typeof seededRandom>;

const PRIORITIES = ['High', 'Medium', 'Low'];
const PRODUCT_CLASSES = ['Bottle', 'Jar', 'Closure', 'Container', 'Pail'];
const CHANNELS = ['Food & Beverage', 'Personal Care', 'Household Chemical', 'Pharma', 'Industrial'];
const PLANTS = ['CHI', 'KCK', 'SEY', 'RCH', 'HMR', 'LAK'];
const MACHINES = ['Bekum 304', 'Uniloy 350', 'Nissei ASB-70', 'Jomar 65', 'Sidel SBO8'];
const DECISION_REASONS = ['Price', 'Capacity', 'Customer timing', 'Technical risk', 'Volume'];
const DECIDERS = ['Pricing analyst (synthetic)', 'Pricing lead (synthetic)'];
const ITEMS = [
  '32oz HDPE Round 38-400',
  '1 gal HDPE F-style',
  '16oz PET Boston Round 28-410',
  '64oz LDPE Cylinder',
  '8oz PP Jar 70-400',
  '5 gal HDPE Pail',
];
const BPR_STATUSES = ['Implemented', 'Pending', 'Cancelled'];
const SPR_STATUSES = ['Approved', 'Declined', 'Closed'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** A date in Pretium's fiscal year `fy` (Oct–Sep, labelled by the year it ends). */
function dateInFiscalYear(rng: Rng, fy: number): string {
  const month = rng.int(1, 12);
  const year = month >= 10 ? fy - 1 : fy;
  return isoDate(year, month, rng.int(1, 28));
}

const E = ERF_COLUMNS;
const B = BPR_COLUMNS;
const S = SPR_COLUMNS;

/** One synthetic ERF row. FY26+ rows have blank figures, like the legacy app. */
export function syntheticErfRow(
  rng: Rng,
  erfNumber: string,
  fields: { customerName: string | null; sfOpportunityId: string | null; title: string | null },
  fy: number,
): PricingRow {
  const submitted = dateInFiscalYear(rng, fy);
  const outcome =
    fy >= 2026 && rng.chance(0.5) ? 'open' : rng.pick(['accepted', 'rejected', 'abandoned']);
  const decided = outcome !== 'open';
  const blankFigures = fy >= 2026 || rng.chance(0.1);
  const engineerDays = rng.int(1, 20);
  return {
    [E.erfNumber.column]: erfNumber,
    [E.customerName.column]: fields.customerName,
    [E.sfOpportunityId.column]: fields.sfOpportunityId,
    [E.title.column]: fields.title,
    [E.submittedOn.column]: submitted,
    [E.priority.column]: rng.pick(PRIORITIES),
    [E.productClass.column]: rng.pick(PRODUCT_CLASSES),
    [E.channel.column]: rng.pick(CHANNELS),
    [E.plant.column]: rng.pick(PLANTS),
    [E.machine.column]: rng.pick(MACHINES),
    [E.estRevenue.column]: blankFigures ? '' : rng.int(40, 2_500) * 1_000,
    [E.estVolume.column]: blankFigures ? null : rng.int(100, 20_000) * 1_000,
    [E.estNetCapital.column]: blankFigures ? ' ' : rng.int(0, 900) * 1_000,
    [E.decisionType.column]: decided ? rng.pick(['Approved', 'Declined', 'Withdrawn']) : null,
    [E.decisionBy.column]: decided ? rng.pick(DECIDERS) : null,
    [E.decisionDate.column]: decided ? submitted : null,
    [E.decisionReason.column]:
      decided && outcome !== 'accepted' ? rng.pick(DECISION_REASONS) : null,
    [E.acceptedFlag.column]: outcome === 'accepted' ? 1 : 0,
    [E.rejectedFlag.column]: outcome === 'rejected' ? 'Y' : 'N',
    [E.abandonedFlag.column]: outcome === 'abandoned',
    [E.attachmentCount.column]: rng.int(0, 6),
    [E.daysToEngineerAssigned.column]: engineerDays,
    [E.daysToEceApproved.column]: rng.chance(0.8) ? engineerDays + rng.int(2, 30) : null,
    [E.daysToPriceConfirmed.column]: decided ? engineerDays + rng.int(10, 60) : null,
  };
}

export function syntheticBprRow(
  rng: Rng,
  bprNumber: string,
  erfNumber: string | null,
  customerName: string | null,
  fy: number,
): PricingRow {
  const requested = dateInFiscalYear(rng, fy);
  return {
    [B.bprNumber.column]: bprNumber,
    [B.erfNumber.column]: erfNumber,
    [B.customerName.column]: customerName,
    [B.itemDescription.column]: rng.pick(ITEMS),
    [B.status.column]: rng.pick(BPR_STATUSES),
    [B.requestedBy.column]: rng.pick(DECIDERS),
    [B.requestedOn.column]: requested,
    [B.effectiveOn.column]: rng.chance(0.7) ? requested : null,
  };
}

/** The fixture `PRICING_MODE=fake` serves. Deterministic. Returns a fresh copy. */
export function syntheticPricingFixture(): PricingFixture {
  const rng = seededRandom(20_260_922); // the date of Cory's export, for the record
  const sf = loadSyntheticFixture();
  const erf: PricingRow[] = [];
  const bpr: PricingRow[] = [];
  const spr: PricingRow[] = [];
  let bprSeq = 410_000;
  let sprSeq = 52_000;
  let historicErf = 18_000;

  const addBprs = (erfNumber: string | null, customer: string | null, fy: number, max: number) => {
    for (let i = rng.int(0, max); i > 0; i--) {
      bpr.push(syntheticBprRow(rng, `BPR-${bprSeq++}`, erfNumber, customer, fy));
    }
  };

  for (const o of sf.opportunities) {
    const erfNumber = typeof o.ERF_Number__c === 'string' ? o.ERF_Number__c.trim() : '';
    if (!erfNumber) continue;
    const customer = ((o.Account as Record<string, unknown> | undefined)?.Name as string) ?? null;
    const name = typeof o.Name === 'string' ? o.Name : '';
    const title = name.split(' / ').at(-1) ?? null;
    erf.push(
      syntheticErfRow(
        rng,
        erfNumber,
        { customerName: customer, sfOpportunityId: String(o.Id), title },
        2026,
      ),
    );
    addBprs(erfNumber, customer, 2026, 3);
  }

  for (const a of sf.accounts) {
    const customer = typeof a.Name === 'string' ? a.Name : null;
    // Older ERFs for about half the customers (with figures: the blanking starts ~FY25/26).
    if (rng.chance(0.5)) {
      for (let i = rng.int(1, 3); i > 0; i--) {
        const fy = rng.int(2016, 2025);
        const number = String(historicErf++);
        erf.push(
          syntheticErfRow(
            rng,
            number,
            { customerName: customer, sfOpportunityId: null, title: rng.pick(ITEMS) },
            fy,
          ),
        );
        addBprs(number, customer, Math.min(fy + 1, 2026), 2);
      }
    }
    // SPR history (retired Nov 2025: nothing after FY25).
    if (rng.chance(0.5)) {
      for (let i = rng.int(1, 4); i > 0; i--) {
        const fy = rng.int(2014, 2025);
        let requested = dateInFiscalYear(rng, fy);
        if (requested >= '2025-11-01') requested = '2025-10-15';
        spr.push({
          [S.sprNumber.column]: `SPR-${sprSeq++}`,
          [S.customerName.column]: customer,
          [S.itemDescription.column]: rng.pick(ITEMS),
          [S.status.column]: rng.pick(SPR_STATUSES),
          [S.requestedOn.column]: requested,
          [S.decidedOn.column]: rng.chance(0.8) ? requested : null,
        });
      }
    }
    // A few BPRs not tied to any ERF (cardinality is not 1:1).
    if (rng.chance(0.1)) addBprs(null, customer, rng.int(2018, 2026), 1);
  }
  return { erf, bpr, spr };
}
