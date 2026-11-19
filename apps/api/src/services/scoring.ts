import type { DbOrTx } from '@ccq/db';
import {
  getQuoteById,
  getScoringModel,
  getSetting,
  insertActivityEvent,
  loadScoringFacts,
  scoringModelInputFromRow,
  setQuotePriority,
  listQuoteItems,
} from '@ccq/db/repos';
import {
  parseQualificationSettings,
  parseScoringModel,
  score,
  type QualificationSettings,
  type ScoreResult,
  type ScoringModel,
  withItemsNote,
} from '@ccq/domain';

/** What triggered a recalculation; recorded on the score-change activity event. */
export type ScoringTrigger =
  | 'intake_submit'
  | 'intake_resubmit'
  | 'input_change'
  /** B-19: an admin activated a new scoring model version (background rescore of open quotes). */
  | 'model_change'
  | `gate:${string}`;

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
   * Scores the quote and stores the result. Writes one `priority_score_changed` activity event when the
   * score or the computed tier moves (an override keeps the displayed tier; the score and computed tier
   * still update), and says so in `tierChanged`.
   */
  async recalculate(
    db: DbOrTx,
    quoteId: string,
    actorId: string,
    at: Date,
    trigger: ScoringTrigger,
  ): Promise<(ScoreResult & { tierChanged: boolean }) | null> {
    const [model, before, facts, items] = await Promise.all([
      this.model(db, at),
      getQuoteById(db, quoteId),
      loadScoringFacts(db, quoteId),
      listQuoteItems(db, quoteId),
    ]);
    if (!model || !before || !facts) return null;

    // FB-19 (W13-32): the quote's volume is the sum of its items'; the breakdown says so.
    const result = withItemsNote(
      score(model, facts, at),
      model,
      items.length,
      before.estAnnualVolume,
    );
    await setQuotePriority(db, quoteId, result, at, {
      tierOverridden: before.priorityTierOverridden,
    });

    const previous =
      (before.priorityBreakdown as { computedTier?: string } | null)?.computedTier ??
      (before.priorityTierOverridden ? null : before.priorityTier);
    const tierChanged = !!previous && previous !== result.tier;
    // FB-27 (N17-15): one `priority_score_changed` event per recalculation that moves the score (or the
    // computed tier, e.g. a new model's bands), with the tier before and after. It replaces the tier-only
    // event; older `priority_tier_changed` rows are still read. The first score of a quote has no "from".
    const previousScore = before.priorityScore;
    const scoreChanged = previousScore !== null && !sameScore(previousScore, result.total);
    if (scoreChanged || tierChanged) {
      await insertActivityEvent(db, {
        quoteId,
        type: 'priority_score_changed',
        actorId,
        at,
        payload: {
          from: previousScore,
          to: result.total,
          tierFrom: previous,
          tierTo: result.tier,
          tierChanged,
          modelVersion: result.modelVersion,
          trigger,
          overridden: before.priorityTierOverridden,
        },
        createdBy: actorId,
      });
    }
    return { ...result, tierChanged };
  }
}

/** Scores are stored to two decimals; compare at that precision so a rounding wobble is not a change. */
const sameScore = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
