import { describe, expect, it } from 'vitest';

import {
  MODEL_UPLOAD_PERMISSION,
  ROI_NOT_REQUIRED_TEXT,
  ROI_REQUIRED_WHEN_SEED,
  nextModelVersion,
  parseRoiRequiredWhen,
  planModelUpload,
  quotingSteps,
  roiReasonText,
  roiRequirement,
  versionRestoredOnRemoval,
  type ModelFileRef,
  type QuotingStepsInput,
} from './index';
import {
  QUOTING_MODEL_KINDS,
  VERSIONED_ATTACHMENT_KINDS,
  isQuotingModelKind,
  isVersionedKind,
} from '../attachments/file-types';
import { submissionRules } from '../lead-review';
import { notificationEvent } from '../notifications/events';
import { HANDOFF_TYPES, planCostModelUploaded, planRoiUploaded } from '../notifications/recipients';
import { permissionsForRoles } from '../policy/can';
import { rolesWithPermission } from '../policy/matrix';
import { NOW, makeActor, makeQuote } from '../test-utils';
import { asUserId } from '../types/ids';
import { ROLES, type Role } from '../types/roles';
import { fieldsReferenced } from '../workflow/rules';
import { hybridConfig } from '../workflow/seeds/hybrid';

const PRICER = asUserId('user-pricer');
const quoting = makeQuote('QUOTING', { assignedPricerId: PRICER });
const ready = { costModelOnFile: true, costModelGrandfathered: false, roiRequired: true };

const file = (id: string, version: number, at: Date): ModelFileRef => ({
  id,
  version,
  fileName: `${id}.xlsx`,
  uploadedById: 'u',
  uploadedAt: at,
});
const t = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('roi_required_when (FB-07, D-001; provisional)', () => {
  it('parses the seed and falls back to it; rejects a malformed setting', () => {
    expect(parseRoiRequiredWhen(undefined)).toEqual(ROI_REQUIRED_WHEN_SEED);
    expect(parseRoiRequiredWhen(ROI_REQUIRED_WHEN_SEED)).toEqual(ROI_REQUIRED_WHEN_SEED);
    expect(
      parseRoiRequiredWhen({ g2Outcomes: ['a', 'a'], capitalLikely: false, fundingModels: [] }),
    ).toEqual({ g2Outcomes: ['a'], capitalLikely: false, fundingModels: [] });
    expect(() => parseRoiRequiredWhen({ g2Outcomes: [] })).toThrow(/roi_required_when/);
    expect(() => parseRoiRequiredWhen({ ...ROI_REQUIRED_WHEN_SEED, extra: 1 })).toThrow();
  });

  it('seed: capital required (G2), capital likely, customer-funded or $0 CER', () => {
    expect(ROI_REQUIRED_WHEN_SEED).toEqual({
      g2Outcomes: ['capital_required'],
      capitalLikely: true,
      fundingModels: ['CUSTOMER_FUNDED', 'ZERO_CER'],
    });
  });

  it('lists every reason that applies, and none when capital is not required', () => {
    expect(
      roiRequirement(
        {
          g2_outcome: 'capital_required',
          capital_likely: true,
          tooling_funding_model: 'ZERO_CER',
        },
        ROI_REQUIRED_WHEN_SEED,
      ),
    ).toEqual({
      required: true,
      reasons: [
        { code: 'g2_outcome', value: 'capital_required' },
        { code: 'capital_likely', value: null },
        { code: 'funding_model', value: 'ZERO_CER' },
      ],
    });
    expect(
      roiRequirement(
        { g2_outcome: 'proceed', capital_likely: false, tooling_funding_model: 'COMPANY_FUNDED' },
        ROI_REQUIRED_WHEN_SEED,
      ),
    ).toEqual({ required: false, reasons: [] });
    // capitalLikely switched off in config: the flag alone no longer requires an ROI.
    expect(
      roiRequirement({ capital_likely: true }, { ...ROI_REQUIRED_WHEN_SEED, capitalLikely: false })
        .required,
    ).toBe(false);
  });

  it('says why in words, with the config labels', () => {
    expect(
      roiReasonText(
        { code: 'g2_outcome', value: 'capital_required' },
        { g2Outcome: () => 'Advance – capital required' },
      ),
    ).toBe('Engineering’s decision: Advance – capital required');
    expect(roiReasonText({ code: 'capital_likely', value: null })).toBe(
      'Capital is flagged likely',
    );
    expect(roiReasonText({ code: 'funding_model', value: 'ZERO_CER' })).toBe(
      'Tooling funding: ZERO_CER',
    );
    expect(ROI_NOT_REQUIRED_TEXT).toMatch(/^Not required/);
  });
});

