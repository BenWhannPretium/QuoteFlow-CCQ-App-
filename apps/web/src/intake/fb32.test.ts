import type { PublicConfigResponse, SfOpportunityDetail, SfProductSpec } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { itemFromSpec, prefillFromOpportunity, sfSuggestionsForSpec, wizardConfig } from './model';

/**
 * FB-32 (N19-04, Sarah Brennan): less double entry. Item 1's name comes from the opportunity's first product
 * specification (only while the KAM has not typed one), and "Salesforce says X, Use this" hints exist for
 * the specification's Color, off unless `intake_sf_suggestions_enabled` is on. Synthetic values only.
 */

const entry = (code: string, label: string, meta: Record<string, unknown> = {}) => ({
  code,
  label,
  sort: 10,
  meta,
});

const config = (settings: Record<string, unknown> = {}): PublicConfigResponse => ({
  stages: [],
  gates: [],
  outcomes: [],
  reasonCodes: [],
  tiers: [],
  valueLists: {
    request_class: [entry('CCQ', 'CCQ')],
    resin: [entry('HDPE', 'HDPE'), entry('PET', 'PET')],
    neck_diameter: [entry('28', '28 mm')],
    neck_finish_type: [entry('410', '410')],
    color_type: [
      entry('NATURAL', 'Natural'),
      entry('STOCK_WHITE', 'Stock white', { resins: ['HDPE', 'PP'] }),
      entry('CUSTOM', 'Custom color', { freeText: true }),
    ],
  },
  settings: {
    intake_required_fields: [],
    intake_volume_placeholder: { values: [], roundMultiple: null },
    intake_default_request_class: 'CCQ',
    intake_allowed_request_classes: ['CCQ'],
    intake_redirect_message: 'Elsewhere.',
    ...settings,
  },
});

const spec = (over: Partial<SfProductSpec> = {}): SfProductSpec => ({
  id: 'a0PSYN000000000001',
  opportunityId: '006SYN000000000001',
  name: 'PS-000001',
  productType: null,
  resin: 'HDPE',
  capacity: '16 oz',
  neckFinish: '28-410',
  color: null,
  annualVolume: 250000,
  ...over,
});

const detail = (specs: SfProductSpec[]) =>
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
      shipToLocations: null,
      systemModstamp: null,
      dataQuality: [],
    },
    account: { id: '001SYN', name: 'Synthetic Co', shipTo: null },
    productSpecs: specs,
    productSpecsStatus: specs.length > 0 ? 'found' : 'none',
    ccqStageHint: null,
    snapshotSyncedAt: null,
    liveRefreshedAt: null,
    liveError: null,
    deletedInSf: false,
  }) as unknown as SfOpportunityDetail;

const cfg = wizardConfig(config())!;
const KEY1 = '11111111-1111-4111-8111-111111111111';

describe("FB-32 (B1): item 1's name comes from Salesforce", () => {
  it("is the first specification's name, tagged, when nothing was typed", () => {
    const out = prefillFromOpportunity(detail([spec()]), cfg);
    expect(out.items![0]!.label).toBe('PS-000001');
    expect(out.items![0]!.sfPrefill?.label).toBe('PS-000001');
  });

  it('is the capacity when the specification has no name', () => {
    const out = prefillFromOpportunity(detail([spec({ name: ' ', capacity: '16 oz' })]), cfg);
    expect(out.items![0]!.label).toBe('16 oz');
    expect(out.items![0]!.sfPrefill?.label).toBe('16 oz');
  });

  it('is left blank, with no tag, when the specification has neither', () => {
    const out = prefillFromOpportunity(detail([spec({ name: null, capacity: null })]), cfg);
    expect(out.items![0]!.label ?? null).toBeNull();
    expect(out.items![0]!.sfPrefill?.label).toBeNull();
  });

  it('is left blank when Salesforce sent no specification', () => {
    const out = prefillFromOpportunity(detail([]), cfg);
    expect(out.items![0]!.label ?? null).toBeNull();
  });

  it('never overwrites a name the KAM typed, on a second pick of the same opportunity', () => {
    const first = prefillFromOpportunity(detail([spec()]), cfg);
    const typed = {
      ...first,
      items: [{ ...first.items![0]!, label: 'My 16 oz bottle' }],
    };
    const again = prefillFromOpportunity(detail([spec()]), cfg, typed);
    expect(again.items![0]!.label).toBe('My 16 oz bottle');
    expect(again.items![0]!.sfPrefill?.label).toBeNull();
  });

  it('never overwrites a typed name when another opportunity is picked', () => {
    const current = { items: [{ key: KEY1, label: 'Typed first' }] };
    const out = prefillFromOpportunity(detail([spec({ name: 'PS-000009' })]), cfg, current);
    expect(out.items![0]!.label).toBe('Typed first');
    expect(out.items![0]!.key).toBe(KEY1);
  });

  it('replaces the name Salesforce itself supplied last time', () => {
    const first = prefillFromOpportunity(detail([spec({ name: 'PS-000001' })]), cfg);
    const out = prefillFromOpportunity(detail([spec({ name: 'PS-000002' })]), cfg, first);
    expect(out.items![0]!.label).toBe('PS-000002');
    expect(out.items![0]!.sfPrefill?.label).toBe('PS-000002');
  });

  it("clears the previous opportunity's Salesforce name when the new one has none", () => {
    const first = prefillFromOpportunity(detail([spec({ name: 'PS-000001' })]), cfg);
    const out = prefillFromOpportunity(detail([spec({ name: null, capacity: null })]), cfg, first);
    expect(out.items![0]!.label ?? null).toBeNull();
  });

  it('items added from Salesforce products are named the same way', () => {
    expect(itemFromSpec(spec({ name: 'PS-000003' }), cfg).label).toBe('PS-000003');
    expect(itemFromSpec(spec({ name: null }), cfg).label).toBe('16 oz');
  });
});

