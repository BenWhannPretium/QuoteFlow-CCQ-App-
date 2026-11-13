import type { PublicConfigResponse, SfOpportunityDetail } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import {
  evaluateDraft,
  FIELD_META,
  issueText,
  prefillFromOpportunity,
  problemField,
  requiredFieldsNow,
  submitProblemIssues,
  wizardConfig,
} from './model';

/**
 * FB-15 (W13-01, W13-02, W13-04): the wizard's side of "the intake says it is missing required information".
 * The wizard called a draft ready that the server then refused. Each wizard-side cause is reproduced here
 * (these tests fail on the pre-FB-15 model). Synthetic values only.
 */

const entry = (code: string, label: string, meta: Record<string, unknown> = {}, sort = 10) => ({
  code,
  label,
  sort,
  meta,
});
const present = (field: string) => ({ field, op: 'present' });

const config: PublicConfigResponse = {
  stages: [],
  gates: [],
  outcomes: [],
  reasonCodes: [],
  tiers: [],
  retiredValues: { resin: { PCR_HDPE: 'PCR-HDPE' } },
  valueLists: {
    request_class: [entry('CCQ', 'CCQ')],
    product_family: [entry('BOTTLE', 'Bottle'), entry('OTHER', 'Other', { freeText: true })],
    component: [entry('CONTAINER', 'Container'), entry('OTHER', 'Other', { freeText: true })],
    market: [entry('FOOD', 'Food'), entry('BEVERAGE', 'Beverage')],
    sub_market: [
      entry('FOOD_SNACKS', 'Snacks & Confections', { market: 'FOOD' }),
      entry('BEV_SPIRITS', 'Spirits & Mixers', { market: 'BEVERAGE' }),
    ],
    resin: [entry('HDPE', 'HDPE'), entry('PET', 'PET')],
    neck_diameter: [entry('28', '28 mm')],
    neck_finish_type: [entry('410', '410'), entry('CUSTOM', 'Custom', { freeText: true })],
    color_type: [entry('NATURAL', 'Natural')],
    drawing_status: [entry('HAVE_DRAWING', 'Have drawing', { hasDrawing: true })],
    tooling_funding_model: [
      entry('NOT_DISCUSSED', 'Not discussed', { defaultAtIntake: true }),
      entry('SHARED', 'Shared', { customerShare: true }),
    ],
  },
  settings: {
    intake_required_fields: [
      present('sf_opportunity_id'),
      present('customer.name'),
      present('ship_to.city'),
      present('ship_to.state'),
      present('product_family'),
      present('resin'),
      present('est_annual_volume'),
      present('quote_needed_by'),
      present('product_needed_by'),
      present('market'),
      present('sub_market'),
    ],
    intake_volume_placeholder: { values: [], roundMultiple: null },
    intake_default_request_class: 'CCQ',
    intake_allowed_request_classes: ['CCQ'],
    intake_redirect_message: 'Stock stays in the pricing application.',
    intake_min_spec_fields: ['height', 'neck', 'resin', 'color'],
    intake_field_help: {},
    intake_description_template: '{container_size} {product_family}',
  },
};
const cfg = wizardConfig(config)!;

const address = { line1: '1 Test St', city: 'Testville', state: 'MO', postal: null, country: 'US' };
const ready = {
  sfOpportunityId: '006SYN000000000001',
  customer: { status: 'existing' as const, sfAccountId: '001SYN', name: 'Synthetic Co' },
  shipTo: address,
  shipToDefault: address,
  requestClass: 'CCQ',
  productFamily: 'BOTTLE',
  components: ['CONTAINER'],
  market: 'FOOD',
  subMarket: 'FOOD_SNACKS',
  resin: 'HDPE',
  estAnnualVolume: 500_000,
  quoteNeededBy: '2026-12-15',
  productNeededBy: '2027-03-01',
};
const NOW = new Date('2026-11-13T15:00:00Z');
const blocking = (data: Parameters<typeof evaluateDraft>[0], kept = {}) =>
  evaluateDraft(data, cfg, true, kept, NOW).blocking.map((b) => `${b.code}:${b.field}`);

describe('W13-01 (b): the wizard checks list codes exactly as the server does', () => {
  it('a complete draft is ready', () => {
    expect(blocking(ready)).toEqual([]);
  });

  it('a retired or unknown code is named before Submit (the server refused it, the wizard did not)', () => {
    expect(cfg.intake.listCodes?.resin).toEqual(['HDPE', 'PET']);
    expect(blocking({ ...ready, resin: 'PCR_HDPE' })).toEqual(['INVALID_VALUE:resin']);
  });

  it("a reworked quote's own retired code is kept, as on the server", () => {
    expect(blocking({ ...ready, resin: 'PCR_HDPE' }, { resin: ['PCR_HDPE'] })).toEqual([]);
  });
});

describe('W13-01 (e), W13-02: Market and Sub-market', () => {
  it('both are required and marked', () => {
    expect(blocking({ ...ready, market: null, subMarket: null })).toEqual([
      'MISSING_FIELD:market',
      'MISSING_FIELD:sub_market',
    ]);
    expect(cfg.requiredFields.has('market')).toBe(true);
    expect(cfg.requiredFields.has('sub_market')).toBe(true);
  });

  it('a sub-market of another market is named', () => {
    expect(blocking({ ...ready, market: 'BEVERAGE' })).toEqual(['INVALID_VALUE:sub_market']);
  });
});

