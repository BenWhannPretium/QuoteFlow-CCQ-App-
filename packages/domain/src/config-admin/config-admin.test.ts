import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors';
import { OVERRIDE_SETTINGS_SEED } from '../overrides/config';
import { parseScoringModel } from '../scoring/model';
import { SCORING_MODEL_V1_INPUT, scoringModelV1 } from '../scoring/seeds';
import { NOW } from '../test-utils';
import { configDiff } from './diff';
import { previewScoringChange } from './scoring-preview';
import { parseSettingValue, SETTING_SPECS, settingSpec } from './settings';

const invalid = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('INVALID_CONFIG');
    return (err as DomainError).message;
  }
  throw new Error('expected INVALID_CONFIG');
};

describe('app setting specs', () => {
  it('has one spec per key, each with a parser', () => {
    const keys = SETTING_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SETTING_SPECS.every((s) => typeof s.parse === 'function')).toBe(true);
  });

  it('covers every CR-51 app setting with a structured editor', () => {
    const editor = (k: string) => settingSpec(k).editor;
    expect(editor('validity_days_default')).toBe('integer');
    expect(editor('min_opportunity_value_warning_usd')).toBe('nullableNumber');
    expect(editor('min_volume_warning_by_process')).toBe('numberMap');
    expect(editor('eng_queue_aging_days')).toBe('agingDays');
    expect(editor('kam_can_see_peer_scores')).toBe('boolean');
    expect(editor('intake_required_fields')).toBe('rules');
    expect(editor('eng_queue_backup_assigner_user_ids')).toBe('userIds');
    expect(editor('overridable_fields')).toBe('overridableFields');
    expect(settingSpec('g4_tier_rules').nullable).toBe(true);
  });

  it('validates validity days with the release parser (whole days, 1–730)', () => {
    expect(parseSettingValue('validity_days_default', 45)).toBe(45);
    invalid(() => parseSettingValue('validity_days_default', 0));
    invalid(() => parseSettingValue('validity_days_default', 30.5));
    invalid(() => parseSettingValue('validity_days_default', '30'));
    expect(invalid(() => parseSettingValue('validity_days_default', null))).toMatch(
      /needs a value/,
    );
  });

  it('accepts null only where "not set" means off', () => {
    expect(parseSettingValue('min_opportunity_value_warning_usd', null)).toBeNull();
    expect(parseSettingValue('min_opportunity_value_warning_usd', 25_000)).toBe(25_000);
    invalid(() => parseSettingValue('min_opportunity_value_warning_usd', -1));
    expect(parseSettingValue('g4_tier_rules', null)).toBeNull();
    invalid(() => parseSettingValue('kam_can_see_peer_scores', null));
  });

  it('checks structured values', () => {
    expect(parseSettingValue('min_volume_warning_by_process', { IBM: 50_000, '*': 0 })).toEqual({
      IBM: 50_000,
      '*': 0,
    });
    invalid(() => parseSettingValue('min_volume_warning_by_process', { IBM: 'lots' }));
    expect(parseSettingValue('eng_queue_aging_days', { aging: 2, old: 5 })).toEqual({
      aging: 2,
      old: 5,
    });
    expect(invalid(() => parseSettingValue('eng_queue_aging_days', { aging: 5, old: 2 }))).toMatch(
      /old must be ≥ aging/,
    );
    invalid(() => parseSettingValue('eng_queue_backup_assigner_user_ids', ['not-a-uuid']));
    invalid(() =>
      parseSettingValue('qualification_exception_note_outcomes', ['advance-without-gate']),
    );
  });

  it('validates required-field rules with the domain DSL schema', () => {
    const rules = [{ field: 'resin', op: 'present' }, { anyOf: [{ field: 'a', op: 'present' }] }];
    expect(parseSettingValue('intake_required_fields', rules)).toEqual(rules);
    invalid(() => parseSettingValue('intake_required_fields', [{ field: 'resin', op: 'exists' }]));
    invalid(() => parseSettingValue('intake_required_fields', [{ anyOf: [] }]));
  });

  it('validates override approvers per field with the overrides parser', () => {
    const fields = OVERRIDE_SETTINGS_SEED.fields;
    expect(parseSettingValue('overridable_fields', fields)).toHaveLength(fields.length);
    const noApprover = fields.map((f) =>
      f.field === 'priority_tier' ? { ...f, approverRoles: [] } : f,
    );
    expect(invalid(() => parseSettingValue('overridable_fields', noApprover))).toMatch(
      /needs approverRoles/,
    );
    invalid(() =>
      parseSettingValue('overridable_fields', [{ ...fields[0], requestRoles: ['Nobody'] }]),
    );
  });

  it('validates G4 tier rules when set', () => {
    const rules = {
      tiers: [{ key: 't1', label: 'Over $1M', minCapitalUsd: 1e6, approverRoles: ['Leadership'] }],
    };
    expect(parseSettingValue('g4_tier_rules', rules)).toMatchObject({ outcomeKeys: ['approve'] });
    invalid(() => parseSettingValue('g4_tier_rules', { tiers: [{ key: 't1', label: 'x' }] }));
  });

  it('keeps unknown keys editable as any JSON', () => {
    expect(settingSpec('some_future_key').editor).toBe('json');
    expect(parseSettingValue('some_future_key', { a: [1, 'b'] })).toEqual({ a: [1, 'b'] });
    expect(parseSettingValue('some_future_key', null)).toBeNull();
  });
});

