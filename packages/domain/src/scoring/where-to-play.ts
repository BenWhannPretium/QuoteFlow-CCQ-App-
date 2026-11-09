/**
 * FB-10 (F-073, D-004 open): strategic-fit points from the Where-to-Play 9-box, by QuoteFlow market.
 * Everything here is PROVISIONAL. The grid (`docs/build-guide/feedback/inputs/9-box.md`) is by segment and
 * the text extraction lost which segment sits in which cell, so the placement is unconfirmed (Melanie
 * Rasche). The points are the example in that file; D-004 sets the real ones. The market list is coarse,
 * so each market takes the cell most of its segments sit in (option (b) of D-004: score by market).
 *
 * Draft only: these points seed an INACTIVE scoring model version. The live model is unchanged.
 */

/** The 9-box groups as the extraction lists them, and the points each carries (the file's example). */
export const WHERE_TO_PLAY_GROUP_POINTS = {
  strategic_growth_1: 90,
  strategic_growth_2: 75,
  strategic_growth_3: 60,
  selectively_participate: 50,
  rationalization: 20,
} as const;
export type WhereToPlayGroup = keyof typeof WHERE_TO_PLAY_GROUP_POINTS;

export const WHERE_TO_PLAY_GROUP_LABELS: Readonly<Record<WhereToPlayGroup, string>> = {
  strategic_growth_1: 'Strategic Growth (1)',
  strategic_growth_2: 'Strategic Growth (2)',
  strategic_growth_3: 'Strategic Growth (3)',
  selectively_participate: 'Selectively Participate',
  rationalization: 'Rationalization',
};

/** `market` value-list code → the group most of its segments sit in (provisional, unconfirmed). */
export const WHERE_TO_PLAY_MARKET_GROUPS: Readonly<Record<string, WhereToPlayGroup>> = {
  // Hair, bath & shower, skin
  PERSONAL_CARE: 'strategic_growth_1',
  // Nutritional powders; nut butter & spreads; pet care (honey is Rationalization)
  NUTRITION: 'strategic_growth_2',
  FOOD: 'strategic_growth_2',
  PET: 'strategic_growth_2',
  // Non-alcoholic beverages (alcoholic is Rationalization)
  BEVERAGE: 'strategic_growth_3',
  // Pest control is Strategic Growth, cleaning and lawn/garden Rationalization: a split market
  HOUSEHOLD_CHEMICAL: 'selectively_participate',
  // Commercial chemical is Selectively Participate; life sciences, ag chem and auto care are not
  INDUSTRIAL_CHEMICAL: 'selectively_participate',
  // Specimen containers, swabs, consumer health
  PHARMA_HEALTH: 'rationalization',
};

/** The `strategic_fit` map values: market code → points. */
export const WHERE_TO_PLAY_MARKET_POINTS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(WHERE_TO_PLAY_MARKET_GROUPS).map(([market, group]) => [
    market,
    WHERE_TO_PLAY_GROUP_POINTS[group],
  ]),
);
