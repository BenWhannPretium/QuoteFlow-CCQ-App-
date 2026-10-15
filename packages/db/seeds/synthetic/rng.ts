import { Faker, en } from '@faker-js/faker';

import { uuidv7 } from '../../src/ids';

export const DEFAULT_SEED = 20261015;
/** Fixed "now" for generated data, so every run produces identical rows (and ids). */
export const DEFAULT_ANCHOR = new Date('2026-10-15T15:00:00Z');
export const DAY_MS = 86_400_000;

/** Seeded randomness. Never use Math.random or the clock in the generator. */
export function createRng(seed: number = DEFAULT_SEED) {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  const bytes = (size: number) => Uint8Array.from({ length: size }, () => faker.number.int(255));
  return {
    faker,
    int: (min: number, max: number) => faker.number.int({ min, max }),
    float: (min: number, max: number, fractionDigits = 2) =>
      faker.number.float({ min, max, fractionDigits }),
    chance: (p: number) => faker.number.float({ min: 0, max: 1 }) < p,
    pick: <T>(items: readonly T[]): T => faker.helpers.arrayElement(items),
    shuffle: <T>(items: readonly T[]): T[] => faker.helpers.shuffle([...items]),
    /** Standard normal via Box–Muller. */
    normal: () => {
      const u = Math.max(1e-9, faker.number.float({ min: 0, max: 1 }));
      const v = faker.number.float({ min: 0, max: 1 });
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** A deterministic UUID v7 stamped with `at`. */
    uuid: (at: Date) => uuidv7(at.getTime(), bytes),
  };
}

export type Rng = ReturnType<typeof createRng>;
