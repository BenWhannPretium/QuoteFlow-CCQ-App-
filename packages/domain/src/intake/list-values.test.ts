import { describe, expect, it } from 'vitest';

import { INTAKE_LIST_FIELDS, listValueIssues } from './intake';

/** DR-cross-cutting-02: list-backed intake fields hold active value-list codes. */
describe('listValueIssues', () => {
  const config = {
    listCodes: {
      market: ['FOOD', 'HOME_CARE'],
      resin: ['HDPE', 'PET'],
      component: ['CONTAINER', 'CLOSURE'],
      pcr_level: ['0', '25'],
    },
  };

  it('accepts active codes and blanks', () => {
    expect(
      listValueIssues(
        { market: 'FOOD', resin: null, components: ['CONTAINER'], pcr_level: '' },
        config,
      ),
    ).toEqual([]);
  });

  it('refuses an unknown or retired code with the sub-market wording', () => {
    expect(
      listValueIssues({ market: 'PHARMA_HEALTH', resin: 'UNOBTAINIUM', pcr_level: '77' }, config),
    ).toEqual([
      { code: 'INVALID_VALUE', field: 'market', message: 'Pick a market from the list' },
      { code: 'INVALID_VALUE', field: 'resin', message: 'Pick a resin from the list' },
      { code: 'INVALID_VALUE', field: 'pcr_level', message: 'Pick a PCR level from the list' },
    ]);
  });

  it('checks every element of a multi-pick', () => {
    expect(listValueIssues({ components: ['CONTAINER', 'WARP'] }, config)).toEqual([
      { code: 'INVALID_VALUE', field: 'components', message: 'Pick a component from the list' },
    ]);
  });

  it('keeps a retired value the quote already holds (rework)', () => {
    expect(
      listValueIssues({ market: 'PHARMA_HEALTH' }, config, { market: 'PHARMA_HEALTH' }),
    ).toEqual([]);
    // ... but not a different retired one.
    expect(listValueIssues({ market: 'AUTO' }, config, { market: 'PHARMA_HEALTH' })).toHaveLength(
      1,
    );
  });

  it('skips lists the config does not carry', () => {
    expect(listValueIssues({ packaging_type: 'LASER' }, config)).toEqual([]);
    expect(listValueIssues({ market: 'ZZZ' }, {})).toEqual([]);
  });

  it('covers the fields named in the dry-run report', () => {
    for (const field of [
      'market',
      'resin',
      'product_family',
      'neck_diameter',
      'pcr_level',
      'packaging_type',
    ]) {
      expect(INTAKE_LIST_FIELDS[field], field).toBeDefined();
    }
  });
});
