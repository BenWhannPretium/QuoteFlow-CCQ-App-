import type { SfAccount, SfOpportunity, SfProductSpec } from '@ccq/contracts';
import { Connection } from 'jsforce';

import { MAPPED_OBJECTS, OPPORTUNITY_OBJECT, PRODUCT_SPEC_OBJECT, type FieldRef } from './fieldMap';
import { jwtLogin, type JwtLoginConfig } from './jwt';
import {
  mapAccount,
  mapAll,
  mapOpportunityRecord,
  mapProductSpec,
  type MapOptions,
} from './mapper';
import { clientCredentialsLogin, type ClientCredentialsConfig, type SfSession } from './oauth';
import {
  searchTerms,
  silentLogger,
  type SalesforceReader,
  type SearchOpportunitiesParams,
  type SfLogger,
  type SfOpportunityRecord,
} from './reader';
import { isInvalidSession, sfErrorCode, withRetry, type RetryOptions } from './retry';
import {
  accountByIdSoql,
  changedOpportunitiesSoql,
  opportunityByIdSoql,
  productSpecsSoql,
  searchSoql,
  type AvailableFields,
} from './soql';

type Raw = Record<string, unknown>;

export interface SfQueryResult {
  records: Raw[];
  done: boolean;
  nextRecordsUrl?: string | undefined;
}

/**
 * The read-only slice of the Salesforce API the reader uses: SOQL query + queryMore, describe and
 * getDeleted. Nothing else is reachable through it. A stub implements it in unit tests.
 */
export interface SfApi {
  query(soql: string): Promise<SfQueryResult>;
  queryMore(locator: string): Promise<SfQueryResult>;
  /** Field API names of an object; null when the object doesn't exist or isn't visible. */
  describeFields(objectName: string): Promise<string[] | null>;
  deleted(objectName: string, start: Date, end: Date): Promise<{ id: string }[]>;
}

/** Logs in (JWT bearer or client credentials) and returns an SfApi bound to the session. */
export type SfApiFactory = () => Promise<SfApi>;

export const DEFAULT_SF_API_VERSION = '62.0';

/** SfApi over a jsforce v3 Connection. Only read calls are wrapped. */
export function jsforceApi(session: SfSession, version: string = DEFAULT_SF_API_VERSION): SfApi {
  const conn = new Connection({
    instanceUrl: session.instanceUrl,
    accessToken: session.accessToken,
    version,
  });
  const toResult = (r: { records: unknown[]; done: boolean; nextRecordsUrl?: string }) => ({
    records: r.records as Raw[],
    done: r.done,
    nextRecordsUrl: r.nextRecordsUrl,
  });
  return {
    query: async (soql) => toResult(await conn.query(soql, { autoFetch: false })),
    queryMore: async (locator) => toResult(await conn.queryMore(locator)),
    describeFields: async (objectName) => {
      try {
        const d = await conn.describe(objectName);
        return d.fields.map((f) => f.name);
      } catch (err) {
        if (sfErrorCode(err) === 'NOT_FOUND' || sfErrorCode(err) === 'INVALID_TYPE') return null;
        throw err;
      }
    },
    deleted: async (objectName, start, end) =>
      (await conn.sobject(objectName).deleted(start, end)).deletedRecords.map((d) => ({
        id: d.id,
      })),
  };
}

/** The login for `SF_AUTH_FLOW`. `flow` may be omitted for JWT (the original setup). */
export type JsforceReaderConfig = (
  ({ flow?: 'jwt' } & JwtLoginConfig) | ({ flow: 'client_credentials' } & ClientCredentialsConfig)
) & { apiVersion?: string };

/** JWT bearer login, then a jsforce connection. */
export const jwtApiFactory =
  (
    config: JwtLoginConfig & { apiVersion?: string },
    fetchImpl: typeof fetch = fetch,
  ): SfApiFactory =>
  async () =>
    jsforceApi(await jwtLogin(config, fetchImpl), config.apiVersion);

/** Client credentials login (the app's "Run As" user), then a jsforce connection. */
export const clientCredentialsApiFactory =
  (
    config: ClientCredentialsConfig & { apiVersion?: string },
    fetchImpl: typeof fetch = fetch,
  ): SfApiFactory =>
  async () =>
    jsforceApi(await clientCredentialsLogin(config, fetchImpl), config.apiVersion);

/** The production factory for the configured login flow. */
export const sfApiFactory = (
  config: JsforceReaderConfig,
  fetchImpl: typeof fetch = fetch,
): SfApiFactory =>
  config.flow === 'client_credentials'
    ? clientCredentialsApiFactory(config, fetchImpl)
    : jwtApiFactory(config, fetchImpl);

export interface JsforceReaderOptions extends MapOptions {
  logger?: SfLogger;
  retry?: RetryOptions;
  /** Clock for the getDeleted window (SF only keeps ~30 days). */
  now?: () => Date;
}

/**
 * The describe() field a SOQL path depends on: `Owner.Email` → `OwnerId`, `Spec__r.Name` →
 * `Spec__c`, `Name` → `Name`. (The related object's own fields aren't described here.)
 */
export function describedFieldFor(path: string): string {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return head!;
  return head!.endsWith('__r') ? `${head!.slice(0, -3)}__c` : `${head}Id`;
}

/** SF's getDeleted rejects starts older than ~30 days; stay just inside. */
const DELETED_WINDOW_MS = 29 * 86_400_000;

/**
 * Live, read-only reader. Logs in lazily, describes each mapped object once per session (dropping
 * custom fields the org lacks, logged by name), pages with queryMore, retries REQUEST_LIMIT_EXCEEDED
 * and 5xx with backoff, and times out each call after 20 s.
 */
