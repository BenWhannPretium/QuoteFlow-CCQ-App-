/**
 * What a valid requested value is for each overridable field, and how values compare. Values are JSON
 * (`override.original_value` / `requested_value` are jsonb), so comparison is structural.
 */
export interface OverrideValueContext {
  /** Tier keys of the scoring model in effect (CRITICAL / HIGH / …). */
  tierKeys: readonly string[];
}

export type NormalizeResult = { ok: true; value: unknown } | { ok: false; message: string };

export interface OverrideValueKind {
  normalize(value: unknown, ctx: OverrideValueContext): NormalizeResult;
  /** One-line rendering for logs, notifications and CSV. */
  describe(value: unknown): string;
}

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'postal', 'country'] as const;

function normalizeAddress(value: unknown): NormalizeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'Enter an address' };
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ADDRESS_KEYS) {
    const v = src[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { ok: false, message: `${key} must be text` };
    const trimmed = v.trim().replace(/\s+/g, ' ');
    if (trimmed.length > 200) return { ok: false, message: `${key} is too long` };
    if (trimmed) out[key] = trimmed;
  }
  if (!out.line1 && !out.city) return { ok: false, message: 'Enter at least a street or a city' };
  return { ok: true, value: out };
}

export const OVERRIDE_VALUE_KINDS: Readonly<Record<string, OverrideValueKind>> = {
  priority_tier: {
    normalize: (value, ctx) =>
      typeof value === 'string' && ctx.tierKeys.includes(value)
        ? { ok: true, value }
        : { ok: false, message: `Choose one of ${ctx.tierKeys.join(', ')}` },
    describe: (value) => (typeof value === 'string' ? value : '—'),
  },
  ship_to: {
    normalize: normalizeAddress,
    describe: (value) => {
      if (!value || typeof value !== 'object') return '—';
      const a = value as Record<string, unknown>;
      return ADDRESS_KEYS.map((k) => a[k])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .join(', ');
    },
  },
  queue_position: {
    normalize: (value) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9999
        ? { ok: true, value }
        : { ok: false, message: 'Position must be a whole number from 1 (top of the queue)' },
    describe: (value) => (typeof value === 'number' ? `#${value}` : '—'),
  },
};

/** Stable JSON: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Structural equality for override values (null and undefined are the same "no value"). */
export const overrideValuesEqual = (a: unknown, b: unknown): boolean =>
  canonicalJson(a) === canonicalJson(b);

export const describeOverrideValue = (field: string, value: unknown): string =>
  OVERRIDE_VALUE_KINDS[field]?.describe(value) ?? canonicalJson(value);
