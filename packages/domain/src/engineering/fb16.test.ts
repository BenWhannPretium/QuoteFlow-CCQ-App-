import { describe, expect, it } from 'vitest';

import { ASSIGNMENT_RULES_SEED, suggestEngineer } from './assignment-rules';
import { computeUtilization, utilizationLevel } from './capacity';
import {
  PACK_OUT_REQUIREMENT_KEY,
  PACK_OUT_RULE_SEED,
  isForwardOutcome,
  packOutRequirementErrors,
  packOutRuleErrors,
  packOutUnitProvided,
  parsePackOutRule,
} from './pack-out';
import {
  MACHINE_TYPE_PROCESS_MAP_SEED,
  TWO_STEP_PLANT_MACHINE_TYPES_SEED,
  checkPlantRunsMachineType,
  machineTypeProcessMapErrors,
  machineTypesForPlant,
  pairFitsMap,
  parseMachineTypeProcessMap,
  parseTwoStepPlantMachineTypes,
  planSolutionPick,
  plantMachineTypes,
  plantsRunning,
  processTypeForMachine,
  twoStepPlantMachineTypeErrors,
  type PickListEntry,
  type SolutionPick,
} from './process-machine';
import {
  CAPACITY_SIGNOFF_FIELD,
  SCHEDULER_ROLES,
  canApproveCapacityInDecision,
  canEditCapacity,
  canEditEngReview,
  capacityApprovalErrors,
  capacityBlockedNote,
  planCapacitySignoff,
  planSchedulerAssignment,
  withCapacityApproved,
} from './review';
import { EMPTY_SOLUTION_EXTRAS } from './solution-extras';
import { DomainError } from '../errors';
import {
  EMPTY_LEAD_REVIEW,
  planReturnToAssignee,
  returnTargets,
  returnTargetUser,
} from '../lead-review';
import { emailDeliveryFor, notificationEvent } from '../notifications/events';
import {
  HANDOFF_TYPES,
  planCapacityAssigned,
  planCapacityBlocked,
  planCapacityReady,
  planLeadReturned,
  resolveDeliveries,
} from '../notifications/recipients';
import { KAM_ID, OTHER_ID, makeActor, makeQuote } from '../test-utils';
import { asUserId } from '../types/ids';
import type { RequiredRule } from '../types/workflow-config';
import { REQUIREMENT_LABELS, uniqueRequirements } from '../workflow/requirement-labels';
import { evaluateRules } from '../workflow/rules';
import { buildHybridConfig } from '../workflow/seeds/hybrid';

/**
 * FB-16 (walkthrough 2026-11-13, W13-12 to W13-21): the merged "Process & machine type" pick and its
 * plant filter, the pack-out rule, the Production Scheduler as a second assignee, a capacity block that
 * returns the work to the engineer, and capacity approved inside the G2 decision.
 */

const config = buildHybridConfig();
const SCHEDULER_ID = asUserId('user-scheduler');
const ENGINEER_ID = asUserId('user-engineer');

// Jim Zweifel's list (FB-13), the part these tests need. Codes and labels as sent.
const MACHINE_TYPES: PickListEntry[] = [
  { code: 'EBM', label: 'EBM' },
  { code: 'IBM', label: 'IBM' },
  { code: 'ISBM', label: 'ISBM' },
  { code: 'RHB', label: 'RHB' },
  { code: 'INJ-CAP', label: 'INJ - CAP' },
  { code: 'INJ-PREFORM', label: 'INJ - PREFORM' },
  { code: 'INJ-OTHER', label: 'INJ - OTHER' },
  { code: 'DECO', label: 'DECO' },
];
const PLANTS: PickListEntry[] = [
  { code: 'AURORA', label: 'Aurora', meta: { machineTypes: ['EBM'] } },
  {
    code: 'SALT_LAKE_CITY',
    label: 'Salt Lake City',
    meta: { machineTypes: ['EBM', 'IBM', 'ISBM', 'RHB'] },
  },
  {
    code: 'CLEVELAND_OH',
    label: 'Cleveland, OH',
    meta: { machineTypes: ['EBM', 'INJ-PREFORM', 'RHB'] },
  },
  { code: 'PERU', label: 'Peru', meta: { machineTypes: ['ISBM'] } },
  // A plant an Admin added without the meta: never filtered, never checked.
  { code: 'NEW_PLANT', label: 'New plant', meta: {} },
];
const PROCESS_TYPES = ['EBM', 'RHB', 'IBM', 'IMM', 'IMM_PREFORM', 'ISBM', 'ASSEMBLY', 'OTHER'];

