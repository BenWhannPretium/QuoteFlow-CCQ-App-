import { describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_RULES_SEED,
  parseAssignmentRules,
  suggestEngineer,
  type AssignmentRules,
} from './assignment-rules';
import { planEquipmentBomUpload } from './review';
import {
  EMPTY_SOLUTION_EXTRAS,
  PACK_OUT_MAX,
  normalizeSolutionExtras,
  packOutSummary,
  validateSolutionExtras,
  type SolutionExtras,
} from './solution-extras';
import { isEngineeringKind, isVersionedKind, ATTACHMENT_KINDS } from '../attachments/file-types';
import { KAM_ID, makeActor, makeQuote } from '../test-utils';
import { asUserId } from '../types/ids';

const ENGINEER_ID = asUserId('user-engineer');

// ── F-058: who may upload the equipment BOM ──────────────────────────────────────────────────────

describe('equipment BOM upload (F-058)', () => {
  const quote = makeQuote('ENG_REVIEW', { assignedEngineerId: ENGINEER_ID });
  const codes = (r: ReturnType<typeof planEquipmentBomUpload>) =>
    r.ok ? [] : r.errors.map((e) => e.code);

  it('is a versioned, engineering-owned kind', () => {
    expect(ATTACHMENT_KINDS).toContain('equipment_bom');
    expect(isVersionedKind('equipment_bom')).toBe(true);
    expect(isEngineeringKind('equipment_bom')).toBe(true);
    expect(isEngineeringKind('cost_model')).toBe(false);
    expect(isEngineeringKind('spec')).toBe(false);
  });

  it('the EngLead, or the assigned engineer, may upload while it is in Engineering Review', () => {
    expect(planEquipmentBomUpload(makeActor('EngLead'), quote)).toEqual({ ok: true });
    expect(planEquipmentBomUpload(makeActor('Engineer', { userId: ENGINEER_ID }), quote)).toEqual({
      ok: true,
    });
  });

  it('nobody else may: not another engineer, the KAM, Pricing, Finance or the others', () => {
    for (const role of [
      'SalesLeader',
      'Pricing',
      'PricingLead',
      'Finance',
      'Approver',
      'Leadership',
    ] as const) {
      expect(codes(planEquipmentBomUpload(makeActor(role), quote))).toEqual(['NOT_PERMITTED']);
    }
    expect(codes(planEquipmentBomUpload(makeActor('Engineer'), quote))).toEqual(['NOT_PERMITTED']);
    expect(codes(planEquipmentBomUpload(makeActor('KAM', { userId: KAM_ID }), quote))).toEqual([
      'NOT_PERMITTED',
    ]);
  });

  it('not outside Engineering Review, and not once the assignee has submitted to the lead', () => {
    const lead = makeActor('EngLead');
    expect(codes(planEquipmentBomUpload(lead, { ...quote, stageKey: 'QUOTING' }))).toEqual([
      'WRONG_STAGE',
    ]);
    expect(codes(planEquipmentBomUpload(lead, { ...quote, status: 'closed' }))).toEqual([
      'QUOTE_CLOSED',
    ]);
    const submitted = { ...quote, engSubmittedAt: new Date('2026-11-09T12:00:00Z') };
    const engineer = makeActor('Engineer', { userId: ENGINEER_ID });
    expect(codes(planEquipmentBomUpload(engineer, submitted))).toEqual(['LOCKED_FOR_REVIEW']);
    // The lead may act at any time.
    expect(planEquipmentBomUpload(lead, submitted)).toEqual({ ok: true });
  });
});

// ── F-024 / F-025: two-step and pack-out ─────────────────────────────────────────────────────────

