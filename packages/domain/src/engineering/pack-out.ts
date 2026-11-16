import { PACK_OUT_LABELS, type PackOutField, type SolutionExtras } from './solution-extras';
import { DomainError } from '../errors';
import type { WorkflowConfig } from '../types/workflow-config';
import { itemName } from '../intake/items';
import { itemView, quoteItemFacts } from '../workflow/item-rules';

/**
 * FB-16 (W13-14; Zachary Cairns, 2026-11-13): pack-out reads as "one of these".
 *
 * Only one of units per bag / tray / case is needed, and bags and cases are never filled in together.
 * `app_setting.pack_out_rule` (provisional) holds both halves:
 *
 * - `notTogether`: groups of pack-out fields of which at most one may be filled. Seed: bag and case.
 *   Enforced on save (422) and inline in the form.
 * - `requireOneOf`: when true, G2 cannot advance (and the engineer cannot submit to the lead) until one of
 *   `PACK_OUT_UNIT_FIELDS` is filled. Seeded **false**: Engineering has not confirmed they know pack-out
 *   at quote time (W13-W7). An Admin switches it on; nothing is rebuilt.
 *
 * Units per pallet is separate: it is never part of the "one of" set.
 */
export const PACK_OUT_UNIT_FIELDS = ['unitsPerBag', 'unitsPerTray', 'unitsPerCase'] as const;
export type PackOutUnitField = (typeof PACK_OUT_UNIT_FIELDS)[number];

export interface PackOutRule {
  requireOneOf: boolean;
  notTogether: PackOutUnitField[][];
}

export const PACK_OUT_RULE_SEED: PackOutRule = {
  requireOneOf: false,
  notTogether: [['unitsPerBag', 'unitsPerCase']],
};

const isUnitField = (v: unknown): v is PackOutUnitField =>
  (PACK_OUT_UNIT_FIELDS as readonly unknown[]).includes(v);

/** Null / undefined → the seed. Throws INVALID_CONFIG on a malformed value. */
export function parsePackOutRule(input: unknown): PackOutRule {
  if (input === undefined || input === null) {
    return {
      requireOneOf: PACK_OUT_RULE_SEED.requireOneOf,
      notTogether: PACK_OUT_RULE_SEED.notTogether.map((g) => [...g]),
    };
  }
  const bad = (msg: string) => new DomainError('INVALID_CONFIG', `pack_out_rule: ${msg}`);
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('must be an object');
  const v = input as { requireOneOf?: unknown; notTogether?: unknown };
  if (typeof v.requireOneOf !== 'boolean') throw bad('"requireOneOf" must be true or false');
  const groups = v.notTogether ?? [];
  if (!Array.isArray(groups) || groups.length > 10) throw bad('"notTogether" must be a list');
  const notTogether = groups.map((group, i): PackOutUnitField[] => {
    if (!Array.isArray(group) || group.length < 2 || !group.every(isUnitField)) {
      throw bad(
        `"notTogether" group ${i + 1} must list two or more of: ${PACK_OUT_UNIT_FIELDS.join(', ')}`,
      );
    }
    if (new Set(group).size !== group.length) {
      throw bad(`"notTogether" group ${i + 1} repeats a field`);
    }
    return [...group];
  });
  return { requireOneOf: v.requireOneOf, notTogether };
}

type PackOutValues = Pick<SolutionExtras, PackOutField>;

const filled = (v: unknown) => v !== null && v !== undefined;
const lower = (field: PackOutField) => PACK_OUT_LABELS[field].toLowerCase();

/**
 * The "not together" half, as save errors: one error per field after the first that is filled in a group
 * ("Fill in units per bag or units per case, not both"). Empty when the values fit the rule.
 */
export function packOutRuleErrors(values: PackOutValues, rule: PackOutRule): DomainError[] {
  const errors: DomainError[] = [];
  for (const group of rule.notTogether) {
    const present = group.filter((f) => filled(values[f]));
    if (present.length < 2) continue;
    const names = group.map(lower);
    const tail = group.length === 2 ? 'both' : 'more than one';
    const message = `Fill in ${names.slice(0, -1).join(', ')} or ${names.at(-1)}, not ${tail}`;
    for (const field of present.slice(1)) {
      if (!errors.some((e) => e.field === field)) {
        errors.push(new DomainError('INVALID_VALUE', message, field));
      }
    }
  }
  return errors;
}

/** One of bag / tray / case is filled in. */
export const packOutUnitProvided = (values: Partial<Record<PackOutUnitField, unknown>>): boolean =>
  PACK_OUT_UNIT_FIELDS.some((f) => filled(values[f]));

/** What a missing pack-out reports as its field (a key in `REQUIREMENT_LABELS`). */
export const PACK_OUT_REQUIREMENT_KEY = 'pack_out_units';

/**
 * Does a gate outcome move the quote forward out of its stage (to a later stage, still active)? Read from
 * the workflow config's stage order, so it follows an Admin's changes: G2 Advance, Advance with risk and
 * Advance – capital required do; Hold, Rework (back to the KAM), Redirect and Stop do not.
 */
export function isForwardOutcome(
  config: Pick<WorkflowConfig, 'stages' | 'gates' | 'transitions'>,
  gateKey: string,
  outcomeKey: string,
): boolean {
  const gate = config.gates.find((g) => g.key === gateKey);
  const transition = config.transitions.find(
    (t) => t.gateKey === gateKey && t.outcomeKey === outcomeKey,
  );
  if (!gate || !transition || transition.nextStatus !== 'active') return false;
  const order = (key: string) => config.stages.findIndex((s) => s.key === key);
  const from = order(gate.stageKey);
  return (
    transition.targetStageKeys.length > 0 &&
    transition.targetStageKeys.every((key) => order(key) > from)
  );
}

/**
 * The "require one of" half, as a gate requirement (switched off in the seed). When the rule is on, a
 * forward outcome needs one of units per bag / tray / case on the Engineering Review. `fields` are the
 * quote's decision fields (snake_case, as the gate rules read them).
 */
export function packOutRequirementErrors(
  rule: PackOutRule,
  fields: Readonly<Record<string, unknown>>,
): DomainError[] {
  if (!rule.requireOneOf) return [];
  const message = 'Pack-out: units per bag, per tray or per case (fill in one)';
  const missing = (f: Readonly<Record<string, unknown>>) =>
    !packOutUnitProvided({
      unitsPerBag: f.units_per_bag,
      unitsPerTray: f.units_per_tray,
      unitsPerCase: f.units_per_case,
    });
  // FB-19: each item has its own pack-out; with several items the message names the item.
  const items = quoteItemFacts(fields);
  if (items) {
    return items
      .filter((item) => missing(itemView(fields, item)))
      .map(
        (item) =>
          new DomainError(
            'MISSING_FIELD',
            items.length > 1 ? `${itemName(item.item_no, item.label)}: ${message}` : message,
            PACK_OUT_REQUIREMENT_KEY,
          ),
      );
  }
  return missing(fields)
    ? [new DomainError('MISSING_FIELD', message, PACK_OUT_REQUIREMENT_KEY)]
    : [];
}
