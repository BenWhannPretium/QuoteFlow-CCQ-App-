import { canSeeCommercialFields } from '../policy/can';
import { isCommercialKey } from '../policy/sensitivity';
import type { Actor } from '../types/actor';

/**
 * B-14 list helpers shared by the quote list, the prioritization view, the board and the CSV export.
 */

/**
 * Whether the actor sees other KAMs' priority (score, tier, breakdown). Mirrors `canSeePriorityScore`
 * for "a quote that isn't theirs": the list's SQL uses it to stop a tier filter or a score sort from
 * revealing a peer's withheld priority (`kam_can_see_peer_scores`, open question D-K1).
 */
export function seesPeerPriority(actor: Actor, kamCanSeePeerScores: boolean): boolean {
  return kamCanSeePeerScores || actor.roles.some((r) => r !== 'KAM');
}

const DAY_MS = 86_400_000;

/** Whole calendar days (24 h periods) from `from` to `now`, never negative. */
export function daysSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
}

/**
 * The columns a CSV export may contain for this actor: the requested (visible) ones, minus commercial
 * fields (architecture §3.3, the same registry `redact` uses) for roles without
 * `quote.read.commercialFields`. Unknown keys are dropped; order is kept; duplicates removed.
 */
export function exportColumnsFor(
  actor: Actor,
  requested: readonly string[],
  known: readonly string[],
): string[] {
  const commercial = canSeeCommercialFields(actor);
  const allowed = new Set(known);
  return [...new Set(requested)].filter(
    (key) => allowed.has(key) && (commercial || !isCommercialKey(key, [])),
  );
}

/** "Avery Q. Kam" → "AK"; used for the board's KAM avatar. */
export function personInitials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}
