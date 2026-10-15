import type { Rng } from './rng';
import { DAY_MS } from './rng';

/** Stage mix of the "New Last Week" report (102 rows). */
export const SF_STAGE_COUNTS: [stage: string, count: number][] = [
  ['Qualifying', 8],
  ['Quoting', 35],
  ['Negotiating', 48],
  ['Final Review', 2],
  ['PO(s) in hand', 5],
  ['Verbal Award', 1],
  ['Closed Won – Product Shipping', 1],
  ['Closed Lost', 2],
];

export const REGIONS = ['East', 'Central', 'West'] as const;

export interface SyntheticCustomer {
  id: string;
  sfAccountId: string | null;
  name: string;
  status: 'existing' | 'not_yet_established';
  region: (typeof REGIONS)[number];
  shipTo: { line1: string; city: string; region: string; postal: string; country: 'US' };
}

export interface SyntheticOpportunity {
  id: string;
  sfOpportunityId: string;
  name: string;
  customer: SyntheticCustomer;
  amount: number;
  closeDate: string;
  sfStage: string;
  /** Parsed attributes reused for the quote's intake fields. */
  spec: {
    sizeOz: number;
    resin: string;
    shape: string;
    neck: string;
    productFamily: string;
    market: string;
  };
}

const SHAPES: [shape: string, family: string][] = [
  ['Boston Round', 'BOTTLE'],
  ['Cylinder', 'BOTTLE'],
  ['Oval', 'BOTTLE'],
  ['Square', 'BOTTLE'],
  ['Wide Mouth Jar', 'JAR'],
  ['Straight-Sided Jar', 'JAR'],
  ['Handleware Jug', 'HANDLEWARE'],
  ['Tub', 'CANISTER_TUB'],
  ['Canister', 'CANISTER_TUB'],
  ['Preform', 'PREFORM'],
];
const RESINS = ['HDPE', 'PET', 'PP', 'LDPE', 'PCR-HDPE', 'PCR-PET', 'PETG'];
const NECKS = ['28-410', '38-400', '89-400', '110-400', '120 DC'];
const SIZES = [2, 4, 8, 12, 16, 24, 32, 64, 128];
const MARKETS = [
  'FOOD',
  'BEVERAGE',
  'NUTRITION',
  'PERSONAL_CARE',
  'HOUSEHOLD_CHEMICAL',
  'PHARMA_HEALTH',
  'INDUSTRIAL_CHEMICAL',
  'PET',
];

/** 18-character id with a Salesforce-like key prefix. Fake: never a real record. */
const sfId = (rng: Rng, prefix: string) =>
  prefix + 'SYN' + rng.faker.string.alphanumeric({ length: 12, casing: 'mixed' });

const STATES = ['IL', 'OH', 'MO', 'IN', 'GA', 'PA', 'NJ', 'TX', 'CA', 'WA', 'AZ', 'NC'];

export function buildCustomers(rng: Rng, anchor: Date, count = 70): SyntheticCustomer[] {
  return Array.from({ length: count }, (_, i) => {
    const existing = i % 7 !== 6; // every seventh is not yet established (10 of 70)
    return {
      id: rng.uuid(new Date(anchor.getTime() - 380 * DAY_MS + i * 1000)),
      sfAccountId: existing ? sfId(rng, '001') : null,
      name: `${rng.faker.company.name()} (synthetic)`,
      status: existing ? 'existing' : 'not_yet_established',
      region: rng.pick(REGIONS),
      shipTo: {
        line1: rng.faker.location.streetAddress(),
        city: rng.faker.location.city(),
        region: rng.pick(STATES),
        postal: rng.faker.location.zipCode('#####'),
        country: 'US',
      },
    };
  });
}

/** Log-normal around ~$75k, clamped to $1k–$1.4M, so most land in $20k–$200k. */
function amount(rng: Rng): number {
  const raw = Math.exp(Math.log(75_000) + 1.1 * rng.normal());
  return Math.round(Math.min(1_400_000, Math.max(1_000, raw)) / 100) * 100;
}

const addMonths = (date: Date, months: number) =>
  new Date(date.getTime() + months * 30.44 * DAY_MS);

export function buildOpportunities(
  rng: Rng,
  anchor: Date,
  customers: SyntheticCustomer[],
): SyntheticOpportunity[] {
  const distributors = Array.from(
    { length: 14 },
    () => `${rng.faker.company.name().split(/[ ,-]/)[0]} Packaging Supply`,
  );
  const stages = rng.shuffle(SF_STAGE_COUNTS.flatMap(([stage, n]) => Array<string>(n).fill(stage)));
  return stages.map((sfStage, i) => {
    const customer = customers[i % customers.length]!;
    const [shape, productFamily] = rng.pick(SHAPES);
    const resin = rng.pick(RESINS);
    const neck = productFamily === 'PREFORM' ? rng.pick(['28-410', '38-400']) : rng.pick(NECKS);
    const sizeOz = rng.pick(SIZES);
    const brand =
      `${rng.faker.word.adjective({ length: { min: 4, max: 8 } })} ${rng.faker.word.noun({ length: { min: 4, max: 8 } })}`.replace(
        /\b\w/g,
        (ch) => ch.toUpperCase(),
      );
    const close = addMonths(anchor, rng.float(2, 9));
    return {
      id: rng.uuid(new Date(anchor.getTime() - 200 * DAY_MS + i * 1000)),
      sfOpportunityId: sfId(rng, '006'),
      name: `${rng.pick(distributors)} / ${brand} / ${sizeOz}oz ${resin} ${shape} ${neck}`,
      customer,
      amount: amount(rng),
      closeDate: close.toISOString().slice(0, 10),
      sfStage,
      spec: { sizeOz, resin, shape, neck, productFamily, market: rng.pick(MARKETS) },
    };
  });
}
