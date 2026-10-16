import { resolverFor } from './inputs';
import type { ScoringFacts } from './inputs';
import type { ScoringAttribute, ScoringBand, ScoringModel, ScoringTier } from './model';
import { canSeeCommercialFields } from '../policy/can';
import { isCommercialKey } from '../policy/sensitivity';
import type { Actor } from '../types/actor';

export interface ScoreBreakdownItem {
  key: string;
  label: string;
  weight: number;
  /** What the attribute was scored on (a number or a code); null when unknown or restricted. */
  raw: string | number | null;
  /** 0–100 for this attribute, after bands / map / inverse. */
  points: number;
  /** weight × points, the attribute's share of the total (2 decimals). */
  contribution: number;
  explanation: string;
  unknown: boolean;
  /** The input is a commercial field (e.g. preliminary capital): `raw` is hidden from roles without commercial access. */
  sensitive: boolean;
}

export interface ScoreResult {
  /** 0–100, one decimal. */
  total: number;
  tier: string;
  tierLabel: string;
  modelVersion: number;
  breakdown: ScoreBreakdownItem[];
  /** Attribute keys whose input was unknown and scored neutral, e.g. capital before Engineering Review. */
  unknowns: string[];
}

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function bandFor(bands: readonly ScoringBand[], value: number): ScoringBand | undefined {
  return bands.find(
    ([min, max]) => (min === null || value >= min) && (max === null || value < max),
  );
}

function describeBand([min, max]: ScoringBand): string {
  if (min === null && max === null) return 'any value';
  if (min === null) return `under ${fmt.format(max!)}`;
  if (max === null) return `${fmt.format(min)} or more`;
  return `${fmt.format(min)} to under ${fmt.format(max)}`;
}

/** The input names a commercial field (architecture §3.3), so its raw value is restricted. */
function isSensitive(attribute: ScoringAttribute): boolean {
  const path = attribute.map ? attribute.map.by.split('+') : [attribute.input];
  return path.some((p) => {
    const parts = p.trim().split('.');
    return isCommercialKey(parts[parts.length - 1]!, parts.slice(0, -1));
  });
}

function scoreAttribute(
  model: ScoringModel,
  attribute: ScoringAttribute,
  facts: ScoringFacts,
  now: Date,
): Omit<ScoreBreakdownItem, 'contribution' | 'key' | 'label' | 'weight' | 'sensitive'> {
  const resolved = resolverFor(attribute.input).resolve(attribute, facts, now);
  const unknownScore = attribute.unknownScore ?? model.unknownScore;
  const unknown = (why?: string) => ({
    raw: null,
    points: unknownScore,
    unknown: true,
    explanation: `${attribute.unknownExplanation ?? `${attribute.label} unknown`}${
      why ? ` (${why})` : ''
    }; scored a neutral ${fmt.format(unknownScore)}`,
  });
  if (resolved.raw === null) return unknown(resolved.detail);

  let base: number;
  let how: string;
  if (resolved.points !== undefined) {
    base = resolved.points;
    how = `${resolved.raw}${resolved.detail ? ` (${resolved.detail}, default)` : ''}`;
  } else {
    const value = Number(resolved.raw);
    const band = bandFor(attribute.bands ?? [], value);
    if (!band) return unknown(`${fmt.format(value)} is outside every band`);
    base = band[2];
    how = `${fmt.format(value)} is in the band ${describeBand(band)}`;
  }
  const points = attribute.inverse ? 100 - base : base;
  return {
    raw: resolved.raw,
    points,
    unknown: false,
    explanation: `${how} → ${fmt.format(points)} points${attribute.inverse ? ' (inverse scale)' : ''}`,
  };
}

export function tierFor(tiers: readonly ScoringTier[], total: number): ScoringTier {
  const sorted = [...tiers].sort((a, b) => b.min - a.min);
  return sorted.find((t) => total >= t.min) ?? sorted[sorted.length - 1]!;
}

/**
 * Scores a quote. Pure and deterministic: the same model, facts and `now` always give the same result.
 * `total` = Σ weight × points, rounded to one decimal; the tier is the highest tier whose `min` ≤ total.
 */
export function score(model: ScoringModel, facts: ScoringFacts, now: Date): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = model.attributes.map((attribute) => {
    const item = scoreAttribute(model, attribute, facts, now);
    return {
      key: attribute.key,
      label: attribute.label,
      weight: attribute.weight,
      ...item,
      contribution: round(attribute.weight * item.points, 2),
      sensitive: isSensitive(attribute),
    };
  });
  const total = round(
    model.attributes.reduce((acc, a, i) => acc + a.weight * breakdown[i]!.points, 0),
    1,
  );
  const tier = tierFor(model.tiers, total);
  return {
    total,
    tier: tier.key,
    tierLabel: tier.label ?? tier.key,
    modelVersion: model.version,
    breakdown,
    unknowns: breakdown.filter((b) => b.unknown).map((b) => b.key),
  };
}

/**
 * Hides the raw value behind commercial inputs (e.g. the preliminary capital estimate) from roles without
 * `quote.read.commercialFields`. Points and contribution stay, so the total still adds up.
 */
export function redactScore(result: ScoreResult, actor: Actor): ScoreResult {
  if (canSeeCommercialFields(actor)) return result;
  return {
    ...result,
    breakdown: result.breakdown.map((b) =>
      b.sensitive && !b.unknown
        ? {
            ...b,
            raw: null,
            explanation: `Based on a restricted commercial figure → ${fmt.format(b.points)} points`,
          }
        : b,
    ),
  };
}