describe('W13-12: the process type is derived from the machine type (machine_type_process_map)', () => {
  it('the seed maps every one of Jim’s 14 machine types to an active process type', () => {
    expect(Object.keys(MACHINE_TYPE_PROCESS_MAP_SEED)).toHaveLength(14);
    expect(MACHINE_TYPE_PROCESS_MAP_SEED).toMatchObject({
      EBM: 'EBM',
      IBM: 'IBM',
      ISBM: 'ISBM',
      RHB: 'RHB',
      'INJ-CAP': 'IMM',
      'INJ-PREFORM': 'IMM_PREFORM',
      'INJ-OTHER': 'IMM',
    });
    // W13-W11: the non-forming machine types wait for Engineering; OTHER until then.
    for (const code of [
      'DECO',
      'PAD PRINTING',
      'PRINTING',
      'LAMINATION',
      'DIE CUTTING',
      'STAMPING',
      '12B',
    ]) {
      expect(MACHINE_TYPE_PROCESS_MAP_SEED[code], code).toBe('OTHER');
    }
    expect(
      machineTypeProcessMapErrors(MACHINE_TYPE_PROCESS_MAP_SEED, {
        machineTypes: Object.keys(MACHINE_TYPE_PROCESS_MAP_SEED),
        processTypes: PROCESS_TYPES,
      }),
    ).toEqual([]);
  });

  it('parses the setting: unset is the seed, values are trimmed, a malformed value is refused', () => {
    expect(parseMachineTypeProcessMap(null)).toEqual(MACHINE_TYPE_PROCESS_MAP_SEED);
    expect(parseMachineTypeProcessMap(undefined)).not.toBe(MACHINE_TYPE_PROCESS_MAP_SEED);
    expect(parseMachineTypeProcessMap({ ' EBM ': ' EBM ' })).toEqual({ EBM: 'EBM' });
    for (const bad of [[], 'EBM', 7, { EBM: '' }, { EBM: 3 }, { '': 'EBM' }, { EBM: null }]) {
      expect(() => parseMachineTypeProcessMap(bad), JSON.stringify(bad)).toThrow(DomainError);
    }
    const tooMany = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`M${i}`, 'EBM']));
    expect(() => parseMachineTypeProcessMap(tooMany)).toThrow(/at most 200/);
  });

  it('the Admin check names a key that is not an active machine type and a value that is not an active process', () => {
    const errors = machineTypeProcessMapErrors(
      { EBM: 'EBM', WHEEL: 'EBM', IBM: 'BLOWING' },
      { machineTypes: ['EBM', 'IBM'], processTypes: PROCESS_TYPES },
    );
    expect(errors.map((e) => e.message)).toEqual([
      '"WHEEL" is not an active machine type',
      '"BLOWING" (for IBM) is not an active process type',
    ]);
    expect(errors.every((e) => e.code === 'INVALID_CONFIG')).toBe(true);
  });

  it('looks the process up, and says whether a stored pair fits the map', () => {
    const map = MACHINE_TYPE_PROCESS_MAP_SEED;
    expect(processTypeForMachine(map, 'INJ-CAP')).toBe('IMM');
    expect(processTypeForMachine(map, 'EBM_WHEEL')).toBeNull();
    expect(processTypeForMachine(map, null)).toBeNull();
    expect(pairFitsMap(map, { processType: 'IMM', machineType: 'INJ-CAP' })).toBe(true);
    // An old quote: the process was picked by hand and differs from what the machine type derives.
    expect(pairFitsMap(map, { processType: 'EBM', machineType: 'INJ-CAP' })).toBe(false);
    expect(pairFitsMap(map, { processType: null, machineType: 'INJ-CAP' })).toBe(false);
    // Nothing to compare: no machine type, or a retired code the map does not know.
    expect(pairFitsMap(map, { processType: 'EBM', machineType: null })).toBe(true);
    expect(pairFitsMap(map, { processType: 'EBM', machineType: 'EBM_WHEEL' })).toBe(true);
  });

  it('the routing suggestion is unchanged: each machine type reaches the engineer its process reached before', () => {
    const neiberger = { id: 'u-n', displayName: 'Randy Neiberger' };
    const pasillas = { id: 'u-p', displayName: 'Rafael Pasillas' };
    const suggest = (machineType: string, resin: string | null = null) =>
      suggestEngineer(
        ASSIGNMENT_RULES_SEED,
        { processType: processTypeForMachine(MACHINE_TYPE_PROCESS_MAP_SEED, machineType), resin },
        [neiberger, pasillas],
      );
    // Paul Slomkowski, Nov 4: ISBM, RHB and injection to the PET engineer; EBM and IBM to the polyolefin one.
    for (const m of ['ISBM', 'RHB', 'INJ-CAP', 'INJ-PREFORM', 'INJ-OTHER']) {
      expect(suggest(m), m).toMatchObject({ userId: 'u-n' });
    }
    for (const m of ['EBM', 'IBM']) expect(suggest(m), m).toMatchObject({ userId: 'u-p' });
    // A non-forming machine type derives OTHER, which no process rule names: the resin rules decide,
    // exactly as they do while no process is chosen.
    expect(suggest('DECO')).toBeNull();
    expect(suggest('DECO', 'PET')).toMatchObject({ userId: 'u-n', basis: { resin: 'PET' } });
    expect(suggest('DECO', 'HDPE')).toMatchObject({ userId: 'u-p', basis: { resin: 'HDPE' } });
  });
});

