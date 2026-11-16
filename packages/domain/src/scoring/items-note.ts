import type { ScoringModel } from './model';
import type { ScoreResult } from './score';
import { itemsVolumeText } from '../intake/items';

/**
 * FB-19 (W13-32): the quote's volume is the sum of its items'. With more than one item, the breakdown of
 * every attribute scored on the quote's volume (`input` = `quote.est_annual_volume`, whatever the model
 * calls it) says so: "3 items, 2.1 M units a year in total: …". The score itself is unchanged.
 */
export function withItemsNote(
  result: ScoreResult,
  model: Pick<ScoringModel, 'attributes'>,
  itemCount: number,
  totalVolume: number | null,
): ScoreResult {
  const note = itemsVolumeText(itemCount, totalVolume);
  if (!note) return result;
  const onVolume = new Set(
    model.attributes.filter((a) => a.input === 'quote.est_annual_volume').map((a) => a.key),
  );
  if (onVolume.size === 0) return result;
  return {
    ...result,
    breakdown: result.breakdown.map((b) =>
      onVolume.has(b.key) ? { ...b, explanation: `${note}: ${b.explanation}` } : b,
    ),
  };
}
