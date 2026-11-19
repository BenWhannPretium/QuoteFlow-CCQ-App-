import { Connection } from 'jsforce';

import { DEFAULT_SF_API_VERSION } from './jsforce';
import { clientCredentialsLogin, type ClientCredentialsConfig, type SfSession } from './oauth';
import { silentLogger, type SfLogger } from './reader';
import { isInvalidSession, isRetryable, sfErrorCode, withTimeout, SF_TIMEOUT_MS } from './retry';
import { isWritableSfField } from './writeMap';
import {
  SF_ID,
  sfWriteHostProblem,
  type SalesforceWriter,
  type SfStageResult,
  type SfWriteResult,
} from './writer';

/**
 * FB-29: the live Salesforce writer. One of the two files allowed to call a jsforce write method
 * (`eslint.config.js` and `writeGuard.test.ts`); every other file in this folder stays read-only.
 *
 * - Its own identity: client credentials for a separate External Client App whose "Run As" user may
 *   edit only the approved fields (SF_WRITE_CLIENT_ID / _SECRET / _LOGIN_URL). Never the read-only user.
 * - Before any write, the `instance_url` the token response returns must pass `sfWriteHostProblem`: outside
 *   production only a sandbox is written to.
 * - Only `Opportunity` fields on the allow-list (`writeMap.ts`); never a create, delete or Account.
 * - One attempt per call (timeout 20 s; an expired session logs in again once): the outbox retries.
 *
 * Logs carry ids, field names and error codes only: never values, tokens or URLs with credentials.
 */

/** The slice of the API the writer uses. A stub implements it in unit tests. */
export interface SfWriteApi {
  readonly instanceUrl: string;
  /** Update one record; jsforce's save result. */
  update(
    objectName: string,
    record: { Id: string } & Record<string, string>,
  ): Promise<{ success: boolean; errors: unknown[] }>;
  /** The StageName of one opportunity, through this session; null when it is not found. */
  stageOf(sfOpportunityId: string): Promise<{ found: boolean; stage: string | null }>;
}

export type SfWriteApiFactory = () => Promise<SfWriteApi>;

export interface JsforceWriterConfig extends ClientCredentialsConfig {
  apiVersion?: string;
}

/** The SfWriteApi over a jsforce v3 Connection. */
export function jsforceWriteApi(
  session: SfSession,
  version: string = DEFAULT_SF_API_VERSION,
): SfWriteApi {
  const conn = new Connection({
    instanceUrl: session.instanceUrl,
    accessToken: session.accessToken,
    version,
  });
  return {
    instanceUrl: session.instanceUrl,
    update: async (objectName, record) => {
      const result = (await conn.sobject(objectName).update(record)) as unknown as {
        success: boolean;
        errors?: unknown[];
      };
      return { success: result.success, errors: result.errors ?? [] };
    },
    stageOf: async (id) => {
      // `id` passed SF_ID (letters and digits only) before it reaches the query.
      const r = await conn.query<{ StageName?: string | null }>(
        `SELECT StageName FROM Opportunity WHERE Id = '${id}' LIMIT 1`,
      );
      const rec = r.records[0];
      return rec ? { found: true, stage: rec.StageName ?? null } : { found: false, stage: null };
    },
  };
}

/** Client credentials login (the write user), then a write API. */
export const writeApiFactory =
  (config: JsforceWriterConfig, fetchImpl: typeof fetch = fetch): SfWriteApiFactory =>
  async () =>
    jsforceWriteApi(await clientCredentialsLogin(config, fetchImpl), config.apiVersion);

/** A save-result error's code (e.g. FIELD_CUSTOM_VALIDATION_EXCEPTION) and its message. */
function saveError(errors: unknown[]): { code: string; message: string } {
  const first = (errors[0] ?? {}) as { errorCode?: unknown; statusCode?: unknown; message?: unknown };
  const code =
    typeof first.errorCode === 'string'
      ? first.errorCode
      : typeof first.statusCode === 'string'
        ? first.statusCode
        : 'UPDATE_FAILED';
  const message = typeof first.message === 'string' ? first.message : 'Salesforce refused the update';
  return { code, message };
}

