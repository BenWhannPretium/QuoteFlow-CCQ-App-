import { z } from 'zod';

import { DomainError } from '../errors';
import { INPUT_RESOLVERS } from './inputs';

/**
 * The scoring model DSL (mirrors the `scoring_model` table). Advisory only: the score orders queues and
 * informs G1, a human decides. Attributes, weights, bands and tiers are config (D-19 open), never code.
 *
 * An attribute turns one input into 0–100 points:
 * - `input` names a resolver in `INPUT_RESOLVERS` (`map`, `days_to_close`, …) or, otherwise, a fact path
 *   such as `quote.est_annual_revenue` / `eng_review.prelim_capital_usd` whose number is banded.
 * - `bands`: `[min, max, points]`, min inclusive, max exclusive, `null` = open-ended.
 * - `map`: `{ by, values, default }` looks up a code (`by` may join several facts with `+`).
 * - `inverse`: flips the points (100 − p), so bands can be written "bigger number, bigger band".
 * - an unknown input scores `unknownScore` (else the model's) and is listed in `unknowns`.
 */

const points = z.number().min(0).max(100);
const bound = z.number().nullable();

export const scoringBandSchema = z.tuple([bound, bound, points]);

export const scoringMapSchema = z
  .object({
    /** Fact path, or several joined with `+` (`product_family+resin` → `BOTTLE+HDPE`). Bare names mean `quote.<name>`. */
    by: z.string().min(1),
    values: z.record(z.string(), points),
    /** Points for a known value that is not in `values`. Without it, such a value counts as unknown. */
    default: points.optional(),
  })
  .strict();

export const scoringAttributeSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    weight: z.number().min(0).max(1),
    input: z.string().min(1),
    bands: z.array(scoringBandSchema).optional(),
    map: scoringMapSchema.optional(),
    inverse: z.boolean().default(false),
    unknownScore: points.optional(),
    /** Shown when the input is unknown, e.g. "Unknown until Engineering Review". */
    unknownExplanation: z.string().min(1).optional(),
    provisional: z.boolean().default(true),
  })
  .strict();

export const scoringTierSchema = z
  .object({ key: z.string().min(1), label: z.string().min(1).optional(), min: points })
  .strict();

export const scoringModelSchema = z
  .object({
    version: z.number().int().min(1),
    attributes: z.array(scoringAttributeSchema).min(1),
    tiers: z.array(scoringTierSchema).min(1),
    /** Points for an unknown input when the attribute sets no `unknownScore`. */
    unknownScore: points.default(50),
    provisional: z.boolean().default(true),
  })
  .strict();

export type ScoringBand = z.infer<typeof scoringBandSchema>;
export type ScoringAttribute = z.infer<typeof scoringAttributeSchema>;
export type ScoringTier = z.infer<typeof scoringTierSchema>;
export type ScoringModelInput = z.input<typeof scoringModelSchema>;
export type ScoringModel = z.infer<typeof scoringModelSchema>;

/** Weights may be written as 0.2 or 0.15; floating point sums get this much slack. */
const WEIGHT_TOLERANCE = 1e-6;

export function validateScoringModel(model: ScoringModel): DomainError[] {
  const errors: DomainError[] = [];
  const bad = (message: string) => errors.push(new DomainError('INVALID_CONFIG', message));

  const sum = model.attributes.reduce((acc, a) => acc + a.weight, 0);
  if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
    bad(`Scoring weights must sum to 1 (they sum to ${Number(sum.toFixed(6))})`);
  }

  const keys = new Set<string>();
  for (const a of model.attributes) {
    if (keys.has(a.key)) bad(`Duplicate scoring attribute "${a.key}"`);
    keys.add(a.key);
    const usesMap = INPUT_RESOLVERS[a.input]?.mapsToPoints === true;
    if (usesMap && !a.map) bad(`Attribute "${a.key}" uses input "${a.input}" but has no map`);
    if (!usesMap && (!a.bands || a.bands.length === 0)) {
      bad(`Attribute "${a.key}" needs bands for input "${a.input}"`);
    }
    for (const [min, max] of a.bands ?? []) {
      if (min !== null && max !== null && min >= max) {
        bad(`Attribute "${a.key}" has a band whose min (${min}) is not below its max (${max})`);
      }
    }
  }

  const tierKeys = new Set(model.tiers.map((t) => t.key));
  if (tierKeys.size !== model.tiers.length) bad('Duplicate scoring tier key');
  if (!model.tiers.some((t) => t.min === 0)) bad('One scoring tier must start at 0');
  return errors;
}

/** Parses untrusted config (seed, DB row), applies defaults and validates it. Throws INVALID_CONFIG. */
export function parseScoringModel(input: unknown): ScoringModel {
  const parsed = scoringModelSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `Scoring model failed schema validation: ${detail}`);
  }
  const errors = validateScoringModel(parsed.data);
  if (errors.length > 0) {
    throw new DomainError('INVALID_CONFIG', errors.map((e) => e.message).join('; '));
  }
  return parsed.data;
}