describe('W13-13: the machine types a plant runs, and the plants that run a machine type', () => {
  it('reads meta.machineTypes; a plant without it is not judged', () => {
    expect(plantMachineTypes(PLANTS[0])).toEqual(['EBM']);
    expect(plantMachineTypes({ meta: {} })).toBeNull();
    expect(plantMachineTypes({ meta: null })).toBeNull();
    expect(plantMachineTypes(undefined)).toBeNull();
    expect(plantMachineTypes({ meta: { machineTypes: ['EBM', 3, null] } })).toEqual(['EBM']);
  });

  it('offers only the chosen plant’s machine types, in list order; everything before a plant is chosen', () => {
    const codes = (plant: string | null) =>
      machineTypesForPlant(MACHINE_TYPES, PLANTS, plant).map((m) => m.code);
    expect(codes('SALT_LAKE_CITY')).toEqual(['EBM', 'IBM', 'ISBM', 'RHB']);
    expect(codes('AURORA')).toEqual(['EBM']);
    expect(codes(null)).toHaveLength(MACHINE_TYPES.length);
    expect(codes('')).toHaveLength(MACHINE_TYPES.length);
    // A plant with no meta, or a code the list no longer has: not filtered.
    expect(codes('NEW_PLANT')).toHaveLength(MACHINE_TYPES.length);
    expect(codes('PLANT_01')).toHaveLength(MACHINE_TYPES.length);
  });

  it('the plants running any of the given machine types (preform, blow and the capacity row’s Site)', () => {
    const codes = (machineTypes: string[]) =>
      plantsRunning(PLANTS, machineTypes).map((p) => p.code);
    expect(codes(TWO_STEP_PLANT_MACHINE_TYPES_SEED.preform)).toEqual(['CLEVELAND_OH', 'NEW_PLANT']);
    expect(codes(TWO_STEP_PLANT_MACHINE_TYPES_SEED.blow)).toEqual([
      'SALT_LAKE_CITY',
      'CLEVELAND_OH',
      'PERU',
      'NEW_PLANT',
    ]);
    expect(codes(['EBM'])).toEqual(['AURORA', 'SALT_LAKE_CITY', 'CLEVELAND_OH', 'NEW_PLANT']);
    // No machine type chosen yet: every plant.
    expect(codes([])).toHaveLength(PLANTS.length);
  });

  it('the server check refuses a machine type the plant does not run, and says why', () => {
    const check = (plantCode: string | null, machineType: string | null) =>
      checkPlantRunsMachineType({
        plantCode,
        machineType,
        plants: PLANTS,
        machineTypes: MACHINE_TYPES,
      });
    expect(check('SALT_LAKE_CITY', 'ISBM')).toEqual({ ok: true });
    const refused = check('SALT_LAKE_CITY', 'INJ-CAP');
    expect(refused).toMatchObject({
      ok: false,
      plantLabel: 'Salt Lake City',
      machineLabel: 'INJ - CAP',
    });
    expect(!refused.ok && refused.error).toMatchObject({
      code: 'INVALID_VALUE',
      field: 'machineType',
      message: 'Salt Lake City does not run INJ - CAP; pick again',
    });
    // Not checked: nothing to compare, a plant without the meta, a placeholder plant, a retired code.
    expect(check(null, 'EBM').ok).toBe(true);
    expect(check('AURORA', null).ok).toBe(true);
    expect(check('NEW_PLANT', 'INJ-CAP').ok).toBe(true);
    expect(check('PLANT_01', 'INJ-CAP').ok).toBe(true);
    expect(check('AURORA', 'EBM_WHEEL').ok).toBe(true);
  });

  it('two_step_plant_machine_types: the seed, the parser and the Admin check', () => {
    expect(parseTwoStepPlantMachineTypes(null)).toEqual({
      preform: ['INJ-PREFORM'],
      blow: ['RHB', 'ISBM'],
    });
    expect(parseTwoStepPlantMachineTypes({ preform: [' INJ-PREFORM '], blow: [] })).toEqual({
      preform: ['INJ-PREFORM'],
      blow: [],
    });
    for (const bad of [
      [],
      'x',
      { preform: ['A'] },
      { preform: 'A', blow: [] },
      { preform: [''], blow: [] },
    ]) {
      expect(() => parseTwoStepPlantMachineTypes(bad), JSON.stringify(bad)).toThrow(DomainError);
    }
    expect(
      twoStepPlantMachineTypeErrors({ preform: ['INJ-PREFORM'], blow: ['RHB', 'WHEEL'] }, [
        'INJ-PREFORM',
        'RHB',
      ]).map((e) => e.message),
    ).toEqual(['"WHEEL" (blow) is not an active machine type']);
    expect(
      twoStepPlantMachineTypeErrors(TWO_STEP_PLANT_MACHINE_TYPES_SEED, [
        'INJ-PREFORM',
        'RHB',
        'ISBM',
      ]),
    ).toEqual([]);
  });
});

describe('W13-12 / W13-13: what the Engineering Review stores (planSolutionPick)', () => {
  const none: SolutionPick = { plantCode: null, machineType: null, processType: null };
  const plan = (stored: SolutionPick, sent: Partial<SolutionPick>) =>
    planSolutionPick({
      stored,
      sent,
      map: MACHINE_TYPE_PROCESS_MAP_SEED,
      plants: PLANTS,
      machineTypes: MACHINE_TYPES,
    });

  it('a picked machine type sets the process type, whatever process the caller sent', () => {
    expect(plan(none, { plantCode: 'CLEVELAND_OH', machineType: 'INJ-PREFORM' })).toEqual({
      ok: true,
      pick: { plantCode: 'CLEVELAND_OH', machineType: 'INJ-PREFORM', processType: 'IMM_PREFORM' },
    });
    // An older client still sends a process type: the derived one wins.
    expect(plan(none, { machineType: 'ISBM', processType: 'EBM' })).toMatchObject({
      ok: true,
      pick: { machineType: 'ISBM', processType: 'ISBM' },
    });
  });

  it('clearing the machine type clears the process type', () => {
    const stored = { plantCode: 'AURORA', machineType: 'EBM', processType: 'EBM' };
    expect(plan(stored, { machineType: null })).toEqual({
      ok: true,
      pick: { plantCode: 'AURORA', machineType: null, processType: null },
    });
  });

  it('an old quote whose pair does not fit the map keeps its values until someone picks again', () => {
    const old = { plantCode: 'AURORA', machineType: 'EBM', processType: 'ISBM' };
    // Saving another field, or the same machine type again, changes nothing.
    expect(plan(old, {})).toEqual({ ok: true, pick: old });
    expect(plan(old, { machineType: 'EBM' })).toEqual({ ok: true, pick: old });
    // Picking again derives the process.
    expect(plan(old, { plantCode: 'SALT_LAKE_CITY', machineType: 'RHB' })).toMatchObject({
      ok: true,
      pick: { machineType: 'RHB', processType: 'RHB' },
    });
  });

  it('a process type sent on its own is stored as sent (a quote with no machine type yet)', () => {
    expect(plan(none, { processType: 'ISBM' })).toEqual({
      ok: true,
      pick: { plantCode: null, machineType: null, processType: 'ISBM' },
    });
    expect(plan({ ...none, processType: 'ISBM' }, { processType: null })).toMatchObject({
      ok: true,
      pick: { processType: null },
    });
  });

  it('refuses a machine type the plant does not run, on either change', () => {
    const picked = plan(none, { plantCode: 'SALT_LAKE_CITY', machineType: 'INJ-CAP' });
    expect(!picked.ok && picked.errors.map((e) => [e.code, e.field, e.message])).toEqual([
      ['INVALID_VALUE', 'machineType', 'Salt Lake City does not run INJ - CAP; pick again'],
    ]);
    // The plant changes under a stored machine type it does not run.
    const moved = plan(
      { plantCode: 'SALT_LAKE_CITY', machineType: 'ISBM', processType: 'ISBM' },
      { plantCode: 'AURORA' },
    );
    expect(!moved.ok && moved.errors.map((e) => e.message)).toEqual([
      'Aurora does not run ISBM; pick again',
    ]);
    // The web sends the cleared machine type with the new plant: accepted.
    expect(
      plan(
        { plantCode: 'SALT_LAKE_CITY', machineType: 'ISBM', processType: 'ISBM' },
        { plantCode: 'AURORA', machineType: null },
      ),
    ).toEqual({ ok: true, pick: { plantCode: 'AURORA', machineType: null, processType: null } });
  });

  it('an unrelated save on an old quote with an incompatible stored pair is not refused', () => {
    const old = { plantCode: 'AURORA', machineType: 'ISBM', processType: 'ISBM' };
    expect(plan(old, {}).ok).toBe(true);
  });

  it('refuses a machine type the map does not know yet, pointing at the setting', () => {
    const res = planSolutionPick({
      stored: none,
      sent: { machineType: 'DECO' },
      map: { EBM: 'EBM' },
      plants: PLANTS,
      machineTypes: MACHINE_TYPES,
    });
    expect(!res.ok && res.errors.map((e) => [e.code, e.field])).toEqual([
      ['INVALID_CONFIG', 'machineType'],
    ]);
  });
});