describe('W13-01 (g), W13-02: the minimum-spec fields carry the marker while no drawing is attached', () => {
  it('marks height, neck, resin and color without a drawing, and not with one', () => {
    const without = requiredFieldsNow(cfg, false);
    for (const f of ['height_mm', 'neck_diameter', 'neck_finish_type', 'resin', 'color_type']) {
      expect(without.has(f), f).toBe(true);
    }
    const withDrawing = requiredFieldsNow(cfg, true);
    expect(withDrawing.has('height_mm')).toBe(false);
    expect(withDrawing.has('resin')).toBe(true); // required by the rules anyway
  });
});

describe('W13-01: a refused submit lists every field by its label', () => {
  it('normalises the server paths to the intake fields', () => {
    expect(problemField('subMarket')).toBe('sub_market');
    expect(problemField('/data/sfOpportunityId')).toBe('sf_opportunity_id');
    expect(problemField('/quote_needed_by')).toBe('quote_needed_by');
    expect(problemField('ship_to.state')).toBe('ship_to.state');
  });

  it('prefers the server blocking list and labels every entry', () => {
    const issues = submitProblemIssues({
      detail: 'The intake is missing required information',
      errors: [{ path: 'subMarket', message: 'sub_market is required' }],
      blocking: [
        { code: 'MISSING_FIELD', field: 'sub_market', message: 'sub_market is required' },
        { code: 'INVALID_VALUE', field: 'resin', message: 'Pick a resin from the list' },
      ],
    });
    expect(issues.map(issueText)).toEqual(['Sub-market is required', 'Pick a resin from the list']);
  });

  it('falls back to errors[] when there is no blocking list', () => {
    const issues = submitProblemIssues({
      errors: [{ path: '/data/sfOpportunityId', message: 'Opportunity not found in Salesforce' }],
    });
    expect(issues).toEqual([
      {
        code: 'SERVER',
        field: 'sf_opportunity_id',
        message: 'Opportunity not found in Salesforce',
      },
    ]);
  });

  it('every field the domain can block on has a label and a step (so every Fix link lands)', () => {
    const fields = [
      ...cfg.intake.requiredFields.map((r) => (r as { field: string }).field),
      'customer.sf_account_id',
      'ship_to_override_reason',
      'product_family_other',
      'component_other',
      'decoration_type_other',
      'customer_share_pct',
      'freight_special_arrangements',
      'drawing_or_min_spec',
      'neck_finish_type_custom',
      'resin_grade',
    ];
    for (const f of fields) expect(FIELD_META[f], f).toBeDefined();
  });
});

describe('W13-04: Salesforce product specifications', () => {
  const detail = (
    specs: SfOpportunityDetail['productSpecs'],
    status: 'found' | 'none' | 'unavailable',
  ) =>
    ({
      opportunity: {
        id: '006SYN000000000001',
        name: 'Synthetic opportunity',
        accountId: '001SYN',
        accountName: 'Synthetic Co',
        ownerId: null,
        ownerName: null,
        ownerAlias: null,
        ownerEmail: null,
        amount: 100_000,
        closeDate: null,
        stage: null,
        isClosed: false,
        isWon: false,
        erfNumber: null,
        quoteSource: null,
        systemModstamp: null,
        dataQuality: [],
      },
      account: { id: '001SYN', name: 'Synthetic Co', shipTo: address },
      productSpecs: specs,
      productSpecsStatus: status,
      ccqStageHint: null,
      snapshotSyncedAt: null,
      liveRefreshedAt: null,
      liveError: null,
      deletedInSf: false,
    }) as unknown as SfOpportunityDetail;
  const spec = (id: string, resin: string | null) => ({
    id,
    opportunityId: '006SYN000000000001',
    name: id,
    productType: null,
    resin,
    capacity: '16 oz',
    neckFinish: '28-410',
    color: null,
    annualVolume: 250_000,
  });

  it('keeps every specification and pre-fills from the first', () => {
    const out = prefillFromOpportunity(detail([spec('a', 'HDPE'), spec('b', 'PET')], 'found'), cfg);
    expect(out.sfProductSpecs?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out.sfProductSpecsStatus).toBe('found');
    expect(out).toMatchObject({
      resin: 'HDPE',
      neckDiameter: '28',
      neckFinishType: '410',
      containerSize: '16 oz',
    });
  });

  it('a resin Salesforce names that is not on the list leaves the resin blank (shown as unmatched)', () => {
    const out = prefillFromOpportunity(
      detail([spec('a', 'High-density polyethylene')], 'found'),
      cfg,
    );
    expect(out.resin).toBeNull();
    expect(out.sfPrefill?.resin).toBeNull();
    expect(out.sfProductSpecs?.[0]?.resin).toBe('High-density polyethylene');
  });

  it('records that Salesforce had no product details, or could not be read', () => {
    expect(prefillFromOpportunity(detail([], 'none'), cfg).sfProductSpecsStatus).toBe('none');
    expect(prefillFromOpportunity(detail([], 'unavailable'), cfg).sfProductSpecsStatus).toBe(
      'unavailable',
    );
  });
});
