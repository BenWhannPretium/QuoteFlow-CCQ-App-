import { describe, expect, it } from 'vitest';

import { parseIntakeConfig } from '../intake/intake';
import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote } from '../test-utils';
import {
  ENG_QUEUE_SETTINGS_SEED,
  agingBucket,
  agingBucketLabels,
  businessDaysBetween,
  countByAgingBucket,
  filterEngQueue,
  parseEngQueueSettings,
  sortEngQueue,
  type EngQueueEntry,
} from './queue';
import {
  canAssignEngQueue,
  canEditEngReview,
  engineeringCompleteness,
  planAccept,
  planAssignment,
  planCapacityEvidence,
  type CapacityRowInput,
} from './review';
import { asUserId } from '../types/ids';
import { hybridConfig } from '../workflow/seeds/hybrid';
import { computeTimeInStage, summarizeStageTimes } from '../workflow/time-in-stage';

const ENGINEER_ID = asUserId('user-engineer');
const BACKUP_ID = asUserId('user-backup');
const settings = { ...ENG_QUEUE_SETTINGS_SEED, backupAssignerUserIds: [BACKUP_ID] };

describe('settings', () => {
  it('parses the seed and rejects bad config', () => {
    expect(parseEngQueueSettings(ENG_QUEUE_SETTINGS_SEED)).toEqual(ENG_QUEUE_SETTINGS_SEED);
    expect(() =>
      parseEngQueueSettings({ agingDays: { aging: 10, old: 3 }, backupAssignerUserIds: [] }),
    ).toThrow(/old must be ≥ aging/);
    expect(() => parseEngQueueSettings({})).toThrow(/INVALID_CONFIG|failed validation/);
  });
});

describe('business days (US Central)', () => {
  // 2026-10-26 is a Monday. 15:00Z is 10:00 Central.
  const at = (day: string, time = '15:00:00Z') => new Date(`${day}T${time}`);

  it.each([
    ['same day', '2026-10-26', '2026-10-26', 0],
    ['Mon → Thu', '2026-10-26', '2026-10-29', 3],
    ['Fri → Mon', '2026-10-30', '2026-11-02', 1],
    ['Fri → Sat', '2026-10-30', '2026-10-31', 0],
    ['Sat → Mon', '2026-10-31', '2026-11-02', 1],
    ['Mon → next Mon', '2026-10-26', '2026-11-02', 5],
    ['three weeks and a day', '2026-10-26', '2026-11-17', 16],
    ['backwards', '2026-10-29', '2026-10-26', 0],
  ])('%s', (_name, from, to, days) => {
    expect(businessDaysBetween(at(from), at(to))).toBe(days);
  });

  it('uses the Central calendar date, not UTC', () => {
    // 03:00Z on Tuesday is still Monday evening in Chicago.
    expect(businessDaysBetween(at('2026-10-26'), at('2026-10-27', '03:00:00Z'))).toBe(0);
    expect(businessDaysBetween(at('2026-10-26'), at('2026-10-27', '06:00:00Z'))).toBe(1);
  });
});

describe('aging buckets (not an SLA)', () => {
  const edges = ENG_QUEUE_SETTINGS_SEED.agingDays;
  it.each([
    [0, 'fresh'],
    [2, 'fresh'],
    [3, 'aging'],
    [10, 'aging'],
    [11, 'old'],
  ] as const)('%i business days → %s', (days, bucket) => {
    expect(agingBucket(days, edges)).toBe(bucket);
  });

  it('labels and counts', () => {
    expect(agingBucketLabels(edges)).toEqual({
      fresh: '< 3 days',
      aging: '3–10 days',
      old: '> 10 days',
    });
    expect(
      countByAgingBucket([
        { agingBucket: 'old' },
        { agingBucket: 'fresh' },
        { agingBucket: 'old' },
      ]),
    ).toEqual({ fresh: 1, aging: 0, old: 2 });
  });
});

const entry = (quoteNumber: string, over: Partial<EngQueueEntry> = {}): EngQueueEntry => ({
  quoteNumber,
  tier: 'STANDARD',
  score: 50,
  enteredQueueAt: new Date('2026-10-20T15:00:00Z'),
  businessDaysInQueue: 4,
  agingBucket: 'aging',
  pinnedPosition: null,
  assignedEngineerId: null,
  productFamily: 'BOTTLE',
  searchText: quoteNumber.toLowerCase(),
  ...over,
});
const TIERS = ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'];

