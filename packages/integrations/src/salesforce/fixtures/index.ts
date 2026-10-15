import type { SfFixture } from '../fake';
import synthetic from './synthetic.json' with { type: 'json' };

/**
 * The synthetic fixture for `SF_MODE=fake`: generated from the B-03 synthetic data by
 * `pnpm db:sf-fixture`, so its opportunity ids match the seeded snapshots and quotes.
 * Synthetic only: no real customers or SF records (CLAUDE.md rule 8). Returns a fresh copy.
 */
export function loadSyntheticFixture(): SfFixture {
  return structuredClone(synthetic as unknown as SfFixture);
}
