import { canSeeCommercialFields } from './can';
import { isCommercialKey, toSnakeCase } from './sensitivity';
import type { Actor } from '../types/actor';

function strip(value: unknown, ancestors: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, ancestors));
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return value; // Date, Map, class instances: leave intact
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isCommercialKey(key, ancestors)) continue;
    out[key] = strip(child, [...ancestors, toSnakeCase(key)]);
  }
  return out;
}

/**
 * Returns a copy of `entity` without commercial fields, unless the actor holds `quote.read.commercialFields`.
 * Works on nested objects and arrays and never mutates the input. The result is typed as `T` for convenience,
 * but commercial properties may be absent, so DTO schemas should mark them optional.
 */
export function redact<T>(entity: T, actor: Actor): T {
  if (canSeeCommercialFields(actor)) return entity;
  return strip(entity, []) as T;
}