describe('queue order: pinned → tier → score desc → oldest first', () => {
  it('orders by every key in turn', () => {
    const items = [
      entry('Q-low', { tier: 'LOW', score: 99 }),
      entry('Q-std-60', { score: 60 }),
      entry('Q-std-60-older', { score: 60, enteredQueueAt: new Date('2026-10-01T00:00:00Z') }),
      entry('Q-high', { tier: 'HIGH', score: 61 }),
      entry('Q-pin-2', { tier: 'LOW', pinnedPosition: 2 }),
      entry('Q-pin-1', { tier: 'LOW', pinnedPosition: 1 }),
      entry('Q-unscored', { tier: null, score: null }),
      entry('Q-std-unscored', { score: null }),
      entry('Q-a', { score: 10 }),
      entry('Q-b', { score: 10 }),
    ];
    expect(sortEngQueue(items, TIERS).map((e) => e.quoteNumber)).toEqual([
      'Q-pin-1',
      'Q-pin-2',
      'Q-high',
      'Q-std-60-older',
      'Q-std-60',
      'Q-a',
      'Q-b',
      'Q-std-unscored',
      'Q-low',
      'Q-unscored',
    ]);
  });
});

describe('queue filters', () => {
  const items = [
    entry('A', {
      tier: 'HIGH',
      assignedEngineerId: ENGINEER_ID,
      businessDaysInQueue: 12,
      agingBucket: 'old',
    }),
    entry('B', { productFamily: 'JAR', searchText: 'b acme corp' }),
    entry('C', { tier: null, productFamily: null, businessDaysInQueue: 1, agingBucket: 'fresh' }),
  ];
  const keys = (f: Parameters<typeof filterEngQueue>[1]) =>
    filterEngQueue(items, f).map((e) => e.quoteNumber);

  it('filters by tier, engineer, unassigned, age, bucket, product family and text', () => {
    expect(keys({})).toEqual(['A', 'B', 'C']);
    expect(keys({ tiers: ['HIGH'] })).toEqual(['A']);
    expect(keys({ engineer: ENGINEER_ID })).toEqual(['A']);
    expect(keys({ engineer: 'unassigned' })).toEqual(['B', 'C']);
    expect(keys({ agedOverDays: 10 })).toEqual(['A']);
    expect(keys({ agedOverDays: 0 })).toEqual(['A', 'B', 'C']);
    expect(keys({ agingBuckets: ['fresh'] })).toEqual(['C']);
    expect(keys({ productFamilies: ['JAR'] })).toEqual(['B']);
    expect(keys({ q: '  ACME ' })).toEqual(['B']);
    expect(keys({ q: '   ' })).toEqual(['A', 'B', 'C']);
  });
});