export class JsforceSalesforceReader implements SalesforceReader {
  readonly mode = 'live' as const;
  private api: Promise<SfApi> | null = null;
  private available: Promise<AvailableFields> | null = null;
  private readonly logger: SfLogger;
  private readonly now: () => Date;

  constructor(
    private readonly connect: SfApiFactory,
    private readonly options: JsforceReaderOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
  }

  /** Run `fn` against the API with retry; on an expired session, log in again once. */
  private async call<T>(op: string, fn: (api: SfApi) => Promise<T>): Promise<T> {
    const attempt = async () => {
      this.api ??= this.connect();
      const api = await this.api.catch((err: unknown) => {
        this.api = null; // let the next call try to log in again
        throw err;
      });
      return fn(api);
    };
    const retry = {
      ...this.options.retry,
      onRetry: (info: { attempt: number; code: string; delayMs: number }) =>
        this.logger.warn({ op, ...info }, 'salesforce call retrying'),
    };
    try {
      return await withRetry(attempt, retry);
    } catch (err) {
      if (!isInvalidSession(err)) throw err;
      this.logger.info({ op }, 'salesforce session expired; logging in again');
      this.api = null;
      this.available = null;
      return withRetry(attempt, retry);
    }
  }

  /** Which mapped custom fields exist, per object. Described once per session. */
  private fields(): Promise<AvailableFields> {
    this.available ??= this.describeAll().catch((err: unknown) => {
      this.available = null;
      throw err;
    });
    return this.available;
  }

  private async describeAll(): Promise<AvailableFields> {
    const out: AvailableFields = {};
    for (const [objectName, map] of Object.entries(MAPPED_OBJECTS)) {
      const names = await this.call('describe', (api) => api.describeFields(objectName));
      const set = new Set(names ?? []);
      out[objectName] = set;
      const missing = Object.values<FieldRef>(map)
        .filter((ref) => ref.custom && !set.has(ref.path))
        .map((ref) => ref.path);
      if (names === null) {
        this.logger.warn({ object: objectName }, 'salesforce object not found; mapped as empty');
      } else if (missing.length > 0) {
        this.logger.warn(
          { object: objectName, missingFields: missing },
          'salesforce custom fields not in org; mapped as null (fieldMap.ts TODO(M3))',
        );
      }
    }
    return out;
  }

  /** All records for a SOQL query, following nextRecordsUrl. */
  private async *pages(op: string, soql: string): AsyncIterable<Raw[]> {
    let result = await this.call(op, (api) => api.query(soql));
    yield result.records;
    while (!result.done && result.nextRecordsUrl) {
      const locator = result.nextRecordsUrl;
      result = await this.call(op, (api) => api.queryMore(locator));
      yield result.records;
    }
  }

  private async queryAll(op: string, soql: string): Promise<Raw[]> {
    const all: Raw[] = [];
    for await (const page of this.pages(op, soql)) all.push(...page);
    return all;
  }

  private mapRecords(op: string, records: Raw[]): SfOpportunityRecord[] {
    const { items, dropped } = mapAll(records, (r) => mapOpportunityRecord(r, this.options));
    if (dropped > 0) this.logger.warn({ op, dropped }, 'salesforce records without an Id dropped');
    return items;
  }

  async searchOpportunities(p: SearchOpportunitiesParams): Promise<SfOpportunity[]> {
    const soql = searchSoql({ ...p, terms: searchTerms(p.q) }, await this.fields());
    const records = await this.queryAll('search', soql);
    return this.mapRecords('search', records).map((r) => r.opportunity);
  }

  async getOpportunity(id: string): Promise<SfOpportunityRecord | null> {
    const soql = opportunityByIdSoql(id, await this.fields());
    const [record] = this.mapRecords('getOpportunity', await this.queryAll('getOpportunity', soql));
    return record ?? null;
  }

  async getAccount(id: string): Promise<SfAccount | null> {
    const soql = accountByIdSoql(id, await this.fields());
    const [raw] = await this.queryAll('getAccount', soql);
    return raw ? mapAccount(raw) : null;
  }

  async *listChangedOpportunities(since: Date | null): AsyncIterable<SfOpportunityRecord[]> {
    const soql = changedOpportunitiesSoql(since, await this.fields());
    for await (const page of this.pages('listChanged', soql)) {
      yield this.mapRecords('listChanged', page);
    }
  }

  async listDeletedOpportunityIds(start: Date, end: Date): Promise<string[]> {
    const earliest = new Date(this.now().getTime() - DELETED_WINDOW_MS);
    const from = start < earliest ? earliest : start;
    if (from >= end) return [];
    const rows = await this.call('deleted', (api) => api.deleted(OPPORTUNITY_OBJECT, from, end));
    return rows.map((r) => r.id);
  }

  async getProductSpecs(opportunityId: string): Promise<SfProductSpec[]> {
    const available = await this.fields();
    const specFields = available[PRODUCT_SPEC_OBJECT];
    if (specFields && specFields.size === 0) return []; // object not in this org yet (M3)
    const soql = productSpecsSoql(opportunityId, available);
    if (!soql) return [];
    const { items } = mapAll(await this.queryAll('getProductSpecs', soql), mapProductSpec);
    return items;
  }

  /**
   * For the live contract test: each mapped field that doesn't resolve in the org, as
   * `Object.Field`. Empty when the whole field map resolves.
   */
  async unresolvedFields(): Promise<string[]> {
    const available = await this.fields();
    const missing: string[] = [];
    for (const [objectName, map] of Object.entries(MAPPED_OBJECTS)) {
      const set = available[objectName];
      for (const ref of Object.values<FieldRef>(map)) {
        if (!set?.has(describedFieldFor(ref.path))) missing.push(`${objectName}.${ref.path}`);
      }
    }
    return missing;
  }
}
