import type { ScoringFacts } from '../scoring/inputs';
import type { ScoringModel } from '../scoring/model';
import { score } from '../scoring/score';

/**
 * "What would this scoring change do?" (B-19). Scores the same quotes under the active model and a
 * draft, then compares totals, tiers and rank. Pure: the caller loads the quotes (the last 50) and
 * passes `now`, so a preview never touches a stored score.
 */

export interface PreviewQuote {
  id: string;
  facts: ScoringFacts;
}

export interface PreviewSide {
  score: number;
  tier: string;
  /** 1 = highest score among the previewed quotes. */
  rank: number;
}

export interface ScoringPreviewRow {
  quoteId: string;
  /** Null when there is no active model to compare against. */
  before: PreviewSide | null;
  after: PreviewSide;
  tierChanged: boolean;
  /** before.rank − after.rank: positive = moved up the list. 0 when there is no before. */
  rankDelta: number;
}

export interface ScoringPreview {
  rows: ScoringPreviewRow[];
  summary: {
    quotes: number;
    tierChanges: number;
    rankChanges: number;
    movedUp: number;
    movedDown: number;
    /** Quotes per tier before and after, in the draft's tier order (highest first). */
    byTier: { tier: string; label: string; before: number; after: number }[];
  };
}

/** Ranks by score, highest first; ties keep the input order (newest first), so ranks are stable. */
function ranks(scores: readonly number[]): number[] {
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const out = new Array<number>(scores.length);
  order.forEach(({ i }, position) => (out[i] = position + 1));
  return out;
}

export function previewScoringChange(
  current: ScoringModel | null,
  draft: ScoringModel,
  quotes: readonly PreviewQuote[],
  now: Date,
): ScoringPreview {
  const after = quotes.map((q) => score(draft, q.facts, now));
  const before = current ? quotes.map((q) => score(current, q.facts, now)) : null;
  const afterRanks = ranks(after.map((r) => r.total));
  const beforeRanks = before ? ranks(before.map((r) => r.total)) : null;

  const rows: ScoringPreviewRow[] = quotes.map((q, i) => {
    const a = after[i]!;
    const b = before?.[i];
    const beforeSide = b ? { score: b.total, tier: b.tier, rank: beforeRanks![i]! } : null;
    return {
      quoteId: q.id,
      before: beforeSide,
      after: { score: a.total, tier: a.tier, rank: afterRanks[i]! },
      tierChanged: beforeSide !== null && beforeSide.tier !== a.tier,
      rankDelta: beforeSide ? beforeSide.rank - afterRanks[i]! : 0,
    };
  });

  const tiers = [...draft.tiers].sort((x, y) => y.min - x.min);
  const known = new Set(tiers.map((t) => t.key));
  const extra = (before ?? []).map((r) => r.tier).filter((t) => !known.has(t));
  const byTier = [
    ...tiers.map((t) => ({ tier: t.key, label: t.label ?? t.key })),
    ...[...new Set(extra)].map((t) => ({ tier: t, label: t })),
  ].map((t) => ({
    ...t,
    before: rows.filter((r) => r.before?.tier === t.tier).length,
    after: rows.filter((r) => r.after.tier === t.tier).length,
  }));

  return {
    rows,
    summary: {
      quotes: rows.length,
      tierChanges: rows.filter((r) => r.tierChanged).length,
      rankChanges: rows.filter((r) => r.rankDelta !== 0).length,
      movedUp: rows.filter((r) => r.rankDelta > 0).length,
      movedDown: rows.filter((r) => r.rankDelta < 0).length,
      byTier,
    },
  };
}
