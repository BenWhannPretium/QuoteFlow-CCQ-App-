import { describe, expect, it } from 'vitest';

import { ROLES, isRole } from './roles';

describe('roles', () => {
  it('has the nine roles (PricingLead added in B-26) plus PostAward', () => {
    expect(ROLES).toHaveLength(10);
    expect(isRole('KAM')).toBe(true);
    expect(isRole('PostAward')).toBe(true);
    expect(isRole('PricingLead')).toBe(true);
    expect(isRole('CCQ.KAM')).toBe(false);
  });
});
