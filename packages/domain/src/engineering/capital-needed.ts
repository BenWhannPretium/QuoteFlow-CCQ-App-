import { DomainError } from '../errors';

/**
 * FB-17 (W13-22; Bailey Schmitt and Ben Whann, agreed 2026-11-12): "Advance – capital required" is gone
 * from G2. Whether a quote needs capital is no longer a choice at the gate: it follows from Engineering's
 * preliminary capital figure. Capital is needed when that figure is above
 * `app_setting.capital_needed_above_usd` (seed 0, provisional), so any amount above $0 needs capital and
 * an engineer enters $0 to say none is needed.
 *
 * Two readings, on purpose:
 *
 * - `engCapitalNeeded` is the fact the G2 rules read (`eng_capital_needed`). A blank figure counts as
 *   needed (fail closed): a blank must never let the equipment BOM be skipped.
 * - `capitalNeed` is what everything after G2 reads (the pricing and Final Review queues, the warnings,
 *   capital readiness). There a blank figure is unknown, not capital: a quote that advanced before G2
 *   asked for the figure is not flagged by it.
 */
export const CAPITAL_NEEDED_ABOVE_USD_SEED = 0;

/** The upper bound the Admin console accepts (the largest preliminary capital the form takes). */
const CAPITAL_NEEDED_ABOVE_USD_MAX = 999_999_999_999;

/** Null / undefined → the seed. Throws INVALID_CONFIG on anything that is not a dollar amount ≥ 0. */
export function parseCapitalNeededAboveUsd(input: unknown): number {
  if (input === undefined || input === null) return CAPITAL_NEEDED_ABOVE_USD_SEED;
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    input > CAPITAL_NEEDED_ABOVE_USD_MAX
  ) {
    throw new DomainError(
      'INVALID_CONFIG',
      'capital_needed_above_usd must be a dollar amount of 0 or more',
    );
  }
  return input;
}

/** The G2 outcome that said "capital required" before FB-17. Switched off; old decisions keep it. */
export const HISTORICAL_CAPITAL_OUTCOME = 'capital_required';

const amount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * `eng_capital_needed`, derived by the server for the G2 rules: the preliminary capital is above the
 * threshold. A blank or unreadable figure counts as needed.
 */
export function engCapitalNeeded(prelimCapitalUsd: unknown, aboveUsd: number): boolean {
  const figure = amount(prelimCapitalUsd);
  return figure === null ? true : figure > aboveUsd;
}

export type CapitalNeedReason = 'prelim_capital' | 'historical_outcome' | 'capital_likely';

export interface CapitalNeed {
  /** Any reason applies: the quote is treated as needing capital. */
  needed: boolean;
  /**
   * Engineering's own evidence says so: the preliminary capital is above the threshold, or the quote was
   * decided "Advance – capital required" before that outcome was switched off. The "capital likely" flag
   * alone (Sales can set it at intake) is not Engineering's evidence.
   */
  byEngineering: boolean;
  reasons: CapitalNeedReason[];
  /** The preliminary capital figure, when there is one. */
  prelimCapitalUsd: number | null;
}

/**
 * Whether a quote needs capital, and why, from its decision fields (`QuoteState.fields`): the
 * preliminary capital figure, Engineering's latest G2 outcome and the "capital likely" flag.
 *
 * FB-19: with items (`fields.items`), capital is needed when ANY item's figure is above the threshold,
 * and the figure is the items' total. A list row with no items passes the total as `prelim_capital_usd`
 * and the largest item figure as `prelim_capital_max_usd`.
 */
export function capitalNeed(
  fields: Readonly<Record<string, unknown>>,
  aboveUsd: number = CAPITAL_NEEDED_ABOVE_USD_SEED,
): CapitalNeed {
  const items = Array.isArray(fields.items)
    ? (fields.items as Readonly<Record<string, unknown>>[])
    : null;
  const figures = items
    ? items.map((i) => amount(i.prelim_capital_usd)).filter((v): v is number => v !== null)
    : null;
  const figure = figures
    ? figures.length > 0
      ? figures.reduce((a, b) => a + b, 0)
      : null
    : amount(fields.prelim_capital_usd);
  const largest = figures
    ? figures.length > 0
      ? Math.max(...figures)
      : null
    : (amount(fields.prelim_capital_max_usd) ?? figure);
  const reasons: CapitalNeedReason[] = [];
  if (largest !== null && largest > aboveUsd) reasons.push('prelim_capital');
  if (fields.g2_outcome === HISTORICAL_CAPITAL_OUTCOME) reasons.push('historical_outcome');
  const byEngineering = reasons.length > 0;
  if (fields.capital_likely === true) reasons.push('capital_likely');
  return { needed: reasons.length > 0, byEngineering, reasons, prelimCapitalUsd: figure };
}

/**
 * FB-21 (N17-19): whether a quote entering Quoting starts on the "capital needed" readiness
 * (`capital_readiness_default.whenNeeded`). Not needed only when every figure is entered (each item's,
 * on a multi-item quote) and none is above the threshold, and the quote was not decided with the retired
 * "Advance – capital required". A blank figure counts as needed, as at G2 (`engCapitalNeeded`).
 */
export function capitalNeededForReadiness(
  fields: Readonly<Record<string, unknown>>,
  aboveUsd: number = CAPITAL_NEEDED_ABOVE_USD_SEED,
): boolean {
  if (fields.g2_outcome === HISTORICAL_CAPITAL_OUTCOME) return true;
  const items = Array.isArray(fields.items)
    ? (fields.items as Readonly<Record<string, unknown>>[])
    : null;
  return items && items.length > 0
    ? items.some((i) => engCapitalNeeded(i.prelim_capital_usd, aboveUsd))
    : engCapitalNeeded(fields.prelim_capital_usd, aboveUsd);
}

/** "$250,000" for the timeline and messages (whole dollars; the figure is a budgetary estimate). */
export function formatCapitalUsd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** "Required to advance when preliminary capital is above $0": the BOM card and the field hint. */
export function capitalNeededRuleText(aboveUsd: number = CAPITAL_NEEDED_ABOVE_USD_SEED): string {
  return `Required to advance when preliminary capital is above ${formatCapitalUsd(aboveUsd)}`;
}

/**
 * What the Pricing and Final Review queues show as Engineering's decision: the G2 outcome's label, with
 * "capital needed" beside it when the quote needs capital. A quote decided with the retired "Advance –
 * capital required" outcome already says so in its label.
 */
export function g2DecisionText(entry: {
  g2Outcome: string | null;
  g2OutcomeLabel: string | null;
  capitalNeeded: boolean;
}): string | null {
  if (!entry.g2OutcomeLabel) return null;
  return entry.capitalNeeded && entry.g2Outcome !== HISTORICAL_CAPITAL_OUTCOME
    ? `${entry.g2OutcomeLabel} · capital needed`
    : entry.g2OutcomeLabel;
}
