import type { Actor } from '../types/actor';
import type { UserId } from '../types/ids';

/**
 * Setting `kam_can_see_peer_scores` (D-K1, seed true). When false, a user whose only role is KAM does not see
 * the priority score, tier or breakdown of quotes owned by another KAM. Any other role sees all scores in scope.
 * The API applies this server-side; the UI never receives the hidden values.
 */
export function canSeePriorityScore(
  actor: Actor,
  quoteKamUserId: UserId | string,
  kamCanSeePeerScores: boolean,
): boolean {
  if (kamCanSeePeerScores) return true;
  if (quoteKamUserId === actor.userId) return true;
  return actor.roles.some((r) => r !== 'KAM');
}
