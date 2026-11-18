import { isApiError } from '@/lib/api';

import { RedirectingError } from './session';

/**
 * Whether a failed `/me` query should replace the whole app with a full-page message.
 *
 * `/me` goes stale after five minutes and refetches on window focus. In TanStack Query a failed
 * *refetch* reports an error while the last good identity is still held, and the gate used to swap the
 * page out on any error: coming back to the tab during a deploy restart or a VPN reconnect unmounted
 * the router and threw away whatever the user had typed. With an identity in hand, only an answer that
 * says the identity is no longer good (signed out, no role, or a sign-in redirect under way) takes the
 * page; a blip keeps the app on screen and the next refetch settles it.
 */
export function meErrorBlocksApp(hasIdentity: boolean, err: unknown): boolean {
  if (!hasIdentity) return true;
  return err instanceof RedirectingError || isApiError(err, 401) || isApiError(err, 403);
}
