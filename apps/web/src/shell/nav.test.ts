import type { MeResponse } from '@ccq/contracts';
import { permissionsForRoles, type Role } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { landingFor, landingRolesFor } from '@/landing/landings';

import { isNavItemActive, navItemsFor, splitTabs, type NavItem } from './nav';

const meFor = (...roles: Role[]): MeResponse => ({
  user: { id: '0192f0c0-0000-7000-8000-000000000001', displayName: 'T', upn: 't', email: null },
  roles,
  permissions: permissionsForRoles(roles),
  scope: { type: 'all' },
  featureFlags: {},
  authMode: 'dev',
});

const keys = (...roles: Role[]) => navItemsFor(meFor(...roles)).map((i) => i.key);

describe('navItemsFor (from the seeded permission matrix)', () => {
  it.each<[Role[], string[]]>([
    [['KAM'], ['home', 'intake', 'pipeline']],
    [['SalesLeader'], ['home', 'intake', 'pipeline', 'analytics']],
    [['EngLead'], ['home', 'queue-engineering', 'pipeline', 'analytics']],
    [['Engineer'], ['home', 'queue-engineering', 'pipeline']],
    [['Pricing'], ['home', 'queue-pricing', 'pipeline', 'analytics']],
    [['Approver'], ['home', 'pipeline', 'approvals', 'analytics']],
    [['Leadership'], ['home', 'pipeline', 'analytics']],
    [['Admin'], ['home', 'intake', 'pipeline', 'analytics', 'admin']],
    [
      ['SalesLeader', 'Approver'],
      ['home', 'intake', 'pipeline', 'approvals', 'analytics'],
    ],
  ])('%j → %j', (roles, expected) => {
    expect(keys(...roles)).toEqual(expected);
  });

  it('labels the engineering queue per role', () => {
    const label = (role: Role) =>
      navItemsFor(meFor(role)).find((i) => i.key === 'queue-engineering')?.label;
    expect(label('EngLead')).toBe('Engineering queue');
    expect(label('Engineer')).toBe('My assignments');
  });

  it('follows the permissions, not role names', () => {
    const me = { ...meFor('KAM'), permissions: ['quote.read', 'config.manage'] };
    expect(navItemsFor(me).map((i) => i.key)).toEqual(['home', 'pipeline', 'admin']);
  });
});

describe('isNavItemActive', () => {
  const [home, , pipeline] = navItemsFor(meFor('KAM')) as [NavItem, NavItem, NavItem];
  it('matches home exactly and pipeline on /quotes and /board', () => {
    expect(isNavItemActive(home, '/')).toBe(true);
    expect(isNavItemActive(home, '/quotes')).toBe(false);
    expect(isNavItemActive(pipeline, '/quotes/CCQ-2026-00001')).toBe(true);
    expect(isNavItemActive(pipeline, '/board')).toBe(true);
    expect(isNavItemActive(pipeline, '/quotesx')).toBe(false);
  });
});

describe('splitTabs', () => {
  it('keeps five tabs and moves the rest behind More', () => {
    const items = navItemsFor(meFor('EngLead', 'Pricing', 'Approver', 'Admin'));
    expect(items.length).toBeGreaterThan(5);
    const { tabs, overflow } = splitTabs(items);
    expect(tabs).toHaveLength(4);
    expect([...tabs, ...overflow]).toEqual(items);
    expect(splitTabs(items.slice(0, 5)).overflow).toEqual([]);
  });
});

describe('landing', () => {
  it('picks the primary role for multi-role users', () => {
    expect(landingFor(['SalesLeader', 'Approver'])?.role).toBe('Approver');
    expect(landingRolesFor(['KAM', 'Leadership'])).toEqual(['KAM', 'Leadership']);
  });

  it('honours a requested role only if the user holds it', () => {
    expect(landingFor(['SalesLeader', 'Approver'], 'SalesLeader')?.role).toBe('SalesLeader');
    expect(landingFor(['KAM'], 'Admin')?.role).toBe('KAM');
  });

  it('returns null for users with no known role', () => {
    expect(landingFor(['Unknown'])).toBeNull();
  });
});
