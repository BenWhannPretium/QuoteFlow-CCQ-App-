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
    [['KAM'], ['home', 'intake', 'proposals', 'pipeline']],
    [
      ['SalesLeader'],
      ['home', 'intake', 'proposals', 'qualify', 'pipeline', 'approvals', 'analytics'],
    ],
    [['EngLead'], ['home', 'queue-engineering', 'pipeline', 'approvals', 'analytics']],
    [['Engineer'], ['home', 'queue-engineering', 'pipeline']],
    [['Pricing'], ['home', 'queue-pricing', 'pipeline', 'analytics']],
    [['Approver'], ['home', 'pipeline', 'approvals', 'analytics']],
    [
      ['Leadership'],
      ['home', 'queue-engineering', 'queue-pricing', 'pipeline', 'approvals', 'analytics', 'audit'],
    ],
    [
      ['Admin'],
      [
        'home',
        'intake',
        'queue-engineering',
        'queue-pricing',
        'pipeline',
        'approvals',
        'analytics',
        'admin',
      ],
    ],
    [
      ['SalesLeader', 'Approver'],
      ['home', 'intake', 'proposals', 'qualify', 'pipeline', 'approvals', 'analytics'],
    ],
  ])('%j → %j', (roles, expected) => {
    expect(keys(...roles)).toEqual(expected);
  });

  it('labels the engineering queue per role', () => {
    const label = (role: Role) =>
      navItemsFor(meFor(role)).find((i) => i.key === 'queue-engineering')?.label;
    expect(label('EngLead')).toBe('Engineering queue');
    expect(label('Engineer')).toBe('My assignments');
    expect(label('Leadership')).toBe('Engineering queue');
    expect(label('Admin')).toBe('Engineering queue');
    expect(label('KAM')).toBeUndefined();
  });

  it('hides "To qualify" when G1 is switched off (g1_enabled=false)', () => {
    expect(navItemsFor(meFor('SalesLeader'), { g1Enabled: false }).map((i) => i.key)).toEqual([
      'home',
      'intake',
      'proposals',
      'pipeline',
      'approvals',
      'analytics',
    ]);
    const qualify = navItemsFor(meFor('SalesLeader')).find((i) => i.key === 'qualify')!;
    expect(qualify).toMatchObject({
      label: 'To qualify',
      to: '/approvals',
      search: { gate: 'G1' },
    });
  });

  it('tells Approvals and the G1 queue apart by the gate search param', () => {
    const items = navItemsFor(meFor('SalesLeader', 'Approver'));
    const qualify = items.find((i) => i.key === 'qualify')!;
    const approvals = items.find((i) => i.key === 'approvals')!;
    expect(isNavItemActive(qualify, '/approvals', { gate: 'G1' })).toBe(true);
    expect(isNavItemActive(approvals, '/approvals', { gate: 'G1' })).toBe(false);
    expect(isNavItemActive(approvals, '/approvals', {})).toBe(true);
  });

  it('B-12: the Approvals tabs keep the right rail item active', () => {
    const items = navItemsFor(meFor('SalesLeader', 'Approver'));
    const qualify = items.find((i) => i.key === 'qualify')!;
    const approvals = items.find((i) => i.key === 'approvals')!;
    // Final Review and Overrides are Approvals; the To qualify tab is the qualify item.
    for (const search of [{ tab: 'final-review' }, { tab: 'overrides' }, { gate: 'G4' }]) {
      expect(isNavItemActive(approvals, '/approvals', search), JSON.stringify(search)).toBe(true);
      expect(isNavItemActive(qualify, '/approvals', search), JSON.stringify(search)).toBe(false);
    }
    expect(isNavItemActive(qualify, '/approvals', { tab: 'to-qualify' })).toBe(true);
    expect(isNavItemActive(approvals, '/approvals', { tab: 'to-qualify' })).toBe(false);
  });

  it('B-12: the review screen highlights Approvals, not Pipeline', () => {
    const items = navItemsFor(meFor('Approver'));
    const path = '/quotes/CCQ-2026-00007/review';
    expect(
      isNavItemActive(
        items.find((i) => i.key === 'approvals')!,
        path,
      ),
    ).toBe(true);
    expect(
      isNavItemActive(
        items.find((i) => i.key === 'pipeline')!,
        path,
      ),
    ).toBe(false);
    expect(
      isNavItemActive(
        items.find((i) => i.key === 'pipeline')!,
        '/quotes/CCQ-2026-00007',
      ),
    ).toBe(true);
  });

  it('B-12: Leadership gets Approvals to read the Final Review queue, with no decision permission', () => {
    const me = meFor('Leadership');
    expect(navItemsFor(me).some((i) => i.key === 'approvals')).toBe(true);
    expect(me.permissions).toContain('finalReview.read');
    expect(me.permissions).not.toContain('gate.G4.decide');
  });

  it('follows the permissions, not role names', () => {
    const me = { ...meFor('KAM'), permissions: ['quote.read', 'config.manage'] };
    expect(navItemsFor(me).map((i) => i.key)).toEqual(['home', 'pipeline', 'admin']);
  });
});

describe('isNavItemActive', () => {
  const [home, , , pipeline] = navItemsFor(meFor('KAM')) as [NavItem, NavItem, NavItem, NavItem];
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