describe('W13-14: the pack-out rule (pack_out_rule)', () => {
  const values = (over: Partial<typeof EMPTY_SOLUTION_EXTRAS> = {}) => ({
    ...EMPTY_SOLUTION_EXTRAS,
    ...over,
  });

  it('the seed: bag and case not together, nothing required', () => {
    expect(PACK_OUT_RULE_SEED).toEqual({
      requireOneOf: false,
      notTogether: [['unitsPerBag', 'unitsPerCase']],
    });
    expect(parsePackOutRule(null)).toEqual(PACK_OUT_RULE_SEED);
    expect(parsePackOutRule(undefined).notTogether[0]).not.toBe(PACK_OUT_RULE_SEED.notTogether[0]);
    expect(parsePackOutRule({ requireOneOf: true })).toEqual({
      requireOneOf: true,
      notTogether: [],
    });
  });

  it('refuses a malformed setting', () => {
    for (const bad of [
      [],
      'on',
      {},
      { requireOneOf: 'yes' },
      { requireOneOf: false, notTogether: 'bag' },
      { requireOneOf: false, notTogether: [['unitsPerBag']] },
      { requireOneOf: false, notTogether: [['unitsPerBag', 'unitsPerPallet']] },
      { requireOneOf: false, notTogether: [['unitsPerBag', 'unitsPerBag']] },
      { requireOneOf: false, notTogether: ['unitsPerBag'] },
    ]) {
      expect(() => parsePackOutRule(bad), JSON.stringify(bad)).toThrow(DomainError);
    }
  });

  it('bag and case cannot both be filled; tray and pallet go with either', () => {
    const rule = PACK_OUT_RULE_SEED;
    expect(packOutRuleErrors(values(), rule)).toEqual([]);
    expect(packOutRuleErrors(values({ unitsPerBag: 50, unitsPerTray: 10 }), rule)).toEqual([]);
    expect(packOutRuleErrors(values({ unitsPerCase: 12, unitsPerPallet: 480 }), rule)).toEqual([]);
    const both = packOutRuleErrors(values({ unitsPerBag: 50, unitsPerCase: 12 }), rule);
    expect(both.map((e) => [e.code, e.field, e.message])).toEqual([
      ['INVALID_VALUE', 'unitsPerCase', 'Fill in units per bag or units per case, not both'],
    ]);
  });

  it('a group of three reads "not more than one", and a field is reported once across groups', () => {
    const rule = parsePackOutRule({
      requireOneOf: false,
      notTogether: [
        ['unitsPerBag', 'unitsPerTray', 'unitsPerCase'],
        ['unitsPerBag', 'unitsPerCase'],
      ],
    });
    const errors = packOutRuleErrors(
      values({ unitsPerBag: 1, unitsPerTray: 2, unitsPerCase: 3 }),
      rule,
    );
    expect(errors.map((e) => e.field)).toEqual(['unitsPerTray', 'unitsPerCase']);
    expect(errors[0]!.message).toBe(
      'Fill in units per bag, units per tray or units per case, not more than one',
    );
  });

  it('requireOneOf is built and off: nothing is required with the seed', () => {
    expect(packOutRequirementErrors(PACK_OUT_RULE_SEED, {})).toEqual([]);
    expect(packOutUnitProvided({})).toBe(false);
    expect(packOutUnitProvided({ unitsPerTray: 24 })).toBe(true);
    expect(packOutUnitProvided({ unitsPerTray: null })).toBe(false);
  });

  it('switched on, a forward decision needs one of bag, tray or case (pallet alone is not enough)', () => {
    const on = { ...PACK_OUT_RULE_SEED, requireOneOf: true };
    const missing = packOutRequirementErrors(on, { units_per_pallet: 480 });
    expect(missing.map((e) => [e.code, e.field])).toEqual([
      ['MISSING_FIELD', PACK_OUT_REQUIREMENT_KEY],
    ]);
    expect(REQUIREMENT_LABELS[PACK_OUT_REQUIREMENT_KEY]).toBe(missing[0]!.message);
    for (const field of ['units_per_bag', 'units_per_tray', 'units_per_case']) {
      expect(packOutRequirementErrors(on, { [field]: 12 }), field).toEqual([]);
    }
  });

  it('applies to the outcomes that move the quote forward, read from the workflow config', () => {
    for (const outcome of ['proceed', 'proceed_with_risk', 'capital_required']) {
      expect(isForwardOutcome(config, 'G2', outcome), outcome).toBe(true);
    }
    for (const outcome of ['hold', 'rework', 'redirect', 'stop']) {
      expect(isForwardOutcome(config, 'G2', outcome), outcome).toBe(false);
    }
    expect(isForwardOutcome(config, 'G3', 'submit')).toBe(true);
    expect(isForwardOutcome(config, 'G3', 'rework')).toBe(false);
    expect(isForwardOutcome(config, 'G9', 'proceed')).toBe(false);
    expect(isForwardOutcome(config, 'G2', 'no_such_outcome')).toBe(false);
  });
});

