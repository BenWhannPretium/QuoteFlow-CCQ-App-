import { describe, expect, it } from 'vitest';

import { onlyKnownServerChanges, stableJson } from './draft-merge';

/** FB-15 (W13-01): a drawing upload must not make Submit say "changed in another tab". */
describe('onlyKnownServerChanges', () => {
  const base = {
    resin: 'HDPE',
    drawingStatus: 'COMING',
    shipTo: { city: 'St. Louis', state: 'MO' },
  };

  it('a drawing upload: the server set the drawing status this copy already mirrors', () => {
    const server = { ...base, drawingStatus: 'HAVE_DRAWING' };
    const mine = { ...server, commentsForEngineering: 'Matte finish' };
    expect(onlyKnownServerChanges(server, base, mine)).toBe(true);
  });

  it('a change made in another tab is still a conflict', () => {
    expect(onlyKnownServerChanges({ ...base, resin: 'PET' }, base, base)).toBe(false);
    expect(onlyKnownServerChanges({ ...base, market: 'FOOD' }, base, base)).toBe(false);
  });

  it('nothing changed on the server: no conflict', () => {
    expect(onlyKnownServerChanges(base, base, { ...base, resin: 'PP' })).toBe(true);
  });

  it('ignores key order, and a missing field equals null or undefined', () => {
    const server = { ...base, shipTo: { state: 'MO', city: 'St. Louis' } };
    expect(onlyKnownServerChanges(server, { ...base, description: undefined }, base)).toBe(true);
    expect(stableJson({ a: 1, b: null })).toBe(stableJson({ b: null, a: 1 }));
  });
});
