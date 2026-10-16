import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../errors';
import { KAM_ID, OTHER_ID, makeActor, makeQuote } from '../test-utils';
import {
  assertCan,
  assertHoldsPermission,
  can,
  canSeeCommercialFields,
  canSeeOverrideLog,
  holdsPermission,
  inScope,
  permissionsForRoles,
} from './can';
import { PERMISSION_MATRIX, rolesWithPermission } from './matrix';
import { PERMISSIONS } from '../types/permissions';
import { ROLES } from '../types/roles';
import type { Role } from '../types/roles';

/** Architecture §3.4, transcribed independently of matrix.ts (unqualified role-level view, no resource). */
const EXPECTED: Record<string, Role[]> = {
  'quote.create': ['KAM', 'SalesLeader', 'Admin'],
  'quote.read': [
    'KAM',
    'SalesLeader',
    'EngLead',
    'Engineer',
    'Pricing',
    'Approver',
    'Leadership',
    'Admin',
  ],
  'quote.read.commercialFields': ['EngLead', 'Pricing', 'Approver', 'Leadership', 'Admin'],
  'gate.G1.decide': ['SalesLeader'],
  'engQueue.read': ['EngLead', 'Engineer', 'Leadership', 'Admin'],
  'queue.assign': ['EngLead', 'Admin'],
  'engReview.edit': ['EngLead'],
  'gate.G2.decide': ['EngLead'],
  'pricingQueue.read': ['Pricing', 'Leadership', 'Admin'],
  'quoting.edit': ['Pricing'],
  'gate.G3.submit': ['Pricing'],
  'finalReview.read': ['Approver', 'Leadership', 'Admin'],
  'gate.G4.decide': ['Approver'],
  'outcome.record': ['SalesLeader'],
  'override.request': ['KAM', 'SalesLeader', 'EngLead', 'Pricing'],
  'override.approve': ['SalesLeader', 'Admin'],
  'override.revert': ['SalesLeader', 'EngLead', 'Admin'],
  'overrideLog.read': ['Leadership', 'Admin'],
  'audit.read': ['Leadership', 'Admin'],
  'attachment.upload': ['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing'],
  'export.csv': ['KAM', 'SalesLeader', 'EngLead', 'Pricing', 'Approver', 'Leadership', 'Admin'],
  'analytics.read': ['SalesLeader', 'EngLead', 'Pricing', 'Approver', 'Leadership', 'Admin'],
  'config.manage': ['Admin'],
};