describe('FB-32: the rest of the prefill is unchanged', () => {
  it('fills resin, neck, volume and container size on item 1 as before', () => {
    const item = prefillFromOpportunity(detail([spec()]), cfg).items![0]!;
    expect(item).toMatchObject({
      resin: 'HDPE',
      neckDiameter: '28',
      neckFinishType: '410',
      neckFinishTypeCustom: null,
      estAnnualVolume: 250000,
      containerSize: '16 oz',
      sfProductSpecId: 'a0PSYN000000000001',
    });
    expect(item.sfPrefill).toEqual({
      resin: 'HDPE',
      neckDiameter: '28',
      neckFinishType: '410',
      neckFinishTypeCustom: null,
      estAnnualVolume: 250000,
      containerSize: '16 oz',
      label: 'PS-000001',
    });
  });

  it('keeps what the KAM has on a field Salesforce could not give', () => {
    const current = { items: [{ key: KEY1, resin: 'PET', containerSize: '8 oz' }] };
    const out = prefillFromOpportunity(
      detail([spec({ resin: 'Polypropylene', capacity: null })]),
      cfg,
      current,
    );
    expect(out.items![0]).toMatchObject({ resin: 'PET', containerSize: '8 oz' });
  });

  it('does not fill the color: a suggestion never fills', () => {
    const on = wizardConfig(config({ intake_sf_suggestions_enabled: true }))!;
    const item = prefillFromOpportunity(detail([spec({ color: 'Natural' })]), on).items![0]!;
    expect(item.colorType ?? null).toBeNull();
    expect(item.sfPrefill?.colorType ?? null).toBeNull();
  });
});

describe('FB-32 (C): "Salesforce says X, Use this" hints', () => {
  const on = wizardConfig(config({ intake_sf_suggestions_enabled: true }))!;

  it('are off unless the setting is true (a missing setting is off)', () => {
    expect(cfg.sfSuggestionsEnabled).toBe(false);
    expect(
      wizardConfig(config({ intake_sf_suggestions_enabled: false }))!.sfSuggestionsEnabled,
    ).toBe(false);
    expect(
      wizardConfig(config({ intake_sf_suggestions_enabled: 'yes' }))!.sfSuggestionsEnabled,
    ).toBe(false);
    expect(on.sfSuggestionsEnabled).toBe(true);
    expect(sfSuggestionsForSpec(spec({ color: 'Natural' }), cfg)).toEqual([]);
  });

  it('show the Salesforce text for an exact match when on', () => {
    expect(sfSuggestionsForSpec(spec({ color: 'Natural' }), on)).toEqual([
      { quoteflowField: 'colorType', sfLabel: 'Color', sfText: 'Natural', code: 'NATURAL' },
    ]);
    expect(sfSuggestionsForSpec(spec({ color: ' natural ' }), on)[0]?.code).toBe('NATURAL');
  });

  it('show nothing for a miss, a near miss or a Custom entry', () => {
    for (const color of ['Amber', 'White', 'Stock-white', 'Custom color', null]) {
      expect(sfSuggestionsForSpec(spec({ color }), on)).toEqual([]);
    }
    expect(sfSuggestionsForSpec(undefined, on)).toEqual([]);
  });
});
