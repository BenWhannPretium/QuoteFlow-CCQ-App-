import { describe, expect, it } from 'vitest';

import { ROLES, isRole } from './roles';

describe('roles', () => {
  it('has the eight roles plus PostAward', () => {
    expect(ROLES).toHaveLength(9);
    expect(isRole('KAM')).toBe(true);
    expect(isRole('PostAward')).toBe(true);
    expect(isRole('CCQ.KAM')).toBe(false);
  });
});
