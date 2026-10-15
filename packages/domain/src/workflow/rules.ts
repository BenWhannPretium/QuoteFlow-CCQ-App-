import { DomainError } from '../errors';
import type { RequiredRule } from '../types/workflow-config';

export type FieldValues = Readonly<Record<string, unknown>>;

/** Reads `a.b.c` from nested plain objects. Returns undefined as soon as the path breaks. */
export function getPath(values: FieldValues, path: string): unknown {
  let current: unknown = values;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** "Present" = not null/undefined, not blank text, not NaN, not an empty array. `0` and `false` count as present. */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Every field name a rule reads (used to snapshot evidence on the gate decision). */
export function fieldsReferenced(rule: RequiredRule): string[] {
  if ('anyOf' in rule) return rule.anyOf.flatMap(fieldsReferenced);
  if ('allOf' in rule) return rule.allOf.flatMap(fieldsReferenced);
  return [rule.field];
}

function leafPasses(rule: Extract<RequiredRule, { field: string }>, values: FieldValues): boolean {
  const value = getPath(values, rule.field);
  switch (rule.op) {
    case 'present':
      return isPresent(value);
    case 'minItems':
      return Array.isArray(value) && value.length >= rule.value;
    case 'equals':
      return value === rule.value;
    case 'oneOf':
      return (rule.value as unknown[]).includes(value);
    case 'gte':
      return typeof value === 'number' && value >= rule.value;
  }
}

function describeLeaf(rule: Extract<RequiredRule, { field: string }>): string {
  switch (rule.op) {
    case 'present':
      return `${rule.field} is required`;
    case 'minItems':
      return `${rule.field} needs at least ${rule.value} item(s)`;
    case 'equals':
      return `${rule.field} must equal ${String(rule.value)}`;
    case 'oneOf':
      return `${rule.field} must be one of: ${rule.value.join(', ')}`;
    case 'gte':
      return `${rule.field} must be at least ${rule.value}`;
  }
}

function describe(rule: RequiredRule): string {
  if ('anyOf' in rule) return rule.anyOf.map(describe).join(' or ');
  if ('allOf' in rule) return rule.allOf.map(describe).join(' and ');
  return describeLeaf(rule);
}

/**
 * Evaluates one rule. Returns every failure: an `allOf` reports each failing child, while a failing
 * `anyOf` reports a single error that names all the alternatives.
 */
export function evaluateRule(rule: RequiredRule, values: FieldValues): DomainError[] {
  if ('allOf' in rule) return rule.allOf.flatMap((child) => evaluateRule(child, values));
  if ('anyOf' in rule) {
    if (rule.anyOf.some((child) => evaluateRule(child, values).length === 0)) return [];
    return [
      new DomainError(
        'MISSING_FIELD',
        `At least one of: ${describe(rule)}`,
        fieldsReferenced(rule).join(','),
      ),
    ];
  }
  return leafPasses(rule, values)
    ? []
    : [new DomainError('MISSING_FIELD', describeLeaf(rule), rule.field)];
}

export function evaluateRules(rules: readonly RequiredRule[], values: FieldValues): DomainError[] {
  return rules.flatMap((rule) => evaluateRule(rule, values));
}