describe('model kinds', () => {
  it('the three Quoting models are versioned, and so is the FB-06 equipment BOM', () => {
    expect([...QUOTING_MODEL_KINDS]).toEqual(['cost_model', 'roi_model', 'price_table']);
    expect([...VERSIONED_ATTACHMENT_KINDS]).toEqual([...QUOTING_MODEL_KINDS, 'equipment_bom']);
    // The BOM is Engineering's file, not a Quoting step.
    expect(isQuotingModelKind('equipment_bom')).toBe(false);
    expect(isVersionedKind('cost_model')).toBe(true);
    expect(isVersionedKind('bottle_drawing')).toBe(false);
    expect(isQuotingModelKind('roi_model')).toBe(true);
    expect(isQuotingModelKind('spec')).toBe(false);
  });

  it('each step has its own upload permission', () => {
    expect(MODEL_UPLOAD_PERMISSION).toEqual({
      cost_model: 'quoting.edit',
      roi_model: 'roi.upload',
      price_table: 'gate.G3.submit',
    });
  });
});

describe('F-083: the Finance role reads quotes and uploads the ROI, nothing else', () => {
  it('holds exactly quote.read, quote.read.commercialFields and roi.upload', () => {
    expect(permissionsForRoles(['Finance'])).toEqual([
      'quote.read',
      'quote.read.commercialFields',
      'roi.upload',
    ]);
  });

  it('roi.upload: Finance, the pricing lead (provisional fallback) and Admin', () => {
    expect(rolesWithPermission('roi.upload').sort()).toEqual(['Admin', 'Finance', 'PricingLead']);
  });
});

