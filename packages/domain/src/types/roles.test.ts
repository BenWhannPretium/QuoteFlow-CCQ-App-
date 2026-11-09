import { describe, expect, it } from 'vitest';

import { ROLES, isRole } from './roles';

describe('roles', () => {
  it('has the ten roles (PricingLead added in B-26, Finance in FB-07) plus PostAward', () => {
    expect(ROLES).toHaveLength(11);
    expect(isRole('KAM')).toBe(true);
    expect(isRole('PostAward')).toBe(true);
    expect(isRole('PricingLead')).toBe(true);
    expect(isRole('Finance')).toBe(true);
    expect(isRole('CCQ.KAM')).toBe(false);
  });
});