/** Save-result codes worth another try (a locked row, a busy org); everything else needs a person. */
const RETRYABLE_SAVE_CODES = new Set(['UNABLE_TO_LOCK_ROW', 'REQUEST_LIMIT_EXCEEDED', 'SERVER_UNAVAILABLE']);

export class JsforceSalesforceWriter implements SalesforceWriter {
  readonly mode = 'live' as const;
  private api: Promise<SfWriteApi> | null = null;
  private readonly logger: SfLogger;

  constructor(
    private readonly connect: SfWriteApiFactory,
    private readonly options: {
      /** APP_ENVIRONMENT: outside prod only a sandbox instance is written to. */
      appEnvironment: string;
      logger?: SfLogger;
      timeoutMs?: number;
    },
  ) {
    this.logger = options.logger ?? silentLogger;
  }

  /** Log in (once), and refuse an instance this environment may not write to. */
  private session(): Promise<SfWriteApi> {
    this.api ??= this.connect().then((api) => {
      const problem = sfWriteHostProblem(api.instanceUrl, this.options.appEnvironment);
      if (problem) throw Object.assign(new Error(problem), { errorCode: 'INSTANCE_REFUSED' });
      return api;
    });
    return this.api.catch((err: unknown) => {
      this.api = null;
      throw err;
    });
  }

  /** One call; an expired session logs in again once. */
  private async call<T>(op: string, fn: (api: SfWriteApi) => Promise<T>): Promise<T> {
    const timeout = this.options.timeoutMs ?? SF_TIMEOUT_MS;
    try {
      return await withTimeout(this.session().then(fn), timeout);
    } catch (err) {
      if (!isInvalidSession(err)) throw err;
      this.logger.info({ op }, 'salesforce write session expired; logging in again');
      this.api = null;
      return withTimeout(this.session().then(fn), timeout);
    }
  }

  private failure(op: string, err: unknown): { ok: false; retryable: boolean; code: string; message: string } {
    const code = sfErrorCode(err);
    const refused = code === 'INSTANCE_REFUSED';
    this.logger.warn({ op, code }, 'salesforce write call failed');
    return {
      ok: false,
      retryable: !refused && isRetryable(err),
      code,
      // A refused instance says why in plain words; anything else only its code (messages can echo data).
      message: refused && err instanceof Error ? err.message : `Salesforce call failed (${code})`,
    };
  }

  async updateOpportunity(
    sfOpportunityId: string,
    fields: Readonly<Record<string, string>>,
    options: { dedupeKey: string },
  ): Promise<SfWriteResult> {
    if (!SF_ID.test(sfOpportunityId)) {
      return { ok: false, retryable: false, code: 'INVALID_ID', message: 'not a Salesforce id' };
    }
    const names = Object.keys(fields);
    const refused = names.filter((f) => !isWritableSfField('Opportunity', f));
    if (names.length === 0 || refused.length > 0) {
      return {
        ok: false,
        retryable: false,
        code: 'FIELD_NOT_ALLOWED',
        message: `not on the write allow-list: ${refused.join(', ') || '(no fields)'}`,
      };
    }
    try {
      const result = await this.call('update', (api) =>
        api.update('Opportunity', { Id: sfOpportunityId, ...fields }),
      );
      if (result.success) {
        this.logger.info(
          { op: 'update', sfOpportunityId, fields: names, dedupeKey: options.dedupeKey },
          'salesforce opportunity updated',
        );
        return { ok: true };
      }
      const { code, message } = saveError(result.errors);
      this.logger.warn({ op: 'update', sfOpportunityId, fields: names, code }, 'salesforce refused the update');
      return { ok: false, retryable: RETRYABLE_SAVE_CODES.has(code), code, message };
    } catch (err) {
      return this.failure('update', err);
    }
  }

  async getCurrentStage(sfOpportunityId: string): Promise<SfStageResult> {
    if (!SF_ID.test(sfOpportunityId)) {
      return { ok: false, retryable: false, code: 'INVALID_ID', message: 'not a Salesforce id' };
    }
    try {
      const r = await this.call('stage', (api) => api.stageOf(sfOpportunityId));
      if (!r.found) {
        return {
          ok: false,
          retryable: false,
          code: 'NOT_FOUND',
          message: 'the write user cannot see this opportunity',
        };
      }
      return { ok: true, stage: r.stage };
    } catch (err) {
      return this.failure('stage', err);
    }
  }
}