describe('W13-20: the numeric rules behind the inputs (750 % cannot be calculated or coloured)', () => {
  const row = {
    cycleTimeS: 14.5,
    cavitation: 8,
    scheduledRunDaysPerYear: 350,
    allocatedAnnualVolume: 1_000_000,
    utilizationBeforePct: 40,
  };

  it('an effectiveness of 750 % is not usable, and the result names it', () => {
    const calc = computeUtilization({ ...row, effectivenessPct: 750 });
    expect(calc).toEqual({ ok: false, invalid: ['effectivenessPct'] });
    expect(computeUtilization({ ...row, effectivenessPct: 100 }).ok).toBe(true);
  });

  it('W13-21: at or below the target is ok (green), above it warn (amber), above 100 over (red)', () => {
    const basis = { warnAbovePct: 85 };
    expect(utilizationLevel(60, basis)).toBe('ok');
    expect(utilizationLevel(85, basis)).toBe('ok');
    expect(utilizationLevel(85.04, basis)).toBe('ok');
    expect(utilizationLevel(85.1, basis)).toBe('warn');
    expect(utilizationLevel(100, basis)).toBe('warn');
    expect(utilizationLevel(100.1, basis)).toBe('over');
  });
});

describe('W13-15: the Production Scheduler as a second assignee', () => {
  const settings = { backupAssignerUserIds: [] as string[] };
  const lead = makeActor('EngLead');
  const quote = makeQuote('ENG_REVIEW', { assignedEngineerId: ENGINEER_ID });
  const scheduler = { id: SCHEDULER_ID, roles: ['ProductionScheduler'] as const, active: true };

  it('only users holding the Production Scheduler role can be assigned', () => {
    expect(SCHEDULER_ROLES).toEqual(['ProductionScheduler']);
    expect(planSchedulerAssignment(lead, settings, quote, scheduler)).toEqual({
      ok: true,
      changed: true,
      from: null,
      to: SCHEDULER_ID,
    });
    for (const bad of [
      undefined,
      { ...scheduler, active: false },
      { id: 'u-eng', roles: ['Engineer'] as const, active: true },
      { id: 'u-lead', roles: ['EngLead'] as const, active: true },
    ]) {
      const res = planSchedulerAssignment(lead, settings, quote, bad);
      expect(!res.ok && res.errors.map((e) => [e.code, e.field])).toEqual([
        ['INVALID_ASSIGNEE', 'schedulerId'],
      ]);
    }
  });

  it('the same scheduler again changes nothing; null clears the assignment', () => {
    const assigned = { ...quote, assignedSchedulerId: SCHEDULER_ID };
    expect(planSchedulerAssignment(lead, settings, assigned, scheduler)).toMatchObject({
      ok: true,
      changed: false,
    });
    // The assign dialog resends the current scheduler when only the engineer changes. If that person
    // has since been deactivated or lost the role, it is still a no-op, so the engineer can be changed.
    for (const stale of [
      { ...scheduler, active: false },
      { id: SCHEDULER_ID, roles: ['Engineer'] as const, active: true },
    ]) {
      expect(planSchedulerAssignment(lead, settings, assigned, stale)).toEqual({
        ok: true,
        changed: false,
        from: SCHEDULER_ID,
        to: SCHEDULER_ID,
      });
    }
    // Outside the stage the stage error still wins.
    const moved = { ...assigned, stageKey: 'QUOTING' };
    expect(planSchedulerAssignment(lead, settings, moved, scheduler).ok).toBe(false);
    expect(planSchedulerAssignment(lead, settings, assigned, null)).toEqual({
      ok: true,
      changed: true,
      from: SCHEDULER_ID,
      to: null,
    });
    expect(planSchedulerAssignment(lead, settings, quote, null)).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it('the people who assign the engineer assign the scheduler: the lead, Admin or a backup assigner, in Engineering only', () => {
    expect(planSchedulerAssignment(makeActor('Admin'), settings, quote, scheduler).ok).toBe(true);
    const backup = makeActor('Engineer', { userId: asUserId('user-backup') });
    expect(
      planSchedulerAssignment(backup, { backupAssignerUserIds: ['user-backup'] }, quote, scheduler)
        .ok,
    ).toBe(true);
    for (const role of ['Engineer', 'ProductionScheduler', 'KAM', 'Leadership'] as const) {
      const res = planSchedulerAssignment(makeActor(role), settings, quote, scheduler);
      expect(!res.ok && res.errors.map((e) => e.code), role).toEqual(['NOT_PERMITTED']);
    }
    const wrong = planSchedulerAssignment(lead, settings, makeQuote('QUOTING'), scheduler);
    expect(!wrong.ok && wrong.errors.map((e) => e.code)).toEqual(['WRONG_STAGE']);
    const closed = planSchedulerAssignment(
      lead,
      settings,
      makeQuote('ENG_REVIEW', { status: 'closed' }),
      scheduler,
    );
    expect(!closed.ok && closed.errors.map((e) => e.code)).toEqual(['QUOTE_CLOSED']);
  });

  it('the scheduler edits the capacity rows of their own quote, never the solution', () => {
    const mine = makeQuote('ENG_REVIEW', {
      assignedEngineerId: ENGINEER_ID,
      assignedSchedulerId: SCHEDULER_ID,
    });
    const me = makeActor('ProductionScheduler', { userId: SCHEDULER_ID });
    const engineer = makeActor('Engineer', { userId: ENGINEER_ID });
    expect(canEditCapacity(me, mine, config)).toBe(true);
    expect(canEditEngReview(me, mine, config)).toBe(false);
    // The engineer keeps both parts; the lead too; another scheduler neither.
    expect(canEditCapacity(engineer, mine, config)).toBe(true);
    expect(canEditEngReview(engineer, mine, config)).toBe(true);
    expect(canEditCapacity(lead, mine, config)).toBe(true);
    expect(canEditCapacity(makeActor('ProductionScheduler'), mine, config)).toBe(false);
    // Not outside Engineering, and not on a closed quote.
    expect(canEditCapacity(me, { ...mine, stageKey: 'QUOTING' }, config)).toBe(false);
    expect(canEditCapacity(me, { ...mine, status: 'closed' }, config)).toBe(false);
  });

  // FB-22 (N17-14): the scheduler's part is submitted on its own, so the engineer's submission no longer
  // locks the scheduler's rows (it locks them for the engineer); the scheduler's own submission does.
  it('while the engineer’s work is with the lead the rows are locked for the engineer, not the scheduler', () => {
    const submitted = makeQuote('ENG_REVIEW', {
      assignedEngineerId: ENGINEER_ID,
      assignedSchedulerId: SCHEDULER_ID,
      engSubmittedAt: new Date('2026-11-14T15:00:00Z'),
    });
    const me = makeActor('ProductionScheduler', { userId: SCHEDULER_ID });
    expect(canEditCapacity(me, submitted, config)).toBe(true);
    expect(
      canEditCapacity(
        me,
        { ...submitted, capacitySubmittedAt: new Date('2026-11-14T16:00:00Z') },
        config,
      ),
    ).toBe(false);
    expect(canEditCapacity(makeActor('Engineer', { userId: ENGINEER_ID }), submitted, config)).toBe(
      false,
    );
    expect(canEditCapacity(lead, submitted, config)).toBe(true);
    // The sign-off is a decision, not evidence: the scheduler may still approve or block.
    expect(planCapacitySignoff(me, submitted, { status: 'approved' }).ok).toBe(true);
  });

  it('after G2 advances the capacity rows are locked like the rest of the section', () => {
    const advanced = makeQuote('ENG_REVIEW', {
      assignedSchedulerId: SCHEDULER_ID,
      decisions: [
        {
          gateKey: 'G2',
          outcomeKey: 'proceed',
          decidedBy: 'user-lead',
          decidedAt: new Date('2026-11-14T15:00:00Z'),
          targetStageKey: 'QUOTING',
        },
      ],
    });
    expect(
      canEditCapacity(makeActor('ProductionScheduler', { userId: SCHEDULER_ID }), advanced, config),
    ).toBe(false);
  });

  it('the scheduler signs capacity off on their own quote only', () => {
    const mine = makeQuote('ENG_REVIEW', { assignedSchedulerId: SCHEDULER_ID });
    const me = makeActor('ProductionScheduler', { userId: SCHEDULER_ID });
    expect(planCapacitySignoff(me, mine, { status: 'approved' })).toMatchObject({
      ok: true,
      status: 'approved',
    });
    const other = planCapacitySignoff(makeActor('ProductionScheduler'), mine, {
      status: 'approved',
    });
    expect(!other.ok && other.errors.map((e) => e.code)).toEqual(['NOT_PERMITTED']);
  });

  it('notifications: the scheduler is told on assignment and when capacity can start', () => {
    expect(planCapacityAssigned(SCHEDULER_ID)).toEqual([
      {
        type: 'quote.capacity_assigned',
        recipient: { kind: 'user', userId: SCHEDULER_ID },
        reason: 'next_owner',
        asAssignee: true,
      },
    ]);
    const quoteWith = { kamUserId: KAM_ID, assignedSchedulerId: SCHEDULER_ID };
    expect(planCapacityReady(quoteWith)).toEqual([
      {
        type: 'quote.capacity_ready',
        recipient: { kind: 'user', userId: SCHEDULER_ID },
        reason: 'next_owner',
        asAssignee: true,
      },
    ]);
    expect(planCapacityReady({ kamUserId: KAM_ID })).toEqual([]);
    expect(planCapacityReady({ kamUserId: KAM_ID, assignedSchedulerId: null })).toEqual([]);
    // Both are in the catalogue with an immediate email (provisional).
    for (const type of [HANDOFF_TYPES.capacityAssigned, HANDOFF_TYPES.capacityReady]) {
      expect(notificationEvent(type), type).toBeDefined();
      expect(emailDeliveryFor(type), type).toBe('immediate');
    }
  });
});

describe('W13-19: the lead sends the work back to the engineer or to the production scheduler', () => {
  const lead = makeActor('EngLead');
  const submitted = {
    ...EMPTY_LEAD_REVIEW,
    submittedAt: new Date('2026-11-14T15:00:00Z'),
    submittedBy: ENGINEER_ID,
  };
  const both = makeQuote('ENG_REVIEW', {
    assignedEngineerId: ENGINEER_ID,
    assignedSchedulerId: SCHEDULER_ID,
    engSubmittedAt: submitted.submittedAt,
  });
  const engineerOnly = makeQuote('ENG_REVIEW', {
    assignedEngineerId: ENGINEER_ID,
    engSubmittedAt: submitted.submittedAt,
  });

  it('offers the engineer first (the default) and the scheduler when one is assigned', () => {
    expect(returnTargets('engineering', both)).toEqual([
      { target: 'assignee', userId: ENGINEER_ID },
      { target: 'scheduler', userId: SCHEDULER_ID },
    ]);
    expect(returnTargets('engineering', engineerOnly)).toEqual([
      { target: 'assignee', userId: ENGINEER_ID },
    ]);
    expect(returnTargetUser('engineering', both, 'scheduler')).toBe(SCHEDULER_ID);
    expect(returnTargetUser('engineering', engineerOnly, 'scheduler')).toBeNull();
    // Pricing has no second assignee.
    const pricing = makeQuote('QUOTING', {
      assignedPricerId: OTHER_ID,
      assignedSchedulerId: SCHEDULER_ID,
    });
    expect(returnTargets('pricing', pricing)).toEqual([{ target: 'assignee', userId: OTHER_ID }]);
    expect(returnTargets('pricing', makeQuote('QUOTING'))).toEqual([]);
  });

  it('a note is required for either target, and the engineer is the default', () => {
    expect(planReturnToAssignee('engineering', lead, both, submitted, 'Fix the cycle')).toEqual({
      ok: true,
    });
    expect(
      planReturnToAssignee('engineering', lead, both, submitted, 'Wrong line', 'scheduler'),
    ).toEqual({ ok: true });
    const noNote = planReturnToAssignee('engineering', lead, both, submitted, '  ', 'scheduler');
    expect(!noNote.ok && noNote.errors.map((e) => e.code)).toEqual(['NOTE_REQUIRED']);
  });

  it('refuses the scheduler as a target when nobody is assigned as scheduler, and in pricing', () => {
    const none = planReturnToAssignee(
      'engineering',
      lead,
      engineerOnly,
      submitted,
      'Wrong line',
      'scheduler',
    );
    expect(!none.ok && none.errors.map((e) => [e.code, e.field])).toEqual([
      ['INVALID_VALUE', 'to'],
    ]);
    const pricing = makeQuote('QUOTING', {
      assignedPricerId: OTHER_ID,
      pricingSubmittedAt: submitted.submittedAt,
    });
    const res = planReturnToAssignee(
      'pricing',
      makeActor('PricingLead'),
      pricing,
      submitted,
      'Re-cost',
      'scheduler',
    );
    expect(!res.ok && res.errors.map((e) => e.message)).toEqual([
      'Pricing work goes back to the pricer',
    ]);
  });

  it('only the chosen person is notified, plus the KAM’s in-app update', () => {
    const quote = {
      kamUserId: KAM_ID,
      assignedEngineerId: ENGINEER_ID,
      assignedSchedulerId: SCHEDULER_ID,
    };
    const deliveries = resolveDeliveries(
      planLeadReturned(SCHEDULER_ID, quote),
      () => [],
      'user-lead',
    );
    expect(deliveries.map((d) => [d.userId, d.type])).toEqual([
      [SCHEDULER_ID, 'quote.returned_by_lead'],
      [KAM_ID, 'quote.lead_review_update'],
    ]);
  });
});

describe('W13-17: a capacity block sends the work straight back to the engineer', () => {
  const quote = makeQuote('ENG_REVIEW', {
    assignedEngineerId: ENGINEER_ID,
    assignedSchedulerId: SCHEDULER_ID,
  });
  const scheduler = makeActor('ProductionScheduler', { userId: SCHEDULER_ID });
  const lead = makeActor('EngLead', { userId: asUserId('user-lead') });

  it('a new block returns the work; a note is required', () => {
    const noNote = planCapacitySignoff(scheduler, quote, { status: 'blocked' });
    expect(!noNote.ok && noNote.errors.map((e) => e.code)).toEqual(['NOTE_REQUIRED']);
    expect(
      planCapacitySignoff(scheduler, quote, { status: 'blocked', note: ' Line 4 is full ' }),
    ).toEqual({ ok: true, status: 'blocked', note: 'Line 4 is full', returnsToEngineer: true });
    expect(capacityBlockedNote('Line 4 is full')).toBe('Capacity blocked: Line 4 is full');
    // The lead may block too.
    expect(
      planCapacitySignoff(lead, quote, { status: 'blocked', note: 'No press time' }),
    ).toMatchObject({ ok: true, returnsToEngineer: true });
  });

  it('editing the note of an existing block, approving and clearing do not send it back again', () => {
    expect(
      planCapacitySignoff(scheduler, quote, { status: 'blocked', note: 'Still full' }, 'blocked'),
    ).toMatchObject({ ok: true, status: 'blocked', returnsToEngineer: false });
    expect(planCapacitySignoff(scheduler, quote, { status: 'approved' }, 'blocked')).toMatchObject({
      ok: true,
      status: 'approved',
      returnsToEngineer: false,
    });
    expect(planCapacitySignoff(scheduler, quote, { status: null }, 'blocked')).toMatchObject({
      ok: true,
      status: null,
      returnsToEngineer: false,
    });
    // Blocking an approved sign-off is a new block.
    expect(
      planCapacitySignoff(scheduler, quote, { status: 'blocked', note: 'Changed' }, 'approved'),
    ).toMatchObject({ returnsToEngineer: true });
  });

  it('a long note is refused', () => {
    const res = planCapacitySignoff(scheduler, quote, {
      status: 'blocked',
      note: 'x'.repeat(2001),
    });
    expect(!res.ok && res.errors.map((e) => e.field)).toEqual(['note']);
  });

  it('tells the engineer, the engineering lead when someone else blocked, and the KAM in-app', () => {
    const handoff = {
      kamUserId: KAM_ID,
      assignedEngineerId: ENGINEER_ID,
      assignedSchedulerId: SCHEDULER_ID,
    };
    const members = () => [asUserId('user-lead'), asUserId('user-lead-2')];
    const byScheduler = resolveDeliveries(planCapacityBlocked(handoff), members, SCHEDULER_ID);
    expect(byScheduler.map((d) => [d.userId, d.type])).toEqual([
      [ENGINEER_ID, 'quote.capacity_blocked'],
      ['user-lead', 'quote.capacity_blocked'],
      ['user-lead-2', 'quote.capacity_blocked'],
      [KAM_ID, 'quote.lead_review_update'],
    ]);
    expect(byScheduler[0]!.asAssignee).toBe(true);
    // The lead who blocked is not told; the other lead still is.
    const byLead = resolveDeliveries(planCapacityBlocked(handoff), members, 'user-lead');
    expect(byLead.map((d) => d.userId)).toEqual([ENGINEER_ID, 'user-lead-2', KAM_ID]);
    // No engineer assigned yet: the leads and the KAM.
    expect(
      resolveDeliveries(planCapacityBlocked({ kamUserId: KAM_ID }), members, SCHEDULER_ID).map(
        (d) => d.userId,
      ),
    ).toEqual(['user-lead', 'user-lead-2', KAM_ID]);
    // The engineer and the lead get an email; the KAM's update is in-app only.
    expect(emailDeliveryFor('quote.capacity_blocked')).toBe('immediate');
    expect(emailDeliveryFor('quote.lead_review_update')).toBe('none');
  });
});

describe('W13-18: the lead approves capacity inside "Decide feasibility"', () => {
  const advance = config.outcomes.find((o) => o.gateKey === 'G2' && o.key === 'proceed')!;
  const hold = config.outcomes.find((o) => o.gateKey === 'G2' && o.key === 'hold')!;
  const lead = makeActor('EngLead');
  const ready = (signoff: string | null) =>
    makeQuote('ENG_REVIEW', {
      assignedEngineerId: ENGINEER_ID,
      assignedSchedulerId: SCHEDULER_ID,
      fields: {
        process_type: 'EBM',
        machine_type: 'EBM',
        plant_code: 'AURORA',
        cavitation: 8,
        cycle_time_s: 14.5,
        capacity_evidence: [{}],
        capacity_utilization_missing: false,
        // FB-17 (W13-22): G2 Advance also needs the capital figure; $0 = no capital, so no BOM.
        prelim_capital_usd: 0,
        eng_capital_needed: false,
        [CAPACITY_SIGNOFF_FIELD]: signoff,
      },
    });

  it('a not-yet-signed capacity is satisfiable for the lead; the rule itself is unchanged', () => {
    const quote = ready(null);
    expect(canApproveCapacityInDecision(lead, quote, advance.requiredFields)).toBe(true);
    // Without the tick the rule still fails; with it, nothing is missing.
    expect(evaluateRules(advance.requiredFields, quote.fields).map((e) => e.field)).toEqual([
      CAPACITY_SIGNOFF_FIELD,
    ]);
    expect(evaluateRules(advance.requiredFields, withCapacityApproved(quote.fields))).toEqual([]);
    expect(capacityApprovalErrors(lead, quote, advance.requiredFields, true)).toEqual([]);
    expect(capacityApprovalErrors(lead, quote, advance.requiredFields, undefined)).toEqual([]);
    expect(capacityApprovalErrors(lead, quote, advance.requiredFields, false)).toEqual([]);
  });

  it('a block is never overridden in the decision: Advance stays unavailable', () => {
    const quote = ready('blocked');
    expect(canApproveCapacityInDecision(lead, quote, advance.requiredFields)).toBe(false);
    const errors = capacityApprovalErrors(lead, quote, advance.requiredFields, true);
    expect(errors.map((e) => [e.code, e.field])).toEqual([['INVALID_STATE', 'capacityApproved']]);
    expect(errors[0]!.message).toMatch(/blocked/);
  });

  it('nothing to tick once capacity is approved, or on an outcome that does not need it', () => {
    const approved = ready('approved');
    expect(canApproveCapacityInDecision(lead, approved, advance.requiredFields)).toBe(false);
    expect(
      capacityApprovalErrors(lead, approved, advance.requiredFields, true).map((e) => e.message),
    ).toEqual(['Capacity is already approved']);
    expect(canApproveCapacityInDecision(lead, ready(null), hold.requiredFields)).toBe(false);
    expect(
      capacityApprovalErrors(lead, ready(null), hold.requiredFields, true).map((e) => e.message),
    ).toEqual(['Capacity cannot be signed off with this decision']);
  });

  it('only someone holding capacity.signoff on the quote, and only in Engineering', () => {
    const quote = ready(null);
    for (const role of ['Engineer', 'KAM', 'Admin', 'Leadership'] as const) {
      const actor = makeActor(role, { userId: ENGINEER_ID });
      expect(canApproveCapacityInDecision(actor, quote, advance.requiredFields), role).toBe(false);
    }
    expect(
      canApproveCapacityInDecision(lead, { ...quote, stageKey: 'QUOTING' }, advance.requiredFields),
    ).toBe(false);
    expect(
      canApproveCapacityInDecision(lead, { ...quote, status: 'closed' }, advance.requiredFields),
    ).toBe(false);
  });
});

describe('W13-12: one label for the two rules, and W13-16: the stage label', () => {
  it('process type and machine type read "Process & machine type", listed once', () => {
    expect(REQUIREMENT_LABELS.process_type).toBe('Process & machine type');
    expect(REQUIREMENT_LABELS.machine_type).toBe('Process & machine type');
    const rules: RequiredRule[] = [
      { field: 'process_type', op: 'present' },
      { field: 'machine_type', op: 'present' },
      { field: 'plant_code', op: 'present' },
    ];
    const missing = evaluateRules(rules, {}).map((e) => ({
      field: e.field ?? '',
      message: e.message,
    }));
    expect(missing).toHaveLength(3);
    expect(uniqueRequirements(missing).map((m) => m.field)).toEqual(['process_type', 'plant_code']);
    // A requirement with no registered label is kept by its own message.
    expect(
      uniqueRequirements([
        { field: 'x', message: 'x is required' },
        { field: 'y', message: 'x is required' },
        { field: 'z', message: 'z is required' },
      ]).map((m) => m.field),
    ).toEqual(['x', 'z']);
  });

  it('both rules stay required at G2 Advance', () => {
    const advance = config.outcomes.find((o) => o.gateKey === 'G2' && o.key === 'proceed')!;
    const fields = advance.requiredFields.flatMap((r) => ('field' in r ? [r.field] : []));
    expect(fields).toEqual(expect.arrayContaining(['process_type', 'machine_type']));
  });

  it('the seeded stage is "Engineering & Capacity" (provisional); the gate label stays', () => {
    const stage = config.stages.find((s) => s.key === 'ENG_REVIEW')!;
    expect(stage).toMatchObject({ label: 'Engineering & Capacity', provisional: true });
    expect(config.gates.find((g) => g.key === 'G2')!.label).toBe('Feasible solution?');
  });
});