describe('planModelUpload: who uploads which model, allowed and denied for every role', () => {
  const allowed: Record<string, readonly Role[]> = {
    cost_model: ['Pricing', 'PricingLead'],
    roi_model: ['PricingLead', 'Finance', 'Admin'],
    price_table: ['PricingLead'],
  };
  for (const kind of QUOTING_MODEL_KINDS) {
    it.each(ROLES.map((r) => [r] as const))(`${kind}: %s`, (role) => {
      const plan = planModelUpload(kind, makeActor(role), quoting, ready);
      if (allowed[kind]!.includes(role)) expect(plan).toEqual({ ok: true });
      else expect(!plan.ok && plan.errors.map((e) => e.code)).toEqual(['NOT_PERMITTED']);
    });
  }

  it('only in Quoting, never on a closed quote', () => {
    const lead = makeActor('PricingLead');
    const eng = planModelUpload('cost_model', lead, makeQuote('ENG_REVIEW'), ready);
    expect(!eng.ok && eng.errors[0]!.code).toBe('WRONG_STAGE');
    const fr = planModelUpload('roi_model', makeActor('Finance'), makeQuote('FINAL_REVIEW'), ready);
    expect(!fr.ok && fr.errors[0]!.code).toBe('WRONG_STAGE');
    const closed = planModelUpload(
      'cost_model',
      lead,
      makeQuote('QUOTING', { status: 'closed' }),
      ready,
    );
    expect(!closed.ok && closed.errors[0]!.code).toBe('QUOTE_CLOSED');
  });

  it('lead review: once the pricer submitted, only the lead replaces the costing model', () => {
    const submitted = { ...quoting, pricingSubmittedAt: NOW };
    const pricer = planModelUpload(
      'cost_model',
      makeActor('Pricing', { userId: PRICER }),
      submitted,
      ready,
    );
    expect(!pricer.ok && pricer.errors[0]!.code).toBe('LOCKED_FOR_REVIEW');
    expect(planModelUpload('cost_model', makeActor('PricingLead'), submitted, ready).ok).toBe(true);
    // Finance's ROI is not the pricer's part: the submission does not lock it.
    expect(planModelUpload('roi_model', makeActor('Finance'), submitted, ready).ok).toBe(true);
  });

  it('ROI: costing comes first, and only on a quote that needs one', () => {
    const finance = makeActor('Finance');
    const first = planModelUpload('roi_model', finance, quoting, {
      ...ready,
      costModelOnFile: false,
    });
    expect(!first.ok && first.errors[0]!.code).toBe('COSTING_FIRST');
    expect(
      planModelUpload('roi_model', finance, quoting, {
        ...ready,
        costModelOnFile: false,
        costModelGrandfathered: true,
      }).ok,
    ).toBe(true);
    const notNeeded = planModelUpload('roi_model', finance, quoting, {
      ...ready,
      roiRequired: false,
    });
    expect(!notNeeded.ok && notNeeded.errors[0]!.code).toBe('ROI_NOT_REQUIRED');
  });

  it('a Finance user with no data scope over the quote is denied', () => {
    // A region the quote is not in (an `owner` scope narrows only KAM and Engineer, as RLS does).
    const outside = makeActor('Finance', { scope: { type: 'region', values: ['Elsewhere'] } });
    const plan = planModelUpload('roi_model', outside, quoting, ready);
    expect(!plan.ok && plan.errors[0]!.code).toBe('NOT_PERMITTED');
  });
});

describe('quotingSteps: costing → ROI → price approved', () => {
  const base: QuotingStepsInput = {
    costModel: null,
    roiModel: null,
    priceTable: null,
    costingCompleted: false,
    costingAttestedBy: null,
    costingAttestedAt: null,
    costModelGrandfathered: false,
    roi: { required: true, reasons: [{ code: 'g2_outcome', value: 'capital_required' }] },
    priceConfirmed: null,
  };

  it('starts at costing; ROI and price wait', () => {
    const s = quotingSteps(base);
    expect([s.current, s.costing.status, s.roi.status, s.price.status]).toEqual([
      'costing',
      'waiting',
      'blocked',
      'blocked',
    ]);
  });

  it('a model without the attestation is not done; both make costing done, then ROI is next', () => {
    const modelOnly = quotingSteps({ ...base, costModel: file('c1', 1, t(0)) });
    expect(modelOnly.costing.status).toBe('waiting');
    const costed = quotingSteps({
      ...base,
      costModel: file('c1', 1, t(0)),
      costingCompleted: true,
      costingAttestedBy: 'p',
      costingAttestedAt: t(1),
    });
    expect([costed.current, costed.costing.status, costed.roi.status, costed.price.status]).toEqual(
      ['roi', 'done', 'waiting', 'blocked'],
    );
    expect(costed.costing).toMatchObject({ attestedBy: 'p', attestedAt: t(1) });
  });

  it('with the ROI on file the price is next; a confirmed price finishes', () => {
    const roiIn = {
      ...base,
      costModel: file('c1', 1, t(0)),
      costingCompleted: true,
      roiModel: file('r1', 1, t(2)),
    };
    expect(quotingSteps(roiIn).current).toBe('price');
    expect(quotingSteps(roiIn).price.status).toBe('waiting');
    const done = quotingSteps({
      ...roiIn,
      priceConfirmed: { by: 'lead', at: t(3) },
      priceTable: file('p1', 1, t(3)),
    });
    expect([done.current, done.price.status, done.price.confirmedBy]).toEqual([
      'done',
      'done',
      'lead',
    ]);
    expect(done.price.priceTable?.id).toBe('p1');
  });

  it('ROI not required: the step says so and the price is next after costing', () => {
    const s = quotingSteps({
      ...base,
      roi: { required: false, reasons: [] },
      costModel: file('c1', 1, t(0)),
      costingCompleted: true,
    });
    expect([s.current, s.roi.status, s.price.status]).toEqual(['price', 'not_required', 'waiting']);
  });

  it('grandfathered: "no model on file", costing done with the attestation alone', () => {
    const s = quotingSteps({ ...base, costModelGrandfathered: true, costingCompleted: true });
    expect(s.costing).toMatchObject({ status: 'done', noModelOnFile: true });
    expect(s.current).toBe('roi');
  });

  it('flags an ROI built before the latest costing model', () => {
    const s = quotingSteps({
      ...base,
      costModel: file('c2', 2, t(5)),
      costingCompleted: true,
      roiModel: file('r1', 1, t(2)),
    });
    expect(s.roi.olderThanCostModel).toBe(true);
  });
});