describe('who may assign, accept and edit', () => {
  const quote = makeQuote('ENG_REVIEW', { assignedEngineerId: ENGINEER_ID });
  const engineer = makeActor('Engineer', { userId: ENGINEER_ID });
  const otherEngineer = makeActor('Engineer');

  it('assign: queue.assign holders and backup assigners only', () => {
    expect(canAssignEngQueue(makeActor('EngLead'), settings, quote)).toBe(true);
    expect(canAssignEngQueue(makeActor('Admin'), settings, quote)).toBe(true);
    expect(canAssignEngQueue(engineer, settings, quote)).toBe(false);
    expect(canAssignEngQueue(makeActor('KAM'), settings, quote)).toBe(false);
    expect(canAssignEngQueue(makeActor('Engineer', { userId: BACKUP_ID }), settings, quote)).toBe(
      true,
    );
    // A backup assigner still needs to be able to read the quote.
    const ownerScoped = makeActor('Engineer', { userId: BACKUP_ID, scope: { type: 'owner' } });
    expect(canAssignEngQueue(ownerScoped, settings, quote)).toBe(false);
  });

  it('edit: EngLead, or the assigned Engineer, while in ENG_REVIEW', () => {
    expect(canEditEngReview(makeActor('EngLead'), quote, hybridConfig)).toBe(true);
    expect(canEditEngReview(engineer, quote, hybridConfig)).toBe(true);
    expect(canEditEngReview(otherEngineer, quote, hybridConfig)).toBe(false);
    expect(canEditEngReview(makeActor('KAM', { userId: KAM_ID }), quote, hybridConfig)).toBe(false);
    expect(
      canEditEngReview(makeActor('EngLead'), { ...quote, stageKey: 'QUOTING' }, hybridConfig),
    ).toBe(false);
    expect(
      canEditEngReview(makeActor('EngLead'), { ...quote, status: 'closed' }, hybridConfig),
    ).toBe(false);
    expect(
      canEditEngReview(makeActor('EngLead'), { ...quote, status: 'on_hold' }, hybridConfig),
    ).toBe(true);
  });

  it('planAssignment validates the actor, stage and assignee', () => {
    const lead = makeActor('EngLead');
    const assignee = { id: OTHER_ID, roles: ['Engineer'] as const, active: true };
    expect(planAssignment(lead, settings, quote, assignee)).toEqual({
      ok: true,
      changed: true,
      from: ENGINEER_ID,
      to: OTHER_ID,
    });
    expect(planAssignment(lead, settings, quote, { ...assignee, id: ENGINEER_ID })).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(planAssignment(lead, settings, makeQuote('ENG_REVIEW'), assignee)).toMatchObject({
      ok: true,
      from: null,
    });
    const codes = (r: ReturnType<typeof planAssignment>) =>
      r.ok ? [] : r.errors.map((e) => e.code);
    expect(codes(planAssignment(engineer, settings, quote, assignee))).toEqual(['NOT_PERMITTED']);
    expect(codes(planAssignment(lead, settings, quote, undefined))).toEqual(['INVALID_ASSIGNEE']);
    expect(codes(planAssignment(lead, settings, quote, { ...assignee, active: false }))).toEqual([
      'INVALID_ASSIGNEE',
    ]);
    expect(codes(planAssignment(lead, settings, quote, { ...assignee, roles: ['KAM'] }))).toEqual([
      'INVALID_ASSIGNEE',
    ]);
    expect(
      codes(planAssignment(lead, settings, { ...quote, stageKey: 'QUOTING' }, assignee)),
    ).toEqual(['WRONG_STAGE']);
    expect(codes(planAssignment(lead, settings, { ...quote, status: 'closed' }, assignee))).toEqual(
      ['QUOTE_CLOSED'],
    );
  });

  it('planAccept: once, by the EngLead or the assigned engineer', () => {
    expect(planAccept(makeActor('EngLead'), quote, null)).toEqual({ ok: true });
    expect(planAccept(engineer, quote, null)).toEqual({ ok: true });
    const codes = (r: ReturnType<typeof planAccept>) => (r.ok ? [] : r.errors.map((e) => e.code));
    expect(codes(planAccept(otherEngineer, quote, null))).toEqual(['NOT_PERMITTED']);
    expect(codes(planAccept(engineer, quote, NOW))).toEqual(['ALREADY_ACCEPTED']);
    expect(codes(planAccept(engineer, { ...quote, stageKey: 'INTAKE' }, null))).toEqual([
      'WRONG_STAGE',
    ]);
  });
});

