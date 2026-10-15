import { describe, expect, it } from 'vitest';

import { evaluateRule, evaluateRules, fieldsReferenced, getPath, isPresent } from './rules';
import type { RequiredRule } from '../types/workflow-config';
import { requiredRuleSchema } from '../types/workflow-config';

describe('isPresent', () => {
  it.each([
    [undefined, false],
    [null, false],
    ['', false],
    ['   ', false],
    [Number.NaN, false],
    [[], false],
    [0, true],
    [false, true],
    ['a', true],
    [[1], true],
    [{}, true],
  ])('%j → %s', (value, expected) => {
    expect(isPresent(value)).toBe(expected);
  });
});

describe('getPath', () => {
  it('reads nested values and stops at non-objects', () => {
    const values = { a: { b: { c: 1 } }, s: 'str', n: null };
    expect(getPath(values, 'a.b.c')).toBe(1);
    expect(getPath(values, 'a.x.c')).toBeUndefined();
    expect(getPath(values, 's.length')).toBeUndefined();
    expect(getPath(values, 'n.x')).toBeUndefined();
  });
});

describe('evaluateRule', () => {
  const fail = (rule: RequiredRule, values: Record<string, unknown>) =>
    evaluateRule(rule, values).map((e) => [e.code, e.field]);

  it('present', () => {
    expect(fail({ field: 'est_annual_volume', op: 'present' }, {})).toEqual([
      ['MISSING_FIELD', 'est_annual_volume'],
    ]);
    expect(fail({ field: 'est_annual_volume', op: 'present' }, { est_annual_volume: 0 })).toEqual(
      [],
    );
  });

  it('minItems', () => {
    const rule: RequiredRule = { field: 'capacity_evidence', op: 'minItems', value: 1 };
    expect(fail(rule, {})).toHaveLength(1);
    expect(fail(rule, { capacity_evidence: [] })).toHaveLength(1);
    expect(fail(rule, { capacity_evidence: 'nope' })).toHaveLength(1);
    expect(fail(rule, { capacity_evidence: [{}] })).toEqual([]);
    expect(evaluateRule(rule, {})[0]!.message).toBe('capacity_evidence needs at least 1 item(s)');
  });

  it('equals / oneOf / gte', () => {
    expect(fail({ field: 'k', op: 'equals', value: 'a' }, { k: 'a' })).toEqual([]);
    expect(fail({ field: 'k', op: 'equals', value: 'a' }, { k: 'b' })).toHaveLength(1);
    expect(fail({ field: 'k', op: 'oneOf', value: ['a', 2] }, { k: 2 })).toEqual([]);
    expect(
      evaluateRule({ field: 'k', op: 'oneOf', value: ['a', 'b'] }, { k: 'c' })[0]!.message,
    ).toContain('a, b');
    expect(fail({ field: 'k', op: 'gte', value: 5 }, { k: 5 })).toEqual([]);
    expect(fail({ field: 'k', op: 'gte', value: 5 }, { k: 4 })).toHaveLength(1);
    expect(fail({ field: 'k', op: 'gte', value: 5 }, { k: '9' })).toHaveLength(1);
    expect(evaluateRule({ field: 'k', op: 'equals', value: true }, {})[0]!.message).toContain(
      'true',
    );
    expect(evaluateRule({ field: 'k', op: 'gte', value: 5 }, {})[0]!.message).toContain(
      'at least 5',
    );
  });

  it('anyOf passes if one alternative passes, else reports one error naming all of them', () => {
    const rule: RequiredRule = {
      anyOf: [
        { field: 'a', op: 'present' },
        { field: 'b', op: 'present' },
      ],
    };
    expect(fail(rule, { b: 1 })).toEqual([]);
    const errors = evaluateRule(rule, {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'MISSING_FIELD',
      field: 'a,b',
      message: 'At least one of: a is required or b is required',
    });
  });

  it('allOf reports every failing child', () => {
    const rule: RequiredRule = {
      allOf: [
        { field: 'a', op: 'present' },
        { field: 'b', op: 'present' },
        { field: 'c', op: 'present' },
      ],
    };
    expect(fail(rule, { b: 1 })).toEqual([
      ['MISSING_FIELD', 'a'],
      ['MISSING_FIELD', 'c'],
    ]);
  });

  it('nests', () => {
    const rule: RequiredRule = {
      anyOf: [
        {
          allOf: [
            { field: 'a', op: 'present' },
            { field: 'b', op: 'present' },
          ],
        },
        { field: 'c', op: 'present' },
      ],
    };
    expect(fail(rule, { a: 1, b: 1 })).toEqual([]);
    expect(fail(rule, { c: 1 })).toEqual([]);
    expect(fail(rule, { a: 1 })).toHaveLength(1);
    expect(fieldsReferenced(rule)).toEqual(['a', 'b', 'c']);
  });

  it('evaluateRules collects across rules', () => {
    expect(
      evaluateRules(
        [
          { field: 'a', op: 'present' },
          { field: 'b', op: 'present' },
        ],
        {},
      ),
    ).toHaveLength(2);
  });
});

describe('rule schema', () => {
  it('accepts the documented shapes and rejects junk', () => {
    expect(requiredRuleSchema.safeParse({ field: 'x', op: 'present' }).success).toBe(true);
    expect(requiredRuleSchema.safeParse({ field: 'x', op: 'minItems', value: 1 }).success).toBe(
      true,
    );
    expect(requiredRuleSchema.safeParse({ anyOf: [{ field: 'x', op: 'present' }] }).success).toBe(
      true,
    );
    expect(requiredRuleSchema.safeParse({ field: 'x', op: 'minItems' }).success).toBe(false);
    expect(requiredRuleSchema.safeParse({ field: 'x', op: 'regex', value: '.*' }).success).toBe(
      false,
    );
    expect(requiredRuleSchema.safeParse({ anyOf: [] }).success).toBe(false);
  });
});