describe('versions (F-074, T-034)', () => {
  it('the next upload is version n+1 and supersedes the current one', () => {
    expect(nextModelVersion([])).toEqual({ version: 1, supersedes: null });
    expect(
      nextModelVersion([
        { id: 'a', version: 1, current: false },
        { id: 'b', version: 2, current: true },
      ]),
    ).toEqual({ version: 3, supersedes: 'b' });
  });

  it('removing the current version restores the newest remaining one', () => {
    const versions = [
      { id: 'a', version: 1, removed: false, current: false },
      { id: 'b', version: 2, removed: true, current: false },
      { id: 'c', version: 3, removed: false, current: true },
    ];
    expect(versionRestoredOnRemoval('c', versions)).toBe('a');
    expect(versionRestoredOnRemoval('a', versions)).toBeNull();
    expect(
      versionRestoredOnRemoval('a', [{ id: 'a', version: 1, removed: false, current: true }]),
    ).toBeNull();
  });
});

describe('notifications (FB-05 resolver)', () => {
  it('costing uploaded on a quote that needs an ROI tells Finance; otherwise nobody', () => {
    expect(planCostModelUploaded(true)).toEqual([
      {
        type: HANDOFF_TYPES.readyForRoi,
        recipient: { kind: 'role', role: 'Finance' },
        reason: 'next_owner',
      },
    ]);
    expect(planCostModelUploaded(false)).toEqual([]);
  });

  it('ROI uploaded tells the pricing lead', () => {
    expect(planRoiUploaded()).toEqual([
      {
        type: HANDOFF_TYPES.roiUploaded,
        recipient: { kind: 'role', role: 'PricingLead' },
        reason: 'next_owner',
      },
    ]);
  });

  it('both types are in the catalogue and emailed', () => {
    for (const type of [HANDOFF_TYPES.readyForRoi, HANDOFF_TYPES.roiUploaded]) {
      expect(notificationEvent(type)?.email).toBe('immediate');
    }
  });
});

describe('lead review: the pricer submits the costing, not the ROI', () => {
  it("the pricer's submission is checked without the ROI rule, with the costing-model rule", () => {
    const fields = submissionRules('pricing', hybridConfig).flatMap((r) => fieldsReferenced(r));
    expect(fields).toContain('cost_model_on_file');
    expect(fields).not.toContain('roi_model_on_file');
    expect(fields).not.toContain('roi_required');
  });
});

describe('F-081: the gate is "Price approved"', () => {
  it('G3 label and its advance outcome', () => {
    expect(hybridConfig.gates.find((g) => g.key === 'G3')?.label).toBe('Price approved');
    expect(hybridConfig.outcomes.find((o) => o.gateKey === 'G3' && o.key === 'submit')?.label).toBe(
      'Advance – price approved',
    );
  });
});
