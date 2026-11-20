/**
 * FB-29 (N19-01, D-16w): the governed write to Salesforce. A separate interface from `SalesforceReader`
 * (which still has no write method), reached only through the write-back worker, and only while the
 * write-back is switched on (CLAUDE.md rule 5).
 *
 * Salesforce's REST update has no idempotency key, and jsforce's `update` returns only
 * `{ id, success, errors }`. The `dedupeKey` is the outbox's, local only: a retry is made safe by reading
 * the current value first (`getCurrentStage`), never by a server-side key.
 *
 * The writer uses its OWN identity (`SF_WRITE_*`): a separate External Client App and "Run As" user with
 * edit access on the approved fields only. The read-only integration user is never reused. On the test
 * site the reader points at the production org, so the writer's checks read through the writer's own
 * session, never the reader's: a sandbox writer is never compared against production data.
 */

export type SfWriteResult =
  { ok: true } | { ok: false; retryable: boolean; code: string; message: string };

export type SfStageResult =
  | { ok: true; stage: string | null }
  | { ok: false; retryable: boolean; code: string; message: string };

export interface SalesforceWriter {
  readonly mode: 'fake' | 'live';
  /**
   * Update fields on one Opportunity. Only fields on the write allow-list (`writeMap.ts`); anything else
   * is refused without a call. Never throws: a failure says whether it is worth another try.
   */
  updateOpportunity(
    sfOpportunityId: string,
    fields: Readonly<Record<string, string>>,
    options: { dedupeKey: string },
  ): Promise<SfWriteResult>;
  /** The opportunity's StageName now, read through the writer's own session. Never throws. */
  getCurrentStage(sfOpportunityId: string): Promise<SfStageResult>;
}

/** A Salesforce record id (15 or 18 characters). Anything else is refused before a call. */
export const SF_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

/**
 * Why a Salesforce URL may not be written to from this environment; null when it may. Used for the
 * configured login URL (at start-up) and again for the `instance_url` the token response returns (before
 * any write):
 *
 * - https, on a My Domain host (`*.my.salesforce.com`): the client credentials flow refuses
 *   login.salesforce.com and test.salesforce.com, and `test.salesforce.com` would otherwise look like a sandbox;
 * - outside production (`APP_ENVIRONMENT` other than prod) only a **sandbox** My Domain (a host containing
 *   `.sandbox.`): the test site must never write to the production org.
 */
export function sfWriteHostProblem(url: string, appEnvironment: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'the Salesforce write URL is not a valid URL';
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') return 'the Salesforce write URL must start with https://';
  if (host === 'login.salesforce.com' || host === 'test.salesforce.com') {
    return `${host} cannot be used: the write user logs in with client credentials, which needs the org's My Domain URL`;
  }
  if (!host.endsWith('.my.salesforce.com')) {
    return 'the Salesforce write URL must be a My Domain URL (ending in .my.salesforce.com)';
  }
  if (appEnvironment !== 'prod' && !host.includes('.sandbox.')) {
    return 'outside production QuoteFlow may only write to a Salesforce sandbox (a My Domain URL containing .sandbox.); this one looks like a production org';
  }
  return null;
}
