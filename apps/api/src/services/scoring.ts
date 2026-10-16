import type { DbOrTx } from '@ccq/db';
import {
  getQuoteById,
  getScoringModel,
  getSetting,
  insertActivityEvent,
  loadScoringFacts,
  scoringModelInputFromRow,
  setQuotePriority,
} from '@ccq/db/repos';
import {
  parseQualificationSettings,
  parseScoringModel,
  score,
  type QualificationSettings,
  type ScoreResult,
  type ScoringModel,
} from '@ccq/domain';

/** What triggered a recalculation; recorded on the tier-change activity event. */
export type ScoringTrigger =
  'intake_submit' | 'intake_resubmit' | 'input_change' | `gate:${string}`;

/**
 * Advisory priority scoring (F-05, B-08). The domain computes; this service loads the model in effect,
 * assembles the facts, stores the result and records a tier change. A human still decides at G1.
 *
 * Recalculate on intake submit / resubmit, after every gate decision (G2 records the capital estimate)
 * and whenever an input field changes (B-10's engineering-review edits call `recalculate`).
 */
export class ScoringService {
  /** The newest scoring model effective at `at`, or null when none is configured. */
  async model(db: DbOrTx, at: Date): Promise<ScoringModel | null> {
    const row = await getScoringModel(db, at);
    return row ? parseScoringModel(scoringModelInputFromRow(row)) : null;
  }

  async qualificationSettings(db: DbOrTx): Promise<QualificationSettings> {
    const [minValue, minVolume, noteOutcomes] = await Promise.all([
      getSetting(db, 'min_opportunity_value_warning_usd'),
      getSetting(db, 'min_volume_warning_by_process'),
      getSetting(db, 'qualification_exception_note_outcomes'),
    ]);
    return parseQualificationSettings({
      minOpportunityValueUsd: minValue,
      minVolumeByProcess: minVolume,
      exceptionNoteOutcomes: noteOutcomes,
    });
  }

  async kamCanSeePeerScores(db: DbOrTx): Promise<boolean> {
    return (await getSetting(db, 'kam_can_see_peer_scores')) !== false;
  }

  /**
   * Scores the quote and stores the result. Writes a `priority_tier_changed` activity event when the
   * computed tier moves (an override keeps the displayed tier; the score and computed tier still update).
   */
  async recalculate(
    db: DbOrTx,
    quoteId: string,
    actorId: string,
    at: Date,
    trigger: ScoringTrigger,
  ): Promise<ScoreResult | null> {
    const [model, before, facts] = await Promise.all([
      this.model(db, at),
      getQuoteById(db, quoteId),
      loadScoringFacts(db, quoteId),
    ]);
    if (!model || !before || !facts) return null;

    const result = score(model, facts, at);
    await setQuotePriority(db, quoteId, result, at, {
      tierOverridden: before.priorityTierOverridden,
    });

    const previous =
      (before.priorityBreakdown as { computedTier?: string } | null)?.computedTier ??
      (before.priorityTierOverridden ? null : before.priorityTier);
    if (previous && previous !== result.tier) {
      await insertActivityEvent(db, {
        quoteId,
        type: 'priority_tier_changed',
        actorId,
        at,
        payload: {
          from: previous,
          to: result.tier,
          score: result.total,
          previousScore: before.priorityScore,
          modelVersion: result.modelVersion,
          trigger,
          overridden: before.priorityTierOverridden,
        },
        createdBy: actorId,
      });
    }
    return result;
  }
}
