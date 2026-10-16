import { parseScoringModel } from './model';
import type { ScoringModel, ScoringModelInput } from './model';

/**
 * Scoring model v1: the PRD's seven F-05 attributes (D-19 open, PRD set recommended). Every weight, band and
 * map value is PROVISIONAL until the M4 review (Jim Zweifel + sales leadership; Bailey approves interim).
 * Strategic fit and product fit start neutral (empty maps, default 50) so no market or product is favoured
 * before the business says so. The DB seed (`scoring_model` row) is derived from this object.
 */
export const SCORING_MODEL_V1_INPUT = {
  version: 1,
  unknownScore: 50,
  provisional: true,
  attributes: [
    {
      key: 'revenue',
      label: 'Estimated annual revenue',
      weight: 0.2,
      input: 'quote.est_annual_revenue',
      bands: [
        [0, 25_000, 10],
        [25_000, 100_000, 40],
        [100_000, 250_000, 70],
        [250_000, null, 100],
      ],
      unknownExplanation: 'Annual revenue not given',
    },
    {
      key: 'volume',
      label: 'Estimated annual volume',
      weight: 0.15,
      input: 'quote.est_annual_volume',
      bands: [
        [0, 100_000, 10],
        [100_000, 500_000, 40],
        [500_000, 2_000_000, 70],
        [2_000_000, null, 100],
      ],
      unknownExplanation: 'Annual volume not given',
    },
    {
      key: 'strategic_fit',
      label: 'Strategic fit (where to play)',
      weight: 0.15,
      input: 'map',
      map: { by: 'market', values: {}, default: 50 },
      unknownExplanation: 'Market not given',
    },
    {
      key: 'capital_exposure',
      label: 'Capital exposure',
      weight: 0.15,
      input: 'eng_review.prelim_capital_usd',
      inverse: true,
      bands: [
        [null, 50_000, 0],
        [50_000, 250_000, 30],
        [250_000, 1_000_000, 60],
        [1_000_000, null, 90],
      ],
      unknownScore: 50,
      unknownExplanation: 'Capital exposure unknown until Engineering Review',
    },
    {
      key: 'customer_risk',
      label: 'Customer risk',
      weight: 0.1,
      input: 'map',
      map: { by: 'customer.status', values: { existing: 80, not_yet_established: 40 } },
      unknownExplanation: 'Customer status unknown',
    },
    {
      key: 'product_fit',
      label: 'Product fit',
      weight: 0.15,
      input: 'map',
      map: { by: 'product_family+resin', values: {}, default: 50 },
      unknownExplanation: 'Product family or resin not given',
    },
    {
      key: 'timing',
      label: 'Timing (days to expected close)',
      weight: 0.1,
      input: 'days_to_close',
      bands: [
        [null, 30, 100],
        [30, 90, 70],
        [90, 180, 40],
        [180, null, 20],
      ],
      unknownExplanation: 'Expected close date not given',
    },
  ],
  tiers: [
    { key: 'CRITICAL', label: 'Critical', min: 80 },
    { key: 'HIGH', label: 'High', min: 60 },
    { key: 'STANDARD', label: 'Standard', min: 40 },
    { key: 'LOW', label: 'Low', min: 0 },
  ],
} satisfies ScoringModelInput;

export const scoringModelV1: ScoringModel = parseScoringModel(SCORING_MODEL_V1_INPUT);