describe('capacity evidence (CR-19, F-059)', () => {
  const row = (over: Partial<CapacityRowInput> = {}): CapacityRowInput => ({
    site: 'AURORA',
    lineAsset: ' Line 4 ',
    assumedEffectivenessPct: 80,
    cycleTimeS: 10,
    utilizationBeforePct: 40,
    analysisDate: '2026-10-26',
    analystId: ENGINEER_ID,
    notes: '  ',
    ...over,
  });
  const stored = [
    {
      id: 'r1',
      assumedEffectivenessPct: 72,
      cycleTimeS: 11,
      utilizationBeforePct: 55,
      allocatedAnnualVolume: 500_000,
      scheduledRunDaysPerYear: 340,
    },
    {
      id: 'r2',
      assumedEffectivenessPct: 80,
      cycleTimeS: 9,
      utilizationBeforePct: 40,
      allocatedAnnualVolume: null,
      scheduledRunDaysPerYear: null,
    },
  ];
  // 10 s x 4 cavities x 80 % x 350 days = 9 676 800 units a year; the quote's volume is half of that.
  const context = {
    cavitation: 4,
    quoteAnnualVolume: 4_838_400,
    basis: { scheduledRunDaysPerYear: 350 },
  };
  const lead = makeActor('EngLead');
  const engineer = makeActor('Engineer', { userId: ENGINEER_ID });

  it('replaces the set: updates, inserts and deletes', () => {
    const plan = planCapacityEvidence(
      lead,
      [row({ id: 'r1', utilizationBeforePct: 65 }), row()],
      stored,
      context,
    );
    expect(plan).toMatchObject({
      ok: true,
      deleteIds: ['r2'],
      upsert: [
        { id: 'r1', utilizationBeforePct: 65, lineAsset: 'Line 4', notes: null },
        { id: null, assumedEffectivenessPct: 80 },
      ],
    });
  });

  it('calculates utilization after on the server; a caller cannot supply it', () => {
    const plan = planCapacityEvidence(lead, [row()], [], context);
    // 40 % before + 4 838 400 / 9 676 800 = 50 % added
    expect(plan).toMatchObject({
      ok: true,
      upsert: [
        {
          allocatedAnnualVolume: 4_838_400,
          scheduledRunDaysPerYear: 350,
          utilizationAfterPct: 90,
        },
      ],
      allocationWarning: null,
    });
  });

  it('defaults the allocated volume and run days, and honours what the engineer sets', () => {
    const plan = planCapacityEvidence(
      lead,
      [
        row({
          allocatedAnnualVolume: 2_419_200,
          scheduledRunDaysPerYear: 300,
          utilizationBeforePct: 10,
        }),
        row({ allocatedAnnualVolume: null, scheduledRunDaysPerYear: null }),
      ],
      [],
      context,
    );
    expect(
      plan.ok && plan.upsert.map((r) => [r.allocatedAnnualVolume, r.scheduledRunDaysPerYear]),
    ).toEqual([
      [2_419_200, 300],
      [4_838_400, 350],
    ]);
    // 2 419 200 / ((86400/10) x 4 x 0.8 x 300 = 8 294 400) = 29.17 % on top of 10 %
    expect(plan.ok && plan.upsert[0]!.utilizationAfterPct).toBeCloseTo(39.17, 2);
  });

  it('keeps a stored value that is omitted on an existing row, and defaults a blank one', () => {
    const plan = planCapacityEvidence(lead, [row({ id: 'r1' })], stored, context);
    expect(plan.ok && plan.upsert[0]).toMatchObject({
      allocatedAnnualVolume: 500_000,
      scheduledRunDaysPerYear: 340,
    });
    const blank = planCapacityEvidence(
      lead,
      [row({ id: 'r1', allocatedAnnualVolume: null, scheduledRunDaysPerYear: null })],
      stored,
      context,
    );
    expect(blank.ok && blank.upsert[0]).toMatchObject({
      allocatedAnnualVolume: 4_838_400,
      scheduledRunDaysPerYear: 350,
    });
  });

  it('leaves utilization after empty until the review has a cavitation', () => {
    const plan = planCapacityEvidence(lead, [row()], [], { ...context, cavitation: null });
    expect(plan.ok && plan.upsert[0]!.utilizationAfterPct).toBeNull();
  });

  it('T-030: warns, and does not block, when the rows do not add up to the quote volume', () => {
    const plan = planCapacityEvidence(
      lead,
      [
        row({ lineAsset: 'Line 1', allocatedAnnualVolume: 3_000_000 }),
        row({ lineAsset: 'Line 2', allocatedAnnualVolume: 1_000_000 }),
      ],
      [],
      context,
    );
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.allocationWarning).toMatchObject({
      allocated: 4_000_000,
      total: 4_838_400,
      difference: -838_400,
    });
    const split = planCapacityEvidence(
      lead,
      [row({ allocatedAnnualVolume: 3_000_000 }), row({ allocatedAnnualVolume: 1_838_400 })],
      [],
      context,
    );
    expect(split.ok && split.allocationWarning).toBeNull();
  });

  it('effectiveness has no default: it must be stated on every new row', () => {
    const plan = planCapacityEvidence(
      lead,
      [row({ assumedEffectivenessPct: undefined })],
      [],
      context,
    );
    expect(!plan.ok && plan.errors.map((e) => [e.code, e.field, e.message])).toEqual([
      [
        'MISSING_FIELD',
        'rows/0/assumedEffectivenessPct',
        'Row 1: state the assumed effectiveness % (there is no default)',
      ],
    ]);
    const nulls = planCapacityEvidence(
      engineer,
      [row({ cycleTimeS: null, utilizationBeforePct: undefined })],
      [],
      context,
    );
    expect(!nulls.ok && nulls.errors.map((e) => e.field)).toEqual([
      'rows/0/cycleTimeS',
      'rows/0/utilizationBeforePct',
    ]);
  });

  it('commercial numbers are write-only only for an actor who cannot see them: omitted means keep', () => {
    // Since 2026-10-30 every role sees them; an actor with no role is the only one left.
    const plan = planCapacityEvidence(
      makeActor([]),
      [
        row({
          id: 'r1',
          assumedEffectivenessPct: undefined,
          cycleTimeS: undefined,
          utilizationBeforePct: undefined,
          notes: 'line confirmed',
        }),
        row({ id: 'r2', utilizationBeforePct: 5 }),
      ],
      stored,
      context,
    );
    expect(plan).toMatchObject({
      ok: true,
      deleteIds: [],
      upsert: [
        { id: 'r1', assumedEffectivenessPct: 72, cycleTimeS: 11, utilizationBeforePct: 55 },
        { id: 'r2', utilizationBeforePct: 5 },
      ],
    });
    // Someone who can see the numbers must send them: omitting one is an error, not "keep".
    const lead2 = planCapacityEvidence(
      lead,
      [row({ id: 'r1', cycleTimeS: undefined })],
      stored,
      context,
    );
    expect(!lead2.ok && lead2.errors.map((e) => e.field)).toEqual(['rows/0/cycleTimeS']);
    // The assigned Engineer sees the numbers they entered, so the same rule applies to them.
    const eng2 = planCapacityEvidence(
      engineer,
      [row({ id: 'r1', cycleTimeS: undefined })],
      stored,
      context,
    );
    expect(!eng2.ok && eng2.errors.map((e) => e.field)).toEqual(['rows/0/cycleTimeS']);
  });

  it('rejects rows from another quote and duplicates', () => {
    const plan = planCapacityEvidence(
      lead,
      [row({ id: 'nope' }), row({ id: 'r1' }), row({ id: 'r1' })],
      stored,
      context,
    );
    expect(!plan.ok && plan.errors.map((e) => e.field)).toEqual(['rows/0/id', 'rows/2/id']);
  });
});

