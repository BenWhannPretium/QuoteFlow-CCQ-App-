import type { AuthSession } from './session';

/**
 * UX-016: "Check again" on the "No QuoteFlow access yet" page.
 *
 * The API reads a person's roles from their token, and the browser keeps a token for up to an hour. So
 * after IT adds someone to a group, a plain reload still sends the old token and still says "no access".
 * This asks the session for a fresh token first (skipping the cached one), then asks `/me` again.
 *
 * A failed refresh does not stop the second step: `/me` is asked either way, and its own answer (still
 * no role, signed out, or a redirect to sign in) is what the page then shows. Dev sign-in has no token,
 * so there the refresh does nothing and this is a plain refetch.
 */
export async function checkAccessAgain(
  session: Pick<AuthSession, 'headers'>,
  refetchMe: () => Promise<unknown>,
): Promise<void> {
  try {
    await session.headers({ forceRefresh: true });
  } catch {
    // The refetch below reports what is wrong.
  }
  await refetchMe();
}
