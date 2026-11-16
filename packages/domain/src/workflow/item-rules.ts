import { evaluateRule, evaluateRules, fieldsReferenced, type FieldValues } from './rules';
import { DomainError } from '../errors';
import { itemName } from '../intake/items';
import type { RequiredRule } from '../types/workflow-config';

/**
 * FB-19 (W13-32 to W13-34): the gate rules on a quote with items.
 *
 * The state builder (`loadQuoteStates`) puts each item's own facts on `fields.items` (its number, its
 * label, its engineering solution and its capacity rows); the quote's fields stay as they were (the
 * mirror of item 1 and item 1's review row), so a one-item quote is evaluated exactly as before.
 *
 * A rule that reads a fact the items carry is checked once per item, against the quote's fields with
 * that item's facts on top; every other rule is checked once. The gate passes only when every item
 * passes, and with more than one item each failure names its item ("Item 2 (24 oz bottle): …"). Which
 * rules are per item is not listed anywhere: it follows from the configured rules and the facts the
 * state builder puts on items, so an Admin's rule change keeps working.
 */

/** Keys on an item entry that identify it rather than describe it (never make a rule per item). */
const ITEM_IDENTITY_KEYS = new Set(['item_no', 'label', 'quote_item_id']);

export interface QuoteItemFacts {
  item_no: number;
  label: string | null;
  [fact: string]: unknown;
}

/** The items on a quote's fields (`fields.items`), or null when the state has none. */
export function quoteItemFacts(fields: FieldValues): QuoteItemFacts[] | null {
  const items = fields.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.filter((i): i is QuoteItemFacts => !!i && typeof i === 'object');
}

/** The facts the items carry (the union of their keys, less their identity). */
export function itemFactKeys(items: readonly QuoteItemFacts[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items)
    for (const key of Object.keys(item)) if (!ITEM_IDENTITY_KEYS.has(key)) keys.add(key);
  return keys;
}

/** True when `rule` reads a fact the items carry (its first path segment is an item fact). */
export function ruleIsPerItem(rule: RequiredRule, itemKeys: ReadonlySet<string>): boolean {
  return fieldsReferenced(rule).some((f) => itemKeys.has(f.split('.')[0] ?? ''));
}

/** One item's view of the quote: the quote's fields with the item's facts on top. */
export function itemView(fields: FieldValues, item: QuoteItemFacts): FieldValues {
  const { item_no: _n, label: _l, quote_item_id: _id, ...facts } = item;
  return { ...fields, ...facts };
}

/**
 * `evaluateRules` for a quote whose fields may carry items (see above). Without items it is exactly
 * `evaluateRules`.
 */
export function evaluateQuoteRules(
  rules: readonly RequiredRule[],
  fields: FieldValues,
): DomainError[] {
  const items = quoteItemFacts(fields);
  if (!items) return evaluateRules(rules, fields);
  const keys = itemFactKeys(items);
  const named = items.length > 1;
  const out: DomainError[] = [];
  for (const rule of rules) {
    if (!ruleIsPerItem(rule, keys)) {
      out.push(...evaluateRule(rule, fields));
      continue;
    }
    for (const item of items) {
      for (const e of evaluateRule(rule, itemView(fields, item))) {
        out.push(
          named
            ? new DomainError(
                e.code,
                `${itemName(item.item_no, item.label)}: ${e.message}`,
                e.field,
              )
            : e,
        );
      }
    }
  }
  return out;
}