describe('two-step process and pack-out (F-024, F-025)', () => {
  const twoStep: SolutionExtras = {
    ...EMPTY_SOLUTION_EXTRAS,
    twoStep: true,
    preformPlantCode: 'PLANT_01',
    blowPlantCode: 'PLANT_02',
    preformNumber: 'PF-2210',
    twoStepFreightNote: 'Preforms ship by truck, weekly.',
  };

  it('keeps the four details while ticked and trims text', () => {
    expect(normalizeSolutionExtras({ ...twoStep, preformNumber: '  PF-2210 ' })).toEqual(twoStep);
    expect(normalizeSolutionExtras({ ...twoStep, twoStepFreightNote: '   ' })).toEqual({
      ...twoStep,
      twoStepFreightNote: null,
    });
  });

  it('unticking clears the four details and leaves pack-out alone', () => {
    const out = normalizeSolutionExtras({ ...twoStep, twoStep: false, unitsPerCase: 24 });
    expect(out).toEqual({ ...EMPTY_SOLUTION_EXTRAS, unitsPerCase: 24 });
  });

  it('checks the lengths (preform number ≤ 40, freight note ≤ 300)', () => {
    expect(validateSolutionExtras(twoStep)).toEqual([]);
    expect(validateSolutionExtras({ ...twoStep, preformNumber: 'x'.repeat(40) })).toEqual([]);
    expect(
      validateSolutionExtras({ ...twoStep, preformNumber: 'x'.repeat(41) }).map((e) => e.field),
    ).toEqual(['preformNumber']);
    expect(validateSolutionExtras({ ...twoStep, twoStepFreightNote: 'x'.repeat(300) })).toEqual([]);
    expect(
      validateSolutionExtras({ ...twoStep, twoStepFreightNote: 'x'.repeat(301) }).map(
        (e) => e.field,
      ),
    ).toEqual(['twoStepFreightNote']);
  });

  it('pack-out counts are optional whole numbers from 1', () => {
    expect(validateSolutionExtras(EMPTY_SOLUTION_EXTRAS)).toEqual([]);
    expect(
      validateSolutionExtras({
        ...EMPTY_SOLUTION_EXTRAS,
        unitsPerBag: 1,
        unitsPerPallet: PACK_OUT_MAX,
      }),
    ).toEqual([]);
    const bad = validateSolutionExtras({
      ...EMPTY_SOLUTION_EXTRAS,
      unitsPerBag: 0,
      unitsPerTray: 2.5,
      unitsPerCase: -4,
      unitsPerPallet: PACK_OUT_MAX + 1,
    });
    expect(bad.map((e) => e.field)).toEqual([
      'unitsPerBag',
      'unitsPerTray',
      'unitsPerCase',
      'unitsPerPallet',
    ]);
  });

  it('summarises only the counts that were entered, in a fixed order', () => {
    expect(packOutSummary(EMPTY_SOLUTION_EXTRAS)).toEqual([]);
    expect(
      packOutSummary({ ...EMPTY_SOLUTION_EXTRAS, unitsPerPallet: 1200, unitsPerBag: 50 }),
    ).toEqual([
      { field: 'unitsPerBag', label: 'Units per bag', value: 50 },
      { field: 'unitsPerPallet', label: 'Units per pallet', value: 1200 },
    ]);
  });
});

// ── F-062: routing suggestions ───────────────────────────────────────────────────────────────────

