import { describe, expect, it } from 'vitest';

import type { DomainError } from '../errors';
import { KAM_ID, makeActor, makeQuote } from '../test-utils';
import {
  canRequestOverride,
  findOverridableField,
  OVERRIDE_SETTINGS_SEED,
  overrideActions,
  overrideValuesEqual,
  canonicalJson,
  describeOverrideValue,
  parseOverrideSettings,
  planOverrideDecision,
  planOverrideRequest,
  planOverrideRevert,
  type OverrideQuote,
  type OverrideRecord,
  type OverrideSettings,
} from './index';
import { asUserId } from '../types/ids';
import type { Role } from '../types/roles';

const settings = parseOverrideSettings(OVERRIDE_SETTINGS_SEED);
const ctx = { tierKeys: ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'] };
const quote = (over: { status?: OverrideQuote['status']; region?: string } = {}): OverrideQuote => {
  const q = makeQuote('ENG_REVIEW');
  return {
    kamUserId: q.kamUserId,
    assignedEngineerId: null,
    stageKey: q.stageKey,
    status: over.status ?? 'active',
    ...(over.region ? { region: over.region } : {}),
  };
};
const LEADER_ID = asUserId('user-leader');
const ENGLEAD_ID = asUserId('user-englead');
const kam = makeActor('KAM', { userId: KAM_ID });
const otherKam = makeActor('KAM', { userId: asUserId('user-kam-2') });
const leader = makeActor('SalesLeader', { userId: LEADER_ID });
const engLead = makeActor('EngLead', { userId: ENGLEAD_ID });
const as = (role: Role) => makeActor(role, { userId: asUserId(`user-${role}`) });
const why = 'Strategic launch for the account renewal';
const codes = (r: { ok: boolean; errors?: DomainError[] }) =>
  r.ok ? [] : (r as { errors: DomainError[] }).errors.map((e) => e.code);

const record = (over: Partial<OverrideRecord> = {}): OverrideRecord => ({
  id: 'ovr-1',
  field: 'priority_tier',
  requestedBy: KAM_ID,
  status: 'requested',
  approvalMode: 'approver',
  originalValue: 'STANDARD',
  requestedValue: 'HIGH',
  ...over,
});

describe('override settings (config)', () => {
  it('parses the provisional seed: tier needs an approver, ship-to and queue position are self-applied', () => {
    expect(findOverridableField(settings, 'priority_tier')).toMatchObject({
      approval: 'approver',
      approverRoles: ['SalesLeader', 'EngLead'],
    });
    expect(findOverridableField(settings, 'ship_to')).toMatchObject({
      approval: 'self',
      approverRoles: [],
    });
    expect(findOverridableField(settings, 'queue_position')).toMatchObject({
      approval: 'self',
      requestRoles: ['EngLead'],
    });
    expect(settings.justificationMinLength).toBe(15);
  });

  it.each([
    ['not an object', 'nope', /validation/],
    [
      'unknown role',
      {
        ...OVERRIDE_SETTINGS_SEED,
        fields: [{ ...OVERRIDE_SETTINGS_SEED.fields[0], requestRoles: ['Boss'] }],
      },
      /validation/,
    ],
    [
      'duplicate field',
      {
        ...OVERRIDE_SETTINGS_SEED,
        fields: [OVERRIDE_SETTINGS_SEED.fields[0], OVERRIDE_SETTINGS_SEED.fields[0]],
      },
      /Duplicate/,
    ],
    [
      'unknown field',
      {
        ...OVERRIDE_SETTINGS_SEED,
        fields: [{ ...OVERRIDE_SETTINGS_SEED.fields[1], field: 'price' }],
      },
      /No value kind/,
    ],
    [
      'approver mode without approvers',
      {
        ...OVERRIDE_SETTINGS_SEED,
        fields: [{ ...OVERRIDE_SETTINGS_SEED.fields[0], approverRoles: [] }],
      },
      /needs approverRoles/,
    ],
    [
      'self mode with approvers',
      {
        ...OVERRIDE_SETTINGS_SEED,
        fields: [{ ...OVERRIDE_SETTINGS_SEED.fields[1], approverRoles: ['Admin'] }],
      },
      /takes no approverRoles/,
    ],
  ])('rejects %s', (_name, input, message) => {
    expect(() => parseOverrideSettings(input)).toThrow(message);
  });

  it('who approves is config: making ship-to need a SalesLeader is a settings change only', () => {
    const changed: OverrideSettings = parseOverrideSettings({
      ...OVERRIDE_SETTINGS_SEED,
      fields: OVERRIDE_SETTINGS_SEED.fields.map((f) =>
        f.field === 'ship_to' ? { ...f, approval: 'approver', approverRoles: ['SalesLeader'] } : f,
      ),
    });
    const r = planOverrideRequest(
      changed,
      kam,
      quote(),
      {
        field: 'ship_to',
        requestedValue: { line1: '9 New Rd', city: 'Elsewhere' },
        justification: why,
      },
      { line1: '1 Old Rd', city: 'Here' },
      ctx,
      { openRequestExists: false },
    );
    expect(r.ok && r.plan).toMatchObject({ status: 'requested', apply: false });
  });
});

describe('values', () => {
  it('compares structurally, ignoring key order, with null = undefined', () => {
    expect(overrideValuesEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(overrideValuesEqual(null, undefined)).toBe(true);
    expect(overrideValuesEqual('HIGH', 'LOW')).toBe(false);
    expect(canonicalJson({ b: undefined, a: 'x' })).toBe('{"a":"x"}');
  });

  it('describes values for logs', () => {
    expect(describeOverrideValue('ship_to', { line1: '1 Main', city: 'Town', state: '' })).toBe(
      '1 Main, Town',
    );
    expect(describeOverrideValue('ship_to', null)).toBe('—');
    expect(describeOverrideValue('priority_tier', 'HIGH')).toBe('HIGH');
    expect(describeOverrideValue('priority_tier', null)).toBe('—');
    expect(describeOverrideValue('queue_position', 1)).toBe('#1');
    expect(describeOverrideValue('queue_position', null)).toBe('—');
    expect(describeOverrideValue('mystery', { a: 1 })).toBe('{"a":1}');
  });
});

describe('planOverrideRequest', () => {
  const request = (
    actor = kam,
    input: Partial<{ field: string; requestedValue: unknown; justification: string }> = {},
    current: unknown = 'STANDARD',
    q = quote(),
    openRequestExists = false,
  ) =>
    planOverrideRequest(
      settings,
      actor,
      q,
      { field: 'priority_tier', requestedValue: 'HIGH', justification: why, ...input },
      current,
      ctx,
      { openRequestExists },
    );

  it('a tier request waits for an approver and notifies the approver roles', () => {
    const r = request();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({
      status: 'requested',
      apply: false,
      originalValue: 'STANDARD',
      requestedValue: 'HIGH',
      justification: why,
      audits: ['override_requested'],
      activityType: 'override_requested',
    });
    expect(r.plan.notifications).toEqual([
      { type: 'override.requested', recipient: { kind: 'role', role: 'SalesLeader' } },
      { type: 'override.requested', recipient: { kind: 'role', role: 'EngLead' } },
    ]);
  });

  it('a ship-to is self-applied by the KAM with the address normalized, and still logged', () => {
    const r = request(
      kam,
      {
        field: 'ship_to',
        requestedValue: { line1: '  9  New Rd ', city: 'Elsewhere', state: '', country: null },
      },
      { line1: '1 Old Rd', city: 'Here' },
    );
    expect(r.ok && r.plan).toMatchObject({
      status: 'applied',
      apply: true,
      requestedValue: { line1: '9 New Rd', city: 'Elsewhere' },
      originalValue: { line1: '1 Old Rd', city: 'Here' },
      audits: ['override_requested', 'override_applied'],
      activityType: 'override_applied',
      notifications: [],
    });
  });

  it('the EngLead pins a quote to the top of the queue (self)', () => {
    const r = request(engLead, { field: 'queue_position', requestedValue: 1 }, null);
    expect(r.ok && r.plan).toMatchObject({
      status: 'applied',
      originalValue: null,
      requestedValue: 1,
    });
  });

  it('requires a justification of the configured minimum length (trimmed)', () => {
    expect(codes(request(kam, { justification: '   too short    ' }))).toEqual([
      'JUSTIFICATION_REQUIRED',
    ]);
    expect(request(kam, { justification: '  exactly fifteen ' }).ok).toBe(true);
  });

  it('reports every input problem at once', () => {
    expect(codes(request(kam, { justification: 'no', requestedValue: 'MEGA' }))).toEqual([
      'JUSTIFICATION_REQUIRED',
      'INVALID_VALUE',
    ]);
  });

  it.each([
    ['tier not in the model', 'priority_tier', 'MEGA'],
    ['address not an object', 'ship_to', 'somewhere'],
    ['address array', 'ship_to', ['a']],
    ['address with no street or city', 'ship_to', { state: 'MO' }],
    ['address part not text', 'ship_to', { line1: 5 }],
    ['address part too long', 'ship_to', { line1: 'x'.repeat(201) }],
    ['position zero', 'queue_position', 0],
    ['position fractional', 'queue_position', 1.5],
  ])('rejects an invalid value: %s', (_n, field, requestedValue) => {
    const actor = field === 'queue_position' ? engLead : kam;
    expect(codes(request(actor, { field, requestedValue }, null))).toEqual(['INVALID_VALUE']);
  });

  it('rejects a no-op request', () => {
    expect(codes(request(kam, { requestedValue: 'STANDARD' }))).toEqual(['NO_CHANGE']);
  });

  it('rejects a field that is not configured as overridable', () => {
    expect(codes(request(kam, { field: 'est_annual_revenue', requestedValue: 1 }))).toEqual([
      'NOT_OVERRIDABLE',
    ]);
  });

  it.each<[string, ReturnType<typeof makeActor>, string]>([
    ['an Engineer (no override.request)', as('Engineer'), 'priority_tier'],
    ['Leadership (read-only)', as('Leadership'), 'priority_tier'],
    ['Pricing for ship-to (not a requester role)', as('Pricing'), 'ship_to'],
    ['a KAM for queue position (EngLead only)', kam, 'queue_position'],
    ["another KAM's ship-to (own quotes only)", otherKam, 'ship_to'],
  ])('denies %s', (_n, actor, field) => {
    const value = field === 'ship_to' ? { city: 'X' } : field === 'queue_position' ? 1 : 'HIGH';
    expect(codes(request(actor, { field, requestedValue: value }, null))).toEqual([
      'NOT_PERMITTED',
    ]);
  });

  it('a SalesLeader may change any ship-to; scope still applies', () => {
    expect(request(leader, { field: 'ship_to', requestedValue: { city: 'X' } }, null).ok).toBe(
      true,
    );
    const ownerScoped = makeActor('KAM', { userId: asUserId('x'), scope: { type: 'owner' } });
    expect(codes(request(ownerScoped))).toEqual(['NOT_PERMITTED']);
  });

  it('refuses a closed quote and a second open request on the same field', () => {
    expect(codes(request(kam, {}, 'STANDARD', quote({ status: 'closed' })))).toEqual([
      'QUOTE_CLOSED',
    ]);
    expect(codes(request(kam, {}, 'STANDARD', quote(), true))).toEqual(['OVERRIDE_PENDING']);
  });

  it('captures a missing original value as null', () => {
    const r = planOverrideRequest(
      settings,
      kam,
      quote(),
      { field: 'priority_tier', requestedValue: 'HIGH', justification: why },
      undefined,
      ctx,
      { openRequestExists: false },
    );
    expect(r.ok && r.plan.originalValue).toBeNull();
  });
});

describe('planOverrideDecision', () => {
  const decide = (
    actor = leader,
    decision: 'approve' | 'reject' = 'approve',
    current: unknown = 'STANDARD',
    rec = record(),
    note?: string | null,
    q = quote(),
  ) => planOverrideDecision(settings, actor, q, rec, decision, current, note);

  it('approve applies at once and tells the requester', () => {
    const r = decide(leader, 'approve', 'STANDARD', record(), '  fine  ');
    expect(r.ok && r.plan).toEqual({
      status: 'applied',
      apply: true,
      note: 'fine',
      audits: ['override_approved', 'override_applied'],
      activityType: 'override_applied',
      notifications: [{ type: 'override.approved', recipient: { kind: 'user', userId: KAM_ID } }],
    });
  });

  it('the EngLead may approve tier overrides (matrix: priority and queue only)', () => {
    expect(decide(engLead).ok).toBe(true);
  });

  it('fails with STALE_VALUE when the field changed since the request (→ 409)', () => {
    expect(codes(decide(leader, 'approve', 'LOW'))).toEqual(['STALE_VALUE']);
  });

  it('reject needs a note and does not apply', () => {
    expect(codes(decide(leader, 'reject', 'STANDARD', record(), ' '))).toEqual(['NOTE_REQUIRED']);
    const r = decide(leader, 'reject', 'LOW', record(), 'Score already reflects it');
    expect(r.ok && r.plan).toMatchObject({
      status: 'rejected',
      apply: false,
      audits: ['override_rejected'],
    });
  });

  it.each<[string, ReturnType<typeof makeActor>]>([
    ['the KAM', kam],
    ['Leadership', as('Leadership')],
    ['Pricing', as('Pricing')],
    ['Admin (holds override.approve but is not a configured approver)', as('Admin')],
  ])('denies %s', (_n, actor) => {
    expect(codes(decide(actor))).toEqual(['NOT_PERMITTED']);
  });

  it('nobody decides their own request', () => {
    expect(
      codes(decide(leader, 'approve', 'STANDARD', record({ requestedBy: LEADER_ID }))),
    ).toEqual(['SEGREGATION']);
  });

  it('only a requested override can be decided; a closed quote cannot take an approval', () => {
    expect(codes(decide(leader, 'approve', 'HIGH', record({ status: 'applied' })))).toEqual([
      'INVALID_STATE',
    ]);
    expect(
      codes(decide(leader, 'approve', 'STANDARD', record(), null, quote({ status: 'closed' }))),
    ).toEqual(['QUOTE_CLOSED']);
  });

  it('a self-applied field has no approver; an unconfigured field cannot be decided', () => {
    expect(codes(decide(leader, 'approve', null, record({ field: 'ship_to' })))).toEqual([
      'NOT_PERMITTED',
    ]);
    expect(codes(decide(leader, 'approve', null, record({ field: 'gone' })))).toEqual([
      'NOT_OVERRIDABLE',
    ]);
  });
});

describe('planOverrideRevert', () => {
  const applied = record({ status: 'applied' });
  const shipTo = record({
    field: 'ship_to',
    status: 'applied',
    approvalMode: 'self',
    originalValue: { line1: '1 Old Rd' },
    requestedValue: { line1: '9 New Rd' },
  });

  it('an approver reverts in one click; the original is restored exactly', () => {
    const r = planOverrideRevert(settings, leader, quote(), applied, 'HIGH');
    expect(r.ok && r.plan).toEqual({
      status: 'reverted',
      restoreValue: 'STANDARD',
      audits: ['override_reverted'],
      activityType: 'override_reverted',
      notifications: [{ type: 'override.reverted', recipient: { kind: 'user', userId: KAM_ID } }],
    });
  });

  it('the requester of a self-applied override may revert it (no notification to themselves)', () => {
    const r = planOverrideRevert(settings, kam, quote(), shipTo, { line1: '9 New Rd' });
    expect(r.ok && r.plan).toMatchObject({
      restoreValue: { line1: '1 Old Rd' },
      notifications: [],
    });
  });

  it('a revert role may revert a self-applied override too', () => {
    expect(planOverrideRevert(settings, leader, quote(), shipTo, { line1: '9 New Rd' }).ok).toBe(
      true,
    );
  });

  it('restores a null original as null', () => {
    const pinned = record({
      field: 'queue_position',
      status: 'applied',
      approvalMode: 'self',
      originalValue: undefined,
      requestedValue: 1,
      requestedBy: ENGLEAD_ID,
    });
    const r = planOverrideRevert(settings, engLead, quote(), pinned, 1);
    expect(r.ok && r.plan.restoreValue).toBeNull();
  });

  it.each<[string, ReturnType<typeof makeActor>, OverrideRecord]>([
    ['the KAM who requested an approved tier change', kam, applied],
    ['Leadership', as('Leadership'), applied],
    ['another KAM on a self-applied ship-to', otherKam, shipTo],
    ['anyone on an unconfigured field', leader, record({ field: 'gone', status: 'applied' })],
  ])('denies %s', (_n, actor, rec) => {
    expect(codes(planOverrideRevert(settings, actor, quote(), rec, rec.requestedValue))).toEqual([
      'NOT_PERMITTED',
    ]);
  });

  it('only an applied override can be reverted', () => {
    expect(codes(planOverrideRevert(settings, leader, quote(), record(), 'STANDARD'))).toEqual([
      'INVALID_STATE',
    ]);
  });

  it('fails with STALE_VALUE when a later change replaced the value', () => {
    expect(codes(planOverrideRevert(settings, leader, quote(), applied, 'CRITICAL'))).toEqual([
      'STALE_VALUE',
    ]);
  });

  it('a self-requester out of scope may not revert', () => {
    const scoped = makeActor('KAM', {
      userId: KAM_ID,
      scope: { type: 'region', values: ['East'] },
    });
    expect(
      codes(
        planOverrideRevert(
          settings,
          scoped,
          quote({ region: 'West' }),
          shipTo,
          shipTo.requestedValue,
        ),
      ),
    ).toEqual(['NOT_PERMITTED']);
  });
});

describe('overrideActions and canRequestOverride (UI hints)', () => {
  it('flags what the caller may do', () => {
    expect(overrideActions(settings, leader, quote(), record())).toEqual({
      canDecide: true,
      canRevert: false,
    });
    expect(overrideActions(settings, kam, quote(), record())).toEqual({
      canDecide: false,
      canRevert: false,
    });
    expect(overrideActions(settings, leader, quote(), record({ requestedBy: LEADER_ID }))).toEqual({
      canDecide: false,
      canRevert: false,
    });
    expect(overrideActions(settings, leader, quote(), record({ status: 'applied' }))).toEqual({
      canDecide: false,
      canRevert: true,
    });
    expect(overrideActions(settings, leader, quote(), record({ field: 'gone' }))).toEqual({
      canDecide: false,
      canRevert: false,
    });
  });

  it('requestable fields follow config', () => {
    const shipTo = findOverridableField(settings, 'ship_to')!;
    expect(canRequestOverride(shipTo, kam, quote())).toBe(true);
    expect(canRequestOverride(shipTo, otherKam, quote())).toBe(false);
  });
});