describe('configDiff', () => {
  it('lists the changed leaves only', () => {
    expect(
      configDiff(
        { label: 'Lost', sort: 10, meta: { a: 1, b: 2 } },
        { label: 'Lost to competitor', sort: 10, meta: { a: 1, b: 3 } },
      ),
    ).toEqual([
      { path: 'label', before: 'Lost', after: 'Lost to competitor' },
      { path: 'meta.b', before: 2, after: 3 },
    ]);
  });

  it('diffs same-length arrays by position and replaces the rest', () => {
    expect(configDiff({ w: [0.2, 0.8] }, { w: [0.3, 0.7] })).toEqual([
      { path: 'w.0', before: 0.2, after: 0.3 },
      { path: 'w.1', before: 0.8, after: 0.7 },
    ]);
    expect(configDiff({ ids: ['a'] }, { ids: ['a', 'b'] })).toEqual([
      { path: 'ids', before: ['a'], after: ['a', 'b'] },
    ]);
  });

  it('handles added keys, nulls and scalars', () => {
    expect(configDiff(null, 5)).toEqual([{ path: '', before: null, after: 5 }]);
    expect(configDiff({}, { x: 1 })).toEqual([{ path: 'x', before: null, after: 1 }]);
    expect(configDiff({ x: 1 }, { x: 1 })).toEqual([]);
  });
});

describe('previewScoringChange', () => {
  const facts = (revenue: number, volume: number) => ({
    quote: { est_annual_revenue: revenue, est_annual_volume: volume, market: 'FOOD' },
    customer: { status: 'existing' },
    eng_review: null,
  });
  const quotes = [
    { id: 'q-small', facts: facts(10_000, 50_000) },
    { id: 'q-big', facts: facts(300_000, 3_000_000) },
    { id: 'q-mid', facts: facts(150_000, 600_000) },
  ];

  it('is a no-op when the draft equals the active model', () => {
    const p = previewScoringChange(scoringModelV1, scoringModelV1, quotes, NOW);
    expect(p.summary).toMatchObject({ quotes: 3, tierChanges: 0, rankChanges: 0 });
    expect(p.rows.map((r) => r.after.rank)).toEqual([3, 1, 2]);
  });

  it('reports tier and rank changes when weights move', () => {
    // All the weight on volume, and a high bar for the top tiers.
    const draft = parseScoringModel({
      ...SCORING_MODEL_V1_INPUT,
      version: 2,
      attributes: SCORING_MODEL_V1_INPUT.attributes.map((a) => ({
        ...a,
        weight: a.key === 'volume' ? 1 : 0,
      })),
    });
    const p = previewScoringChange(scoringModelV1, draft, quotes, NOW);
    const big = p.rows.find((r) => r.quoteId === 'q-big')!;
    expect(big.after.score).toBe(100);
    expect(big.after.tier).toBe('CRITICAL');
    expect(big.tierChanged).toBe(big.before!.tier !== 'CRITICAL');
    expect(p.summary.tierChanges).toBe(p.rows.filter((r) => r.tierChanged).length);
    expect(p.summary.tierChanges).toBeGreaterThan(0);
    const total = (side: 'before' | 'after') => p.summary.byTier.reduce((n, t) => n + t[side], 0);
    expect(total('before')).toBe(3);
    expect(total('after')).toBe(3);
    expect(p.summary.byTier.map((t) => t.tier)).toEqual(['CRITICAL', 'HIGH', 'STANDARD', 'LOW']);
  });

  it('works without an active model (no before)', () => {
    const p = previewScoringChange(null, scoringModelV1, quotes, NOW);
    expect(p.rows.every((r) => r.before === null && r.rankDelta === 0 && !r.tierChanged)).toBe(
      true,
    );
  });

  it('ranks ties in input order', () => {
    const same = [
      { id: 'a', facts: facts(1, 1) },
      { id: 'b', facts: facts(1, 1) },
    ];
    const p = previewScoringChange(null, scoringModelV1, same, NOW);
    expect(p.rows.map((r) => r.after.rank)).toEqual([1, 2]);
  });
});
