/**
 * FB-12 (F-073, D-004): strategic-fit points from the Where-to-Play 9-box, by QuoteFlow SUB-MARKET.
 *
 * Source: Melanie Rasche (Director of Market Development, Food & Beverage), 2026-11-09, in her reply to
 * "QuoteFlow: your feedback on how quotes are scored", recorded in
 * `docs/build-guide/feedback/inputs/markets.md`. Her rule is by 9-box COLOUR: every sub-market in a
 * green box scores 80, in a yellow or gray box 50, in a red or pink box 20.
 *
 * PROVISIONAL: the weights and tier bands are still open (D-004), as are four of her own questions
 * (Sun Care is not in the sub-market list; what Home Care > Non-Core means; Histology and Tubes & Vials
 * are not on the 9-box). The three unscored sub-markets are left out ON PURPOSE: they get the neutral
 * default, so they are neither helped nor hurt.
 *
 * Draft only: these points seed an INACTIVE scoring model version (`SCORING_MODEL_V3_INPUT`). The live
 * model stays v2, whose strategic fit is the neutral 50 for every quote.
 */

/** The three colour bands and the points each carries (Melanie Rasche, 2026-11-09). */
export const WHERE_TO_PLAY_BAND_POINTS = {
  /** Green boxes: Primary Growth Engines, Upside Accelerators, Value Anchors. */
  strategic_growth: 80,
  /** Yellow and gray boxes: Future Capability Bets, Low-Risk Yielders, Specialist Niches. */
  selectively_participate: 50,
  /** Red and pink boxes: Fix-or-Exit Watchlist, Harvest Cash, Strategic Divestitures. */
  rationalization: 20,
} as const;
export type WhereToPlayBand = keyof typeof WHERE_TO_PLAY_BAND_POINTS;

export const WHERE_TO_PLAY_BAND_LABELS: Readonly<Record<WhereToPlayBand, string>> = {
  strategic_growth: 'Strategic Growth',
  selectively_participate: 'Selectively Participate',
  rationalization: 'Rationalization',
};

/** `sub_market` value-list code → the colour band of its 9-box cell. 27 of the 30 sub-markets. */
export const WHERE_TO_PLAY_SUB_MARKET_BANDS: Readonly<Record<string, WhereToPlayBand>> = {
  // Food
  FOOD_CONDIMENTS: 'selectively_participate',
  FOOD_FERMENTED: 'selectively_participate',
  FOOD_HONEY_SWEETENERS: 'rationalization',
  FOOD_SNACKS: 'strategic_growth',
  FOOD_NUT_BUTTERS: 'rationalization',
  FOOD_OILS: 'selectively_participate',
  FOOD_SPICES: 'strategic_growth',
  // Beverage
  BEV_NON_ALCOHOLIC: 'selectively_participate',
  BEV_SPIRITS_MIXERS: 'rationalization',
  // Nutrition & Wellness
  NW_LIQUID_SUPPLEMENTS: 'selectively_participate',
  NW_NUTRITIONAL_POWDERS: 'strategic_growth',
  NW_READY_TO_DRINK: 'selectively_participate',
  NW_VMS: 'strategic_growth',
  // OTC Health
  OTC_CONSUMER_HEALTH: 'selectively_participate',
  // Clinical (Histology and Tubes & Vials are not on the 9-box: unscored)
  CLIN_LIFE_SCIENCES: 'rationalization',
  CLIN_SPECIMEN_CONTAINERS: 'rationalization',
  CLIN_SWABS: 'rationalization',
  // Personal Care
  PC_BATH_SHOWER: 'strategic_growth',
  PC_HAIR: 'strategic_growth',
  PC_SKIN: 'strategic_growth',
  // Home Care (Non-Core is unscored: see open question 2 in markets.md)
  HC_CLEANING: 'selectively_participate',
  HC_PEST_CONTROL: 'rationalization',
  HC_LAWN_GARDEN: 'selectively_participate',
  HC_PET_CARE: 'rationalization',
  // Auto & Commercial Chemical
  ACC_AUTO_CARE: 'selectively_participate',
  ACC_AG_CROP: 'rationalization',
  ACC_COMMERCIAL_CHEMICAL: 'strategic_growth',
};

/** The sub-markets deliberately without points (they take the neutral default). */
export const WHERE_TO_PLAY_UNSCORED_SUB_MARKETS = [
  'CLIN_HISTOLOGY',
  'CLIN_TUBES_VIALS',
  'HC_NON_CORE',
] as const;

/** The `strategic_fit` `bySegment` values: sub-market code → points. */
export const WHERE_TO_PLAY_SUB_MARKET_POINTS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(WHERE_TO_PLAY_SUB_MARKET_BANDS).map(([subMarket, band]) => [
    subMarket,
    WHERE_TO_PLAY_BAND_POINTS[band],
  ]),
);

/** Shown when a quote has a market but no scored sub-market (the neutral default applies). */
export const PICK_SUB_MARKET_NOTE = 'Pick a sub-market to score strategic fit';

/** FB-12: how a quote's market and sub-market read together everywhere: "Food › Snacks & Confections". */
export function marketPath(
  market: string | null | undefined,
  subMarket: string | null | undefined,
): string | null {
  const parts = [market, subMarket].filter((p): p is string => !!p && p.trim() !== '');
  return parts.length > 0 ? parts.join(' › ') : null;
}