describe('engineering assignment rules (F-062, D-008 open)', () => {
  const rules = parseAssignmentRules(null);
  const neiberger = { id: 'u-neiberger', displayName: 'Randy Neiberger' };
  const pasillas = { id: 'u-pasillas', displayName: 'Rafael Pasillas' };
  const people = [pasillas, neiberger, { id: 'u-other', displayName: 'Jim Zweifel' }];

  it('seeds Paul Slomkowski’s Nov 4 routing: ISBM, RHB and IMM to the PET engineer; EBM and IBM to the polyolefin engineer', () => {
    expect(rules).toEqual(ASSIGNMENT_RULES_SEED);
    const by = (processType: string) =>
      suggestEngineer(rules, { processType, resin: null }, people)?.userId ?? null;
    expect(by('ISBM')).toBe('u-neiberger');
    expect(by('RHB')).toBe('u-neiberger');
    expect(by('IMM')).toBe('u-neiberger');
    expect(by('EBM')).toBe('u-pasillas');
    expect(by('IBM')).toBe('u-pasillas');
    expect(by('ASSEMBLY')).toBeNull();
  });

  it('falls back to the resin while the process type is not chosen yet', () => {
    const by = (resin: string) =>
      suggestEngineer(rules, { processType: null, resin }, people)?.userId ?? null;
    expect(by('PET')).toBe('u-neiberger');
    expect(by('HDPE')).toBe('u-pasillas');
    expect(by('PP')).toBe('u-pasillas');
    expect(by('LDPE')).toBe('u-pasillas');
    // FB-09: PS gets no rule (Paul Slomkowski's email does not mention it); retired codes name nothing.
    expect(by('PS')).toBeNull();
    expect(by('OTHER')).toBeNull();
    expect(by('PCR_PET')).toBeNull();
    expect(by('PVC')).toBeNull();
    expect(suggestEngineer(rules, { processType: null, resin: null }, people)).toBeNull();
  });

  it('the process type wins over the resin', () => {
    const hit = suggestEngineer(rules, { processType: 'EBM', resin: 'PET' }, people);
    expect(hit).toMatchObject({ userId: 'u-pasillas', basis: { processType: 'EBM', resin: null } });
  });

  it('matches the engineer by surname, so a first-name spelling does not matter', () => {
    const rany = { id: 'u-rany', displayName: 'Rany Neiberger' };
    expect(suggestEngineer(rules, { processType: 'ISBM', resin: null }, [rany])?.userId).toBe(
      'u-rany',
    );
  });

  it('a name with no user, or more than one, suggests nobody', () => {
    expect(suggestEngineer(rules, { processType: 'ISBM', resin: null }, [pasillas])).toBeNull();
    const twins = [neiberger, { id: 'u-neiberger-2', displayName: 'Dana Neiberger' }];
    expect(suggestEngineer(rules, { processType: 'ISBM', resin: null }, twins)).toBeNull();
    // A broader later rule does not quietly suggest someone else for the same quote.
    expect(suggestEngineer(rules, { processType: 'ISBM', resin: 'PET' }, [pasillas])).toBeNull();
  });

  it('a rule pinned to a user id uses that user', () => {
    const pinned: AssignmentRules = {
      rules: [
        {
          processTypes: ['ISBM'],
          resins: [],
          engineerName: 'Anyone',
          engineerUserId: 'u-pasillas',
          note: null,
        },
      ],
    };
    expect(suggestEngineer(pinned, { processType: 'ISBM', resin: null }, people)?.name).toBe(
      'Rafael Pasillas',
    );
  });

  it('both conditions on a rule must hold', () => {
    const both: AssignmentRules = {
      rules: [
        {
          processTypes: ['ISBM'],
          resins: ['PET'],
          engineerName: 'Neiberger',
          engineerUserId: null,
          note: null,
        },
      ],
    };
    expect(suggestEngineer(both, { processType: 'ISBM', resin: 'PET' }, people)).toMatchObject({
      userId: 'u-neiberger',
      basis: { processType: 'ISBM', resin: 'PET' },
    });
    expect(suggestEngineer(both, { processType: 'ISBM', resin: 'HDPE' }, people)).toBeNull();
    expect(suggestEngineer(both, { processType: 'ISBM', resin: null }, people)).toBeNull();
  });

  it('rejects malformed config', () => {
    expect(() => parseAssignmentRules('x')).toThrow(/must be an object/);
    expect(() => parseAssignmentRules({})).toThrow(/"rules" must be a list/);
    expect(() =>
      parseAssignmentRules({ rules: [{ processTypes: [], resins: [], engineerName: 'A' }] }),
    ).toThrow(/at least one process type or resin/);
    expect(() =>
      parseAssignmentRules({ rules: [{ processTypes: ['ISBM'], engineerName: '' }] }),
    ).toThrow(/engineerName is required/);
    expect(() =>
      parseAssignmentRules({ rules: [{ processTypes: [1], engineerName: 'A' }] }),
    ).toThrow(/processTypes must be a list of codes/);
    // An empty rule list is valid: it turns suggestions off.
    expect(parseAssignmentRules({ rules: [] })).toEqual({ rules: [] });
  });
});