describe('permission matrix', () => {
  it('covers every permission', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  it.each(PERMISSIONS)('%s: role-level grants match architecture §3.4', (permission) => {
    for (const role of ROLES) {
      if (role === 'PostAward') continue;
      expect(can(makeActor(role), permission), `${role} / ${permission}`).toBe(
        EXPECTED[permission]!.includes(role),
      );
    }
  });

  it('lists roles per permission', () => {
    expect(rolesWithPermission('config.manage')).toEqual(['Admin']);
  });

  it('has no unexpected PostAward grant other than quote.read', () => {
    const granted = PERMISSIONS.filter((p) => rolesWithPermission(p).includes('PostAward'));
    expect(granted).toEqual(['quote.read']);
  });
});

describe('qualified grants', () => {
  it('outcome.record: KAM only on their own quote', () => {
    const kam = makeActor('KAM', { userId: KAM_ID });
    expect(can(kam, 'outcome.record', makeQuote('CUSTOMER_DECISION'))).toBe(true);
    expect(can(makeActor('KAM'), 'outcome.record', makeQuote('CUSTOMER_DECISION'))).toBe(false);
    expect(can(kam, 'outcome.record')).toBe(false); // qualified grant needs a resource
    expect(can(makeActor('SalesLeader'), 'outcome.record', makeQuote('CUSTOMER_DECISION'))).toBe(
      true,
    );
  });

  it('engReview.edit: Engineer only when assigned; EngLead always', () => {
    const quote = makeQuote('ENG_REVIEW', { assignedEngineerId: OTHER_ID });
    expect(can(makeActor('Engineer'), 'engReview.edit', quote)).toBe(true);
    expect(can(makeActor('Engineer', { userId: KAM_ID }), 'engReview.edit', quote)).toBe(false);
    expect(can(makeActor('Engineer'), 'engReview.edit', makeQuote('ENG_REVIEW'))).toBe(false);
    expect(can(makeActor('EngLead', { userId: KAM_ID }), 'engReview.edit', quote)).toBe(true);
  });

  it('override.approve: EngLead only for priority and queue overrides', () => {
    const lead = makeActor('EngLead');
    expect(can(lead, 'override.approve', { overrideField: 'priority_tier' })).toBe(true);
    expect(can(lead, 'override.approve', { overrideField: 'queue_position' })).toBe(true);
    expect(can(lead, 'override.approve', { overrideField: 'ship_to' })).toBe(false);
    expect(can(lead, 'override.approve', {})).toBe(false);
    expect(can(makeActor('SalesLeader'), 'override.approve', { overrideField: 'ship_to' })).toBe(
      true,
    );
  });

  it('PostAward reads Awarded quotes only', () => {
    const post = makeActor('PostAward');
    expect(can(post, 'quote.read', makeQuote('AWARDED'))).toBe(true);
    expect(can(post, 'quote.read', makeQuote('QUOTING'))).toBe(false);
    expect(can(post, 'quote.read', {})).toBe(false);
  });

  it('unions permissions across roles', () => {
    const both = makeActor(['KAM', 'Approver']);
    expect(can(both, 'gate.G4.decide')).toBe(true);
    expect(can(both, 'quote.create')).toBe(true);
    expect(can(makeActor([]), 'quote.read')).toBe(false);
  });
});

describe('data scope', () => {
  const quote = makeQuote('QUOTING', { region: 'NA-East', accountId: 'acct-1' });

  it('owner scope: a KAM cannot read another KAM’s quote', () => {
    const owner = makeActor('KAM', { userId: KAM_ID, scope: { type: 'owner' } });
    const stranger = makeActor('KAM', { userId: OTHER_ID, scope: { type: 'owner' } });
    expect(can(owner, 'quote.read', quote)).toBe(true);
    expect(can(stranger, 'quote.read', quote)).toBe(false);
  });

  it('all scope: a KAM can read any quote', () => {
    expect(
      can(makeActor('KAM', { userId: OTHER_ID, scope: { type: 'all' } }), 'quote.read', quote),
    ).toBe(true);
  });

  it('region scope', () => {
    const scoped = (values: string[]) => makeActor('KAM', { scope: { type: 'region', values } });
    expect(can(scoped(['NA-East', 'EU']), 'quote.read', quote)).toBe(true);
    expect(can(scoped(['EU']), 'quote.read', quote)).toBe(false);
    expect(can(scoped(['NA-East']), 'quote.read', makeQuote('QUOTING'))).toBe(false); // resource has no region
  });

  it('account_list scope', () => {
    const scoped = (values: string[]) =>
      makeActor('KAM', { scope: { type: 'account_list', values } });
    expect(can(scoped(['acct-1']), 'quote.read', quote)).toBe(true);
    expect(can(scoped(['acct-2']), 'quote.read', quote)).toBe(false);
    expect(can(scoped(['acct-1']), 'quote.read', makeQuote('QUOTING'))).toBe(false);
  });

  it('owner scope: an Engineer sees quotes assigned to them, a KAM does not via assignment', () => {
    const resource = { kamUserId: KAM_ID, assignedEngineerId: OTHER_ID };
    const engineer = makeActor('Engineer', { userId: OTHER_ID, scope: { type: 'owner' } });
    expect(inScope(engineer, resource)).toBe(true);
    expect(inScope(engineer, { kamUserId: KAM_ID, assignedEngineerId: null })).toBe(false);
    const kam = makeActor('KAM', { userId: OTHER_ID, scope: { type: 'owner' } });
    expect(inScope(kam, resource)).toBe(false);
  });

  it('owner scope with no kamUserId on the resource denies', () => {
    expect(inScope(makeActor('KAM', { scope: { type: 'owner' } }), {})).toBe(false);
  });

  it('scope narrows a role grant but never widens it', () => {
    expect(can(makeActor('Engineer', { scope: { type: 'all' } }), 'config.manage', quote)).toBe(
      false,
    );
  });
});

describe('assertCan', () => {
  it('passes silently when allowed', () => {
    expect(() => assertCan(makeActor('Admin'), 'config.manage')).not.toThrow();
  });

  it('throws a typed ForbiddenError when denied', () => {
    expect(() => assertCan(makeActor('KAM'), 'config.manage')).toThrow(ForbiddenError);
    try {
      assertCan(makeActor('KAM'), 'config.manage');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_PERMITTED', permission: 'config.manage' });
    }
  });
});

describe('visibility helpers', () => {
  it('override log: Leadership and Admin only', () => {
    for (const role of ROLES) {
      expect(canSeeOverrideLog(makeActor(role)), role).toBe(
        role === 'Leadership' || role === 'Admin',
      );
    }
  });

  it('commercial fields', () => {
    expect(canSeeCommercialFields(makeActor('Pricing'))).toBe(true);
    expect(canSeeCommercialFields(makeActor('KAM'))).toBe(false);
  });
});

describe('holdsPermission (route-level check)', () => {
  it('counts qualified grants, which can() without a resource does not', () => {
    const kam = makeActor('KAM');
    expect(can(kam, 'outcome.record')).toBe(false);
    expect(holdsPermission(kam, 'outcome.record')).toBe(true);
    expect(holdsPermission(makeActor('Engineer'), 'engReview.edit')).toBe(true);
  });

  it('denies roles with no grant at all', () => {
    expect(holdsPermission(makeActor('Leadership'), 'quote.create')).toBe(false);
    expect(() => assertHoldsPermission(makeActor('Leadership'), 'quote.create')).toThrow(
      ForbiddenError,
    );
    expect(() => assertHoldsPermission(makeActor('KAM'), 'quote.create')).not.toThrow();
  });

  it('matches the matrix for every role and permission', () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        expect(holdsPermission({ roles: [role] }, permission)).toBe(
          PERMISSION_MATRIX[permission][role] !== undefined,
        );
      }
    }
  });

  it('permissionsForRoles is the union across roles, in matrix order', () => {
    expect(permissionsForRoles([])).toEqual([]);
    expect(permissionsForRoles(['Approver'])).toContain('gate.G4.decide');
    const multi = permissionsForRoles(['SalesLeader', 'Approver']);
    expect(multi).toEqual(PERMISSIONS.filter((p) => multi.includes(p)));
    expect(multi).toEqual(expect.arrayContaining(['gate.G1.decide', 'gate.G4.decide']));
  });
});