describe('engineering completeness', () => {
  const config = parseIntakeConfig({
    requiredFields: [{ field: 'product_family', op: 'present' }],
    volumePlaceholder: { values: [1_000_000], roundMultiple: null },
    defaultRequestClass: 'CCQ',
    allowedRequestClasses: ['CCQ'],
    redirectMessage: 'Submit it in the pricing application.',
    drawingProvidedCodes: ['HAVE_DRAWING'],
  });
  it('lists what Engineering may chase, without the intake-only request class block', () => {
    const codes = engineeringCompleteness(
      { product_family: 'BOTTLE', request_class: 'STOCK', est_annual_volume: 1_000_000 },
      config,
      NOW,
    ).map((w) => `${w.code}:${w.field}`);
    expect(codes).toContain('VOLUME_PLACEHOLDER:est_annual_volume');
    expect(codes).toContain('DRAWING_MISSING:drawing_status');
    expect(codes).toContain('ENRICH:neck_diameter');
    expect(codes.some((c) => c.startsWith('REQUEST_CLASS_NOT_ALLOWED'))).toBe(false);
    expect(engineeringCompleteness({}, config, NOW)[0]).toMatchObject({
      code: 'MISSING_FIELD',
      field: 'product_family',
    });
  });
});

describe('stage time totals', () => {
  it('sums visits per stage in first-entry order, excluding holds', () => {
    const d = (s: string) => new Date(`2026-10-${s}T00:00:00Z`);
    const times = computeTimeInStage(
      [
        { stageKey: 'INTAKE', enteredAt: d('01'), exitedAt: d('02') },
        { stageKey: 'ENG_REVIEW', enteredAt: d('02'), exitedAt: d('05') },
        { stageKey: 'INTAKE', enteredAt: d('05'), exitedAt: d('06') },
        { stageKey: 'ENG_REVIEW', enteredAt: d('06'), exitedAt: null },
      ],
      [{ startedAt: d('03'), endedAt: d('04') }],
      d('08'),
    );
    const DAY = 86_400_000;
    expect(summarizeStageTimes(times)).toEqual([
      {
        stageKey: 'INTAKE',
        visits: 2,
        elapsedMs: 2 * DAY,
        heldMs: 0,
        activeMs: 2 * DAY,
        current: false,
      },
      {
        stageKey: 'ENG_REVIEW',
        visits: 2,
        elapsedMs: 5 * DAY,
        heldMs: DAY,
        activeMs: 4 * DAY,
        current: true,
      },
    ]);
  });
});
